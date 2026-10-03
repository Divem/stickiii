import type { Note, NoteThemeId } from "./types.js";
import { markdownTitle } from "./markdown.js";

const noteThemes: readonly NoteThemeId[] = ["paper", "mist", "sage", "sky", "peach", "lavender", "ink"];
export const DEFAULT_THEME_OPACITY = 1;
export const MIN_THEME_OPACITY = 0.4;

export function isNoteThemeId(value: unknown): value is NoteThemeId {
  return typeof value === "string" && noteThemes.includes(value as NoteThemeId);
}

export function normalizeThemeOpacity(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(DEFAULT_THEME_OPACITY, Math.max(MIN_THEME_OPACITY, value));
}

export function getNoteTitle(content: string): string {
  return markdownTitle(content);
}

export function normalizeStoredNote(stored: Note & { title?: string }): Note {
  const { title, themeOpacity: rawThemeOpacity, ...note } = stored;
  const themeOpacity = normalizeThemeOpacity(rawThemeOpacity);
  const normalized = themeOpacity === undefined ? note : { ...note, themeOpacity };
  // Older records stored a separate title. Keep it as the first line once.
  if (title?.trim() && title !== "未命名记录" && title !== "Untitled note") {
    return { ...normalized, content: normalized.content ? `${title}\n${normalized.content}` : title };
  }
  return normalized;
}
