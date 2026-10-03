import {
  Check,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  BookOpen,
  Expand,
  Languages,
  Layers3,
  MoreHorizontal,
  Paperclip,
  Pin,
  Settings2,
  Sparkles,
  Trash2,
  X,
  Minus,
  Info,
  LogOut,
  ExternalLink,
  Eye,
  LoaderCircle,
  Plus,
  Star,
  PanelTop,
  CornerUpLeft,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { DEFAULT_SHORTCUTS, type AiConfig, type AiOperation, type FeishuSyncMode, type Note, type NoteAttachment, type NoteThemeId, type ShortcutActionId, type ShortcutConfig, type SyncProviderConfig, type SyncProviderId } from "../shared/types.js";
import { parseFeishuTarget } from "../shared/feishuTarget.js";
import { DEFAULT_THEME_OPACITY, MIN_THEME_OPACITY, getNoteTitle, isNoteThemeId, normalizeThemeOpacity } from "../shared/notes.js";
import { aiErrorMessages, syncErrorMessages, t, type Locale, type MessageKey } from "./i18n.js";
import AiSettings from "./AiSettings.js";
import { applyPolish, undoPolish, type PolishChange } from "./notePolish.js";
import NoteEditor from "./NoteEditor.js";
import NoteList from "./NoteList.js";
import NoteBook, { type PageTurn, type PageTurnDirection } from "./NoteBook.js";
import { hasNoteContent, NoteSaveQueue } from "./noteSaveQueue.js";
import { readyWindow, startDragging } from "./desktop.js";
import { randomUUID } from "../shared/id.js";
import type { NoteWindowContext } from "../shared/types.js";

const providerLabels: Record<SyncProviderId, string> = { notion: "Notion", feishu: "飞书" };
const shortcutLabelKeys: Record<ShortcutActionId, MessageKey> = {
  toggleWindow: "shortcutToggleWindow",
  newNote: "shortcutNewNote",
  previousNote: "shortcutPreviousNote",
  nextNote: "shortcutNextNote",
};

function createNote(): Note {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    content: "",
    attachments: [],
    createdAt: now,
    updatedAt: now,
    syncState: "local",
    theme: "paper",
  };
}

const PREFERENCES_KEY = "desk-tabs.preferences";
type AppPreferences = { locale: Locale; themeOpacity: number };

function readPreferences(): AppPreferences {
  const fallback: AppPreferences = { locale: "zh", themeOpacity: DEFAULT_THEME_OPACITY };
  try {
    const value = JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) ?? "null") as Partial<AppPreferences> | null;
    return {
      locale: value?.locale === "en" ? "en" : "zh",
      themeOpacity: normalizeThemeOpacity(value?.themeOpacity) ?? fallback.themeOpacity,
    };
  } catch {
    return fallback;
  }
}

function writePreferences(preferences: AppPreferences): void {
  try { window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)); } catch { /* Preferences are best effort. */ }
}

