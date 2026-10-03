import { invoke } from "@tauri-apps/api/core";
import type { NoteChange, NoteWindowContext } from "../shared/types.js";
import { createFeishuAdapter } from "../platform/sync/feishu.js";
import { FeishuApi, FeishuError } from "../platform/sync/feishuApi.js";
import type { StoredConfig } from "../platform/sync/configStore.js";
import type { Note, ShortcutActionId, SyncOptions, SyncProviderConfig, SyncProviderId, SyncResult } from "../shared/types.js";
import { MAX_ATTACHMENT_BYTES } from "./attachmentImport.js";

async function importAttachment(noteId: string, file: File, imageOnly: boolean) {
  if (file.size > MAX_ATTACHMENT_BYTES) throw "ATTACHMENT_TOO_LARGE";
  const dataBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject("ATTACHMENT_READ_FAILED");
    reader.onabort = () => reject("ATTACHMENT_READ_FAILED");
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string" || !result.includes(",")) reject("ATTACHMENT_READ_FAILED");
      else resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
  return invoke<Note["attachments"][number]>("import_attachment", {
    noteId, name: file.name, dataBase64, imageOnly,
  });
}

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
  const name = `desk-tabs:${event}`;
  const handler = (event: Event): void => callback((event as CustomEvent<T>).detail);
  window.addEventListener(name, handler);
  return () => window.removeEventListener(name, handler);
}

export const desktopTabs: Window["desktopTabs"] = {
  getWindowContext: () => invoke("get_window_context"),
  setWindowTitle: (title) => invoke("set_window_title", { title }),
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
  importAttachment,
  attachmentPreview: (noteId, attachmentId) => invoke("attachment_preview", { noteId, attachmentId }),
  openAttachment: (storedPath) => invoke("open_attachment", { storedPath }),
  openExternalLink: (url) => invoke("open_external_link", { url }),
  syncNote,
  listSyncConfigs: (loadSaved = false) => invoke("list_sync_configs", { loadSaved }),
  saveSyncConfig: (input) => invoke("save_sync_config", { input }),
  clearSyncConfig: (provider) => invoke("clear_sync_config", { provider }),
  getAiConfig: (loadSaved = false) => invoke("get_ai_config", { loadSaved }),
  saveAiConfig: (input) => invoke("save_ai_config", { input }),
  clearAiConfig: () => invoke("clear_ai_config"),
  testAiConnection: (input) => invoke("test_ai_connection", { input }),
  polishNote: (noteId) => invoke("polish_note", { noteId }),
  aiNote: (noteId, operation) => invoke("ai_note", { noteId, operation }),
  setPinnedWindow: (pinned) => invoke("set_pinned_window", { pinned }),
  listShortcuts: () => invoke("list_shortcuts"),
  saveShortcuts: (shortcuts) => invoke("save_shortcuts", { shortcuts }),
  onShortcutAction: (callback) => subscribe<ShortcutActionId>("shortcut:action", callback),
  onExitRequested: (callback) => subscribe<string>("app:exit-requested", callback),
  completeExit: (saved, requestId) => invoke("complete_exit", { saved, requestId }),
  quitApplication: () => invoke("request_exit"),
  minimizeWindow: () => { void invoke("minimize_window"); },
  closeWindow: () => { void invoke("hide_window"); },
};

export const startDragging = (): Promise<void> => invoke("start_dragging");
export const readyWindow = (): Promise<void> => invoke("ready_window");
