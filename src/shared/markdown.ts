import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { toString } from "mdast-util-to-string";
import type { Root, RootContent, PhrasingContent } from "mdast";
import type { NoteAttachment } from "./types.js";

const parser = unified().use(remarkParse).use(remarkGfm);

export function attachmentImageId(url: string): string | undefined {
  return /^attachment:([a-zA-Z0-9-]+)$/.exec(url)?.[1];
}

export function attachmentImageMarkdown(attachment: NoteAttachment): string {
  const alt = attachment.name.replace(/([\\\[\]])/g, "\\$1").replace(/[\r\n]/g, " ");
  return `![${alt}](attachment:${attachment.id})`;
}

export type NoteContentBlock =
  | { type: "text"; start: number; end: number; text: string }
  | { type: "image"; start: number; end: number; attachment: NoteAttachment };

// Only standalone, managed image paragraphs become editable image blocks.
// Markdown examples inside code blocks keep their original text.
export function noteContentBlocks(content: string, attachments: NoteAttachment[]): NoteContentBlock[] {
  if (!attachments.some((item) => item.mimeType.startsWith("image/"))) return [{ type: "text", start: 0, end: content.length, text: content }];
  return contentBlocksFromTree(content, attachments, parser.parse(content) as Root);
}

function contentBlocksFromTree(content: string, attachments: NoteAttachment[], tree: Root): NoteContentBlock[] {
  const blocks: NoteContentBlock[] = [];
  let cursor = 0;
  function addText(start: number, end: number, beforeImage: boolean): void {
    // Keep Markdown paragraph separators in storage, outside the text fields.
    if (start > 0) start += /^(?:\r\n|\n|\r){1,2}/.exec(content.slice(start, end))?.[0].length ?? 0;
    if (beforeImage) end -= /(?:\r\n|\n|\r){1,2}$/.exec(content.slice(start, end))?.[0].length ?? 0;
    blocks.push({ type: "text", start, end, text: content.slice(start, end) });
  }
  const images = new Map(attachments.filter((item) => item.mimeType.startsWith("image/")).map((item) => [item.id, item]));
  for (const node of tree.children) {
    if (node.type !== "paragraph" || node.children.length !== 1 || node.children[0].type !== "image") continue;
    const id = attachmentImageId(node.children[0].url);
    const attachment = id ? images.get(id) : undefined;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (!attachment || start === undefined || end === undefined) continue;
    addText(cursor, start, true);
    blocks.push({ type: "image", start, end, attachment });
    cursor = end;
  }
  addText(cursor, content.length, false);
  return blocks;
}

export function removeAttachmentImages(content: string, id: string): string {
  const ranges: { start: number; end: number }[] = [];
  function visit(node: Root | RootContent | PhrasingContent): void {
    if (node.type === "image" && attachmentImageId(node.url) === id) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) ranges.push({ start, end });
    }
    if ("children" in node) node.children.forEach(visit);
  }
  visit(parser.parse(content) as Root);
  for (const { start, end } of ranges.reverse()) content = content.slice(0, start) + content.slice(end);
  return content;
}

// Existing image attachments remain visible without rewriting old notes on read.
export function contentWithAttachmentImages(content: string, attachments: NoteAttachment[]): string {
  const images = attachments.filter((item) => item.mimeType.startsWith("image/"));
  if (!images.length) return content;
  return appendMissingImages(content, images, parser.parse(content) as Root);
}

function appendMissingImages(content: string, images: NoteAttachment[], tree: Root): string {
  const referenced = new Set<string>();
  function visit(node: Root | RootContent | PhrasingContent): void {
    if (node.type === "image") {
      const id = attachmentImageId(node.url);
      if (id) referenced.add(id);
    }
    if ("children" in node) node.children.forEach(visit);
  }
  visit(tree);
  const missing = images.filter((item) => !referenced.has(item.id));
  return missing.length ? content + (content ? "\n\n" : "") + missing.map(attachmentImageMarkdown).join("\n\n") + "\n\n" : content;
}

export function prepareNoteContent(content: string, attachments: NoteAttachment[]): { content: string; blocks: NoteContentBlock[] } {
  const images = attachments.filter((item) => item.mimeType.startsWith("image/"));
  if (!images.length) return { content, blocks: [{ type: "text", start: 0, end: content.length, text: content }] };
  const tree = parser.parse(content) as Root;
  const body = appendMissingImages(content, images, tree);
  // Legacy attachments may append Markdown inside an unclosed code fence.
  // Reparse only that compatibility case to preserve Markdown semantics.
  return { content: body, blocks: contentBlocksFromTree(body, images, body === content ? tree : parser.parse(body) as Root) };
}

export function markdownTitle(content: string): string {
  return toString(parser.parse(content.split(/\r\n|\n|\r/, 1)[0]), { includeHtml: false }).trim();
}

export function externalWebUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}
