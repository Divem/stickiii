import type { Note } from "../shared/types.js";

export function noteSearchMatches(content: string, query: string): { start: number; end: number }[] {
  if (!query) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  return [...content.matchAll(pattern)].map((match) => ({ start: match.index, end: match.index + match[0].length }));
}

export function createNoteMatcher(query: string): (note: Note) => boolean {
  if (!query) return () => true;
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
  return (note) => pattern.test(note.content) || note.attachments.some((file) => pattern.test(file.name));
}

export function noteMatchesSearch(note: Note, query: string): boolean {
  return createNoteMatcher(query)(note);
}

export function noteSearchSnippet(content: string, query: string): { before: string; match: string; after: string } | null {
  if (!query) return null;
  const text = content.replace(/\s+/g, " ");
  const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (index < 0) return null;
  const start = Math.max(0, index - 8);
  const end = Math.min(text.length, index + query.length + 40);
  return {
    before: `${start > 0 ? "…" : ""}${text.slice(start, index)}`,
    match: text.slice(index, index + query.length),
    after: `${text.slice(index + query.length, end)}${end < text.length ? "…" : ""}`,
  };
}
