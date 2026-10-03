import { Plus, Search, PanelTop } from "lucide-react";
import { memo, useDeferredValue, useMemo, useState } from "react";
import type { Note } from "../shared/types.js";
import { getNoteTitle } from "../shared/notes.js";
import { t, type Locale } from "./i18n.js";

const NoteRow = memo(function NoteRow({ note, selected, locale, onSelect, onOpen, independent }: {
  note: Note; selected: boolean; locale: Locale; onSelect: (note: Note) => void; onOpen: (id: string) => void; independent: boolean;
}) {
  const firstLine = note.content.split(/\r\n|\n|\r/, 1)[0];
  const title = useMemo(() => getNoteTitle(firstLine), [firstLine]);
  const time = useMemo(() => new Date(note.updatedAt).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", {
    month: "short", day: "numeric",
  }), [note.updatedAt, locale]);
  return <div className="note-list-row"><button className={`popover-note ${selected ? "selected" : ""}`} aria-current={selected ? "true" : undefined}
    title={title || t("untitled", locale)} onClick={() => onSelect(note)}>
    <span>{title || t("untitled", locale)}{independent && <span className="independent-marker" title={t("independentNote", locale)}> · ↗</span>}</span><small>{time}</small>
  </button><button className="note-list-open" aria-label={`${t(independent ? "focusNoteWindow" : "openNoteWindow", locale)} · ${title || t("untitled", locale)}`}
    title={t(independent ? "focusNoteWindow" : "openNoteWindow", locale)} onClick={() => onOpen(note.id)}><PanelTop size={13} /></button></div>;
});

export default function NoteList({ notes, activeNote, locale, onSelect, onNew, onOpen, openNoteIds }: {
  notes: Note[]; activeNote: Note | null; locale: Locale; onSelect: (note: Note) => void; onNew: () => void;
  onOpen: (id: string) => void; openNoteIds: string[];
}) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(100);
  const search = useDeferredValue(query.trim().toLocaleLowerCase());
  const matched = useMemo(() => search ? notes.filter((note) =>
    (note.id === activeNote?.id ? activeNote.content : note.content).toLocaleLowerCase().includes(search)) : notes,
  [notes, activeNote, search]);
  return <>
    <div className="popover-title notes-header"><span>{t("viewNotes", locale)}</span>
      <button className="notes-new-button" aria-label={t("newNote", locale)} title={t("newNote", locale)} onClick={onNew}><Plus size={15} /></button>
    </div>
    <label className="notes-search"><Search size={13} /><input autoFocus value={query}
      aria-label={t("searchPlaceholder", locale)} placeholder={t("searchPlaceholder", locale)}
      onChange={(event) => { setQuery(event.target.value); setLimit(100); }} /></label>
    {matched.slice(0, limit).map((note) => <NoteRow key={note.id} note={note.id === activeNote?.id ? activeNote : note}
      selected={note.id === activeNote?.id} locale={locale} onSelect={onSelect} onOpen={onOpen} independent={openNoteIds.includes(note.id)} />)}
    {!matched.length && <span className="popover-muted">{t("noMatchingNotes", locale)}</span>}
    {matched.length > limit && <button onClick={() => setLimit((current) => current + 100)}>{t("showMoreNotes", locale)}</button>}
  </>;
}
