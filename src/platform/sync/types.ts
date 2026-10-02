import type { Note, SyncProviderId, SyncResult } from "../../shared/types.js";

export type SyncContext = {
  provider: SyncProviderId;
};

export interface NoteSyncAdapter {
  readonly provider: SyncProviderId;
  sync(note: Note, context: SyncContext): Promise<SyncResult>;
}
