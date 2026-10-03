import { hashText } from "../../shared/hash.js";
import { randomUUID } from "../../shared/id.js";
import { markdownForFeishu, markdownTitle } from "../../shared/markdown.js";
import { feishuTargetKey, parseFeishuTarget, type FeishuTarget } from "../../shared/feishuTarget.js";
import type { FeishuChapterPending, FeishuDocument, Note, SyncResult, SyncWarning } from "../../shared/types.js";
import type { SyncContext } from "./types.js";
import { FeishuApi, FeishuError, isId, isObject, isRevision, prepareBlockBatches, type Block, type Converted, type DocumentInfo } from "./feishuApi.js";

type Snapshot = { revision: number; roots: string[]; blocks: Map<string, Block> };
const hash = hashText;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => key !== "revision_id").map((key) => [key, canonical(value[key])]));
}

function chapterFingerprint(snapshot: Snapshot, roots: string[]): string {
  const visited = new Set<string>();
  function tree(id: string, depth = 0): unknown {
    const block = snapshot.blocks.get(id);
    if (!block || visited.has(id) || depth > 100) throw new FeishuError("chapter-missing");
    visited.add(id);
    return { block: canonical(block), descendants: (block.children ?? []).map((child) => tree(child, depth + 1)) };
  }
  return hash(JSON.stringify(roots.map((id) => tree(id))));
}

function chapterIndex(snapshot: Snapshot, ids: string[]): number {
  if (!ids.length) return -1;
  const index = snapshot.roots.indexOf(ids[0]);
  if (index < 0 || ids.some((id, offset) => snapshot.roots[index + offset] !== id)) throw new FeishuError("chapter-missing");
  return index;
}

