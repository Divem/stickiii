import type { AiConfig, AiConfigInput, AiConfigResult, AiConnectionResult, AiOperation, AiPolishResult, AiTransformResult, Note, PickedAttachment, ShortcutActionId, ShortcutConfig, ShortcutSaveResult, SyncOptions, SyncProviderConfig, SyncProviderConfigInput, SyncProviderId, SyncResult, SyncConfigResult } from "../shared/types";

declare global {
  interface Window {
    desktopTabs: {
      getWindowContext(): Promise<import("../shared/types").NoteWindowContext>;
      setWindowTitle(title: string): Promise<void>;
      openNoteWindow(noteId: string): Promise<void>;
      focusNoteWindow(noteId: string): Promise<void>;
      closeNoteWindow(saved: boolean, returnToMain?: boolean): Promise<void>;
      openMainWindow(settings?: boolean): Promise<void>;
      onWindowsChanged(callback: (context: import("../shared/types").NoteWindowContext) => void): () => void;
      onNoteChanged(callback: (change: import("../shared/types").NoteChange) => void): () => void;
      onCloseRequested(callback: () => void): () => void;
      onExitCancelled(callback: () => void): () => void;
      onNoteActivated(callback: (noteId: string) => void): () => void;
      onSettingsRequested(callback: () => void): () => void;
      onRestoreFailed(callback: () => void): () => void;
      listNotes(): Promise<Note[]>;
      saveNote(note: Note): Promise<Note>;
      deleteNote(noteId: string): Promise<void>;
      pickFiles(): Promise<PickedAttachment[]>;
      openAttachment(storedPath: string): Promise<string>;
      syncNote(note: Note, provider: SyncProviderId, options?: SyncOptions): Promise<SyncResult>;
      openExternalLink(url: string): Promise<boolean>;
      listSyncConfigs(): Promise<SyncProviderConfig[]>;
      saveSyncConfig(input: SyncProviderConfigInput): Promise<SyncConfigResult>;
      clearSyncConfig(provider: SyncProviderId): Promise<SyncConfigResult>;
      getAiConfig(): Promise<AiConfig | null>;
      saveAiConfig(input: AiConfigInput): Promise<AiConfigResult>;
      clearAiConfig(): Promise<AiConfigResult>;
      testAiConnection(input: AiConfigInput): Promise<AiConnectionResult>;
      polishNote(noteId: string): Promise<AiPolishResult>;
      aiNote(noteId: string, operation: AiOperation): Promise<AiTransformResult>;
      setPinnedWindow(pinned: boolean): Promise<boolean>;
      listShortcuts(): Promise<ShortcutConfig[]>;
      saveShortcuts(shortcuts: ShortcutConfig[]): Promise<ShortcutSaveResult>;
      onShortcutAction(callback: (action: ShortcutActionId) => void): () => void;
      onExitRequested(callback: (requestId: string) => void): () => void;
      completeExit(saved: boolean, requestId?: string): Promise<void>;
      quitApplication(): Promise<void>;
      minimizeWindow(): void;
      closeWindow(): void;
    };
  }
}

export {};
