import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { NoteChange, NoteWindowContext } from "../shared/types.js";
import { createFeishuAdapter } from "../platform/sync/feishu.js";
import { FeishuApi, FeishuError } from "../platform/sync/feishuApi.js";
import type { StoredConfig } from "../platform/sync/configStore.js";
import type { Note, ShortcutActionId, SyncOptions, SyncProviderConfig, SyncProviderId, SyncResult } from "../shared/types.js";

type Started = { status: "ready"; jobId: string; note: Note; config: SyncProviderConfig } | { status: "result"; result: SyncResult };

// Secrets and bearer tokens stay in Rust. This transport only handles scoped
// Feishu document operations during an explicitly started synchronization job.
class NativeFeishuApi extends FeishuApi {
  constructor(private readonly jobId: string) {
    super(() => Promise.reject(new Error("NATIVE_TRANSPORT_REQUIRED")), 0);
  }

  override async accessToken(_config: StoredConfig): Promise<string> { return "native"; }

  override async request<T>(path: string, method: string, body?: unknown): Promise<T> {
    try {
      return await invoke<T>("feishu_request", { jobId: this.jobId, path, method, body: body ?? null });
    } catch (error) {
      const known = error as { message?: string; apiCode?: number; uncertain?: boolean };
      throw new FeishuError(known?.message ?? "network", known?.apiCode, known?.uncertain);
    }
  }
}

async function executeSync(note: Note, provider: SyncProviderId, options?: SyncOptions): Promise<SyncResult> {
  const started = await invoke<Started>("sync_begin", { note, provider });
  if (started.status === "result") return started.result;
  let result: SyncResult = { status: "error", provider, message: "local-save" };
  try {
    const adapter = createFeishuAdapter(undefined, 0, new NativeFeishuApi(started.jobId));
    result = await adapter.sync(started.note, {
      provider,
      // appSecret is an empty compatibility field, never the saved credential.
      credentials: { ...started.config, appSecret: "" },
      options,
      saveFeishuDocument: (document) => invoke("sync_checkpoint", { jobId: started.jobId, document }),
    });
  } finally {
    result = await invoke<SyncResult>("sync_finish", { jobId: started.jobId, result });
  }
  return result;
}

let pendingSync: Promise<unknown> = Promise.resolve();
function syncNote(note: Note, provider: SyncProviderId, options?: SyncOptions): Promise<SyncResult> {
  const job = pendingSync.then(() => executeSync(note, provider, options));
  pendingSync = job.catch(() => {});
  return job;
}

function subscribe<T>(event: string, callback: (payload: T) => void): () => void {
  let disposed = false;
  const pending = listen<T>(event, ({ payload }) => { if (!disposed) callback(payload); });
  return () => { disposed = true; void pending.then((unlisten) => unlisten()); };
}

export const desktopTabs: Window["desktopTabs"] = {
  getWindowContext: () => invoke("get_window_context"),
  openNoteWindow: (noteId) => invoke("open_note_window", { noteId }),
  focusNoteWindow: (noteId) => invoke("focus_note_window", { noteId }),
  closeNoteWindow: (saved, returnToMain = false) => invoke("close_note_window", { saved, returnToMain }),
  openMainWindow: (settings = false) => invoke("open_main_window", { settings }),
  onWindowsChanged: (callback) => subscribe<NoteWindowContext>("windows:changed", callback),
  onNoteChanged: (callback) => subscribe<NoteChange>("notes:changed", callback),
  onCloseRequested: (callback) => subscribe("window:close-requested", callback),
  onExitCancelled: (callback) => subscribe("app:exit-cancelled", callback),
  onNoteActivated: (callback) => subscribe<string>("note:activate", callback),
  onSettingsRequested: (callback) => subscribe("settings:open", callback),
  onRestoreFailed: (callback) => subscribe("window:restore-failed", callback),
  listNotes: () => invoke("list_notes"),
  saveNote: (note) => invoke("save_note", { note }),
  deleteNote: (noteId) => invoke("delete_note", { noteId }),
  pickFiles: () => invoke("pick_files"),
  openAttachment: (storedPath) => invoke("open_attachment", { storedPath }),
  openExternalLink: (url) => invoke("open_external_link", { url }),
  syncNote,
  listSyncConfigs: () => invoke("list_sync_configs"),
  saveSyncConfig: (input) => invoke("save_sync_config", { input }),
  clearSyncConfig: (provider) => invoke("clear_sync_config", { provider }),
  getAiConfig: () => invoke("get_ai_config"),
  saveAiConfig: (input) => invoke("save_ai_config", { input }),
  clearAiConfig: () => invoke("clear_ai_config"),
  testAiConnection: (input) => invoke("test_ai_connection", { input }),
  polishNote: (noteId) => invoke("polish_note", { noteId }),
  aiNote: (noteId, operation) => invoke("ai_note", { noteId, operation }),
  setPinnedWindow: (pinned) => invoke("set_pinned_window", { pinned }),
  listShortcuts: () => invoke("list_shortcuts"),
  saveShortcuts: (shortcuts) => invoke("save_shortcuts", { shortcuts }),
  onShortcutAction: (callback) => {
    let disposed = false;
    const pending = listen<ShortcutActionId>("shortcut:action", ({ payload }) => { if (!disposed) callback(payload); });
    return () => { disposed = true; void pending.then((unlisten) => unlisten()); };
  },
  onExitRequested: (callback) => {
    let disposed = false;
    const pending = listen<string>("app:exit-requested", ({ payload }) => { if (!disposed) callback(payload); });
    return () => { disposed = true; void pending.then((unlisten) => unlisten()); };
  },
  completeExit: (saved, requestId) => invoke("complete_exit", { saved, requestId }),
  quitApplication: () => invoke("request_exit"),
  minimizeWindow: () => { void invoke("minimize_window"); },
  closeWindow: () => { void invoke("hide_window"); },
};

export const startDragging = (): Promise<void> => invoke("start_dragging");
export const readyWindow = (): Promise<void> => invoke("ready_window");
