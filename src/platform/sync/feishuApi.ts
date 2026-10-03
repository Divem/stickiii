import { hashText } from "../../shared/hash.js";
import { randomUUID } from "../../shared/id.js";
import type { NoteAttachment, Note } from "../../shared/types.js";
import type { StoredConfig } from "./configStore.js";

const API = "https://open.feishu.cn/open-apis";
export type Json = Record<string, unknown>;
export type Block = Json & { block_id: string; block_type: number; children?: string[] };
export type Converted = { first_level_block_ids: string[]; blocks: Block[] };
export type DocumentInfo = { document_id: string; revision_id: number; title: string };
export type FeishuFetch = (url: string, init: RequestInit) => Promise<Response>;

export class FeishuError extends Error {
  constructor(message: string, readonly apiCode?: number, readonly uncertain = false) { super(message); }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
export const isId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]+$/.test(value);
export const isRevision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 1;

export function noteSyncHash(note: Pick<Note, "content" | "attachments">): string {
  return hashText(JSON.stringify({
    content: note.content,
    attachments: note.attachments.map(({ id, name, mimeType, size }) => ({ id, name, mimeType, size })),
  }));
}

type MediaBlock = { rootBlockId: string; blockId: string; blockType: 23 | 27 };

function findMediaBlock(value: unknown, blockType: 23 | 27, rootBlockId?: string): MediaBlock | undefined {
  if (!isObject(value)) return undefined;
  const currentRoot = rootBlockId ?? (isId(value.block_id) ? value.block_id : undefined);
  if (value.block_type === blockType && isId(value.block_id) && currentRoot) {
    return { rootBlockId: currentRoot, blockId: value.block_id, blockType };
  }
  for (const child of value.children as unknown[] | undefined ?? []) {
    const found = findMediaBlock(child, blockType, currentRoot);
    if (found) return found;
  }
  return undefined;
}

export async function createMediaBlock(
  api: FeishuApi,
  documentId: string,
  parentBlockId: string,
  revision: number,
  attachment: Pick<NoteAttachment, "id" | "name" | "mimeType" | "size">,
  token?: string,
  index = -1,
): Promise<{ revision: number; block: MediaBlock }> {
  const blockType: 23 | 27 = attachment.mimeType.startsWith("image/") ? 27 : 23;
  const field = blockType === 27 ? "image" : "file";
  const query = new URLSearchParams({ document_revision_id: String(revision), client_token: randomUUID() });
  const created = await api.request<{ data: { document_revision_id: number; children?: unknown[] } }>(
    `/docx/v1/documents/${documentId}/blocks/${parentBlockId}/children?${query}`,
    "POST",
    { children: [{ block_type: blockType, [field]: {} }], index },
    token,
  );
  if (!isRevision(created.data?.document_revision_id)) throw new FeishuError("verification");
  const block = findMediaBlock(created.data?.children?.[0], blockType)
    ?? findMediaBlock(created.data, blockType);
  if (!block) throw new FeishuError("verification");
  const uploaded = await api.uploadMedia(attachment, blockType === 27 ? "docx_image" : "docx_file", block.blockId, token);
  const patched = await api.request<{ data: { document_revision_id: number } }>(
    `/docx/v1/documents/${documentId}/blocks/${block.blockId}?${new URLSearchParams({ document_revision_id: String(created.data.document_revision_id), client_token: randomUUID() })}`,
    "PATCH",
    { [blockType === 27 ? "replace_image" : "replace_file"]: { token: uploaded.file_token } },
    token,
  );
  if (!isRevision(patched.data?.document_revision_id)) throw new FeishuError("verification");
  return { revision: patched.data.document_revision_id, block };
}

export class FeishuApi {
  private nextRequestAt = 0;
  private token?: { key: string; value: string; expiresAt: number };
  constructor(private readonly fetcher: FeishuFetch, private readonly interval: number) {}

