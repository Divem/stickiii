import {
  Check,
  ChevronRight,
  CirclePlus,
  File,
  FileText,
  Image as ImageIcon,
  Languages,
  Layers3,
  MoreHorizontal,
  Paperclip,
  Pin,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  X,
  Minus,
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
  if (attachment.mimeType.startsWith("image/")) return <ImageIcon size={16} />;
  if (attachment.mimeType.includes("text") || attachment.name.endsWith(".md")) return <FileText size={16} />;
  return <File size={16} />;
}

type OpenMenu = "notes" | "actions" | "sync" | "settings" | null;

export default function App() {
  const [locale, setLocale] = useState<Locale>("zh");
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState<Note | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
  const [syncProvider, setSyncProvider] = useState<SyncProviderId>("notion");
  const [toast, setToast] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void window.desktopTabs.listNotes().then((storedNotes) => {
      if (!active) return;
      const sorted = [...storedNotes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const initialNote = sorted[0] ?? createNote();
      setNotes(sorted.length ? sorted : [initialNote]);
      setDraft(initialNote);
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

  const attachmentSignature = useMemo(
    () => draft?.attachments.map((attachment) => `${attachment.id}:${attachment.name}:${attachment.size}`).join("|") ?? "",
    [draft?.attachments],
  );

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
  }, [draft?.id, draft?.title, draft?.content, attachmentSignature, loaded]);

  function updateDraft(patch: Partial<Note>): void {
    setDraft((current) => current ? { ...current, ...patch, updatedAt: new Date().toISOString(), syncState: "local" } : current);
  }

  function handleNewNote(): void {
    const note = createNote();
    setNotes((current) => [note, ...current]);
    setDraft(note);
    setOpenMenu(null);
  }

  async function handleDelete(): Promise<void> {
    if (!draft || !window.confirm(t("deleteConfirm", locale))) return;
    await window.desktopTabs.deleteNote(draft.id);
    const remaining = notes.filter((note) => note.id !== draft.id);
    setNotes(remaining);
    setDraft(remaining[0] ?? null);
    setOpenMenu(null);
    setToast(locale === "zh" ? "便签已删除" : "Note deleted");
  }

  async function handlePickFiles(): Promise<void> {
    if (!draft) return;
    const picked = await window.desktopTabs.pickFiles();
    if (picked.length) updateDraft({ attachments: [...draft.attachments, ...picked] });
    setOpenMenu(null);
  }

  async function handleOpenAttachment(attachment: NoteAttachment): Promise<void> {
    const error = await window.desktopTabs.openAttachment(attachment.storedPath);
    if (error) setToast(t("fileOpenError", locale));
  }

  async function handleSync(provider: SyncProviderId = syncProvider): Promise<void> {
    if (!draft) return;
    setSyncProvider(provider);
    setOpenMenu(null);
    const result = await window.desktopTabs.syncNote(draft, provider);
    if (result.status === "not-configured") setToast(t("syncNotConfigured", locale));
    else if (result.status === "synced") setToast(`${t("syncSuccess", locale)} ${providerLabels[provider]}`);
    else setToast(t("syncError", locale));
  }

  return (
    <main className="app-shell note-window" onClick={() => openMenu && setOpenMenu(null)}>
      <header className="window-bar">
        <div className="window-drag-area">
          <div className="brand-mark"><Sparkles size={13} strokeWidth={2.5} /></div>
          <span className="window-brand">{t("appName", locale)}</span>
          <span className="window-separator">·</span>
          <span className="window-note-name">{draft?.title || t("untitled", locale)}</span>
          <span className="pinned-badge" title={locale === "zh" ? "窗口始终置顶" : "Always on top"}><Pin size={10} />{locale === "zh" ? "置顶" : "Pinned"}</span>
        </div>
        <div className="window-tools" onClick={(event) => event.stopPropagation()}>
          <button className="window-tool" aria-label={locale === "zh" ? "切换语言" : "Switch language"} title={locale === "zh" ? "切换语言" : "Switch language"} onClick={() => setLocale(locale === "zh" ? "en" : "zh")}><Languages size={13} /></button>
          <button className="window-tool" aria-label={t("minimize", locale)} title={t("minimize", locale)} onClick={() => window.desktopTabs.minimizeWindow()}><Minus size={14} /></button>
          <button className="window-tool close" aria-label={t("close", locale)} title={t("close", locale)} onClick={() => window.desktopTabs.closeWindow()}><X size={14} /></button>
        </div>
      </header>

      <section className="note-surface" onClick={(event) => event.stopPropagation()}>
        <div className="note-topline">
          <div className="note-kicker"><span className="kicker-dot" />{locale === "zh" ? "快速记录" : "QUICK NOTE"}<span className={`save-state ${saveState}`}>{saveState === "saved" ? <Check size={11} /> : null}{saveState === "saved" ? t("localSaved", locale) : t("saving", locale)}</span></div>
          <div className="note-actions">
            <button className="note-action" aria-label={locale === "zh" ? "切换便签" : "Switch note"} title={locale === "zh" ? "切换便签" : "Switch note"} onClick={() => setOpenMenu(openMenu === "notes" ? null : "notes")}><Layers3 size={15} /></button>
            <button className="note-action" aria-label={locale === "zh" ? "更多操作" : "More actions"} title={locale === "zh" ? "更多操作" : "More actions"} onClick={() => setOpenMenu(openMenu === "actions" ? null : "actions")}><MoreHorizontal size={16} /></button>
          </div>
        </div>

        <div className="note-editor">
          {draft ? <>
            <input className="note-title" value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} placeholder={t("untitled", locale)} />
            <div className="note-date">{formatTime(draft.updatedAt, locale)}</div>
            <textarea className="note-content" value={draft.content} onChange={(event) => updateDraft({ content: event.target.value })} placeholder={t("notePlaceholder", locale)} />
            {draft.attachments.length > 0 && <div className="attachment-strip">{draft.attachments.map((attachment) => (
              <button className="attachment-card" key={attachment.id} onClick={() => void handleOpenAttachment(attachment)} title={attachment.name}>
                {attachment.previewDataUrl ? <img src={attachment.previewDataUrl} alt={attachment.name} /> : <span className="attachment-icon">{attachmentIcon(attachment)}</span>}
                <span className="attachment-info"><strong>{attachment.name}</strong><small>{formatSize(attachment.size)}</small></span><ChevronRight size={13} className="attachment-open" />
              </button>
            ))}</div>}
          </> : <div className="empty-note"><Sparkles size={21} /><span>{t("emptyTitle", locale)}</span><button className="inline-new-button" onClick={handleNewNote}>{t("startWriting", locale)}</button></div>}
        </div>

        <div className="hover-toolbar" onClick={(event) => event.stopPropagation()}>
          <button className="hover-tool" aria-label={t("addAttachment", locale)} title={t("addAttachment", locale)} onClick={() => void handlePickFiles()}><Paperclip size={15} /></button>
          <button className="hover-tool" aria-label={t("sync", locale)} title={t("sync", locale)} onClick={() => setOpenMenu(openMenu === "sync" ? null : "sync")}><Send size={15} /></button>
          <button className="hover-tool" aria-label={locale === "zh" ? "设置" : "Settings"} title={locale === "zh" ? "设置" : "Settings"} onClick={() => setOpenMenu(openMenu === "settings" ? null : "settings")}><Settings2 size={15} /></button>
        </div>

        {openMenu === "notes" && <div className="popover notes-popover"><div className="popover-title">{locale === "zh" ? "我的便签" : "My notes"}</div>{notes.length ? notes.map((note) => <button key={note.id} className={`popover-note ${note.id === draft?.id ? "selected" : ""}`} onClick={() => { setDraft(note); setOpenMenu(null); }}><span>{note.title || t("untitled", locale)}</span><small>{formatTime(note.updatedAt, locale)}</small></button>) : <span className="popover-muted">{t("emptyTitle", locale)}</span>}</div>}
        {openMenu === "actions" && <div className="popover actions-popover"><button onClick={handleNewNote}><CirclePlus size={14} />{t("newNote", locale)}</button><button onClick={() => void handleDelete()}><Trash2 size={14} />{t("deleteNote", locale)}</button></div>}
        {openMenu === "sync" && <div className="popover sync-popover"><div className="popover-title">{locale === "zh" ? "同步到" : "Sync to"}</div><button onClick={() => void handleSync("notion")}><span className="provider-glyph notion-glyph">N</span><span>{t("notion", locale)}</span><ChevronRight size={13} /></button><button onClick={() => void handleSync("feishu")}><span className="provider-glyph feishu-glyph">飞</span><span>{t("feishu", locale)}</span><ChevronRight size={13} /></button></div>}
        {openMenu === "settings" && <div className="popover settings-popover"><div className="popover-title">{locale === "zh" ? "设置同步渠道" : "Sync settings"}</div><button onClick={() => void handleSync("notion")}><span className="provider-glyph notion-glyph">N</span>{t("notion", locale)}<small>{locale === "zh" ? "点击连接或同步" : "Connect or sync"}</small></button><button onClick={() => void handleSync("feishu")}><span className="provider-glyph feishu-glyph">飞</span>{t("feishu", locale)}<small>{locale === "zh" ? "点击连接或同步" : "Connect or sync"}</small></button></div>}
      </section>
      {toast && <div className="toast"><Check size={14} />{toast}</div>}
    </main>
  );
}
