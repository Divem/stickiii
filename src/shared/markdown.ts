import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import { toString } from "mdast-util-to-string";
import type { Root, RootContent, PhrasingContent } from "mdast";
import type { NoteAttachment } from "./types.js";

const parser = unified().use(remarkParse).use(remarkGfm);
const writer = unified().use(remarkStringify).use(remarkGfm);

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
  const blocks: NoteContentBlock[] = [];
  let cursor = 0;
  function addText(start: number, end: number, beforeImage: boolean): void {
    // Keep Markdown paragraph separators in storage, outside the text fields.
    if (start > 0) start += /^(?:\r\n|\n|\r){1,2}/.exec(content.slice(start, end))?.[0].length ?? 0;
    if (beforeImage) end -= /(?:\r\n|\n|\r){1,2}$/.exec(content.slice(start, end))?.[0].length ?? 0;
    blocks.push({ type: "text", start, end, text: content.slice(start, end) });
  }
  for (const node of (parser.parse(content) as Root).children) {
    if (node.type !== "paragraph" || node.children.length !== 1 || node.children[0].type !== "image") continue;
    const id = attachmentImageId(node.children[0].url);
    const attachment = attachments.find((item) => item.id === id && item.mimeType.startsWith("image/"));
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
  const referenced = new Set<string>();
  function visit(node: Root | RootContent | PhrasingContent): void {
    if (node.type === "image") {
      const id = attachmentImageId(node.url);
      if (id) referenced.add(id);
    }
    if ("children" in node) node.children.forEach(visit);
  }
  visit(parser.parse(content) as Root);
  const missing = attachments.filter((item) => item.mimeType.startsWith("image/") && !referenced.has(item.id));
  return missing.length ? content + (content ? "\n\n" : "") + missing.map(attachmentImageMarkdown).join("\n\n") + "\n\n" : content;
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

// Preserve remote image destinations as links; local attachment images are sent as
// separate media blocks. The note itself remains unchanged; only the Feishu
// payload is normalized.
export function markdownForFeishu(content: string): { content: string; imageLinks: boolean } {
  const tree = parser.parse(content) as Root;
  let imageLinks = false;
  function transform(node: Root | RootContent | PhrasingContent): void {
    if (!("children" in node)) return;
    node.children = node.children.map((child) => {
      if (child.type === "image") {
        if (attachmentImageId(child.url)) return { type: "text", value: child.alt || "" };
        imageLinks = true;
        return { type: "link", url: child.url, title: child.title, children: [{ type: "text", value: child.alt || child.url }] };
      }
      if (child.type === "imageReference") {
        imageLinks = true;
        return { type: "linkReference", identifier: child.identifier, label: child.label,
          referenceType: child.referenceType, children: [{ type: "text", value: child.alt || child.identifier }] };
      }
      transform(child);
      return child;
    }) as typeof node.children;
  }
  transform(tree);
  return { content: writer.stringify(tree), imageLinks };
}
