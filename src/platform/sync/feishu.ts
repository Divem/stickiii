import type { Note, SyncResult } from "../../shared/types.js";
import type { NoteSyncAdapter } from "./types.js";

export const feishuAdapter: NoteSyncAdapter = {
  provider: "feishu",
  async sync(_note: Note): Promise<SyncResult> {
    return { status: "not-configured", provider: "feishu" };
  },
};
