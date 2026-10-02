import {
  Archive,
  ArrowUpRight,
  AtSign,
  Check,
  ChevronDown,
  CirclePlus,
  File,
  FileText,
  Image as ImageIcon,
  Languages,
  Link2,
  Menu,
  Minus,
  MoreHorizontal,
  Paperclip,
  PanelLeftClose,
  Search,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Note, NoteAttachment, SyncProviderId } from "../shared/types.js";
import { t, type Locale } from "./i18n.js";

const providerLabels: Record<SyncProviderId, string> = { notion: "Notion", feishu: "飞书" };

function createNote(): Note {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: t("untitled", "zh"),
    content: "",
    attachments: [],
    createdAt: now,
    updatedAt: now,
    syncState: "local",
  };
}

function formatTime(value: string, locale: Locale): string {
  const date = new Date(value);
  const today = new Date();
  const time = date.toLocaleTimeString(locale === "zh" ? "zh-CN" : "en-US", { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === today.toDateString()) return locale === "zh" ? `今天 ${time}` : `Today ${time}`;
  return date.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric" });
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function attachmentIcon(attachment: NoteAttachment) {
  if (attachment.mimeType.startsWith("image/")) return <ImageIcon size={17} />;
  if (attachment.mimeType.includes("text") || attachment.name.endsWith(".md")) return <FileText size={17} />;
  return <File size={17} />;
}

export default function App() {
  const [locale, setLocale] = useState<Locale>("zh");
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState<Note | null>(null);
  const [query, setQuery] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
  const [syncProvider, setSyncProvider] = useState<SyncProviderId>("notion");
  const [toast, setToast] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void window.desktopTabs.listNotes().then((storedNotes) => {
      if (!active) return;
      const sorted = [...storedNotes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      setNotes(sorted);
      setDraft(sorted[0] ?? null);
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!loaded || !draft) return;
    setSaveState("saving");
    const timeout = window.setTimeout(() => {
      void window.desktopTabs.saveNote(draft).then((savedNote) => {
        setNotes((current) => [savedNote, ...current.filter((note) => note.id !== savedNote.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
        setDraft((current) => current?.id === savedNote.id ? savedNote : current);
        setSaveState("saved");
      });
    }, 520);
    return () => window.clearTimeout(timeout);
  }, [draft?.id, draft?.title, draft?.content, draft?.attachments, loaded]);

  const filteredNotes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return notes;
    return notes.filter((note) => `${note.title} ${note.content}`.toLowerCase().includes(normalizedQuery));
  }, [notes, query]);

  function updateDraft(patch: Partial<Note>): void {
    setDraft((current) => current ? { ...current, ...patch, updatedAt: new Date().toISOString(), syncState: "local" } : current);
  }

  function handleNewNote(): void {
    const note = createNote();
    setNotes((current) => [note, ...current]);
    setDraft(note);
    setQuery("");
  }

  async function handleDelete(): Promise<void> {
    if (!draft || !window.confirm(t("deleteConfirm", locale))) return;
    await window.desktopTabs.deleteNote(draft.id);
    const remaining = notes.filter((note) => note.id !== draft.id);
    setNotes(remaining);
    setDraft(remaining[0] ?? null);
    setToast(locale === "zh" ? "记录已删除" : "Note deleted");
  }

  async function handlePickFiles(): Promise<void> {
    if (!draft) return;
    const picked = await window.desktopTabs.pickFiles();
    if (picked.length) updateDraft({ attachments: [...draft.attachments, ...picked] });
  }

  async function handleOpenAttachment(attachment: NoteAttachment): Promise<void> {
    const error = await window.desktopTabs.openAttachment(attachment.storedPath);
    if (error) setToast(t("fileOpenError", locale));
  }

  async function handleSync(): Promise<void> {
    if (!draft) return;
    const result = await window.desktopTabs.syncNote(draft, syncProvider);
    if (result.status === "not-configured") setToast(t("syncNotConfigured", locale));
    else if (result.status === "synced") setToast(`${t("syncSuccess", locale)} ${providerLabels[syncProvider]}`);
    else setToast(t("syncError", locale));
  }

  return (
    <main className="app-shell">
      <header className="window-bar">
        <div className="brand-lockup">
          <div className="brand-mark"><Sparkles size={14} strokeWidth={2.5} /></div>
          <span className="brand-name">Desk Tabs</span>
          <span className="brand-slash">/</span>
          <span className="brand-subtitle">{t("productTagline", locale)}</span>
        </div>
        <div className="window-drag-space" />
        <div className="window-tools">
          <button className="icon-button subtle" aria-label="switch language" onClick={() => setLocale(locale === "zh" ? "en" : "zh")}><Languages size={15} /><span>{locale === "zh" ? "中" : "EN"}</span></button>
          <button className="icon-button subtle" aria-label={t("minimize", locale)} onClick={() => window.desktopTabs.minimizeWindow()}><Minus size={16} /></button>
          <button className="icon-button subtle close" aria-label={t("close", locale)} onClick={() => window.desktopTabs.closeWindow()}><X size={16} /></button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-heading">
            <div><span className="eyebrow">YOUR SPACE</span><h1>{t("allNotes", locale)}</h1></div>
            <button className="new-note-button" onClick={handleNewNote} aria-label={t("newNote", locale)}><CirclePlus size={18} /></button>
          </div>
          <div className="search-box"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchPlaceholder", locale)} /></div>
          <div className="sidebar-list">
            {filteredNotes.length ? filteredNotes.map((note) => (
              <button key={note.id} className={`note-list-item ${note.id === draft?.id ? "active" : ""}`} onClick={() => setDraft(note)}>
                <span className="note-list-title">{note.title || t("untitled", locale)}</span>
                <span className="note-list-preview">{note.content || (note.attachments.length ? `${note.attachments.length} ${t("attachmentCount", locale)}` : t("notePlaceholder", locale))}</span>
                <span className="note-list-time">{formatTime(note.updatedAt, locale)}</span>
              </button>
            )) : <div className="sidebar-empty"><Archive size={19} /><span>{query ? t("noResults", locale) : t("emptyTitle", locale)}</span></div>}
          </div>
          <div className="sidebar-footer">
            <div className="sync-caption"><span>{t("integrations", locale)}</span><span className="connection-dot" /></div>
            <div className="provider-row">
              <button className={`provider-chip ${syncProvider === "notion" ? "selected" : ""}`} onClick={() => setSyncProvider("notion")}><span className="notion-glyph">N</span>{t("notion", locale)}</button>
              <button className={`provider-chip ${syncProvider === "feishu" ? "selected" : ""}`} onClick={() => setSyncProvider("feishu")}><span className="feishu-glyph">飞</span>{t("feishu", locale)}</button>
            </div>
            <button className="settings-link"><Settings2 size={15} />{t("comingSoon", locale)}</button>
          </div>
        </aside>

        <section className="editor-area">
          {draft ? <>
            <div className="editor-toolbar">
              <div className="breadcrumb"><span>{t("allNotes", locale)}</span><span className="breadcrumb-divider">/</span><span className="current-crumb">{draft.title || t("untitled", locale)}</span></div>
              <div className="editor-actions">
                <span className={`save-state ${saveState}`}><span className="save-dot" />{saveState === "saved" ? t("localSaved", locale) : t("saving", locale)}</span>
                <button className="toolbar-button" onClick={handleDelete} aria-label={t("deleteNote", locale)}><Trash2 size={15} /></button>
                <button className="toolbar-button" aria-label="more actions"><MoreHorizontal size={17} /></button>
              </div>
            </div>
            <div className="editor-scroll">
              <div className="editor-content">
                <div className="date-kicker"><span className="date-line" />{formatTime(draft.updatedAt, locale)}<span className="date-line" /></div>
                <input className="title-input" value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} placeholder={t("untitled", locale)} />
                <div className="editor-meta"><span><AtSign size={13} /> quick capture</span><span><Link2 size={13} /> local notebook</span></div>
                <textarea className="content-input" value={draft.content} onChange={(event) => updateDraft({ content: event.target.value })} placeholder={t("notePlaceholder", locale)} />

                {draft.attachments.length > 0 && <div className="attachments-section"><div className="section-label"><Paperclip size={14} />{t("attachmentCount", locale)} {draft.attachments.length}</div><div className="attachment-grid">{draft.attachments.map((attachment) => (
                  <button className="attachment-card" key={attachment.id} onClick={() => handleOpenAttachment(attachment)}>
                    {attachment.previewDataUrl ? <img src={attachment.previewDataUrl} alt={attachment.name} /> : <span className="attachment-icon">{attachmentIcon(attachment)}</span>}
                    <span className="attachment-info"><strong>{attachment.name}</strong><small>{formatSize(attachment.size)}</small></span><ArrowUpRight size={14} className="attachment-open" />
                  </button>
                ))}</div></div>}

                <button className="dropzone" onClick={() => void handlePickFiles()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void handlePickFiles(); }}>
                  <span className="dropzone-icon"><Paperclip size={17} /></span><span><strong>{t("addAttachment", locale)}</strong><small>{locale === "zh" ? "拖入这里，随手记会帮你收好" : "Drop anything here and keep it close"}</small></span><ChevronDown size={15} className="dropzone-arrow" />
                </button>
              </div>
            </div>
            <div className="editor-footer">
              <div className="footer-hint"><PanelLeftClose size={14} />{locale === "zh" ? "随时按 ⌘⇧Space 回到这里" : "Press ⌘⇧Space to come back anytime"}</div>
              <button className="sync-button" onClick={() => void handleSync()}><Send size={14} />{t("sync", locale)}<span className="sync-provider-label">{providerLabels[syncProvider]}</span></button>
            </div>
          </> : <div className="empty-editor"><div className="empty-orbit"><span className="orbit-dot dot-one" /><span className="orbit-dot dot-two" /><Sparkles size={28} /></div><h2>{t("emptyTitle", locale)}</h2><p>{t("emptyDescription", locale)}</p><button className="primary-button" onClick={handleNewNote}><CirclePlus size={17} />{t("startWriting", locale)}</button><div className="shortcut-hint"><Menu size={14} /> {locale === "zh" ? "全局快捷键" : "Global shortcut"} <kbd>⌘⇧Space</kbd></div></div>}
        </section>
      </div>
      {toast && <div className="toast"><Check size={15} />{toast}</div>}
    </main>
  );
}
