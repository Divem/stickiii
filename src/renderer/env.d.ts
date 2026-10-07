import type { AiConfig, AiConfigInput, AiConfigResult, AiConnectionResult, AiOperation, AiPolishResult, AiTransformResult, Note, PickedAttachment, ShortcutActionId, ShortcutConfig, ShortcutSaveResult, SyncOptions, SyncProviderConfig, SyncProviderConfigInput, SyncProviderId, SyncResult, SyncConfigResult } from "../shared/types";

declare global {
  interface Window {
    desktopTabs: {
      getWindowContext(): Promise<import("../shared/types").NoteWindowContext>;
      setNotePureMode(pure: boolean): Promise<void>;
      fitNoteContent(height: number): Promise<void>;
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
      listNotes(noteIds?: string[]): Promise<Note[]>;
      saveNote(note: Note): Promise<Note>;
      deleteNote(noteId: string): Promise<void>;
      restoreNote(noteId: string): Promise<Note>;
      listRecovery(): Promise<import("../shared/types").RecoveryEntry[]>;
      snapshotAiNote(noteId: string, expectedContent: string): Promise<void>;
      restoreRecovery(entryId: string): Promise<Note>;
      createNoteCopy(noteId: string, content: string): Promise<Note>;
      pickFiles(): Promise<PickedAttachment[]>;
      importAttachment(noteId: string, file: File, imageOnly: boolean): Promise<PickedAttachment>;
      attachmentPreview(noteId: string, attachmentId: string): Promise<string>;
      openAttachment(storedPath: string): Promise<string>;
      syncNote(note: Note, provider: SyncProviderId, options?: SyncOptions): Promise<SyncResult>;
      openExternalLink(url: string): Promise<boolean>;
      listSyncConfigs(loadSaved?: boolean): Promise<SyncProviderConfig[]>;
      saveSyncConfig(input: SyncProviderConfigInput): Promise<SyncConfigResult>;
      clearSyncConfig(provider: SyncProviderId): Promise<SyncConfigResult>;
      checkFeishuConnection(): Promise<import("../shared/types").FeishuConnectionResult>;
      getAiConfig(loadSaved?: boolean): Promise<AiConfig | null>;
      saveAiConfig(input: AiConfigInput): Promise<AiConfigResult>;
      clearAiConfig(): Promise<AiConfigResult>;
      testAiConnection(input: AiConfigInput): Promise<AiConnectionResult>;
      polishNote(noteId: string, requestId?: string): Promise<AiPolishResult>;
      aiNote(noteId: string, operation: AiOperation, requestId?: string): Promise<AiTransformResult>;
      cancelAiNote(noteId: string, requestId: string): Promise<boolean>;
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
