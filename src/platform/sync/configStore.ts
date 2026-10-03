import type { FeishuSyncMode } from "../../shared/types.js";

// Connector contract. Production storage lives in src-tauri/src/credentials.rs.
// In the renderer's native transport appSecret is always an empty placeholder.
export type StoredConfig = {
  appId: string;
  appSecret: string;
  collaboratorEmail?: string;
  syncMode?: FeishuSyncMode;
  targetDocumentUrl?: string;
  updatedAt: string;
};
