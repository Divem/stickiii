import { randomUUID } from "../../shared/id.js";
import { markdownTitle } from "../../shared/markdown.js";
import { markdownForFeishu } from "../../shared/feishuMarkdown.js";
import { feishuTargetKey, parseFeishuTarget, selectFeishuDocument } from "../../shared/feishuTarget.js";
import { appendFeishuChapter } from "./feishuChapter.js";
import type { FeishuDocument, Note, SyncResult, SyncWarning } from "../../shared/types.js";
import type { NoteSyncAdapter, SyncContext } from "./types.js";
import { createMediaBlock, FeishuApi, FeishuError, isId, isRevision, noteSyncHash, prepareBlockBatches, type Block, type Converted, type DocumentInfo, type FeishuFetch } from "./feishuApi.js";

export function createFeishuAdapter(fetcher: FeishuFetch = (url, init) => fetch(url, init), interval = 400, nativeApi?: FeishuApi): NoteSyncAdapter {
  const api = nativeApi ?? new FeishuApi(fetcher, interval);
  // Serialize writes across notes to respect per-app and per-document rate limits.
  let pending: Promise<unknown> = Promise.resolve();

  async function sync(note: Note, context: SyncContext): Promise<SyncResult> {
    const config = context.credentials;
    if (!config) return { status: "not-configured", provider: "feishu" };
    const mode = config.syncMode ?? "create";
    const target = mode === "append" ? parseFeishuTarget(config.targetDocumentUrl ?? "") : undefined;
    if (mode === "append" && !target) return { status: "error", provider: "feishu", message: "target-required" };
    const targetKey = feishuTargetKey(config.appId, mode, target);
    if (mode === "create" && note.feishu && !note.feishu.targetKey && note.feishu.appId !== config.appId) {
      return { status: "error", provider: "feishu", message: "app-changed" };
    }
    let link: FeishuDocument = { ...(selectFeishuDocument(note, targetKey, config.appId, mode) ?? { appId: config.appId }), mode, targetKey };
    if (target) return appendFeishuChapter(api, note, context, link, target);
    async function checkpoint(patch: Partial<FeishuDocument>): Promise<void> {
      link = { ...link, ...patch };
      if (!context.saveFeishuDocument) throw new FeishuError("local-save");
      try { await context.saveFeishuDocument({ ...link }); } catch { throw new FeishuError("local-save"); }
    }
    try {
      if (!config.collaboratorEmail) throw new FeishuError("collaborator-required");
      if (!note.content.trim()) throw new FeishuError("empty-note");
      if (note.content.length > 10_485_760) throw new FeishuError("too-large");
      if (link.appId !== config.appId) throw new FeishuError("app-changed");
      if (link.creationPending && !link.documentId) throw new FeishuError("create-uncertain");
      const token = await api.accessToken(config);
      const title = [...(markdownTitle(note.content) || "贴贴便签")].slice(0, 800).join("");
      const hash = noteSyncHash(note);
      const prepared = markdownForFeishu(note.content);
      const warnings: SyncWarning[] = prepared.imageLinks ? ["image-links"] : [];
      const readDocument = async (): Promise<DocumentInfo> => {
        const result = await api.request<{ data: { document: DocumentInfo } }>(`/docx/v1/documents/${link.documentId}`, "GET", undefined, token);
        const doc = result.data?.document;
        if (!doc || doc.document_id !== link.documentId || !isRevision(doc.revision_id)) throw new FeishuError("verification");
        return doc;
      };
      let metadata: DocumentInfo | undefined;
      if (link.documentId) {
        if (!isId(link.documentId)) throw new FeishuError("verification");
        metadata = await readDocument();
        if (metadata.revision_id !== link.revisionId && !context.options?.overwriteRemote) {
          return { status: "conflict", provider: "feishu", remoteUrl: link.url! };
        }
        if (metadata.revision_id === link.revisionId && link.contentHash === hash && link.collaboratorEmail === config.collaboratorEmail && link.syncedAt) {
          return { status: "synced", provider: "feishu", remoteUrl: link.url, warnings };
        }
      }
      // Convert and validate the complete tree before creating or modifying a document.
      const converted = await api.request<{ data: Converted }>("/docx/v1/documents/blocks/convert", "POST", { content_type: "markdown", content: prepared.content }, token);
      const batches = prepareBlockBatches(converted.data ?? {} as Converted);
      if (!link.documentId) {
        await checkpoint({ creationPending: true });
        try {
          const created = await api.request<{ data: { document: DocumentInfo } }>("/docx/v1/documents", "POST", { title }, token);
          metadata = created.data?.document;
          if (!metadata || !isId(metadata.document_id) || !isRevision(metadata.revision_id)) throw new FeishuError("create-uncertain", undefined, true);
        } catch (error) {
          if (error instanceof FeishuError && !error.uncertain) await checkpoint({ creationPending: false });
          else throw new FeishuError("create-uncertain");
          throw error;
        }
        // Checkpoint identity before content writes, so failures cannot create duplicate documents.
        await checkpoint({ documentId: metadata.document_id, url: `https://feishu.cn/docx/${metadata.document_id}`, revisionId: metadata.revision_id, creationPending: false });
      }
      let revision = metadata!.revision_id;
      const rootPath = `/docx/v1/documents/${link.documentId}/blocks/${link.documentId}`;
      const rootChildren = async (): Promise<string[]> => {
        const result = await api.request<{ data: { block: Block } }>(rootPath, "GET", undefined, token);
        const block = result.data?.block;
        if (!block || block.block_id !== link.documentId || (block.children !== undefined && !Array.isArray(block.children))) throw new FeishuError("verification");
        return block.children ?? [];
      };
      const checkRevision = async (): Promise<void> => {
        if ((await readDocument()).revision_id !== revision) throw new FeishuError("remote-changed");
      };
      const write = async (path: string, method: string, body: unknown): Promise<void> => {
        await checkRevision();
        const query = new URLSearchParams({ document_revision_id: String(revision), client_token: randomUUID() });
        const result = await api.request<{ data: { document_revision_id: number } }>(`${path}?${query}`, method, body, token);
        if (!isRevision(result.data?.document_revision_id)) throw new FeishuError("verification");
        revision = result.data.document_revision_id;
        await checkpoint({ revisionId: revision, contentHash: undefined, syncedAt: undefined });
      };
      const oldChildren = await rootChildren();
      // Stage new blocks first; keep the old content until all new blocks are written.
      for (const batch of batches) await write(`${rootPath}/descendant`, "POST", { ...batch, index: -1 });
      const mediaChildren: string[] = [];
      for (const attachment of note.attachments) {
        const documentId = link.documentId;
        if (!documentId) throw new FeishuError("verification");
        const media = await createMediaBlock(api, documentId, documentId, revision, attachment, token);
        revision = media.revision;
        mediaChildren.push(media.block.rootBlockId);
        await checkpoint({ revisionId: revision, contentHash: undefined, syncedAt: undefined });
      }
      const stagedChildren = await rootChildren();
      const newCount = batches.reduce((total, batch) => total + batch.children_id.length, 0) + mediaChildren.length;
      if (stagedChildren.length !== oldChildren.length + newCount || oldChildren.some((id, index) => stagedChildren[index] !== id)) {
        throw new FeishuError("remote-changed");
      }
      const newChildren = stagedChildren.slice(oldChildren.length);
      if (metadata!.title !== title) await write(rootPath, "PATCH", { update_text_elements: { elements: [{ text_run: { content: title } }] } });
      if (oldChildren.length) await write(`${rootPath}/children/batch_delete`, "DELETE", { start_index: 0, end_index: oldChildren.length });
      const verifiedChildren = await rootChildren();
      if (verifiedChildren.length !== newChildren.length || verifiedChildren.some((id, index) => id !== newChildren[index])) throw new FeishuError("verification");
      await checkRevision();
      if (link.collaboratorEmail !== config.collaboratorEmail) {
        try {
          await api.request(`/drive/v1/permissions/${link.documentId}/members?type=docx&need_notification=false`, "POST", {
            member_type: "email", member_id: config.collaboratorEmail, perm: "edit", type: "user",
          }, token);
        } catch (error) {
          if (error instanceof FeishuError) throw new FeishuError("share-failed", error.apiCode);
          throw error;
        }
      }
      await checkpoint({ revisionId: revision, contentHash: hash, syncedAt: new Date().toISOString(), collaboratorEmail: config.collaboratorEmail });
      return { status: "synced", provider: "feishu", remoteUrl: link.url, warnings };
    } catch (error) {
      const known = error instanceof FeishuError ? error : new FeishuError("feishu-api");
      if (known.message === "auth") api.forgetToken();
      if (known.message === "remote-changed" && link.url) return { status: "conflict", provider: "feishu", remoteUrl: link.url };
      return { status: "error", provider: "feishu", message: known.message, apiCode: known.apiCode, remoteUrl: link.url };
    }
  }

  return {
    provider: "feishu",
    sync(note, context) {
      const job = pending.then(() => sync(note, context));
      pending = job.catch(() => {});
      return job;
    },
  };
}

export const feishuAdapter = createFeishuAdapter();