// Append mode only owns these recorded block IDs. It never clears a document root.
export async function appendFeishuChapter(api: FeishuApi, note: Note, context: SyncContext, initial: FeishuDocument, target: FeishuTarget): Promise<SyncResult> {
  let link = structuredClone(initial);
  const config = context.credentials!;
  const warnings: SyncWarning[] = [];
  if (note.attachments.length) warnings.push("local-attachments");
  const checkpoint = async (patch: Partial<FeishuDocument>) => {
    link = { ...link, ...patch };
    if (!context.saveFeishuDocument) throw new FeishuError("local-save");
    try { await context.saveFeishuDocument(structuredClone(link)); } catch { throw new FeishuError("local-save"); }
  };
  try {
    if (!note.content.trim()) throw new FeishuError("empty-note");
    if (note.content.length > 10_485_760) throw new FeishuError("too-large");
    const token = await api.accessToken(config);
    let documentId = target.token;
    if (target.kind === "wiki") {
      const result = await api.request<{ data: { node: { obj_type: string; obj_token: string } } }>(`/wiki/v2/spaces/get_node?token=${encodeURIComponent(target.token)}`, "GET", undefined, token);
      if (result.data?.node?.obj_type !== "docx" || !isId(result.data.node.obj_token)) throw new FeishuError("target-not-document");
      documentId = result.data.node.obj_token;
    }
    const history = [note.feishu, ...Object.values(note.feishuTargets ?? {})].filter((item): item is FeishuDocument => !!item && item.appId === config.appId && item.mode === "append");
    const source = history.find((item) => {
      const previous = parseFeishuTarget(item.url ?? "");
      return previous?.kind === target.kind && previous.token === target.token;
    });
    if (source?.documentId && source.documentId !== documentId) throw new FeishuError("target-changed");
    const sameDocument = history.find((item) => item.documentId === documentId);
    link = { ...structuredClone(sameDocument ?? link), documentId, url: target.url, mode: "append",
      targetKey: feishuTargetKey(config.appId, "append", { kind: "docx", token: documentId, url: target.url }) };
    const docPath = `/docx/v1/documents/${documentId}`;
    const rootPath = `${docPath}/blocks/${documentId}`;
    const metadata = async () => {
      const result = await api.request<{ data: { document: DocumentInfo } }>(docPath, "GET", undefined, token);
      if (result.data?.document?.document_id !== documentId || !isRevision(result.data.document.revision_id)) throw new FeishuError("verification");
      return result.data.document;
    };
    const readSnapshot = async (): Promise<Snapshot> => {
      const revision = (await metadata()).revision_id;
      const blocks = new Map<string, Block>();
      const seenPages = new Set<string>();
      let pageToken = "";
      do {
        const query = new URLSearchParams({ document_revision_id: String(revision), page_size: "500" });
        if (pageToken) query.set("page_token", pageToken);
        const response = await api.request<{ data: { items: Block[]; has_more: boolean; page_token?: string } }>(`${docPath}/blocks?${query}`, "GET", undefined, token);
        if (!Array.isArray(response.data?.items) || typeof response.data.has_more !== "boolean") throw new FeishuError("verification");
        for (const block of response.data.items) {
          if (!isId(block.block_id) || blocks.has(block.block_id)) throw new FeishuError("verification");
          blocks.set(block.block_id, block);
        }
        if (!response.data.has_more) break;
        pageToken = response.data.page_token ?? "";
        if (!pageToken || seenPages.has(pageToken)) throw new FeishuError("verification");
        seenPages.add(pageToken);
      } while (true);
      const roots = blocks.get(documentId)?.children ?? [];
      if (!blocks.has(documentId) || !Array.isArray(roots)) throw new FeishuError("verification");
      return { revision, roots, blocks };
    };
    const assertRevision = async (revision: number) => {
      if ((await metadata()).revision_id !== revision) throw new FeishuError("document-busy");
    };

    async function completePending(recovering: boolean): Promise<void> {
      let pending = link.chapter?.pending;
      if (!pending) return;
      if (pending.phase === "insert") {
        const query = new URLSearchParams({ document_revision_id: String(pending.revisionId), client_token: pending.clientToken });
        let response: { data: { document_revision_id: number; block_id_relations: Array<{ temporary_block_id: string; block_id: string }> } };
        try {
          // Resume exactly the checkpointed request, including its idempotency token.
          response = await api.request(`${rootPath}/descendant?${query}`, "POST", pending.body, token);
        } catch (error) {
          // On a first, explicitly rejected request there is no new chapter to recover.
          if (!recovering && error instanceof FeishuError && !error.uncertain) {
            await checkpoint({ chapter: { ...link.chapter!, pending: undefined } });
          }
          throw error;
        }
        if (!isRevision(response.data?.document_revision_id) || !Array.isArray(response.data.block_id_relations)) throw new FeishuError("verification");
        const relations = new Map(response.data.block_id_relations.map((item) => [item.temporary_block_id, item.block_id]));
        const inserted = pending.body.children_id.map((id) => relations.get(id));
        if (inserted.some((id) => !isId(id)) || new Set(inserted).size !== inserted.length) throw new FeishuError("verification");
        pending = { ...pending, phase: "cleanup", insertedBlockIds: inserted as string[] };
        await checkpoint({ revisionId: response.data.document_revision_id, chapter: { ...link.chapter!, pending } });
      }
      let snapshot = await readSnapshot();
      const inserted = pending.insertedBlockIds!;
      chapterIndex(snapshot, inserted);
      const remainingOld = pending.oldBlockIds.filter((id) => snapshot.blocks.has(id));
      if (remainingOld.length && remainingOld.length !== pending.oldBlockIds.length) throw new FeishuError("chapter-missing");
      if (remainingOld.length) {
        const index = chapterIndex(snapshot, remainingOld);
        const fingerprint = chapterFingerprint(snapshot, remainingOld);
        if (fingerprint !== pending.oldFingerprint && !(recovering && context.options?.overwriteRemote)) throw new FeishuError("chapter-conflict");
        await assertRevision(snapshot.revision);
        const query = new URLSearchParams({ document_revision_id: String(snapshot.revision), client_token: randomUUID() });
        // Delete only the exact contiguous IDs owned by this note; other chapters stay intact.
        await api.request(`${rootPath}/children/batch_delete?${query}`, "DELETE", { start_index: index, end_index: index + remainingOld.length }, token);
        snapshot = await readSnapshot();
      }
      chapterIndex(snapshot, inserted);
      if (pending.oldBlockIds.some((id) => snapshot.blocks.has(id))) throw new FeishuError("verification");
      await assertRevision(snapshot.revision);
      await checkpoint({ revisionId: snapshot.revision, contentHash: pending.contentHash, syncedAt: new Date().toISOString(),
        chapter: { blockIds: inserted, fingerprint: chapterFingerprint(snapshot, inserted) } });
    }

    // First reconcile a prior unknown write, even if the user edited the note since then.
    await completePending(true);
    const snapshot = await readSnapshot();
    const oldIds = link.chapter?.blockIds ?? [];
    const index = chapterIndex(snapshot, oldIds);
    const oldFingerprint = oldIds.length ? chapterFingerprint(snapshot, oldIds) : undefined;
    if (oldIds.length && oldFingerprint !== link.chapter?.fingerprint && !context.options?.overwriteRemote) throw new FeishuError("chapter-conflict");
    const contentHash = hash(note.content);
    const firstLine = markdownTitle(note.content);
    const title = [...(firstLine || "贴贴便签")].slice(0, 800).join("");
    const newline = /\r\n|\r|\n/.exec(note.content);
    const body = firstLine ? (newline ? note.content.slice(newline.index + newline[0].length) : "") : note.content;
    const prepared = markdownForFeishu(body);
    if (prepared.imageLinks) warnings.push("image-links");
    if (oldIds.length && link.contentHash === contentHash && link.chapter?.fingerprint === oldFingerprint && link.syncedAt) {
      await checkpoint({ url: target.url });
      return { status: "synced", provider: "feishu", remoteUrl: target.url, warnings };
    }
    let converted: Converted = { blocks: [], first_level_block_ids: [] };
    if (body.trim()) {
      const result = await api.request<{ data: Converted }>("/docx/v1/documents/blocks/convert", "POST", { content_type: "markdown", content: prepared.content }, token);
      converted = result.data;
      if (!converted || !Array.isArray(converted.blocks) || !Array.isArray(converted.first_level_block_ids)) throw new FeishuError("unsupported-content");
    }
    const headingId = `chapter-${randomUUID()}`;
    converted = { first_level_block_ids: [headingId, ...converted.first_level_block_ids], blocks: [
      { block_id: headingId, block_type: 3, heading1: { elements: [{ text_run: { content: title } }] } }, ...converted.blocks,
    ] };
    const batches = prepareBlockBatches(converted);
    if (batches.length !== 1) throw new FeishuError("chapter-too-large");
    await assertRevision(snapshot.revision);
    const pending: FeishuChapterPending = { phase: "insert", clientToken: randomUUID(), revisionId: snapshot.revision,
      contentHash, oldBlockIds: oldIds, oldFingerprint, body: { ...batches[0], index } };
    await checkpoint({ mode: "append", chapter: { blockIds: oldIds, fingerprint: oldFingerprint, pending } });
    await completePending(false);
    return { status: "synced", provider: "feishu", remoteUrl: target.url, warnings };
  } catch (error) {
    const known = error instanceof FeishuError ? error : new FeishuError("feishu-api");
    if (known.message === "auth") api.forgetToken();
    if (known.message === "chapter-conflict") return { status: "conflict", provider: "feishu", remoteUrl: target.url, scope: "chapter" };
    return { status: "error", provider: "feishu", message: known.message === "remote-changed" ? "document-busy" : known.message,
      apiCode: known.apiCode, remoteUrl: target.url };
  }
}
