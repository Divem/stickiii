import type { Note, NoteAttachment } from "../shared/types.js";

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_IMPORT_FILES = 20;

// Text copied from a web page keeps the usual text paste behavior, even when
// the clipboard also supplies an HTML image representation.
export function clipboardImages(data: DataTransfer): File[] {
  if (data.getData("text/plain")) return [];
  return Array.from(data.files).filter((file) => file.type.startsWith("image/"));
}

export function appendAttachments(current: Note | undefined, attachments: NoteAttachment[]): Note | undefined {
  if (!current || !attachments.length) return current;
  return { ...current, attachments: [...current.attachments, ...attachments], updatedAt: new Date().toISOString() };
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
