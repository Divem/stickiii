import { File, FileText, Image as ImageIcon, X } from "lucide-react";
import type { RefObject } from "react";
import type { Note, NoteAttachment } from "../shared/types.js";
import MarkdownPreview from "./MarkdownPreview.js";
import { t, type Locale } from "./i18n.js";

export default function NoteEditor({ note, preview, readOnly, locale, editorRef, previewRef, onChange, onOpenLink, onOpenAttachment, onRemoveAttachment }: {
  note: Note; preview: boolean; readOnly: boolean; locale: Locale;
  editorRef: RefObject<HTMLTextAreaElement | null>; previewRef: RefObject<HTMLDivElement | null>;
  onChange: (content: string) => void; onOpenLink: (url: string) => void;
  onOpenAttachment: (attachment: NoteAttachment) => void; onRemoveAttachment: (id: string) => void;
}) {
  return <>
    <textarea key={note.id} ref={editorRef} className="note-content" hidden={preview} readOnly={readOnly}
      value={note.content} onChange={(event) => onChange(event.target.value)} aria-label={t("noteContent", locale)}
      title={t("markdownHint", locale)} placeholder={t("notePlaceholder", locale)} />
    {preview && <MarkdownPreview previewRef={previewRef} content={note.content} locale={locale} onOpenLink={onOpenLink} />}
    {note.attachments.length > 0 && <div className="attachment-strip">{note.attachments.map((attachment) => (
      <div className="attachment-card" key={attachment.id}>
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
  </>;
}
