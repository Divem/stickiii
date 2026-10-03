import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { FeishuSyncMode, SyncConfigResult, SyncProviderConfig, SyncProviderId } from "../../src/shared/types.js";
import { parseFeishuTarget } from "../../src/shared/feishuTarget.js";

export type StoredConfig = { appId: string; appSecret: string; collaboratorEmail?: string; syncMode?: FeishuSyncMode; targetDocumentUrl?: string; updatedAt: string };
type Configs = Partial<Record<SyncProviderId, StoredConfig>>;
type Cipher = {
  available(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
};

export function isSyncProvider(value: unknown): value is SyncProviderId {
  return value === "notion" || value === "feishu";
}

async function atomicWrite(path: string, data: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

const unavailable = () => new Error("SYNC_CONFIG_UNAVAILABLE");

// Only the main process constructs this store. Public results never include secrets.
export class SyncConfigStore {
  private configs: Configs | undefined;
  private pending: Promise<unknown> = Promise.resolve();
  private readonly path: string;
  private readonly cipher: Cipher;
  private readonly write: typeof atomicWrite;

  constructor(path: string, cipher: Cipher, write = atomicWrite) {
    this.path = path;
    this.cipher = cipher;
    this.write = write;
  }

  private async load(): Promise<Configs> {
    if (!this.cipher.available()) throw unavailable();
    if (this.configs) return this.configs;
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return this.configs = {};
      throw new Error("SYNC_CONFIG_IO_ERROR");
    }
    try {
      const parsed: unknown = JSON.parse(this.cipher.decrypt(encrypted));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw unavailable();
      const configs: Configs = {};
      for (const [provider, value] of Object.entries(parsed)) {
        if (!isSyncProvider(provider) || !value || typeof value !== "object" ||
          typeof value.appId !== "string" || !value.appId.trim() ||
          typeof value.appSecret !== "string" || !value.appSecret.trim() ||
          typeof value.updatedAt !== "string") throw unavailable();
        configs[provider] = { appId: value.appId, appSecret: value.appSecret, updatedAt: value.updatedAt,
          collaboratorEmail: typeof value.collaboratorEmail === "string" ? value.collaboratorEmail : undefined,
          syncMode: value.syncMode === "append" ? "append" : "create",
          targetDocumentUrl: typeof value.targetDocumentUrl === "string" ? value.targetDocumentUrl : undefined };
      }
      return this.configs = configs;
    } catch {
      // A locked keychain or corrupt file must never be replaced by an empty store.
      throw unavailable();
    }
  }

  async list(): Promise<SyncProviderConfig[]> {
    await this.pending;
    const configs = await this.load();
    return (["notion", "feishu"] as const).flatMap((provider) => {
      const config = configs[provider];
      return config ? [{ provider, appId: config.appId, appSecretConfigured: true, collaboratorEmail: config.collaboratorEmail,
        syncMode: config.syncMode ?? "create", targetDocumentUrl: config.targetDocumentUrl, updatedAt: config.updatedAt }] : [];
    });
  }

  // Main-process use only; this method is never exposed through preload.
  async credentials(provider: SyncProviderId): Promise<StoredConfig | undefined> {
    await this.pending;
    const config = (await this.load())[provider];
    return config ? { ...config } : undefined;
  }

  private mutate(operation: () => Promise<SyncConfigResult>): Promise<SyncConfigResult> {
    const result = this.pending.then(operation).catch((error): SyncConfigResult => ({
      status: error instanceof Error && error.message === "SYNC_CONFIG_UNAVAILABLE" ? "unavailable" : "error",
    }));
    this.pending = result;
    return result;
  }

  private async persist(next: Configs): Promise<void> {
    let encrypted: Buffer;
    try {
      if (!this.cipher.available()) throw unavailable();
      encrypted = this.cipher.encrypt(JSON.stringify(next));
    } catch {
      throw unavailable();
    }
    await this.write(this.path, encrypted);
    this.configs = next;
  }

  save(input: unknown): Promise<SyncConfigResult> {
    return this.mutate(async () => {
      if (!input || typeof input !== "object") return { status: "invalid" };
      const { provider, appId, appSecret, collaboratorEmail, syncMode, targetDocumentUrl } = input as Record<string, unknown>;
      if (!isSyncProvider(provider) || typeof appId !== "string" || !appId.trim() ||
        appId.length > 512 || typeof appSecret !== "string" || appSecret.length > 8192) return { status: "invalid" };
      const configs = await this.load();
      const previous = configs[provider];
      const id = appId.trim();
      const secret = appSecret.trim() || (previous?.appId === id ? previous.appSecret : "");
      if (!secret) return { status: "invalid" };
      if (collaboratorEmail !== undefined && (typeof collaboratorEmail !== "string" ||
        (collaboratorEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(collaboratorEmail.trim())) || collaboratorEmail.length > 254)) {
        return { status: "invalid" };
      }
      const email = typeof collaboratorEmail === "string" ? collaboratorEmail.trim() : previous?.collaboratorEmail;
      if (syncMode !== undefined && syncMode !== "create" && syncMode !== "append") return { status: "invalid" };
      if (targetDocumentUrl !== undefined && (typeof targetDocumentUrl !== "string" || targetDocumentUrl.length > 2048)) return { status: "invalid" };
      const mode = (syncMode ?? previous?.syncMode ?? "create") as FeishuSyncMode;
      const target = typeof targetDocumentUrl === "string" ? targetDocumentUrl.trim() : previous?.targetDocumentUrl;
      if (provider === "feishu" && mode === "append" && (!target || !parseFeishuTarget(target))) return { status: "invalid" };
      await this.persist({ ...configs, [provider]: { appId: id, appSecret: secret, collaboratorEmail: email,
        syncMode: mode, targetDocumentUrl: target, updatedAt: new Date().toISOString() } });
      return { status: "saved", provider };
    });
  }

  clear(provider: unknown): Promise<SyncConfigResult> {
    return this.mutate(async () => {
      if (!isSyncProvider(provider)) return { status: "invalid" };
      const next = { ...await this.load() };
      delete next[provider];
      await this.persist(next);
      return { status: "cleared", provider };
    });
  }
}
