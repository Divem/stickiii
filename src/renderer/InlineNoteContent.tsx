import { useImperativeHandle, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { X } from "lucide-react";
import { contentWithAttachmentImages, noteContentBlocks } from "../shared/markdown.js";
import type { Note, NoteAttachment } from "../shared/types.js";
import NoteImage from "./NoteImage.js";
import { t, type Locale } from "./i18n.js";
import { continueMarkdownList, toggleMarkdownBold } from "./markdownEditing.js";

export type NoteEditorHandle = {
  readonly selectionStart: number;
  readonly selectionEnd: number;
  scrollTop: number;
  focus: (options?: FocusOptions) => void;
  setSelectionRange: (start: number, end: number) => void;
};

export default function InlineNoteContent({ note, hidden, readOnly, importing, locale, editorRef, onChange, onOpenAttachment, onRemoveAttachment }: {
  note: Note; hidden: boolean; readOnly: boolean; importing: boolean; locale: Locale;
  editorRef: RefObject<NoteEditorHandle | null>;
  onChange: (content: string) => void;
  onOpenAttachment: (attachment: NoteAttachment) => void; onRemoveAttachment: (id: string) => void;
}) {
  const content = useMemo(() => contentWithAttachmentImages(note.content, note.attachments), [note.content, note.attachments]);
  const blocks = useMemo(() => noteContentBlocks(content, note.attachments), [content, note.attachments]);
  const root = useRef<HTMLDivElement>(null);
  const editors = useRef(new Map<number, HTMLTextAreaElement>());
  const active = useRef(0);
  const hasImages = blocks.some((block) => block.type === "image");
  useImperativeHandle(editorRef, () => ({
    get selectionStart() { const block = blocks[active.current]; return (block?.start ?? 0) + (editors.current.get(active.current)?.selectionStart ?? 0); },
    get selectionEnd() { const block = blocks[active.current]; return (block?.start ?? 0) + (editors.current.get(active.current)?.selectionEnd ?? 0); },
    get scrollTop() { return hasImages ? root.current?.scrollTop ?? 0 : editors.current.get(0)?.scrollTop ?? 0; },
    set scrollTop(value) { const target = hasImages ? root.current : editors.current.get(0); if (target) target.scrollTop = value; },
    focus(options) { (editors.current.get(active.current) ?? editors.current.get(0))?.focus(options); },
    setSelectionRange(start, end) {
      let index = blocks.findIndex((block) => block.type === "text" && start <= block.end);
      if (index < 0) index = blocks.length - 1;
      const block = blocks[index];
      active.current = index;
      editors.current.get(index)?.setSelectionRange(Math.max(0, start - block.start), Math.max(0, end - block.start));
    },
  }), [blocks, hasImages]);
  useLayoutEffect(() => {
    if (hidden) return;
    const resize = () => {
      for (const editor of editors.current.values()) {
        editor.style.height = hasImages ? "0px" : "";
        if (hasImages) editor.style.height = `${Math.max(28, editor.scrollHeight)}px`;
      }
    };
    resize();
    const observer = new ResizeObserver(resize);
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, [blocks, hidden, hasImages]);
  return <div ref={root} className={`inline-note-content${hasImages ? " has-images" : ""}`} hidden={hidden}>
    {blocks.map((block, index) => block.type === "text" ? <textarea key={`text-${index}`}
      ref={(editor) => { if (editor) editors.current.set(index, editor); else editors.current.delete(index); }}
      className="note-content" hidden={hidden} readOnly={readOnly} value={block.text}
      aria-label={t("noteContent", locale)} title={t("markdownHint", locale)}
      placeholder={index === 0 && !hasImages ? t("notePlaceholder", locale) : undefined}
      onFocus={() => { active.current = index; }} onSelect={() => { active.current = index; }}
      onKeyDown={(event) => {
        if (readOnly || event.nativeEvent.isComposing || event.repeat) return;
        const editor = event.currentTarget;
        const start = block.start + editor.selectionStart;
        const end = block.start + editor.selectionEnd;
        const modifier = navigator.platform.toLowerCase().includes("mac") ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
        const edit = event.key === "Enter" && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey
          ? continueMarkdownList(content, start, end)
          : modifier && event.key.toLowerCase() === "b" && !event.altKey && !event.shiftKey ? toggleMarkdownBold(content, start, end) : null;
        if (!edit) return;
        event.preventDefault();
        editor.setSelectionRange(edit.start - block.start, edit.end - block.start);
        // Native text insertion keeps this edit in the textarea's undo history.
        if (!document.execCommand("insertText", false, edit.text)) {
          editor.setRangeText(edit.text, edit.start - block.start, edit.end - block.start, "end");
          onChange(content.slice(0, edit.start) + edit.text + content.slice(edit.end));
        }
        editor.setSelectionRange(edit.selectionStart - block.start, edit.selectionEnd - block.start);
      }}
      onChange={(event) => {
        onChange(content.slice(0, block.start) + event.target.value + content.slice(block.end));
      }} /> : <div className="note-image-block" key={block.attachment.id}>
        <NoteImage noteId={note.id} attachment={block.attachment} locale={locale} ready={!importing && !hidden} compact onOpen={onOpenAttachment} />
        <button className="note-image-remove" disabled={readOnly} title={t("removeImage", locale)}
          aria-label={`${t("removeImage", locale)} ${block.attachment.name}`} onClick={() => onRemoveAttachment(block.attachment.id)}><X size={13} /></button>
      </div>)}
  </div>;
}
