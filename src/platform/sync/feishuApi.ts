import { hashText } from "../../shared/hash.js";
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