function formatTime(value: string, locale: Locale): string {
  const date = new Date(value);
  const today = new Date();
  const time = date.toLocaleTimeString(locale === "zh" ? "zh-CN" : "en-US", { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === today.toDateString()) return locale === "zh" ? `今天 ${time}` : `Today ${time}`;
  return date.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric" });
}

type OpenMenu = "notes" | "actions" | "settings" | null;
const aiOperations: AiOperation[] = ["polish", "translate", "expand", "explain"];
const aiOperationMeta: Record<AiOperation, { labelKey: MessageKey; processingKey: MessageKey; successKey: MessageKey; unchangedKey: MessageKey }> = {
  polish: { labelKey: "aiPolish", processingKey: "aiPolishing", successKey: "aiPolishSuccess", unchangedKey: "aiPolishUnchanged" },
  translate: { labelKey: "aiTranslate", processingKey: "aiTranslating", successKey: "aiTranslateSuccess", unchangedKey: "aiTranslateUnchanged" },
  expand: { labelKey: "aiExpand", processingKey: "aiExpanding", successKey: "aiExpandSuccess", unchangedKey: "aiExpandUnchanged" },
  explain: { labelKey: "aiExplain", processingKey: "aiExplaining", successKey: "aiExplainSuccess", unchangedKey: "aiExplainUnchanged" },
};

function aiOperationIcon(operation: AiOperation, size = 14) {
  if (operation === "translate") return <Languages size={size} />;
  if (operation === "expand") return <Expand size={size} />;
  if (operation === "explain") return <BookOpen size={size} />;
  return <Sparkles size={size} />;
}

const themeOptions: Array<{ id: NoteThemeId; labelKey: MessageKey; swatch: string }> = [
  { id: "paper", labelKey: "themePaper", swatch: "#ffffff" },
  { id: "mist", labelKey: "themeMist", swatch: "#dfe2e3" },
  { id: "sage", labelKey: "themeSage", swatch: "#c7d99a" },
  { id: "sky", labelKey: "themeSky", swatch: "#b9d9ef" },
  { id: "peach", labelKey: "themePeach", swatch: "#f2c09b" },
  { id: "lavender", labelKey: "themeLavender", swatch: "#d1b9e9" },
  { id: "ink", labelKey: "themeInk", swatch: "#343a3e" },
];

export default function App({ context }: { context: NoteWindowContext }) {
  const isSingleNote = context.noteId !== null;
  const [openNoteIds, setOpenNoteIds] = useState(context.openNoteIds);
  const openNoteIdsRef = useRef(context.openNoteIds);
  const [transferring, setTransferring] = useState(false);
  const transferLock = useRef(false);
  const closeLock = useRef(false);
  const activeExitRequest = useRef<string | null>(null);
  const [preferences, setPreferences] = useState<AppPreferences>(() => readPreferences());
  const { locale, themeOpacity } = preferences;
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState<Note | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [toast, setToast] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [pageTurn, setPageTurn] = useState<PageTurn | null>(null);
  const pageTurnSequence = useRef(0);
  const finishPageTurn = useCallback((sequence: number) => {
    setPageTurn((current) => current?.sequence === sequence ? null : current);
  }, []);
  const [pickingFiles, setPickingFiles] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [failedSaves, setFailedSaves] = useState<Set<string>>(() => new Set());
  const [syncConfigs, setSyncConfigs] = useState<Partial<Record<SyncProviderId, SyncProviderConfig>>>({});
  const [editingProvider, setEditingProvider] = useState<SyncProviderId | null>(null);
  const [aiConfig, setAiConfig] = useState<AiConfig | null>(null);
  const [editingAi, setEditingAi] = useState(false);
  const [polishingId, setPolishingId] = useState<string | null>(null);
  const [runningAiOperation, setRunningAiOperation] = useState<AiOperation | null>(null);
  const [polishChanges, setPolishChanges] = useState<Record<string, PolishChange>>({});
  const [polishChangeOperations, setPolishChangeOperations] = useState<Record<string, AiOperation>>({});
  const [polishFeedback, setPolishFeedback] = useState<{ noteId: string; key: MessageKey; operation: AiOperation; error?: boolean } | null>(null);
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const polishLock = useRef(false);
  const polishIdle = useRef<Promise<void>>(Promise.resolve());
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [collaboratorEmail, setCollaboratorEmail] = useState("");
  const [feishuMode, setFeishuMode] = useState<FeishuSyncMode>("create");
  const [targetDocumentUrl, setTargetDocumentUrl] = useState("");
  const [editorMode, setEditorMode] = useState<"edit" | "preview">("edit");
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncingProvider, setSyncingProvider] = useState<SyncProviderId | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<{ noteId: string; message: string; url?: string; error?: boolean } | null>(null);
  const draftRef = useRef(draft);
  const noteEditorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const autosaveTimer = useRef<number | null>(null);
  const syncLock = useRef(false);
  const navigationLock = useRef(false);
  const pickingLock = useRef(false);
  const exitLock = useRef(false);
  const syncIdle = useRef<Promise<void>>(Promise.resolve());
  const importIdle = useRef<Promise<void>>(Promise.resolve());
  const editorViews = useRef(new Map<string, { start: number; end: number; scroll: number; previewScroll: number; mode: "edit" | "preview" }>());
  const saveQueueRef = useRef<NoteSaveQueue | null>(null);
  if (!saveQueueRef.current) {
    saveQueueRef.current = new NoteSaveQueue((note) => window.desktopTabs.saveNote(note), (saved) => {
      const current = saveQueueRef.current!.read(saved.id)!;
      if (!saveQueueRef.current!.isDirty(saved.id)) setFailedSaves((items) => {
        if (!items.has(saved.id)) return items;
        const next = new Set(items); next.delete(saved.id); return next;
      });
      setNotes((items) => items.some((item) => item.id === saved.id)
        ? items.map((item) => item.id === saved.id ? current : item) : [current, ...items]);
      if (draftRef.current?.id === saved.id) {
        replaceDraft(current);
        setSaveState(saveQueueRef.current!.isDirty(saved.id) ? "saving" : "saved");
      }
    });
  }
  const saveQueue = saveQueueRef.current;
  const [isPinned, setIsPinned] = useState(context.pinned);
  const [isWindowFocused, setIsWindowFocused] = useState(() => document.hasFocus());
  const [shortcutConfigs, setShortcutConfigs] = useState<ShortcutConfig[]>([]);
  const [recordingShortcut, setRecordingShortcut] = useState<ShortcutActionId | null>(null);

  function closeMenus(): void {
    setOpenMenu(null);
    setAiMenuOpen(false);
    setEditingProvider(null);
    setEditingAi(false);
    setRecordingShortcut(null);
  }

  function toggleMenu(menu: Exclude<OpenMenu, null>): void {
    if (openMenu === menu) {
      closeMenus();
      return;
    }
    setOpenMenu(menu);
    setAiMenuOpen(false);
    setEditingProvider(null);
    setEditingAi(false);
    setRecordingShortcut(null);
  }

  function handlePopoverBlur(event: ReactFocusEvent<HTMLDivElement>): void {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    closeMenus();
  }

  function handleAiMenuBlur(event: ReactFocusEvent<HTMLDivElement>): void {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setAiMenuOpen(false);
  }

  useEffect(() => {
    const handleFocus = (): void => setIsWindowFocused(true);
    const handleBlur = (): void => setIsWindowFocused(false);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  useEffect(() => {
    // Keep settings drafts open when switching apps to copy links or credentials.
    const handleWindowBlur = (): void => {
      if (openMenu !== "settings") closeMenus();
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeMenus();
    };
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenu]);

  const loadGeneration = useRef(0);
  async function loadNotes(): Promise<void> {
    const generation = ++loadGeneration.current;
    setLoadError(false);
    try {
      const storedNotes = await window.desktopTabs.listNotes();
      if (generation !== loadGeneration.current) return;
      const sorted = [...storedNotes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const initialNote = (isSingleNote ? sorted.find((note) => note.id === context.noteId) : sorted[0]) ?? (isSingleNote ? null : createNote());
      if (!initialNote) throw new Error("NOTE_MISSING");
      // Carry the previous per-note setting forward once, then keep opacity global.
      if (!window.localStorage.getItem(PREFERENCES_KEY)) {
        const legacyOpacity = normalizeThemeOpacity(initialNote.themeOpacity);
        if (legacyOpacity !== undefined) updatePreferences({ themeOpacity: legacyOpacity });
      }
      saveQueue.seed(sorted);
      saveQueue.track(initialNote);
      setNotes(sorted.length ? sorted : [initialNote]);
      replaceDraft(initialNote);
      setLoaded(true);
    } catch {
      if (generation === loadGeneration.current) setLoadError(true);
    }
  }

  useEffect(() => {
    void loadNotes();
    return () => { loadGeneration.current++; };
  }, []);

  useEffect(() => { if (loaded || loadError) void readyWindow().catch(() => setToast(t("windowActionFailed", locale))); }, [loaded, loadError]);

  useEffect(() => {
    if (isSingleNote) return;
    void window.desktopTabs.listShortcuts().then(setShortcutConfigs).catch(() => setToast(t("shortcutInvalid", locale)));
  }, []);

  useEffect(() => {
    void window.desktopTabs.listSyncConfigs().then((configs) => {
      setSyncConfigs(Object.fromEntries(configs.map((config) => [config.provider, config])) as Partial<Record<SyncProviderId, SyncProviderConfig>>);
    }).catch(() => setToast(t("secureStorageUnavailable", locale)));
  }, []);

  useEffect(() => {
    void window.desktopTabs.getAiConfig().then(setAiConfig).catch(() => setToast(t("aiSecureUnavailable", locale)));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!polishFeedback || polishFeedback.error || polishFeedback.key !== aiOperationMeta[polishFeedback.operation].successKey) return;
    const timeout = window.setTimeout(() => {
      setPolishFeedback((current) => current === polishFeedback ? null : current);
    }, 5000);
    return () => window.clearTimeout(timeout);
  }, [polishFeedback]);

  const activeTheme: NoteThemeId = draft && isNoteThemeId(draft.theme) ? draft.theme : "paper";
  const activeThemeOpacity = normalizeThemeOpacity(themeOpacity) ?? DEFAULT_THEME_OPACITY;

  function updatePreferences(patch: Partial<AppPreferences>): void {
    setPreferences((current) => {
      const next = {
        ...current,
        ...patch,
        themeOpacity: normalizeThemeOpacity(patch.themeOpacity ?? current.themeOpacity) ?? DEFAULT_THEME_OPACITY,
      };
      writePreferences(next);
      return next;
    });
  }

  function setLocale(nextLocale: Locale): void {
    updatePreferences({ locale: nextLocale });
  }

  useEffect(() => {
    document.documentElement.dataset.theme = activeTheme;
    document.documentElement.style.setProperty("--theme-opacity", String(activeThemeOpacity));
  }, [activeTheme, activeThemeOpacity]);

  const attachmentSignature = useMemo(
    () => draft?.attachments.map((attachment) => `${attachment.id}:${attachment.name}:${attachment.size}`).join("|") ?? "",
    [draft?.attachments],
  );

  useEffect(() => {
    if (!loaded || !draft) return;
    if (!saveQueue.isDirty(draft.id)) { setSaveState("saved"); return; }
    setSaveState("saving");
    const noteId = draft.id;
    const timeout = window.setTimeout(() => {
      autosaveTimer.current = null;
      void saveNoteId(noteId, false);
    }, 520);
    autosaveTimer.current = timeout;
    return () => window.clearTimeout(timeout);
  }, [draft?.id, draft?.content, draft?.theme, attachmentSignature, loaded]);

  function cancelAutosave(): void {
    if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = null;
  }

  async function saveNoteId(noteId: string, flush = true): Promise<boolean> {
    if (!isSingleNote && openNoteIdsRef.current.includes(noteId)) return true;
    if (flush && draftRef.current?.id === noteId) cancelAutosave();
    try {
      if (flush) await saveQueue.flush(noteId);
      else await saveQueue.save(noteId);
      if (!saveQueue.isDirty(noteId)) setFailedSaves((items) => {
        if (!items.has(noteId)) return items;
        const next = new Set(items); next.delete(noteId); return next;
      });
      if (draftRef.current?.id === noteId) setSaveState(saveQueue.isDirty(noteId) ? "saving" : "saved");
      return true;
    } catch {
      setFailedSaves((current) => new Set(current).add(noteId));
      if (draftRef.current?.id === noteId) setSaveState("error");
      setToast(t("saveFailed", locale));
      return false;
    }
  }

  async function saveSnapshot(): Promise<boolean> {
    const current = draftRef.current;
    return !current || await saveNoteId(current.id);
  }

  async function retrySave(): Promise<void> {
    cancelAutosave();
    setSaveState("saving");
    try {
      await saveQueue.flush();
      setFailedSaves(new Set());
      setSaveState("saved");
      setToast((current) => current === t("saveFailed", locale) || current === t("exitSaveFailed", locale) ? null : current);
    } catch { setSaveState("error"); setToast(t("saveFailed", locale)); }
  }

  function replaceDraft(note: Note | null): void {
    draftRef.current = note;
    setDraft(note);
  }

  function updateDraft(patch: Partial<Note>): void {
    const current = draftRef.current;
    if (!current || exitLock.current || transferLock.current || closeLock.current || (!isSingleNote && openNoteIdsRef.current.includes(current.id))) return;
    if (patch.content !== undefined && patch.content !== current.content) dismissAiFeedback(current.id);
    const next: Note = { ...current, ...patch, updatedAt: new Date().toISOString(),
      syncState: patch.content !== undefined && patch.content !== current.content ? "local" : current.syncState };
    saveQueue.track(next);
    replaceDraft(next);
  }

  function dismissAiFeedback(noteId: string): void {
    setPolishFeedback((current) => current?.noteId === noteId ? null : current);
    setPolishChanges((changes) => {
      if (!changes[noteId]) return changes;
      const next = { ...changes }; delete next[noteId]; return next;
    });
    setPolishChangeOperations((operations) => {
      if (!operations[noteId]) return operations;
      const next = { ...operations }; delete next[noteId]; return next;
    });
  }

  async function handleNewNote(): Promise<void> {
    if (isSingleNote || !loaded || navigationLock.current || exitLock.current || transferLock.current) return;
    const current = draftRef.current;
    if (current && !saveQueue.isStored(current.id) && !hasNoteContent(current)) {
      closeMenus(); focusEditor(); return;
    }
    navigationLock.current = true;
    setIsNavigating(true);
    try {
      if (!await saveSnapshot()) return;
      rememberEditorView();
      const note = createNote();
      saveQueue.track(note);
      setPageTurn(null);
      setNotes((items) => [note, ...items]);
      replaceDraft(note);
      setEditorMode("edit");
      setSaveState("saved");
      closeMenus();
    } finally { navigationLock.current = false; setIsNavigating(false); }
  }

  async function selectNote(note: Note, direction?: PageTurnDirection): Promise<void> {
    if (isSingleNote) return;
    if (note.id === draftRef.current?.id) { closeMenus(); return; }
    if (navigationLock.current || exitLock.current) return;
    navigationLock.current = true;
    setIsNavigating(true);
    try {
      if (!await saveSnapshot()) return;
      rememberEditorView();
      const current = draftRef.current;
      if (current) {
        const currentIndex = notes.findIndex((item) => item.id === current.id);
        const nextIndex = notes.findIndex((item) => item.id === note.id);
        const view = editorViews.current.get(current.id);
        setPageTurn({ sequence: ++pageTurnSequence.current, direction: direction ?? (nextIndex < currentIndex ? "previous" : "next"),
          note: current, mode: editorMode, scroll: editorMode === "preview" ? view?.previewScroll ?? 0 : view?.scroll ?? 0 });
      }
      replaceDraft(saveQueue.read(note.id) ?? note);
      setEditorMode(editorViews.current.get(note.id)?.mode ?? "edit");
      setSaveState(saveQueue.isDirty(note.id) ? "saving" : "saved");
      closeMenus();
    } finally { navigationLock.current = false; setIsNavigating(false); }
  }

  async function handleDelete(): Promise<void> {
    const current = draftRef.current;
    if (isSingleNote || !current || navigationLock.current || exitLock.current || !window.confirm(t("deleteConfirm", locale))) return;
    navigationLock.current = true;
    setIsNavigating(true);
    cancelAutosave();
    try {
      await saveQueue.remove(current.id, () => saveQueue.isStored(current.id) ? window.desktopTabs.deleteNote(current.id) : Promise.resolve());
      setFailedSaves((items) => { const next = new Set(items); next.delete(current.id); return next; });
      editorViews.current.delete(current.id);
      setPolishChanges((changes) => { const next = { ...changes }; delete next[current.id]; return next; });
      const remaining = notes.filter((note) => note.id !== current.id);
      setPageTurn(null);
      setNotes(remaining);
      const next = remaining[0] ? saveQueue.read(remaining[0].id) ?? remaining[0] : null;
      replaceDraft(next);
      setEditorMode(next ? editorViews.current.get(next.id)?.mode ?? "edit" : "edit");
      closeMenus();
      setToast(t("noteDeleted", locale));
    } catch { setToast(t("deleteFailed", locale)); void saveSnapshot(); }
    finally { navigationLock.current = false; setIsNavigating(false); }
  }

  async function handlePickFiles(): Promise<void> {
    const noteId = draftRef.current?.id;
    if (!noteId || pickingLock.current || exitLock.current || (!isSingleNote && openNoteIdsRef.current.includes(noteId))) return;
    pickingLock.current = true;
    setPickingFiles(true);
    let finishImport!: () => void;
    importIdle.current = new Promise<void>((resolve) => { finishImport = resolve; });
    try {
      const picked = await window.desktopTabs.pickFiles();
      const current = saveQueue.read(noteId);
      if (current && picked.length) {
        const next = { ...current, attachments: [...current.attachments, ...picked], updatedAt: new Date().toISOString() };
        saveQueue.track(next);
        if (draftRef.current?.id === noteId) replaceDraft(next);
        else { setNotes((items) => items.map((item) => item.id === noteId ? next : item)); void saveNoteId(noteId, false); }
      }
      closeMenus();
    } catch { setToast(t("importFilesFailed", locale)); }
    finally { pickingLock.current = false; setPickingFiles(false); finishImport(); }
  }

  async function handleOpenAttachment(attachment: NoteAttachment): Promise<void> {
    try {
      const error = await window.desktopTabs.openAttachment(attachment.storedPath);
      if (error) setToast(t("fileOpenError", locale));
    } catch { setToast(t("fileOpenError", locale)); }
  }

  async function openLink(url: string): Promise<void> {
    try { if (!await window.desktopTabs.openExternalLink(url)) setToast(t("openLinkFailed", locale)); }
    catch { setToast(t("openLinkFailed", locale)); }
  }

  async function handleSync(provider: SyncProviderId): Promise<void> {
    if (!isSingleNote && draftRef.current && openNoteIdsRef.current.includes(draftRef.current.id)) return;
    if (provider === "notion") {
      const noteId = draftRef.current?.id;
      if (noteId) setSyncFeedback({ noteId, message: t("notionUnavailable", locale) });
      return;
    }
    if (!draftRef.current || syncLock.current || exitLock.current) return;
    let snapshot = draftRef.current;
    syncLock.current = true;
    let finishSync!: () => void;
    syncIdle.current = new Promise<void>((resolve) => { finishSync = resolve; });
    setSyncingId(snapshot.id);
    setSyncingProvider(provider);
    closeMenus();
    setSyncFeedback(null);
    try {
      if (!await saveNoteId(snapshot.id)) return;
      const latest = saveQueue.read(snapshot.id);
      if (!latest) return;
      snapshot = latest;
      let result = await window.desktopTabs.syncNote(snapshot, provider);
      if (result.status === "conflict" && window.confirm(t(result.scope === "chapter" ? "chapterConflict" : "syncConflict", locale))) {
        result = await window.desktopTabs.syncNote(snapshot, provider, { overwriteRemote: true });
      }
      if (result.status === "synced") {
        const saved = result.note;
        if (saved && saveQueue.read(saved.id)) saveQueue.acceptStored(saved);
        const warnings = (result.warnings ?? []).map((warning) => t(warning === "local-attachments" ? "syncAttachmentsLocal" : "syncImagesAsLinks", locale));
        const message = draftRef.current?.id === snapshot.id && draftRef.current.content !== snapshot.content
          ? t("syncNewerChanges", locale) : `${t("syncSuccess", locale)} ${providerLabels[provider]}`;
        setSyncFeedback({ noteId: snapshot.id, message: [message, ...warnings].join(" "), url: result.remoteUrl });
      } else if (result.status === "conflict") {
        setSyncFeedback({ noteId: snapshot.id, message: t("syncConflictCancelled", locale), url: result.remoteUrl, error: true });
      } else if (result.status === "error") {
        const message = t(syncErrorMessages[result.message] ?? "syncError", locale);
        setSyncFeedback({ noteId: snapshot.id, message: `${message}${result.apiCode ? ` (${result.apiCode})` : ""}`, url: result.remoteUrl, error: true });
        if (result.message === "collaborator-required" || result.message === "target-required") { openProviderConfig("feishu"); setOpenMenu("settings"); }
      } else {
        setSyncFeedback({ noteId: snapshot.id, message: t(result.status === "not-configured" ? "syncNotConfigured" : "syncNotImplemented", locale), error: true });
        if (result.status === "not-configured") { openProviderConfig(provider); setOpenMenu("settings"); }
      }
    } catch { setSyncFeedback({ noteId: snapshot.id, message: t("syncError", locale), error: true }); }
    finally { syncLock.current = false; setSyncingId(null); setSyncingProvider(null); finishSync(); }
  }

  function openAiConfig(): void {
    if (isSingleNote) { void window.desktopTabs.openMainWindow(true).catch(() => setToast(t("windowActionFailed", locale))); return; }
    setEditingProvider(null);
    setEditingAi(true);
    setOpenMenu("settings");
  }

  async function handleAiOperation(operation: AiOperation): Promise<void> {
    const current = draftRef.current;
    if (!current || polishLock.current || exitLock.current || (!isSingleNote && openNoteIdsRef.current.includes(current.id))) return;
    if (!current.content.trim()) { setToast(t("aiEmpty", locale)); return; }
    const noteId = current.id;
    polishLock.current = true;
    setPolishingId(noteId);
    setRunningAiOperation(operation);
    setPolishFeedback(null);
    setAiMenuOpen(false);
    let finishPolish!: () => void;
    polishIdle.current = new Promise<void>((resolve) => { finishPolish = resolve; });
    try {
      if (!await saveNoteId(noteId)) return;
      const result = operation === "polish"
        ? await window.desktopTabs.polishNote(noteId)
        : await window.desktopTabs.aiNote(noteId, operation);
      if (result.status === "not-configured") {
        setPolishFeedback({ noteId, operation, key: "aiNotConfigured", error: true });
        openAiConfig();
      } else if (result.status === "error") {
        setPolishFeedback({ noteId, operation, key: result.message === "note-missing" && operation !== "polish" ? "aiTransformMissing" : aiErrorMessages[result.message] ?? "aiError", error: true });
      } else {
        const applied = applyPolish(saveQueue.read(noteId), result.originalContent, result.content);
        if (applied.status !== "applied") {
          setPolishFeedback({ noteId, operation, key: applied.status === "changed" ? (operation === "polish" ? "aiPolishChanged" : "aiTransformChanged")
            : applied.status === "missing" ? (operation === "polish" ? "aiPolishMissing" : "aiTransformMissing") : aiOperationMeta[operation].unchangedKey, error: applied.status !== "unchanged" });
          return;
        }
        saveQueue.track(applied.note);
        if (draftRef.current?.id === noteId) replaceDraft(applied.note);
        setNotes((items) => items.map((item) => item.id === noteId ? applied.note : item));
        setPolishChanges((changes) => ({ ...changes, [noteId]: applied.change }));
        setPolishChangeOperations((operations) => ({ ...operations, [noteId]: operation }));
        const saved = await saveNoteId(noteId);
        if (saveQueue.read(noteId)?.content !== applied.note.content) return;
        setPolishFeedback({ noteId, operation, key: saved ? aiOperationMeta[operation].successKey : "aiTransformUnsaved", error: !saved });
      }
    } catch (error) {
      setPolishFeedback({ noteId, operation, key: error === "AI_CONFIG_UNAVAILABLE" ? "aiSecureUnavailable" : "aiError", error: true });
    } finally { polishLock.current = false; setPolishingId(null); setRunningAiOperation(null); finishPolish(); }
  }

  async function handlePolish(): Promise<void> {
    await handleAiOperation("polish");
  }

  async function handleUndoPolish(): Promise<void> {
    const current = draftRef.current;
    if (!current || exitLock.current || polishLock.current) return;
    const change = polishChanges[current.id];
    if (!change) return;
    const restored = undoPolish(current, change);
    if (!restored) { setToast(t("aiUndoChanged", locale)); return; }
    saveQueue.track(restored);
    replaceDraft(restored);
    setNotes((items) => items.map((item) => item.id === restored.id ? restored : item));
    setPolishChanges((changes) => { const next = { ...changes }; delete next[current.id]; return next; });
    setPolishChangeOperations((operations) => { const next = { ...operations }; delete next[current.id]; return next; });
    setPolishFeedback(null);
    if (await saveNoteId(current.id)) setToast(t("aiUndone", locale));
  }

  function openProviderConfig(provider: SyncProviderId): void {
    if (isSingleNote) { void window.desktopTabs.openMainWindow(true).catch(() => setToast(t("windowActionFailed", locale))); return; }
    if (provider === "notion") { setToast(t("notionUnavailable", locale)); return; }
    setEditingProvider(provider);
    setEditingAi(false);
    setAppId(syncConfigs[provider]?.appId ?? "");
    setAppSecret("");
    setCollaboratorEmail(syncConfigs[provider]?.collaboratorEmail ?? "");
    setFeishuMode(syncConfigs[provider]?.syncMode ?? "create");
    setTargetDocumentUrl(syncConfigs[provider]?.targetDocumentUrl ?? "");
  }

  async function handleSaveProviderConfig(): Promise<void> {
    if (!editingProvider) return;
    if (editingProvider === "feishu" && feishuMode === "append" && !parseFeishuTarget(targetDocumentUrl)) {
      setToast(t("targetDocumentInvalid", locale));
      return;
    }
    const result = await window.desktopTabs.saveSyncConfig({ provider: editingProvider, appId, appSecret, collaboratorEmail,
      ...(editingProvider === "feishu" ? { syncMode: feishuMode, targetDocumentUrl } : {}) });
    if (result.status === "saved") {
      const nextConfig: SyncProviderConfig = { provider: editingProvider, appId: appId.trim(), appSecretConfigured: true, collaboratorEmail: collaboratorEmail.trim(), syncMode: feishuMode, targetDocumentUrl: targetDocumentUrl.trim(), updatedAt: new Date().toISOString() };
      setSyncConfigs((current) => ({ ...current, [editingProvider]: nextConfig }));
      setAppSecret("");
      setEditingProvider(null);
      setToast(t("configSaved", locale));
    } else if (result.status === "invalid") setToast(t("configInvalid", locale));
    else setToast(t("secureStorageUnavailable", locale));
  }

  async function handleClearProviderConfig(): Promise<void> {
    if (!editingProvider) return;
    const result = await window.desktopTabs.clearSyncConfig(editingProvider);
    if (result.status === "cleared") {
      setSyncConfigs((current) => {
        const next = { ...current };
        delete next[editingProvider];
        return next;
      });
      setAppId("");
      setAppSecret("");
      setEditingProvider(null);
      setToast(t("configCleared", locale));
    } else setToast(t("secureStorageUnavailable", locale));
  }

  function displayShortcut(accelerator: string): string {
    const mac = navigator.platform.toLowerCase().includes("mac");
    return accelerator.split("+").map((part) => {
      if (part === "CommandOrControl") return mac ? "⌘" : "Ctrl";
      if (part === "Control") return mac ? "⌃" : "Ctrl";
      if (part === "Alt") return mac ? "⌥" : "Alt";
      if (part === "Shift") return mac ? "⇧" : "Shift";
      if (part === "Space") return "Space";
      if (part.startsWith("Arrow")) return part.slice(5);
      return part;
    }).join(mac ? " " : " + ");
  }

  function acceleratorFromKeyEvent(event: ReactKeyboardEvent<HTMLButtonElement>): string | null {
    event.preventDefault();
    if (event.key === "Escape") return null;
    if (!event.metaKey && !event.ctrlKey && !event.altKey) return null;
    if (["Meta", "Control", "Alt", "Shift"].includes(event.key)) return null;
    const modifiers: string[] = [];
    if (event.metaKey || event.ctrlKey) modifiers.push("CommandOrControl");
    if (event.altKey) modifiers.push("Alt");
    if (event.shiftKey) modifiers.push("Shift");
    const key = event.key === " " ? "Space" : event.key.startsWith("Arrow") ? event.key.slice(5) : event.key.length === 1 ? event.key.toUpperCase() : event.key;
    if (!key || ["Tab", "Enter", "Backspace", "Delete"].includes(key)) return null;
    return [...modifiers, key].join("+");
  }

  async function handleShortcutKeyDown(action: ShortcutActionId, event: ReactKeyboardEvent<HTMLButtonElement>): Promise<void> {
    if (recordingShortcut !== action || event.repeat || event.nativeEvent.isComposing) return;
    const accelerator = acceleratorFromKeyEvent(event);
    if (!accelerator) {
      if (event.key === "Escape") setRecordingShortcut(null);
      return;
    }
    const next = shortcutConfigs.map((shortcut) => shortcut.action === action ? { ...shortcut, accelerator } : shortcut);
    const result = await window.desktopTabs.saveShortcuts(next);
    if (result.status === "saved") {
      setShortcutConfigs(result.shortcuts);
      setRecordingShortcut(null);
      setToast(t("shortcutSaved", locale));
    } else if (result.status === "conflict") setToast(t("shortcutConflict", locale));
    else setToast(t("shortcutInvalid", locale));
  }

  async function handleResetShortcuts(): Promise<void> {
    const result = await window.desktopTabs.saveShortcuts(DEFAULT_SHORTCUTS.map((shortcut) => ({ ...shortcut })));
    if (result.status === "saved") {
      setShortcutConfigs(result.shortcuts);
      setToast(t("shortcutSaved", locale));
    } else if (result.status === "conflict") setToast(t("shortcutConflict", locale));
    else setToast(t("shortcutInvalid", locale));
  }

  function selectRelativeNote(offset: number): void {
    if (!draft || notes.length < 2) return;
    const index = notes.findIndex((note) => note.id === draft.id);
    const nextIndex = (index + offset + notes.length) % notes.length;
    void selectNote(notes[nextIndex], offset < 0 ? "previous" : "next");
  }

  function focusEditor(): void {
    setEditorMode("edit");
    window.requestAnimationFrame(() => noteEditorRef.current?.focus({ preventScroll: true }));
  }

  function rememberEditorView(): void {
    const current = draftRef.current;
    const editor = noteEditorRef.current;
    if (!current || !editor) return;
    const previous = editorViews.current.get(current.id);
    // A display:none textarea can report scrollTop=0. Preview must not replace
    // the editor position captured before it was hidden.
    editorViews.current.set(current.id, {
      start: editorMode === "edit" ? editor.selectionStart : previous?.start ?? editor.selectionStart,
      end: editorMode === "edit" ? editor.selectionEnd : previous?.end ?? editor.selectionEnd,
      scroll: editorMode === "edit" ? editor.scrollTop : previous?.scroll ?? 0,
      previewScroll: previewRef.current?.scrollTop ?? previous?.previewScroll ?? 0, mode: editorMode,
    });
  }

  function toggleEditorMode(): void {
    rememberEditorView();
    setEditorMode((current) => current === "edit" ? "preview" : "edit");
  }

  useLayoutEffect(() => {
    if (!draft) return;
    const view = editorViews.current.get(draft.id);
    const editor = noteEditorRef.current;
    if (editorMode === "edit" && editor) {
      if (view) { editor.setSelectionRange(view.start, view.end); editor.scrollTop = view.scroll; }
      editor.focus({ preventScroll: true });
    } else if (previewRef.current) {
      previewRef.current.scrollTop = view?.previewScroll ?? 0;
      previewRef.current.focus({ preventScroll: true });
    }
  }, [draft?.id, editorMode]);

  const shortcutHandler = useRef<(action: ShortcutActionId) => void>(() => {});
  shortcutHandler.current = (action) => {
    if (recordingShortcut || exitLock.current) return;
    if (action === "toggleWindow") {
      if (openMenu === "settings") return;
      if (editorMode === "preview") previewRef.current?.focus({ preventScroll: true });
      else noteEditorRef.current?.focus({ preventScroll: true });
    }
    if (action === "newNote") void handleNewNote();
    if (action === "previousNote") selectRelativeNote(-1);
    if (action === "nextNote") selectRelativeNote(1);
  };
  useEffect(() => window.desktopTabs.onShortcutAction((action) => shortcutHandler.current(action)), []);

  const selectHandler = useRef(selectNote);
  selectHandler.current = selectNote;
  const selectFromList = useCallback((note: Note) => { void selectHandler.current(note); }, []);

  async function handleOpenNoteWindow(noteId: string): Promise<void> {
    if (isSingleNote || transferLock.current || exitLock.current) return;
    if (openNoteIdsRef.current.includes(noteId)) {
      await window.desktopTabs.focusNoteWindow(noteId).catch(() => setToast(t("windowActionFailed", locale)));
      closeMenus(); return;
    }
    transferLock.current = true;
    setTransferring(true);
    try {
      await Promise.all([syncIdle.current, importIdle.current, polishIdle.current]);
      if (!await saveNoteId(noteId)) return;
      if (!saveQueue.isStored(noteId)) return;
      rememberEditorView();
      await window.desktopTabs.openNoteWindow(noteId);
      closeMenus();
    } catch { setToast(t("noteWindowFailed", locale)); }
    finally { transferLock.current = false; setTransferring(false); }
  }

  const windowsHandler = useRef<(next: NoteWindowContext) => Promise<void>>(async () => {});
  windowsHandler.current = async (next) => {
    const released = openNoteIdsRef.current.filter((id) => !next.openNoteIds.includes(id));
    openNoteIdsRef.current = next.openNoteIds;
    if (released.length) {
      try {
        for (const note of await window.desktopTabs.listNotes()) {
          if (released.includes(note.id)) saveQueue.acceptExternal(note);
        }
      } catch { setToast(t("loadFailed", locale)); }
    }
    setOpenNoteIds(openNoteIdsRef.current);
  };
  useEffect(() => {
    if (isSingleNote) return;
    const disposeWindows = window.desktopTabs.onWindowsChanged((next) => { void windowsHandler.current(next); });
    const disposeNotes = window.desktopTabs.onNoteChanged(({ note, sourceWindow }) => {
      if (sourceWindow === "main") return;
      if (!openNoteIdsRef.current.includes(note.id) && saveQueue.isDirty(note.id)) return;
      saveQueue.acceptExternal(note);
    });
    const disposeActivate = window.desktopTabs.onNoteActivated((id) => {
      const note = saveQueue.read(id);
      if (note) void selectHandler.current(note);
    });
    const disposeSettings = window.desktopTabs.onSettingsRequested(() => setOpenMenu("settings"));
    const disposeRestore = window.desktopTabs.onRestoreFailed(() => setToast(t("noteWindowRestoreFailed", locale)));
    return () => { disposeWindows(); disposeNotes(); disposeActivate(); disposeSettings(); disposeRestore(); };
  }, []);
  useEffect(() => {
    const changed = (event: StorageEvent): void => { if (event.key === PREFERENCES_KEY) setPreferences(readPreferences()); };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);

  async function closeSingleNote(returnToMain = false): Promise<void> {
    if (!isSingleNote || closeLock.current || exitLock.current) return;
    closeLock.current = true;
    setTransferring(true);
    try {
      await Promise.all([syncIdle.current, importIdle.current, polishIdle.current]);
      if (!await saveSnapshot()) { await window.desktopTabs.closeNoteWindow(false); return; }
      await window.desktopTabs.closeNoteWindow(true, returnToMain);
    } catch {
      setToast(t("windowActionFailed", locale));
      await window.desktopTabs.closeNoteWindow(false).catch(() => {});
    } finally { closeLock.current = false; setTransferring(false); }
  }
  const closeHandler = useRef(closeSingleNote);
  closeHandler.current = closeSingleNote;
  useEffect(() => window.desktopTabs.onCloseRequested(() => { void closeHandler.current(); }), []);

  const saveOnBlur = useRef<() => void>(() => {});
  saveOnBlur.current = () => { if (loaded && !exitLock.current) void saveSnapshot(); setRecordingShortcut(null); };
  useEffect(() => {
    const flush = (): void => saveOnBlur.current();
    window.addEventListener("blur", flush);
    const hidden = (): void => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", hidden);
    return () => { window.removeEventListener("blur", flush); document.removeEventListener("visibilitychange", hidden); };
  }, []);

  const exitHandler = useRef<(requestId: string) => Promise<void>>(async () => {});
  exitHandler.current = async (requestId) => {
    if (exitLock.current) return;
    exitLock.current = true;
    activeExitRequest.current = requestId;
    setExiting(true);
    cancelAutosave();
    try {
      await Promise.all([syncIdle.current, importIdle.current, polishIdle.current]);
      await saveQueue.flush();
      if (activeExitRequest.current === requestId) await window.desktopTabs.completeExit(true, requestId);
    } catch {
      if (activeExitRequest.current !== requestId) return;
      exitLock.current = false;
      setExiting(false);
      setSaveState("error");
      setToast(t("exitSaveFailed", locale));
      await window.desktopTabs.completeExit(false, requestId).catch(() => {});
    }
  };
  useEffect(() => window.desktopTabs.onExitRequested((id) => { void exitHandler.current(id); }), []);
  useEffect(() => window.desktopTabs.onExitCancelled(() => {
    activeExitRequest.current = null;
    exitLock.current = false;
    setExiting(false);
    setToast(t("exitCancelled", locale));
  }), []);

  async function hideWindow(minimize = false): Promise<void> {
    if (isSingleNote && !minimize) { await closeSingleNote(); return; }
    if (!await saveSnapshot()) return;
    if (minimize) window.desktopTabs.minimizeWindow();
    else window.desktopTabs.closeWindow();
  }

  const pinLock = useRef(false);
  async function handleTogglePin(): Promise<void> {
    if (pinLock.current) return;
    pinLock.current = true;
    try { setIsPinned(await window.desktopTabs.setPinnedWindow(!isPinned)); }
    catch { setToast(t("windowActionFailed", locale)); }
    finally { pinLock.current = false; }
  }

  const firstLine = draft?.content.split(/\r\n|\n|\r/, 1)[0] ?? "";
  const activeTitle = useMemo(() => getNoteTitle(firstLine), [firstLine]);
  useEffect(() => {
    const title = `${activeTitle.slice(0, 160) || t("untitled", locale)} · ${t("appName", locale)}`;
    void window.desktopTabs.setWindowTitle(title).catch(() => {});
  }, [activeTitle, locale]);

  const saveLabel = t(saveState === "saved" ? "localSaved" : saveState === "error" ? "saveFailed" : "saving", locale);
  const activeSyncFeedback = syncFeedback?.noteId === draft?.id ? syncFeedback : null;
  const activePolishFeedback = polishFeedback?.noteId === draft?.id ? polishFeedback : null;
  const activePolishChange = draft ? polishChanges[draft.id] : undefined;
  const canUndoPolish = !!activePolishChange && activePolishChange.polishedContent === draft?.content;
  const activeAiOperation = activePolishFeedback?.operation ?? (draft ? polishChangeOperations[draft.id] : undefined) ?? "polish";
  const activeAiMeta = aiOperationMeta[activeAiOperation];
  const remoteDocumentUrl = activeSyncFeedback?.url ?? draft?.feishu?.url;
  const activeNoteIndex = notes.findIndex((note) => note.id === draft?.id);
  const isDelegated = !isSingleNote && !!draft && openNoteIds.includes(draft.id);
  const previousNote = activeNoteIndex >= 0 && notes.length > 1 ? notes[(activeNoteIndex - 1 + notes.length) % notes.length] : undefined;
  const nextNote = activeNoteIndex >= 0 && notes.length > 1 ? notes[(activeNoteIndex + 1) % notes.length] : undefined;

  return (
    <main className="app-shell note-window" data-window-focused={isWindowFocused} onClick={() => openMenu && closeMenus()}>
      <header className="window-bar">
        <div className="window-drag-area" onMouseDown={(event) => {
          if (event.button === 0 && !(event.target as HTMLElement).closest("button")) void startDragging();
        }}>
          <span className={`brand-logo save-state ${saveState}`} role="status" aria-label={saveLabel} title={saveLabel}>
            <img className="brand-mark" src="./desk-tabs-logo.png" alt="" aria-hidden="true" />
            {saveState !== "saved" && <span className="save-state-marker" aria-hidden="true"><Star size={9} fill="currentColor" /></span>}
          </span>
          <span className="window-brand">{t("appName", locale)}</span>
          <span className="window-separator">·</span>
          <span className="window-note-name" title={activeTitle}>{activeTitle || t("untitled", locale)}</span>
        </div>
        <div className="window-tools" onClick={(event) => event.stopPropagation()}>
          {!isSingleNote && <button className="window-tool" disabled={!loaded || isNavigating || exiting || transferring} aria-label={t("quickCapture", locale)} title={t("quickCapture", locale)} onClick={() => void handleNewNote()}><Plus size={14} /></button>}
          <button className="window-tool editor-mode-switch" role="switch" aria-label={t("togglePreview", locale)} aria-checked={editorMode === "preview"} disabled={!draft || exiting || isDelegated || transferring} title={t(editorMode === "edit" ? "switchToPreview" : "switchToEdit", locale)} onClick={toggleEditorMode}><Eye size={14} /></button>
          {!isSingleNote && <button className="window-tool" disabled={!loaded || exiting} aria-label={t("viewNotes", locale)} title={t("viewNotes", locale)} aria-expanded={openMenu === "notes"} onClick={() => toggleMenu("notes")}><Layers3 size={14} /></button>}
          <button className={`window-tool pinned-badge ${isPinned ? "active" : ""}`} aria-pressed={isPinned} aria-label={t(isPinned ? "unpinWindow" : "pinWindow", locale)} title={isPinned ? `${t("pinned", locale)} · ${t("unpinWindow", locale)}` : t("pinWindow", locale)} onClick={() => void handleTogglePin()}><Pin size={14} /></button>
          <button className="window-tool" aria-label={t("moreActions", locale)} title={t("moreActions", locale)} onClick={() => toggleMenu("actions")}><MoreHorizontal size={16} /></button>
          <button className="window-tool minimize" disabled={exiting} aria-label={t("minimize", locale)} title={t("minimize", locale)} onClick={() => void hideWindow(true)}><Minus size={14} /></button>
          <button className="window-tool close" disabled={exiting} aria-label={t("close", locale)} title={t("close", locale)} onClick={() => void hideWindow()}><X size={14} /></button>
        </div>
      </header>

      <section className="note-surface" onClick={(event) => {
        event.stopPropagation();
        if (!(event.target as HTMLElement).closest(".popover, button")) closeMenus();
      }}>
        <NoteBook previousNote={isSingleNote ? undefined : previousNote} nextNote={isSingleNote ? undefined : nextNote} currentIndex={isSingleNote ? 0 : activeNoteIndex} total={isSingleNote ? 1 : notes.length}
          locale={locale} busy={isNavigating || exiting} turn={pageTurn} onTurnEnd={finishPageTurn}
          onPrevious={() => selectRelativeNote(-1)} onNext={() => selectRelativeNote(1)} onShowNotes={() => toggleMenu("notes")}>
        <div className="note-editor">
          {draft ? <NoteEditor note={draft} preview={editorMode === "preview" || isDelegated} readOnly={exiting || transferring || isDelegated}
            locale={locale} editorRef={noteEditorRef} previewRef={previewRef} onChange={(content) => updateDraft({ content })}
            onOpenLink={(url) => void openLink(url)} onOpenAttachment={(attachment) => void handleOpenAttachment(attachment)}
            onRemoveAttachment={(id) => updateDraft({ attachments: draftRef.current!.attachments.filter((item) => item.id !== id) })} /> : <div className="empty-note"><Sparkles size={21} /><span>{t(!loaded ? loadError ? "loadFailed" : "loadingNotes" : "emptyTitle", locale)}</span>
            {loadError ? <button className="inline-new-button" onClick={() => void loadNotes()}>{t("retryLoad", locale)}</button>
              : loaded && <button className="inline-new-button" onClick={() => void handleNewNote()}>{t("startWriting", locale)}</button>}</div>}
        </div>

        <footer className="note-footer" onClick={(event) => event.stopPropagation()}>
          <div className="footer-content">
            {draft && <time className="note-date" dateTime={draft.updatedAt} title={new Date(draft.updatedAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US")}>{formatTime(draft.updatedAt, locale)}</time>}
            {remoteDocumentUrl && <button className="remote-document-link" title={t("openFeishu", locale)} aria-label={t("openFeishu", locale)} onClick={() => void openLink(remoteDocumentUrl)}><ExternalLink size={11} /><span>{t("openFeishu", locale)}</span></button>}
            <div className="footer-actions">
              <div className="ai-action-group" onBlur={handleAiMenuBlur}>
                <div className="ai-action-buttons">
                  <button className="provider-sync-button ai-polish-button" disabled={!draft || !draft.content.trim() || !!polishingId || exiting || isDelegated || transferring}
                    aria-label={t("aiPolish", locale)} aria-busy={polishingId === draft?.id}
                    title={t(polishingId === draft?.id ? (runningAiOperation ? aiOperationMeta[runningAiOperation].processingKey : "aiPolishing") : "aiPolish", locale)} onClick={() => void handlePolish()}>
                    {polishingId === draft?.id ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}<span className="provider-label">{t("aiPolish", locale)}</span></button>
                  <button className="ai-action-arrow" disabled={!draft || !draft.content.trim() || !!polishingId || exiting || isDelegated || transferring} aria-label={t("aiMoreActions", locale)} title={t("aiMoreActions", locale)} aria-expanded={aiMenuOpen} onClick={() => setAiMenuOpen((open) => !open)}><ChevronDown size={11} /></button>
                </div>
                {aiMenuOpen && <div className="ai-action-menu" role="menu">{aiOperations.map((operation) => <button key={operation} role="menuitem" disabled={!!polishingId || exiting || isDelegated || transferring} onClick={() => void handleAiOperation(operation)}>{aiOperationIcon(operation, 14)}<span>{t(aiOperationMeta[operation].labelKey, locale)}</span></button>)}</div>}
              </div>
              <button className="hover-tool" disabled={!draft || pickingFiles || exiting || isDelegated || transferring} aria-label={t("addAttachment", locale)} title={t(pickingFiles ? "importingFiles" : "addAttachment", locale)} onClick={() => void handlePickFiles()}>{pickingFiles ? <LoaderCircle size={15} className="spin" /> : <Paperclip size={15} />}</button>
              {(["feishu"] as const).map((provider) => {
                const isSyncing = syncingId === draft?.id && syncingProvider === provider;
                const label = t("syncFeishu", locale);
                return <button key={provider} className="provider-sync-button" disabled={!!syncingId || !draft || exiting || isDelegated || transferring} aria-label={label} title={isSyncing ? t("syncing", locale) : label} onClick={() => void handleSync(provider)}>{isSyncing ? <LoaderCircle size={18} className="spin" aria-label={t("syncing", locale)} /> : <span className="provider-glyph feishu-glyph">飞</span>}<span className="provider-label">{t("feishu", locale)}</span></button>;
              })}
              <button className="hover-tool" aria-label={t("settings", locale)} title={t("settings", locale)} aria-expanded={openMenu === "settings"} onClick={() => toggleMenu("settings")}><Settings2 size={15} /></button>
            </div>
          </div>
        </footer>
        </NoteBook>

        <div className="feedback-stack" onClick={(event) => event.stopPropagation()}>
          {isDelegated && draft && <div className="sync-feedback independent-feedback" role="status"><span>{t("independentNote", locale)}</span><button onClick={() => void handleOpenNoteWindow(draft.id)}>{t("focusNoteWindow", locale)}</button></div>}
          {polishingId === draft?.id && <div className="sync-feedback" role="status">{t(runningAiOperation ? aiOperationMeta[runningAiOperation].processingKey : "aiPolishing", locale)}</div>}
          {activePolishFeedback && <div className={`sync-feedback ai-feedback ${activePolishFeedback.error ? "error" : ""}`} role="status">
            <div className="ai-feedback-row"><span className="ai-feedback-message">{t(activePolishFeedback.key, locale)}</span>
              <div className="ai-feedback-controls">
                {canUndoPolish && <button className="undo-polish" disabled={!!polishingId || exiting || isDelegated || transferring} onClick={() => void handleUndoPolish()}>{t(activeAiOperation === "polish" ? "aiUndo" : "aiUndoTransform", locale)}</button>}
                <button className="dismiss-feedback" aria-label={t("dismissMessage", locale)} onClick={() => dismissAiFeedback(activePolishFeedback.noteId)}><X size={12} /></button>
              </div>
            </div>
            {(activePolishFeedback.error || activePolishFeedback.key === activeAiMeta.unchangedKey) && <button className="retry-sync" disabled={!!polishingId || exiting || isDelegated || transferring} onClick={() => void handleAiOperation(activeAiOperation)}>{t(activeAiOperation === "polish" ? "aiRetry" : "aiRetryTransform", locale)}</button>}
            {["aiPolishUnchanged", "aiAuthError", "aiEndpointError"].includes(activePolishFeedback.key) && <button className="ai-feedback-settings" disabled={exiting} onClick={openAiConfig}>{t("aiModelSettings", locale)}</button>}
          </div>}
          {exiting && <div className="sync-feedback" role="status">{t("finishingExit", locale)}</div>}
          {(saveState === "error" || failedSaves.size > 0) && <div className="sync-feedback error" role="alert"><span>{t("saveFailed", locale)}</span>
            <button className="retry-save" disabled={saveState === "saving" || exiting} onClick={() => void retrySave()}>{t("retrySave", locale)}</button></div>}
          {activeSyncFeedback && <div className={`sync-feedback ${activeSyncFeedback.error ? "error" : ""}`} role="status"><span>{activeSyncFeedback.message}</span>
            {activeSyncFeedback.error && <button className="retry-sync" disabled={!!syncingId || exiting || isDelegated || transferring} onClick={() => void handleSync("feishu")}>{t("retrySync", locale)}</button>}
            <button className="dismiss-feedback" aria-label={t("dismissMessage", locale)} onClick={() => setSyncFeedback(null)}><X size={12} /></button></div>}
        </div>

        {openMenu === "notes" && <div className="popover notes-popover" onBlur={handlePopoverBlur}><NoteList notes={notes} activeNote={draft} locale={locale} onSelect={selectFromList} onNew={() => void handleNewNote()} onOpen={(id) => void handleOpenNoteWindow(id)} openNoteIds={openNoteIds} /></div>}
        {openMenu === "actions" && <div className="popover actions-popover" onBlur={handlePopoverBlur}>
          {isSingleNote ? <button disabled={exiting || transferring} onClick={() => void closeSingleNote(true)}><CornerUpLeft size={14} />{t("returnToMain", locale)}</button> : <>
            <button disabled={!draft || !hasNoteContent(draft) || exiting || transferring} onClick={() => draft && void handleOpenNoteWindow(draft.id)}><PanelTop size={14} />{t(isDelegated ? "focusNoteWindow" : "openNoteWindow", locale)}</button>
            <button disabled={!loaded || isNavigating || exiting || transferring} onClick={() => void handleNewNote()}><CirclePlus size={14} />{t("newNote", locale)}</button>
            <button disabled={!draft || isNavigating || exiting || transferring} onClick={() => void handleDelete()}><Trash2 size={14} />{t("deleteNote", locale)}</button>
          </>}
          <button className="compact-minimize" onClick={() => void hideWindow(true)}><Minus size={14} />{t("minimize", locale)}</button>
          {!isSingleNote && <button disabled={exiting || transferring} onClick={() => { closeMenus(); void window.desktopTabs.quitApplication().catch(() => setToast(t("windowActionFailed", locale))); }}><LogOut size={14} />{t("quitApplication", locale)}</button>}
        </div>}
        {openMenu === "settings" && <div className="popover settings-popover">
          {isSingleNote ? <>
            <div className="popover-title">{t("theme", locale)}</div>
            <div className="theme-grid">{themeOptions.map((option) => <button key={option.id} disabled={exiting || transferring} className={`theme-choice ${activeTheme === option.id ? "selected" : ""}`} onClick={() => updateDraft({ theme: option.id })}><span className="theme-swatch" style={{ backgroundColor: option.swatch }} /><span>{t(option.labelKey, locale)}</span>{activeTheme === option.id && <Check size={12} />}</button>)}</div>
            <button className="provider-setting" onClick={() => void window.desktopTabs.openMainWindow(true).catch(() => setToast(t("windowActionFailed", locale)))}><Settings2 size={14} />{t("openMainSettings", locale)}</button>
          </> : editingAi ? <AiSettings config={aiConfig} locale={locale} onClose={() => setEditingAi(false)}
            onSaved={(config) => { setAiConfig(config); setEditingAi(false); setToast(t("configSaved", locale)); }}
            onCleared={() => { setAiConfig(null); setEditingAi(false); setToast(t("configCleared", locale)); }} /> : editingProvider ? <>
            <button className="popover-back" onClick={() => setEditingProvider(null)}>‹ {t("back", locale)}</button>
            <div className="provider-heading"><span className={`provider-glyph ${editingProvider === "notion" ? "notion-glyph" : "feishu-glyph"}`}>{editingProvider === "notion" ? "N" : "飞"}</span><strong>{providerLabels[editingProvider]}</strong>{syncConfigs[editingProvider] && <span className="configured-label">{t("configured", locale)}</span>}</div>
            {editingProvider === "feishu" && <><label className="credential-field"><span>{t("feishuSyncMode", locale)}</span><select value={feishuMode} onChange={(event) => setFeishuMode(event.target.value as FeishuSyncMode)}><option value="create">{t("feishuCreateMode", locale)}</option><option value="append">{t("feishuAppendMode", locale)}</option></select></label>
              {feishuMode === "append" ? <><label className="credential-field"><span>{t("targetDocumentUrl", locale)}</span><input type="url" value={targetDocumentUrl} onChange={(event) => setTargetDocumentUrl(event.target.value)} placeholder={t("targetDocumentPlaceholder", locale)} autoComplete="off" /></label><p className="credential-hint">{t("appendModeHint", locale)}</p></> : <p className="credential-hint">{t("createModeHint", locale)}</p>}</>}
            <label className="credential-field"><span>{t("appId", locale)}</span><input value={appId} onChange={(event) => setAppId(event.target.value)} autoComplete="off" /></label>
            <label className="credential-field"><span>{t("appSecret", locale)}</span><input type="password" value={appSecret} onChange={(event) => setAppSecret(event.target.value)} placeholder={syncConfigs[editingProvider] ? t("savedSecretPlaceholder", locale) : t("appSecretPlaceholder", locale)} autoComplete="new-password" /></label>
            {editingProvider === "feishu" && <>{feishuMode === "create" && <><label className="credential-field"><span>{t("collaboratorEmail", locale)}</span><input type="email" value={collaboratorEmail} onChange={(event) => setCollaboratorEmail(event.target.value)} autoComplete="email" /></label><p className="credential-hint">{t("collaboratorHint", locale)}</p></>}<p className="credential-hint">{t("syncTextOnly", locale)}</p><button className="setup-help" onClick={() => void openLink("https://open.feishu.cn/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/document-docx/docx-v1/document/convert")}><ExternalLink size={11} />{t("feishuSetupHelp", locale)}</button></>}
            <div className="credential-actions"><button className="secondary-action" onClick={() => setEditingProvider(null)}>{t("cancel", locale)}</button><button className="primary-action" onClick={() => void handleSaveProviderConfig()}>{t("saveConfig", locale)}</button></div>
            {syncConfigs[editingProvider] && <button className="clear-config" onClick={() => void handleClearProviderConfig()}>{t("clearConfig", locale)}</button>}
          </> : <>
            <div className="popover-title">{t("language", locale)}</div>
            <div className="locale-switch" role="group" aria-label={t("language", locale)}>
              <button className={locale === "zh" ? "selected" : ""} aria-pressed={locale === "zh"} onClick={() => setLocale("zh")}><Languages size={13} />{t("languageChinese", locale)}</button>
              <button className={locale === "en" ? "selected" : ""} aria-pressed={locale === "en"} onClick={() => setLocale("en")}><Languages size={13} />{t("languageEnglish", locale)}</button>
            </div>
            <div className="popover-title">{t("theme", locale)}</div>
            <div className="theme-grid">{themeOptions.map((option) => <button key={option.id} disabled={exiting || transferring || isDelegated} className={`theme-choice ${activeTheme === option.id ? "selected" : ""}`} onClick={() => updateDraft({ theme: option.id })}><span className="theme-swatch" style={{ backgroundColor: option.swatch }} /><span>{t(option.labelKey, locale)}</span>{activeTheme === option.id && <Check size={12} />}</button>)}</div>
            <label className="opacity-setting" htmlFor="theme-opacity"><span>{t("themeOpacity", locale)}</span><output>{Math.round(activeThemeOpacity * 100)}%</output></label>
            <input id="theme-opacity" className="opacity-slider" type="range" min={Math.round(MIN_THEME_OPACITY * 100)} max="100" step="2" value={Math.round(activeThemeOpacity * 100)} onChange={(event) => updatePreferences({ themeOpacity: Number(event.target.value) / 100 })} aria-label={t("themeOpacity", locale)} />
            <div className="popover-title settings-section-title">{t("aiSettings", locale)}</div>
            <button className="provider-setting" onClick={openAiConfig}><Sparkles size={15} /><span>{t("aiPolish", locale)}</span><small>{t(aiConfig ? "configured" : "notConfigured", locale)}</small><ChevronRight size={13} /></button>
            <div className="popover-title settings-section-title">{t("syncSettings", locale)}</div>
            <button className="provider-setting" onClick={() => openProviderConfig("feishu")}><span className="provider-glyph feishu-glyph">飞</span><span>{t("feishu", locale)}</span><small>{syncConfigs.feishu ? t("configured", locale) : t("notConfigured", locale)}</small><ChevronRight size={13} /></button>
            <div className="popover-title settings-section-title">{t("keyboardShortcuts", locale)}</div>
            <div className="shortcut-list">{shortcutConfigs.map((shortcut) => <div className="shortcut-row" key={shortcut.action}><span>{t(shortcutLabelKeys[shortcut.action], locale)}</span><button className={`shortcut-capture ${recordingShortcut === shortcut.action ? "recording" : ""}`} onClick={() => setRecordingShortcut(shortcut.action)} onKeyDown={(event) => void handleShortcutKeyDown(shortcut.action, event)}>{recordingShortcut === shortcut.action ? t("pressShortcut", locale) : displayShortcut(shortcut.accelerator)}</button></div>)}</div>
            <button className="reset-shortcuts" onClick={() => void handleResetShortcuts()}>{t("resetShortcuts", locale)}</button>
          </>}
        </div>}
      </section>
      {toast && <div className="toast" role="status"><Info size={14} />{toast}</div>}
    </main>
  );
}
