import type { FeishuDocument, Note, SyncOptions, SyncProviderId, SyncResult } from "../../shared/types.js";
import type { StoredConfig } from "./configStore.js";

export type SyncContext = {
  provider: SyncProviderId;
  credentials?: StoredConfig;
  options?: SyncOptions;
  saveFeishuDocument?: (document: FeishuDocument) => Promise<void>;
};

export interface NoteSyncAdapter {
  readonly provider: SyncProviderId;
  sync(note: Note, context: SyncContext): Promise<SyncResult>;
}