  async request<T>(path: string, method: string, body?: unknown, token?: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await delay(Math.max(0, this.nextRequestAt - Date.now()));
      this.nextRequestAt = Date.now() + this.interval;
      let response: Response;
      let data: Json;
      try {
        response = await this.fetcher(`${API}${path}`, {
          method,
          headers: { "Content-Type": "application/json; charset=utf-8", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(20_000), redirect: "error",
        });
        const parsed: unknown = await response.json();
        if (!isObject(parsed) || typeof parsed.code !== "number") throw new Error("INVALID_RESPONSE");
        data = parsed;
      } catch {
        throw new FeishuError("network", undefined, method !== "GET");
      }
      if (response.status === 429 || data.code === 99991400) {
        // Explicit rejection: retry with the same client token, never replay an unknown write.
        if (attempt < 2) { await delay(800 * 2 ** attempt); continue; }
        throw new FeishuError("rate-limit", Number(data.code));
      }
      if (!response.ok || data.code !== 0) {
        const code = Number(data.code);
        const message = response.status === 401 || code === 99991663 ? "auth"
          : response.status === 403 || code === 99991672 || code === 131006 ? "permission"
          : code === 1770021 ? "remote-changed" : "feishu-api";
        throw new FeishuError(message, code, response.status >= 500 && method !== "GET");
      }
      return data as T;
    }
  }

  async uploadMedia(
    attachment: Pick<NoteAttachment, "id" | "name" | "mimeType" | "size">,
    parentType: "docx_image" | "docx_file",
    parentNode: string,
    token?: string,
  ): Promise<{ file_token: string }> {
    const result = await this.request<{ data: { file_token: string } }>(
      "/drive/v1/medias/upload_all",
      "POST",
      { attachment_id: attachment.id, file_name: attachment.name, size: attachment.size, parent_type: parentType, parent_node: parentNode },
      token,
    );
    if (!isObject(result.data) || typeof result.data.file_token !== "string" || !result.data.file_token) {
      throw new FeishuError("verification");
    }
    return { file_token: result.data.file_token };
  }

  async accessToken(config: StoredConfig): Promise<string> {
    const key = hashText(`${config.appId}\0${config.appSecret}`);
    if (this.token?.key === key && this.token.expiresAt > Date.now()) return this.token.value;
    let result: { tenant_access_token: string; expire: number };
    try {
      result = await this.request("/auth/v3/tenant_access_token/internal", "POST", { app_id: config.appId, app_secret: config.appSecret });
    } catch (error) {
      if (error instanceof FeishuError && error.message === "feishu-api") throw new FeishuError("auth", error.apiCode);
      throw error;
    }
    if (!result.tenant_access_token || !Number.isFinite(result.expire)) throw new FeishuError("auth");
    this.token = { key, value: result.tenant_access_token, expiresAt: Date.now() + Math.max(0, result.expire - 60) * 1000 };
    return this.token.value;
  }

  forgetToken(): void { this.token = undefined; }
}

export function prepareBlockBatches(converted: Converted): Array<{ children_id: string[]; descendants: Block[] }> {
  if (!Array.isArray(converted.blocks) || !Array.isArray(converted.first_level_block_ids) || !converted.first_level_block_ids.length) {
    throw new FeishuError("unsupported-content");
  }
  const blocks = new Map<string, Block>();
  for (const source of converted.blocks) {
    if (!isId(source.block_id) || blocks.has(source.block_id) || !Number.isInteger(source.block_type)) throw new FeishuError("unsupported-content");
    const block = structuredClone(source);
    delete block.parent_id;
    delete block.revision_id;
    delete block.comment_ids;
    if (isObject(block.table)) {
      delete block.table.merge_info;
      if (isObject(block.table.property)) delete block.table.property.merge_info;
    }
    if (block.block_type === 27) throw new FeishuError("unsupported-content");
    blocks.set(block.block_id, block);
  }
  const batches: Array<{ children_id: string[]; descendants: Block[] }> = [];
  let batch = { children_id: [] as string[], descendants: [] as Block[] };
  const visited = new Set<string>();
  function subtree(id: string, result: Block[], depth = 0): void {
    const block = blocks.get(id);
    if (!block || visited.has(id) || depth > 100) throw new FeishuError("unsupported-content");
    visited.add(id);
    result.push(block);
    if (block.children !== undefined && (!Array.isArray(block.children) || block.children.some((child) => !isId(child)))) throw new FeishuError("unsupported-content");
    for (const child of block.children ?? []) subtree(child, result, depth + 1);
  }
  for (const root of converted.first_level_block_ids) {
    const descendants: Block[] = [];
    subtree(root, descendants);
    if (descendants.length > 1000) throw new FeishuError("too-large");
    if (batch.descendants.length + descendants.length > 1000) { batches.push(batch); batch = { children_id: [], descendants: [] }; }
    batch.children_id.push(root);
    batch.descendants.push(...descendants);
  }
  if (visited.size !== blocks.size) throw new FeishuError("unsupported-content");
  if (batch.children_id.length) batches.push(batch);
  return batches;
}
