import { ChevronDown, Plus, Search, PanelTop } from "lucide-react";
import { memo, useCallback, useDeferredValue, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Note } from "../shared/types.js";
import { getNoteTitle } from "../shared/notes.js";
import { t, type Locale } from "./i18n.js";
import { createNoteMatcher, noteSearchSnippet } from "./noteSearch.js";
import { noteListRange, noteListScroll } from "./noteListViewport.js";

const NoteRow = memo(function NoteRow({ note, selected, locale, onSelect, onOpen, independent, search, highlighted }: {
  note: Note; selected: boolean; locale: Locale; onSelect: (note: Note, query: string) => void; onOpen: (id: string) => void; independent: boolean;
  search: string; highlighted: boolean;
}) {
  const firstLine = note.content.split(/\r\n|\n|\r/, 1)[0];
  const title = useMemo(() => getNoteTitle(firstLine), [firstLine]);
  const snippet = useMemo(() => noteSearchSnippet(note.content, search)
    ?? note.attachments.map((file) => noteSearchSnippet(file.name, search)).find((item) => item !== null) ?? null, [note.content, note.attachments, search]);
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
    title={title || t("untitled", locale)} onPointerUp={(event) => runOnPointerUp(event, () => onSelect(note, search), selectPointerUp)} onPointerCancel={() => { selectPointerUp.current = false; }} onClick={(event) => runOnClick(event, () => onSelect(note, search), selectPointerUp)}>
    <span className="note-result-content"><span className="note-result-title">{note.favorite && "★ "}{title || t("untitled", locale)}{note.archived && <small> · {t("archivedNote", locale)}</small>}{independent && <span className="independent-marker" title={t("independentNote", locale)}> · ↗</span>}</span>
      {snippet && <span className="note-result-snippet">{snippet.before}<mark>{snippet.match}</mark>{snippet.after}</span>}</span><small>{time}</small>
  </button><button className="note-list-open" aria-label={`${t(independent ? "focusNoteWindow" : "openNoteWindow", locale)} · ${title || t("untitled", locale)}`}
    title={t(independent ? "focusNoteWindow" : "openNoteWindow", locale)} onPointerUp={(event) => runOnPointerUp(event, () => onOpen(note.id), openPointerUp)} onPointerCancel={() => { openPointerUp.current = false; }} onClick={(event) => runOnClick(event, () => onOpen(note.id), openPointerUp)}><PanelTop size={13} /></button></div>;
});

export default function NoteList({ notes, activeNote, locale, newNoteTip, onSelect, onNew, onOpen, openNoteIds, onClose }: {
  notes: Note[]; activeNote: Note | null; locale: Locale; onSelect: (note: Note, query: string) => void; onNew: () => void;
  onOpen: (id: string) => void; openNoteIds: string[];
  newNoteTip?: string;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"notes" | "favorites" | "archived">("notes");
  const [viewport, setViewport] = useState({ top: 0, height: 200 });
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const search = useDeferredValue(query.trim().toLocaleLowerCase());
  const matched = useMemo(() => notes.map((note) => note.id === activeNote?.id ? activeNote : note)
    .filter((note) => scope === "archived" ? !!note.archived : scope === "favorites" ? !!note.favorite && !note.archived : search ? true : !note.archived)
    .filter(createNoteMatcher(search)).sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite)),
  [notes, activeNote, search, scope]);
  const highlightedIndex = Math.max(0, matched.findIndex((note) => note.id === (highlightedId ?? (search ? matched[0]?.id : activeNote?.id))));
  const rowHeight = search ? 54 : 36;
  const range = noteListRange(matched.length, viewport.top, viewport.height, rowHeight);
  const callbacks = useRef({ onSelect, onOpen });
  callbacks.current = { onSelect, onOpen };
  const selectRow = useCallback((note: Note, query: string) => callbacks.current.onSelect(note, query), []);
  const openRow = useCallback((id: string) => callbacks.current.onOpen(id), []);
  useLayoutEffect(() => {
    const element = resultsRef.current!;
    const update = () => setViewport({ top: element.scrollTop, height: element.clientHeight });
    const observer = new ResizeObserver(update);
    observer.observe(element); update();
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = resultsRef.current!;
    element.scrollTop = noteListScroll(element.scrollTop, element.clientHeight, highlightedIndex, rowHeight);
    setViewport({ top: element.scrollTop, height: element.clientHeight });
  }, [highlightedIndex, search, scope, rowHeight]);
  return <>
    <div className="popover-title notes-header"><label className="note-scope-picker">
      <select value={scope} aria-label={t("noteScope", locale)} onChange={(event) => { setScope(event.target.value as typeof scope); setHighlightedId(null); }}>
        <option value="notes">{t("viewNotes", locale)}</option>
        <option value="favorites">{t("favoriteNotes", locale)}</option>
        <option value="archived">{t("archivedNotes", locale)}</option>
      </select><ChevronDown size={11} aria-hidden="true" />
    </label>
      <button className="notes-new-button" aria-label={t("newNote", locale)} title={newNoteTip ?? t("newNote", locale)} onClick={onNew}><Plus size={15} /></button>
    </div>
    <label className="notes-search"><Search size={13} /><input autoFocus value={query} aria-describedby="notes-keyboard-hint"
      aria-label={t("searchPlaceholder", locale)} placeholder={t("searchPlaceholder", locale)}
      onChange={(event) => { setQuery(event.target.value); setHighlightedId(null); }} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
        else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && matched.length) {
          event.preventDefault();
          const index = (highlightedIndex + (event.key === "ArrowDown" ? 1 : -1) + matched.length) % matched.length;
          setHighlightedId(matched[index].id);
        } else if (event.key === "Enter" && matched[highlightedIndex]) { event.preventDefault(); onSelect(matched[highlightedIndex], query.trim()); }
      }} /></label>
    <span id="notes-keyboard-hint" className="notes-keyboard-hint">{t("searchKeyboardHint", locale)}</span>
    <div ref={resultsRef} className="note-search-results" style={{ height: Math.min(280, matched.length * rowHeight) }}
      onScroll={(event) => setViewport({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })}>
    <div role="list" style={{ height: matched.length * rowHeight, position: "relative" }}>
    {matched.slice(range.start, range.end).map((note, offset) => <div key={note.id} role="listitem" aria-posinset={range.start + offset + 1} aria-setsize={matched.length}
      className="note-list-item" style={{ position: "absolute", top: (range.start + offset) * rowHeight, height: rowHeight, left: 0, right: 0 }}>
      <NoteRow note={note} selected={note.id === activeNote?.id} locale={locale} onSelect={selectRow} onOpen={openRow} independent={openNoteIds.includes(note.id)} search={search} highlighted={matched[highlightedIndex]?.id === note.id} /></div>)}
    </div>
    </div>
    {!matched.length && <span className="popover-muted">{t("noMatchingNotes", locale)}</span>}
  </>;
}
