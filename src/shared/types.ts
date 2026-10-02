export type SyncProviderId = "notion" | "feishu";

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
  title: string;
  content: string;
  attachments: NoteAttachment[];
  createdAt: string;
  updatedAt: string;
  syncState: "local" | "syncing" | "synced" | "error";
};

export type PickedAttachment = NoteAttachment;

export type SyncResult =
  | { status: "not-configured"; provider: SyncProviderId }
  | { status: "synced"; provider: SyncProviderId; remoteUrl?: string }
  | { status: "error"; provider: SyncProviderId; message: string };
