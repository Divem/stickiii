import { app, BrowserWindow, dialog, globalShortcut, ipcMain, screen, shell } from "electron";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Note, NoteAttachment, SyncProviderId } from "./shared/types.js";
import { getSyncAdapter } from "./platform/sync/registry.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const notesPath = (): string => join(app.getPath("userData"), "notes.json");
const attachmentsPath = (): string => join(app.getPath("userData"), "attachments");
let mainWindow: BrowserWindow | null = null;
let notes: Note[] = [];

async function loadNotes(): Promise<void> {
  try {
    notes = JSON.parse(await readFile(notesPath(), "utf8")) as Note[];
  } catch {
    notes = [];
  }
}

async function persistNotes(): Promise<void> {
  const path = notesPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(notes, null, 2), "utf8");
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 390,
    minWidth: 320,
    minHeight: 260,
    maxWidth: 760,
    maxHeight: 860,
    show: false,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    fullscreenable: false,
    titleBarStyle: "hidden",
    backgroundColor: "#f8f7f3",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: join(__dirname, "preload.js"),
    },
  });
  mainWindow.setAlwaysOnTop(true, "floating");
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(join(__dirname, "renderer", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function revealWindow(): void {
  if (!mainWindow) createWindow();
  if (mainWindow && !mainWindow.isVisible()) {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const [width, height] = mainWindow.getSize();
    const x = Math.min(Math.max(cursor.x - Math.round(width / 2), display.bounds.x + 12), display.bounds.x + display.bounds.width - width - 12);
    const y = Math.min(Math.max(cursor.y + 18, display.bounds.y + 12), display.bounds.y + display.bounds.height - height - 12);
    mainWindow.setPosition(x, y, false);
  }
  mainWindow?.show();
  mainWindow?.focus();
}

function registerIpc(): void {
  ipcMain.handle("notes:list", () => notes);
  ipcMain.handle("notes:save", async (_event, note: Note) => {
    const updatedNote: Note = { ...note, updatedAt: new Date().toISOString(), syncState: "local" };
    const index = notes.findIndex((item) => item.id === updatedNote.id);
    if (index === -1) notes = [updatedNote, ...notes];
    else notes[index] = updatedNote;
    await persistNotes();
    return updatedNote;
  });
  ipcMain.handle("notes:delete", async (_event, noteId: string) => {
    notes = notes.filter((note) => note.id !== noteId);
    await persistNotes();
  });
  ipcMain.handle("files:pick", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      title: "Add images or files",
    });
    if (result.canceled) return [];

    await mkdir(attachmentsPath(), { recursive: true });
    return Promise.all(result.filePaths.map(async (sourcePath): Promise<NoteAttachment> => {
      const fileName = basename(sourcePath);
      const destination = join(attachmentsPath(), `${randomUUID()}${extname(fileName)}`);
      await copyFile(sourcePath, destination);
      const fileStats = await stat(destination);
      const extension = extname(fileName).toLowerCase();
      const mimeType = extension === ".png" ? "image/png" : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".gif" ? "image/gif" : "application/octet-stream";
      const previewDataUrl = mimeType.startsWith("image/") && fileStats.size <= 3 * 1024 * 1024
        ? `data:${mimeType};base64,${(await readFile(destination)).toString("base64")}`
        : undefined;
      return { id: randomUUID(), name: fileName, mimeType, size: fileStats.size, storedPath: destination, previewDataUrl };
    }));
  });
  ipcMain.handle("files:open", async (_event, storedPath: string) => {
    const allowedRoot = `${attachmentsPath()}${process.platform === "win32" ? "\\" : "/"}`;
    if (!storedPath.startsWith(allowedRoot)) return "INVALID_ATTACHMENT_PATH";
    return shell.openPath(storedPath);
  });
  ipcMain.handle("sync:note", async (_event, note: Note, provider: SyncProviderId) => {
    const adapter = getSyncAdapter(provider);
    return adapter.sync(note, { provider });
  });
  ipcMain.on("window:minimize", () => mainWindow?.minimize());
  ipcMain.on("window:close", () => mainWindow?.hide());
}

app.whenReady().then(async () => {
  await loadNotes();
  registerIpc();
  createWindow();
  globalShortcut.register("CommandOrControl+Shift+Space", revealWindow);
  app.on("activate", revealWindow);
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
