import { ChevronLeft, ChevronRight, Paperclip } from "lucide-react";
import { memo, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import type { Note } from "../shared/types.js";
import { getNoteTitle, isNoteThemeId } from "../shared/notes.js";
import MarkdownPreview from "./MarkdownPreview.js";
import InlineNoteContent, { type NoteEditorHandle } from "./InlineNoteContent.js";
import { t, type Locale } from "./i18n.js";

export type PageTurnDirection = "previous" | "next";
export type PageTurn = {
  sequence: number;
  direction: PageTurnDirection;
  note: Note;
  mode: "edit" | "preview";
  scroll: number;
};

const PagePeek = memo(function PagePeek({ note, direction, locale, shortcut, disabled, onSelect }: {
  note: Note; direction: PageTurnDirection; locale: Locale; disabled: boolean; onSelect: () => void;
  shortcut?: string;
}) {
  const firstLine = note.content.split(/\r\n|\n|\r/, 1)[0];
  const title = useMemo(() => getNoteTitle(firstLine) || t("untitled", locale), [firstLine, locale]);
  const label = `${t(direction === "previous" ? "previousPage" : "nextPage", locale)} · ${title}`;
  return <button className={`page-peek page-peek-${direction}`} disabled={disabled}
    aria-label={label} title={shortcut ? t("shortcutTip", locale).replace("{shortcut}", () => shortcut).replace("{action}", () => label) : label} onClick={onSelect}>
    <span className="page-peek-arrow" aria-hidden="true">
      {direction === "previous" ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
    </span>
  </button>;
});

export default function NoteBook({ previousNote, nextNote, currentIndex, total, locale, busy, turn,
  previousShortcut, nextShortcut, onPrevious, onNext, onShowNotes, onTurnEnd, children }: {
  previousNote?: Note; nextNote?: Note; currentIndex: number; total: number; locale: Locale; busy: boolean;
  turn: PageTurn | null; onPrevious: () => void; onNext: () => void; onShowNotes: () => void;
  onTurnEnd: (sequence: number) => void; children: ReactNode;
  previousShortcut?: string; nextShortcut?: string;
}) {
  const pageRef = useRef<HTMLDivElement>(null);
  const outgoingRef = useRef<HTMLDivElement>(null);
  const outgoingContentRef = useRef<HTMLDivElement>(null);
  const outgoingEditorRef = useRef<NoteEditorHandle>(null);
  const hasNeighbors = !!previousNote && !!nextNote;

  useLayoutEffect(() => {
    if (!turn || !pageRef.current || !outgoingRef.current) return;
    const outgoingContent = outgoingContentRef.current;
    const scroller = turn.mode === "preview" ? outgoingContent?.querySelector(".markdown-preview")
      : outgoingContent?.querySelector(".inline-note-content.has-images") ?? outgoingContent;
    if (scroller) scroller.scrollTop = turn.scroll;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onTurnEnd(turn.sequence);
      return;
    }
    const next = turn.direction === "next";
    const options: KeyframeAnimationOptions = { duration: 280, easing: "cubic-bezier(.22,.65,.3,1)", fill: "both" };
    const incoming = pageRef.current.animate([
      { transform: `translateX(${next ? 12 : -12}px) rotateY(${next ? 6 : -6}deg)` },
      { transform: "translateX(0) rotateY(0)" },
    ], options);
    const outgoing = outgoingRef.current.animate([
      { transform: "rotateY(0)", opacity: 1 },
      { transform: `rotateY(${next ? -78 : 78}deg)`, opacity: 0 },
    ], options);
    void outgoing.finished.then(() => onTurnEnd(turn.sequence)).catch(() => {});
    // A new click can interrupt the animation immediately without remounting the editor.
    return () => { incoming.cancel(); outgoing.cancel(); };
  }, [turn, onTurnEnd]);

  const pageLabel = t("notePagePosition", locale).replace("{current}", String(currentIndex + 1)).replace("{total}", String(total));
  return <div className={`note-book ${hasNeighbors ? "has-neighbors" : ""}`}>
    {previousNote && <PagePeek note={previousNote} direction="previous" locale={locale} shortcut={previousShortcut} disabled={busy} onSelect={onPrevious} />}
    {nextNote && <PagePeek note={nextNote} direction="next" locale={locale} shortcut={nextShortcut} disabled={busy} onSelect={onNext} />}
    <div ref={pageRef} className="note-page">{children}</div>
    {turn && <div key={turn.sequence} ref={outgoingRef} className={`turning-page turning-page-${turn.direction}`}
      data-page-theme={isNoteThemeId(turn.note.theme) ? turn.note.theme : "paper"} aria-hidden="true" inert>
      <div ref={outgoingContentRef} className={`turning-page-content ${turn.mode === "edit" ? "turning-page-text" : ""}`}>
        {turn.mode === "preview" ? <MarkdownPreview content={turn.note.content} noteId={turn.note.id} attachments={turn.note.attachments} locale={locale} onOpenLink={() => {}} />
          : turn.note.attachments.some((attachment) => attachment.mimeType.startsWith("image/"))
            ? <InlineNoteContent note={turn.note} hidden={false} readOnly importing={false} locale={locale} editorRef={outgoingEditorRef}
              onChange={() => {}} onOpenAttachment={() => {}} onRemoveAttachment={() => {}} /> : turn.note.content}
      </div>
      {turn.note.attachments.some((attachment) => !attachment.mimeType.startsWith("image/")) && <div className="turning-page-attachments">{turn.note.attachments.filter((attachment) => !attachment.mimeType.startsWith("image/")).map((attachment) =>
        <span key={attachment.id}><Paperclip size={12} />{attachment.name}</span>)}</div>}
    </div>}
    {hasNeighbors && <button className="note-page-position" data-menu-trigger="notes" disabled={busy} aria-label={`${pageLabel} · ${t("viewNotes", locale)}`}
      title={t("viewNotes", locale)} onClick={onShowNotes}><span aria-hidden="true">{currentIndex + 1} / {total}</span></button>}
  </div>;
}
