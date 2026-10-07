import { File, FileText, Image as ImageIcon, X } from "lucide-react";
import { lazy, memo, Suspense, useEffect, useRef, useState, type RefObject } from "react";
import type { Note, NoteAttachment } from "../shared/types.js";
import { t, type Locale } from "./i18n.js";
import { clipboardImages } from "./attachmentImport.js";
import type { ImageInsertion } from "./attachmentImport.js";
import InlineNoteContent, { type NoteEditorHandle } from "./InlineNoteContent.js";
import { contentWithAttachmentImages } from "../shared/markdown.js";

const MarkdownPreview = lazy(() => import("./MarkdownPreview.js"));

export default memo(function NoteEditor({ note, preview, readOnly, importing, importDisabled, locale, autoSize = false, textSize, editorRef, previewRef, onChange, onOpenLink, onOpenAttachment, onRemoveAttachment, onImportFiles, onImportRejected, onPreviewReady }: {
  note: Note; preview: boolean; readOnly: boolean; locale: Locale;
  importing: boolean; importDisabled: boolean;
  autoSize?: boolean;
  textSize?: number;
  editorRef: RefObject<NoteEditorHandle | null>; previewRef: RefObject<HTMLDivElement | null>;
  onChange: (content: string) => void; onOpenLink: (url: string) => void;
  onOpenAttachment: (attachment: NoteAttachment) => void; onRemoveAttachment: (id: string) => void;
  onImportFiles: (files: File[], imageOnly: boolean, insertion?: ImageInsertion) => void; onImportRejected: (directory: boolean) => void;
  onPreviewReady: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const resetDrag = (): void => { dragDepth.current = 0; setDragging(false); };
  useEffect(() => { resetDrag(); }, [note.id, readOnly, importing, importDisabled]);
  useEffect(() => {
    window.addEventListener("blur", resetDrag);
    window.addEventListener("dragend", resetDrag);
    window.addEventListener("drop", resetDrag);
    return () => {
      window.removeEventListener("blur", resetDrag);
      window.removeEventListener("dragend", resetDrag);
      window.removeEventListener("drop", resetDrag);
    };
  }, []);
  const available = !readOnly && !importing && !importDisabled;
  const imageInsertion = (): ImageInsertion | undefined => preview ? undefined : {
    content: contentWithAttachmentImages(note.content, note.attachments),
    start: editorRef.current?.selectionStart ?? note.content.length,
    end: editorRef.current?.selectionEnd ?? note.content.length,
  };
  const files = note.attachments.filter((attachment) => !attachment.mimeType.startsWith("image/"));
  return <div className={`attachment-drop-zone${dragging ? " dragging" : ""}`} onPaste={(event) => {
    const images = clipboardImages(event.clipboardData);
    if (!images.length) return;
    event.preventDefault();
    if (available) onImportFiles(images, true, imageInsertion());
    else onImportRejected(false);
  }} onDragEnter={(event) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepth.current++;
    if (available) setDragging(true);
  }} onDragOver={(event) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = available ? "copy" : "none";
  }} onDragLeave={(event) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDragging(false);
  }} onDrop={(event) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    resetDrag();
    if (!available) { onImportRejected(false); return; }
    if (Array.from(event.dataTransfer.items).some((item) => item.webkitGetAsEntry?.()?.isDirectory)) {
      onImportRejected(true); return;
    }
    const files = Array.from(event.dataTransfer.files);
    if (files.length) onImportFiles(files, false, imageInsertion());
  }}>
    <InlineNoteContent key={note.id} note={note} hidden={preview} readOnly={readOnly} importing={importing} locale={locale} autoSize={autoSize} textSize={textSize}
      editorRef={editorRef} onChange={onChange} onOpenAttachment={onOpenAttachment} onRemoveAttachment={onRemoveAttachment} />
    {preview && <Suspense fallback={<p role="status">{t("viewLoading", locale)}</p>}><MarkdownPreview previewRef={previewRef} noteId={note.id} attachments={note.attachments} imageReady={!importing}
      content={note.content} locale={locale} onOpenLink={onOpenLink} onOpenAttachment={onOpenAttachment} onChange={readOnly ? undefined : onChange} onReady={onPreviewReady} /></Suspense>}
    {files.length > 0 && <div className="attachment-strip">{files.map((attachment) => (
      <div className="attachment-card" data-attachment-id={attachment.id} key={attachment.id}>
        <button className="attachment-open-button" onClick={() => onOpenAttachment(attachment)} title={attachment.name}>
          {attachment.previewDataUrl ? <img src={attachment.previewDataUrl} alt={attachment.name} loading="lazy" />
            : <span className="attachment-icon">{attachment.mimeType.startsWith("image/") ? <ImageIcon size={16} />
              : attachment.mimeType.includes("text") || attachment.name.endsWith(".md") ? <FileText size={16} /> : <File size={16} />}</span>}
          <span className="attachment-info"><strong>{attachment.name}</strong><small>{attachment.size < 1024 ? `${attachment.size} B`
            : attachment.size < 1024 * 1024 ? `${Math.round(attachment.size / 1024)} KB` : `${(attachment.size / 1024 / 1024).toFixed(1)} MB`}</small></span>
        </button>
        <button className="attachment-remove" disabled={readOnly} title={t("removeAttachment", locale)} aria-label={`${t("removeAttachment", locale)} ${attachment.name}`}
          onClick={() => onRemoveAttachment(attachment.id)}><X size={12} /></button>
      </div>
    ))}</div>}
    {dragging && <div className="attachment-drop-hint" role="status"><ImageIcon size={24} /><strong>{t("dropAttachments", locale)}</strong><span>{t("dropAttachmentsHint", locale)}</span></div>}
    {importing && <span className="attachment-import-status" role="status">{t("importingFiles", locale)}</span>}
  </div>;
});
