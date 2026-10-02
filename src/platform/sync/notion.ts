import type { Note, SyncResult } from "../../shared/types.js";
import type { NoteSyncAdapter } from "./types.js";

export const notionAdapter: NoteSyncAdapter = {
  provider: "notion",
  async sync(_note: Note): Promise<SyncResult> {
    return { status: "not-configured", provider: "notion" };
  },
};
