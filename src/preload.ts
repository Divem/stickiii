import { contextBridge, ipcRenderer } from "electron";
import type { Note, PickedAttachment, SyncProviderId, SyncResult } from "./shared/types.js";

const desktopTabsApi = {
  listNotes: (): Promise<Note[]> => ipcRenderer.invoke("notes:list"),
  saveNote: (note: Note): Promise<Note> => ipcRenderer.invoke("notes:save", note),
  deleteNote: (noteId: string): Promise<void> => ipcRenderer.invoke("notes:delete", noteId),
  pickFiles: (): Promise<PickedAttachment[]> => ipcRenderer.invoke("files:pick"),
  openAttachment: (storedPath: string): Promise<string> => ipcRenderer.invoke("files:open", storedPath),
  syncNote: (note: Note, provider: SyncProviderId): Promise<SyncResult> =>
    ipcRenderer.invoke("sync:note", note, provider),
  minimizeWindow: (): void => ipcRenderer.send("window:minimize"),
  closeWindow: (): void => ipcRenderer.send("window:close"),
};

contextBridge.exposeInMainWorld("desktopTabs", desktopTabsApi);
