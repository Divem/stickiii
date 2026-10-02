import type { Note, PickedAttachment, SyncProviderId, SyncResult } from "../shared/types";

declare global {
  interface Window {
    desktopTabs: {
      listNotes(): Promise<Note[]>;
      saveNote(note: Note): Promise<Note>;
      deleteNote(noteId: string): Promise<void>;
      pickFiles(): Promise<PickedAttachment[]>;
      openAttachment(storedPath: string): Promise<string>;
      syncNote(note: Note, provider: SyncProviderId): Promise<SyncResult>;
      minimizeWindow(): void;
      closeWindow(): void;
    };
  }
}

export {};
