import { Plus, Search, PanelTop } from "lucide-react";
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Note } from "../shared/types.js";
import { getNoteTitle } from "../shared/notes.js";
import { t, type Locale } from "./i18n.js";
import { noteSearchSnippet } from "./noteSearch.js";

const NoteRow = memo(function NoteRow({ note, selected, locale, onSelect, onOpen, independent, search, highlighted }: {
  note: Note; selected: boolean; locale: Locale; onSelect: (note: Note) => void; onOpen: (id: string) => void; independent: boolean;
  search: string; highlighted: boolean;
}) {
  const firstLine = note.content.split(/\r\n|\n|\r/, 1)[0];
  const title = useMemo(() => getNoteTitle(firstLine), [firstLine]);
  const snippet = useMemo(() => noteSearchSnippet(note.content, search), [note.content, search]);
  const time = useMemo(() => new Date(note.updatedAt).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", {
    month: "short", day: "numeric",
  }), [note.updatedAt, locale]);
  const selectPointerUp = useRef(false);
  const openPointerUp = useRef(false);
  const runOnPointerUp = (event: ReactPointerEvent<HTMLButtonElement>, action: () => void, pointerUp: { current: boolean }): void => {
    if (event.pointerType === "mouse" && event.button === 0) {
      pointerUp.current = true;
      action();
    }
  };
  const runOnClick = (event: ReactMouseEvent<HTMLButtonElement>, action: () => void, pointerUp: { current: boolean }): void => {
    if (pointerUp.current && event.detail > 0) {
      pointerUp.current = false;
      return;
    }
    pointerUp.current = false;
    action();
  };
  // Run on pointerup as well as click because WebKit may consume click while focus moves.
  return <div className={`note-list-row ${highlighted ? "keyboard-highlighted" : ""}`} data-highlighted={highlighted}><button className={`popover-note ${selected ? "selected" : ""}`} aria-current={selected ? "true" : undefined}
    title={title || t("untitled", locale)} onPointerUp={(event) => runOnPointerUp(event, () => onSelect(note), selectPointerUp)} onPointerCancel={() => { selectPointerUp.current = false; }} onClick={(event) => runOnClick(event, () => onSelect(note), selectPointerUp)}>
    <span className="note-result-content"><span className="note-result-title">{title || t("untitled", locale)}{independent && <span className="independent-marker" title={t("independentNote", locale)}> · ↗</span>}</span>
      {snippet && <span className="note-result-snippet">{snippet.before}<mark>{snippet.match}</mark>{snippet.after}</span>}</span><small>{time}</small>
  </button><button className="note-list-open" aria-label={`${t(independent ? "focusNoteWindow" : "openNoteWindow", locale)} · ${title || t("untitled", locale)}`}
    title={t(independent ? "focusNoteWindow" : "openNoteWindow", locale)} onPointerUp={(event) => runOnPointerUp(event, () => onOpen(note.id), openPointerUp)} onPointerCancel={() => { openPointerUp.current = false; }} onClick={(event) => runOnClick(event, () => onOpen(note.id), openPointerUp)}><PanelTop size={13} /></button></div>;
});

export default function NoteList({ notes, activeNote, locale, newNoteTip, onSelect, onNew, onOpen, openNoteIds, onClose }: {
  notes: Note[]; activeNote: Note | null; locale: Locale; onSelect: (note: Note) => void; onNew: () => void;
  onOpen: (id: string) => void; openNoteIds: string[];
  newNoteTip?: string;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(100);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const search = useDeferredValue(query.trim().toLocaleLowerCase());
  const matched = useMemo(() => search ? notes.filter((note) =>
    (note.id === activeNote?.id ? activeNote.content : note.content).toLocaleLowerCase().includes(search)) : notes,
  [notes, activeNote, search]);
  const highlightedIndex = Math.max(0, matched.findIndex((note) => note.id === (highlightedId ?? (search ? matched[0]?.id : activeNote?.id))));
  useEffect(() => {
    resultsRef.current?.querySelector("[data-highlighted=true]")?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, search]);
  return <>
    <div className="popover-title notes-header"><span>{t("viewNotes", locale)}</span>
      <button className="notes-new-button" aria-label={t("newNote", locale)} title={newNoteTip ?? t("newNote", locale)} onClick={onNew}><Plus size={15} /></button>
    </div>
    <label className="notes-search"><Search size={13} /><input autoFocus value={query} aria-describedby="notes-keyboard-hint"
      aria-label={t("searchPlaceholder", locale)} placeholder={t("searchPlaceholder", locale)}
      onChange={(event) => { setQuery(event.target.value); setLimit(100); setHighlightedId(null); }} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
        else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && matched.length) {
          event.preventDefault();
          const index = (highlightedIndex + (event.key === "ArrowDown" ? 1 : -1) + matched.length) % matched.length;
          setHighlightedId(matched[index].id); setLimit((current) => Math.max(current, index + 1));
        } else if (event.key === "Enter" && matched[highlightedIndex]) { event.preventDefault(); onSelect(matched[highlightedIndex]); }
      }} /></label>
    <span id="notes-keyboard-hint" className="notes-keyboard-hint">{t("searchKeyboardHint", locale)}</span>
    <div ref={resultsRef} className="note-search-results">
    {matched.slice(0, limit).map((note) => <NoteRow key={note.id} note={note.id === activeNote?.id ? activeNote : note}
      selected={note.id === activeNote?.id} locale={locale} onSelect={onSelect} onOpen={onOpen} independent={openNoteIds.includes(note.id)} search={search} highlighted={matched[highlightedIndex]?.id === note.id} />)}
    </div>
    {!matched.length && <span className="popover-muted">{t("noMatchingNotes", locale)}</span>}
    {matched.length > limit && <button onClick={() => setLimit((current) => current + 100)}>{t("showMoreNotes", locale)}</button>}
  </>;
}
