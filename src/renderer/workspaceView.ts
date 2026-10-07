export type EditorView = { start: number; end: number; scroll: number; previewScroll: number; mode: "edit" | "preview" };
export type WorkspaceView = { activeNoteId?: string; views: Record<string, EditorView> };
const KEY = "desk-tabs.workspace-view";

export function readWorkspaceView(storage: Pick<Storage, "getItem">): WorkspaceView {
  try {
    const value = JSON.parse(storage.getItem(KEY) ?? "null");
    const views: Record<string, EditorView> = Object.create(null);
    for (const [id, raw] of Object.entries(value?.views ?? {}).slice(-500)) {
      const view = raw as Partial<EditorView> | null;
      if (!view || ![view.start, view.end, view.scroll, view.previewScroll].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0) || !["edit", "preview"].includes(view.mode ?? "")) continue;
      views[id] = view as EditorView;
    }
    return { activeNoteId: typeof value?.activeNoteId === "string" ? value.activeNoteId : undefined, views };
  } catch { return { views: {} }; }
}

export function writeWorkspaceView(storage: Pick<Storage, "getItem" | "setItem">, noteId: string, view?: EditorView, makeActive = false): void {
  try {
    const current = readWorkspaceView(storage);
    if (view) { delete current.views[noteId]; current.views[noteId] = view; }
    if (makeActive) current.activeNoteId = noteId;
    current.views = Object.fromEntries(Object.entries(current.views).slice(-500));
    storage.setItem(KEY, JSON.stringify(current));
  } catch { /* Position memory is best effort; note saving remains native. */ }
}
