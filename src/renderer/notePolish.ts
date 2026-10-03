import type { Note } from "../shared/types.js";

export type PolishChange = { noteId: string; originalContent: string; polishedContent: string };

export function applyPolish(current: Note | undefined, originalContent: string, polishedContent: string):
  | { status: "applied"; note: Note; change: PolishChange }
  | { status: "missing" | "changed" | "unchanged" } {
  if (!current) return { status: "missing" };
  if (current.content !== originalContent) return { status: "changed" };
  if (current.content === polishedContent) return { status: "unchanged" };
  return {
    status: "applied",
    note: { ...current, content: polishedContent, updatedAt: new Date().toISOString(), syncState: "local" },
    change: { noteId: current.id, originalContent, polishedContent },
  };
}

export function undoPolish(current: Note | undefined, change: PolishChange): Note | undefined {
  if (!current || current.id !== change.noteId || current.content !== change.polishedContent) return undefined;
  return { ...current, content: change.originalContent, updatedAt: new Date().toISOString(), syncState: "local" };
}
