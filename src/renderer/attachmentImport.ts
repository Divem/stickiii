import type { Note, NoteAttachment } from "../shared/types.js";
import { attachmentImageMarkdown, contentWithAttachmentImages } from "../shared/markdown.js";

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_IMPORT_FILES = 20;

// Text copied from a web page keeps the usual text paste behavior, even when
// the clipboard also supplies an HTML image representation.
export function clipboardImages(data: DataTransfer): File[] {
  if (data.getData("text/plain")) return [];
  return Array.from(data.files).filter((file) => file.type.startsWith("image/"));
}

export type ImageInsertion = { content: string; start: number; end: number };

export function appendAttachments(current: Note | undefined, attachments: NoteAttachment[], insertion?: ImageInsertion): Note | undefined {
  if (!current || !attachments.length) return current;
  const images = attachments.filter((item) => item.mimeType.startsWith("image/"));
  let content = current.content;
  if (images.length) {
    content = contentWithAttachmentImages(content, current.attachments);
    // During an async import the user can keep typing. Preserve all newer text;
    // if its prefix changed, append rather than guessing which edit to replace.
    const start = insertion && content.startsWith(insertion.content.slice(0, insertion.start))
      ? Math.min(insertion.start, content.length) : content.length;
    const end = insertion && content === insertion.content ? insertion.end : start;
    const before = content.slice(0, start);
    const after = content.slice(end);
    content = before + (before && !before.endsWith("\n\n") ? before.endsWith("\n") ? "\n" : "\n\n" : "")
      + images.map(attachmentImageMarkdown).join("\n\n") + "\n\n" + after;
  }
  return { ...current, content, attachments: [...current.attachments, ...attachments], updatedAt: new Date().toISOString() };
}

export async function importAttachmentBatch(files: File[], importFile: (file: File) => Promise<NoteAttachment>):
Promise<{ attachments: NoteAttachment[]; failures: number; error?: string }> {
  if (files.length > MAX_IMPORT_FILES) return { attachments: [], failures: files.length, error: "ATTACHMENT_TOO_MANY" };
  const attachments: NoteAttachment[] = [];
  let failures = 0;
  let error: string | undefined;
  for (const file of files) {
    try {
      if (file.size > MAX_ATTACHMENT_BYTES) throw "ATTACHMENT_TOO_LARGE";
      attachments.push(await importFile(file));
    } catch (cause) {
      failures++;
      error ??= typeof cause === "string" ? cause : "ATTACHMENT_COPY_FAILED";
    }
  }
  return { attachments, failures, error };
}
