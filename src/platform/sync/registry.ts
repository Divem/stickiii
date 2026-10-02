import type { SyncProviderId } from "../../shared/types.js";
import { feishuAdapter } from "./feishu.js";
import { notionAdapter } from "./notion.js";
import type { NoteSyncAdapter } from "./types.js";

const adapters: Record<SyncProviderId, NoteSyncAdapter> = {
  notion: notionAdapter,
  feishu: feishuAdapter,
};

export function getSyncAdapter(provider: SyncProviderId): NoteSyncAdapter {
  return adapters[provider];
}
