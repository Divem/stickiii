export type SyncProviderId = "notion" | "feishu";
export type FeishuSyncMode = "create" | "append";

export type NoteThemeId = "paper" | "mist" | "sage" | "sky" | "peach" | "lavender" | "ink";

export type NoteWindowContext = { noteId: string | null; openNoteIds: string[]; readyNoteIds: string[]; pinned: boolean };
export type NoteChange = { note: Note; sourceWindow: string };

export type ShortcutActionId = "toggleWindow" | "newNote" | "previousNote" | "nextNote";

export type ShortcutConfig = {
  action: ShortcutActionId;
  accelerator: string;
};

export type ShortcutSaveResult =
  | { status: "saved"; shortcuts: ShortcutConfig[] }
  | { status: "conflict" | "invalid"; shortcuts: ShortcutConfig[] };

export const DEFAULT_SHORTCUTS: ShortcutConfig[] = [
  { action: "toggleWindow", accelerator: "CommandOrControl+Shift+Space" },
  { action: "newNote", accelerator: "CommandOrControl+Shift+N" },
  { action: "previousNote", accelerator: "CommandOrControl+Alt+Left" },
  { action: "nextNote", accelerator: "CommandOrControl+Alt+Right" },
];

export type SyncProviderConfig = {
  provider: SyncProviderId;
  appId: string;
  appSecretConfigured: boolean;
  collaboratorEmail?: string;
  syncMode?: FeishuSyncMode;
  targetDocumentUrl?: string;
  updatedAt: string;
};

export type SyncProviderConfigInput = {
  provider: SyncProviderId;
  appId: string;
  appSecret: string;
  collaboratorEmail?: string;
  syncMode?: FeishuSyncMode;
  targetDocumentUrl?: string;
};

export type FeishuChapterPending = {
  phase: "insert" | "cleanup";
  clientToken: string;
  revisionId: number;
  contentHash: string;
  oldBlockIds: string[];
  oldFingerprint?: string;
  insertedBlockIds?: string[];
  mediaAttachments?: Array<Pick<NoteAttachment, "id" | "name" | "mimeType" | "size">>;
  mediaBlockIds?: string[];
  body: { index: number; children_id: string[]; descendants: Record<string, unknown>[] };
};

export type FeishuDocument = {
  appId: string;
  mode?: FeishuSyncMode;
  targetKey?: string;
  documentId?: string;
  url?: string;
  revisionId?: number;
  contentHash?: string;
  syncedAt?: string;
  collaboratorEmail?: string;
  creationPending?: boolean;
  chapter?: { blockIds: string[]; fingerprint?: string; pending?: FeishuChapterPending };
};

export type SyncOptions = { overwriteRemote?: boolean };
export type SyncWarning = "image-links";

export type NoteAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  storedPath: string;
  previewDataUrl?: string;
};

export type Note = {
  id: string;
  content: string;
  attachments: NoteAttachment[];
  createdAt: string;
  updatedAt: string;
  syncState: "local" | "syncing" | "synced" | "error";
  theme?: NoteThemeId;
  /** Legacy per-note opacity, retained only when reading older records. */
  themeOpacity?: number;
  feishu?: FeishuDocument;
  feishuTargets?: Record<string, FeishuDocument>;
};

export type PickedAttachment = NoteAttachment;

export type SyncResult = (
  | { status: "not-configured"; provider: SyncProviderId }
  | { status: "synced"; provider: SyncProviderId; remoteUrl?: string; warnings?: SyncWarning[]; note?: Note }
  | { status: "conflict"; provider: SyncProviderId; remoteUrl: string; scope?: "chapter" }
  | { status: "not-implemented"; provider: SyncProviderId }
  | { status: "error"; provider: SyncProviderId; message: string; remoteUrl?: string; apiCode?: number }) & { note?: Note };

export type SyncConfigResult =
  | { status: "saved"; provider: SyncProviderId }
  | { status: "cleared"; provider: SyncProviderId }
  | { status: "unavailable" | "invalid" | "error" };

export type FeishuConnectionResult =
  | { status: "connected"; scope: "authentication" | "target"; latencyMs: number; title?: string }
  | { status: "error"; message: string; apiCode?: number };

export type AiConfig = {
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
  updatedAt: string;
};

export type AiConfigInput = { baseUrl: string; model: string; apiKey: string };
export type AiConfigResult =
  | { status: "saved"; config: AiConfig }
  | { status: "cleared" | "invalid" | "unavailable" };

export type AiOperation = "polish" | "translate" | "expand" | "explain";

export type AiPolishError = "auth" | "rate-limit" | "model-or-endpoint" | "network" | "timeout" | "service" |
  "empty-note" | "too-large" | "invalid-response" | "truncated" | "refused" | "note-missing" | "busy";
export type AiPolishResult =
  | { status: "polished" | "unchanged"; content: string; originalContent: string }
  | { status: "not-configured" }
  | { status: "error"; message: AiPolishError };
export type AiTransformResult =
  | { status: "transformed" | "unchanged"; content: string; originalContent: string }
  | { status: "not-configured" }
  | { status: "error"; message: AiPolishError };

export type AiConnectionResult =
  | { status: "connected"; latencyMs: number; model: string }
  | { status: "error"; message: AiPolishError | "invalid-config" | "secure-storage" };
