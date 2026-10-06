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
