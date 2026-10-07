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
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { DEFAULT_SHORTCUTS, type AiConfig, type AiOperation, type FeishuSyncMode, type Note, type NoteAttachment, type NoteThemeId, type ShortcutActionId, type ShortcutConfig, type SyncProviderConfig, type SyncProviderId } from "../shared/types.js";
import { parseFeishuTarget } from "../shared/feishuTarget.js";
import { noteSyncHash } from "../platform/sync/feishuApi.js";
import { DEFAULT_THEME_OPACITY, MIN_THEME_OPACITY, getNoteTitle, isNoteThemeId, normalizeThemeOpacity } from "../shared/notes.js";
import { aiErrorMessages, syncErrorMessages, t, type Locale, type MessageKey } from "./i18n.js";
import { applyPolish, undoPolish, type PolishChange } from "./notePolish.js";
import NoteEditor from "./NoteEditor.js";
import NoteList from "./NoteList.js";
import NoteBook, { type PageTurn, type PageTurnDirection } from "./NoteBook.js";
import FeedbackStack from "./FeedbackStack.js";
import { noteSearchMatches } from "./noteSearch.js";
import { readWorkspaceView, writeWorkspaceView, type EditorView } from "./workspaceView.js";
import { hasNoteContent, NoteSaveQueue } from "./noteSaveQueue.js";
import { readyWindow, startDragging } from "./desktop.js";
import { usePureNoteSize } from "./usePureNoteSize.js";
import { randomUUID } from "../shared/id.js";
import type { NoteWindowContext } from "../shared/types.js";
import { appendAttachments, importAttachmentBatch } from "./attachmentImport.js";
import type { ImageInsertion } from "./attachmentImport.js";
import type { NoteEditorHandle } from "./InlineNoteContent.js";
import { contentWithAttachmentImages, noteContentBlocks, removeAttachmentImages } from "../shared/markdown.js";

const AiSettings = lazy(() => import("./AiSettings.js"));
const MarkdownPreview = lazy(() => import("./MarkdownPreview.js"));
const AiComparison = lazy(() => import("./AiComparison.js"));

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
type AppPreferences = { locale: Locale; themeOpacity: number; captureHintSeen: boolean; fontSize: number };

function readPreferences(): AppPreferences {
  const fallback: AppPreferences = { locale: "zh", themeOpacity: DEFAULT_THEME_OPACITY, captureHintSeen: false, fontSize: 13 };
  try {
    const value = JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) ?? "null") as Partial<AppPreferences> | null;
    return {
      locale: value?.locale === "en" ? "en" : "zh",
      themeOpacity: normalizeThemeOpacity(value?.themeOpacity) ?? fallback.themeOpacity,
      captureHintSeen: value?.captureHintSeen === true,
      fontSize: typeof value?.fontSize === "number" && Number.isInteger(value.fontSize) && value.fontSize >= 12 && value.fontSize <= 22 ? value.fontSize : fallback.fontSize,
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
  const [pureMode, setPureMode] = useState(isSingleNote && !!context.pure);
  const [changingPureMode, setChangingPureMode] = useState(false);
  const pureModeLock = useRef(false);
  const exitPureMode = useRef<() => void>(() => {});
  const shellRef = useRef<HTMLElement>(null);
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
  const navigationNotes = useMemo(() => draft?.archived ? [draft] : notes.filter((note) => !note.archived).sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite)), [notes, draft?.id, draft?.archived]);
  const isDelegated = !isSingleNote && !!draft && openNoteIds.includes(draft.id);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [toast, setToast] = useState<string | null>(null);
  const pureSizeError = useCallback(() => setToast(t("windowActionFailed", locale)), [locale]);
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
  const [deletedUndo, setDeletedUndo] = useState<{ note: Note; index: number; stored: boolean } | null>(null);
  const [attachmentUndo, setAttachmentUndo] = useState<{ original: Note; removed: Note } | null>(null);
  const [syncConfigs, setSyncConfigs] = useState<Partial<Record<SyncProviderId, SyncProviderConfig>>>({});
  const [editingProvider, setEditingProvider] = useState<SyncProviderId | null>(null);
  const [aiConfig, setAiConfig] = useState<AiConfig | null>(null);
  const [editingAi, setEditingAi] = useState(false);
  const [editingShortcuts, setEditingShortcuts] = useState(false);
  const [aiSettingsDraft, setAiSettingsDraft] = useState<{ baseUrl: string; model: string } | null>(null);
  const providerDraft = useRef<{ appId: string; collaboratorEmail: string; syncMode: FeishuSyncMode; targetDocumentUrl: string } | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [configLoadError, setConfigLoadError] = useState(false);
  const [configLoadAttempt, setConfigLoadAttempt] = useState(0);
  const [polishingId, setPolishingId] = useState<string | null>(null);
  const [runningAiOperation, setRunningAiOperation] = useState<AiOperation | null>(null);
  const [polishChanges, setPolishChanges] = useState<Record<string, PolishChange>>({});
  const [aiPreviews, setAiPreviews] = useState<Record<string, { operation: AiOperation; originalContent: string; content: string }>>({});
  const [showAiPreview, setShowAiPreview] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryEntries, setRecoveryEntries] = useState<import("../shared/types.js").RecoveryEntry[]>([]);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryError, setRecoveryError] = useState(false);
  const [polishChangeOperations, setPolishChangeOperations] = useState<Record<string, AiOperation>>({});
  const [polishFeedback, setPolishFeedback] = useState<{ noteId: string; key: MessageKey; operation: AiOperation; error?: boolean } | null>(null);
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const [noteFind, setNoteFind] = useState<{ noteId: string; query: string; index: number } | null>(null);
  const polishLock = useRef(false);
  const aiRequest = useRef<{ id: string; noteId: string; started: boolean; cancelled: boolean; interrupted: boolean } | null>(null);
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
  const [checkingFeishu, setCheckingFeishu] = useState(false);
  const [feishuCheck, setFeishuCheck] = useState<{ message: string; error: boolean } | null>(null);
  const feishuCheckGeneration = useRef(0);
  const [syncConflict, setSyncConflict] = useState<{ note: Note; provider: SyncProviderId; url: string; scope?: "chapter" } | null>(null);
  const draftRef = useRef(draft);
  const noteEditorRef = useRef<NoteEditorHandle>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const autosaveTimer = useRef<number | null>(null);
  const syncLock = useRef(false);
  const navigationLock = useRef(false);
  const pickingLock = useRef(false);
  const exitLock = useRef(false);
  const syncIdle = useRef<Promise<void>>(Promise.resolve());
  const importIdle = useRef<Promise<void>>(Promise.resolve());
  const initialViews = useMemo(() => new Map<string, EditorView>(Object.entries(readWorkspaceView(window.localStorage).views)), []);
  const editorViews = useRef(initialViews);
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
  const windowFocusRef = useRef(document.hasFocus());
  const [shortcutConfigs, setShortcutConfigs] = useState<ShortcutConfig[]>([]);
  const [recordingShortcut, setRecordingShortcut] = useState<ShortcutActionId | null>(null);
  const notesMenuPointerUp = useRef(false);

  function handleNotesMenuPointerUp(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (event.pointerType === "mouse" && event.button === 0) {
      notesMenuPointerUp.current = true;
      toggleMenu("notes");
    }
  }

  function handleNotesMenuClick(event: ReactMouseEvent<HTMLButtonElement>): void {
    if (notesMenuPointerUp.current && event.detail > 0) {
      notesMenuPointerUp.current = false;
      return;
    }
    notesMenuPointerUp.current = false;
    toggleMenu("notes");
  }

  function closeMenus(): void {
    setOpenMenu(null);
    setAiMenuOpen(false);
    setEditingProvider(null);
    setEditingAi(false);
    setEditingShortcuts(false);
    setAppSecret("");
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
    setEditingShortcuts(false);
    setRecordingShortcut(null);
  }

  function handlePopoverBlur(event: ReactFocusEvent<HTMLDivElement>): void {
    const nextTarget = event.relatedTarget;
    // Non-focusable clicks have no next target; outside clicks and window blur
    // handle dismissal. Menu triggers perform their own toggle after focus moves.
    if (nextTarget === null) return;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    if (nextTarget instanceof Element && nextTarget.closest("[data-menu-trigger]")) return;
    closeMenus();
  }

  function handleAiMenuBlur(event: ReactFocusEvent<HTMLDivElement>): void {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setAiMenuOpen(false);
  }

  useEffect(() => {
    const handleFocus = (): void => { windowFocusRef.current = true; setIsWindowFocused(true); };
    const handleBlur = (): void => { windowFocusRef.current = false; setIsWindowFocused(false); };
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  useEffect(() => {
    // A file released outside the editor must never navigate the WebView.
    const preventFileNavigation = (event: DragEvent): void => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      if (!event.defaultPrevented && event.type === "drop") setToast(t("dropOnNote", locale));
      if (!event.defaultPrevented && event.type === "dragover") event.dataTransfer.dropEffect = "none";
      event.preventDefault();
    };
    window.addEventListener("dragover", preventFileNavigation);
    window.addEventListener("drop", preventFileNavigation);
    return () => {
      window.removeEventListener("dragover", preventFileNavigation);
      window.removeEventListener("drop", preventFileNavigation);
    };
  }, [locale]);

  useEffect(() => {
    // Keep settings drafts open when switching apps to copy links or credentials.
    const handleWindowBlur = (): void => {
      // On macOS, activating an inactive transparent window can emit a short
      // blur/focus pair around the same native click. Do not erase a menu that
      // the click just opened unless the document is still unfocused.
      window.setTimeout(() => {
        if (windowFocusRef.current) return;
        if (aiRequest.current) aiRequest.current.interrupted = true;
        if (openMenu !== "settings") closeMenus();
      }, 0);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !event.isComposing && !event.defaultPrevented) {
        if (pureMode && !openMenu && !document.querySelector(".panel-backdrop")) {
          if (!event.repeat) exitPureMode.current();
          return;
        }
        closeMenus(); setNoteFind(null);
        if (pureMode) {
          if (editorMode === "preview") previewRef.current?.focus({ preventScroll: true });
          else noteEditorRef.current?.focus({ preventScroll: true });
        } else focusEditor();
      }
    };
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenu, pureMode, editorMode]);

  useEffect(() => {
    const panel = showHelp || showAiPreview || showRecovery ? document.querySelector<HTMLElement>(".panel-backdrop .detail-panel")
      : openMenu === "settings" && (editingAi || editingProvider || editingShortcuts) ? document.querySelector<HTMLElement>(".settings-detail-panel") : null;
    if (!panel) return;
    const previous = document.activeElement as HTMLElement | null;
    const background = [...document.querySelectorAll<HTMLElement>(".window-bar, .note-book, .feedback-stack")];
    for (const element of background) element.inert = true;
    const controls = () => [...panel.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex='0']")].filter((element) => !element.hidden);
    if (!panel.contains(document.activeElement)) controls()[0]?.focus();
    const trap = (event: KeyboardEvent): void => {
      if (event.key !== "Tab") return;
      const elements = controls();
      const index = elements.indexOf(document.activeElement as HTMLElement);
      if ((event.shiftKey && index <= 0) || (!event.shiftKey && (index < 0 || index === elements.length - 1))) {
        event.preventDefault(); (event.shiftKey ? elements.at(-1) : elements[0])?.focus();
      }
    };
    panel.addEventListener("keydown", trap);
    return () => { panel.removeEventListener("keydown", trap); for (const element of background) element.inert = false; if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [showHelp, showAiPreview, showRecovery, openMenu, editingAi, editingProvider, editingShortcuts]);

  const loadGeneration = useRef(0);
  async function loadNotes(): Promise<void> {
    const generation = ++loadGeneration.current;
    setLoadError(false);
    try {
      const storedNotes = await window.desktopTabs.listNotes();
      if (generation !== loadGeneration.current) return;
      const sorted = [...storedNotes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const lastActive = readWorkspaceView(window.localStorage).activeNoteId;
      const initialNote = (isSingleNote ? sorted.find((note) => note.id === context.noteId) : sorted.find((note) => note.id === lastActive && !note.archived) ?? sorted.find((note) => !note.archived)) ?? (isSingleNote ? null : createNote());
      if (!initialNote) throw new Error("NOTE_MISSING");
      // Carry the previous per-note setting forward once, then keep opacity global.
      if (!window.localStorage.getItem(PREFERENCES_KEY)) {
        const legacyOpacity = normalizeThemeOpacity(initialNote.themeOpacity);
        if (legacyOpacity !== undefined) updatePreferences({ themeOpacity: legacyOpacity });
      }
      saveQueue.seed(sorted);
      saveQueue.track(initialNote);
      setNotes(sorted.some((note) => note.id === initialNote.id) ? sorted : [initialNote, ...sorted]);
      replaceDraft(initialNote);
      setEditorMode(editorViews.current.get(initialNote.id)?.mode ?? "edit");
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
    let cancelled = false;
    if (!editingAi && !editingProvider) {
      void window.desktopTabs.listSyncConfigs().then((configs) => {
        if (!cancelled) setSyncConfigs(Object.fromEntries(configs.map((config) => [config.provider, config])));
      }).catch(() => { if (!cancelled) setToast(t("secureStorageUnavailable", locale)); });
      void window.desktopTabs.getAiConfig().then((config) => {
        if (!cancelled) setAiConfig(config);
      }).catch(() => { if (!cancelled) setToast(t("aiSecureUnavailable", locale)); });
      return () => { cancelled = true; };
    }
    setLoadingConfig(true);
    setConfigLoadError(false);
    const load = async () => {
      try {
        if (editingAi) {
          const config = await window.desktopTabs.getAiConfig(true);
          if (!cancelled) setAiConfig(config);
        } else if (editingProvider) {
          const configs = await window.desktopTabs.listSyncConfigs(true);
          if (cancelled) return;
          setSyncConfigs(Object.fromEntries(configs.map((config) => [config.provider, config])));
          const config = configs.find((config) => config.provider === editingProvider);
          setAppId(providerDraft.current?.appId ?? config?.appId ?? "");
          setAppSecret("");
          setCollaboratorEmail(providerDraft.current?.collaboratorEmail ?? config?.collaboratorEmail ?? "");
          setFeishuMode(providerDraft.current?.syncMode ?? config?.syncMode ?? "create");
          setTargetDocumentUrl(providerDraft.current?.targetDocumentUrl ?? config?.targetDocumentUrl ?? "");
        }
      } catch { if (!cancelled) setConfigLoadError(true); }
      finally { if (!cancelled) setLoadingConfig(false); }
    };
    void load();
    return () => { cancelled = true; };
  }, [editingAi, editingProvider, configLoadAttempt, locale]);

  useEffect(() => {
    if (editingProvider && !loadingConfig && !configLoadError) providerDraft.current = { appId, collaboratorEmail, syncMode: feishuMode, targetDocumentUrl };
    setFeishuCheck(null);
    feishuCheckGeneration.current++;
  }, [appId, appSecret, collaboratorEmail, feishuMode, targetDocumentUrl, editingProvider, loadingConfig, configLoadError]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!deletedUndo) return;
    const timer = window.setTimeout(() => setDeletedUndo(null), 8000);
    return () => window.clearTimeout(timer);
  }, [deletedUndo]);

  useEffect(() => {
    if (!attachmentUndo) return;
    const timer = window.setTimeout(() => setAttachmentUndo(null), 8000);
    return () => window.clearTimeout(timer);
  }, [attachmentUndo]);

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
    document.documentElement.style.setProperty("--note-font-size", `${preferences.fontSize}px`);
  }, [activeTheme, activeThemeOpacity, preferences.fontSize]);

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
  }, [draft?.id, draft?.content, draft?.theme, draft?.favorite, draft?.archived, attachmentSignature, loaded]);

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
    const previousId = draftRef.current?.id;
    draftRef.current = note;
    setDraft(note);
    if (note && note.id !== previousId && !isSingleNote) writeWorkspaceView(window.localStorage, note.id, undefined, true);
  }

  function updateDraft(patch: Partial<Note>): void {
    const current = draftRef.current;
    if (!current || exitLock.current || transferLock.current || closeLock.current || (!isSingleNote && openNoteIdsRef.current.includes(current.id))) return;
    if (aiRequest.current && patch.content !== undefined && patch.content !== current.content) aiRequest.current.interrupted = true;
    if (patch.content !== undefined && patch.content !== current.content) setNoteFind(null);
    if (patch.content !== undefined && patch.content !== current.content) clearAiChange(current.id);
    if (patch.content !== undefined || patch.attachments !== undefined) setAttachmentUndo(null);
    const next: Note = { ...current, ...patch, updatedAt: new Date().toISOString(),
      syncState: (patch.content !== undefined && patch.content !== current.content) || (patch.attachments !== undefined && patch.attachments !== current.attachments) ? "local" : current.syncState };
    saveQueue.track(next);
    replaceDraft(next);
  }

  function dismissAiFeedback(noteId: string): void {
    setPolishFeedback((current) => current?.noteId === noteId ? null : current);
  }

  function clearAiChange(noteId: string): void {
    dismissAiFeedback(noteId);
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
    if (note.id === draftRef.current?.id) { closeMenus(); focusEditor(); return; }
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
    if (isSingleNote || !current || navigationLock.current || pickingLock.current || exitLock.current || !window.confirm(t("deleteNamedConfirm", locale).replace("{title}", () => getNoteTitle(current.content) || t("untitled", locale)))) return;
    navigationLock.current = true;
    setIsNavigating(true);
    cancelAutosave();
    try {
      if (!await saveSnapshot()) return;
      const snapshot = saveQueue.read(current.id) ?? current;
      const index = notes.findIndex((note) => note.id === current.id);
      const stored = saveQueue.isStored(current.id);
      await saveQueue.remove(current.id, () => saveQueue.isStored(current.id) ? window.desktopTabs.deleteNote(current.id) : Promise.resolve());
      setFailedSaves((items) => { const next = new Set(items); next.delete(current.id); return next; });
      editorViews.current.delete(current.id);
      setPolishChanges((changes) => { const next = { ...changes }; delete next[current.id]; return next; });
      discardAiPreview(current.id);
      setAttachmentUndo(null);
      const remaining = notes.filter((note) => note.id !== current.id);
      const candidates = remaining.filter((note) => current.archived ? !!note.archived : !note.archived);
      if (!candidates.length && current.archived) candidates.push(...remaining.filter((note) => !note.archived));
      if (!candidates.length) { const blank = createNote(); saveQueue.track(blank); remaining.push(blank); candidates.push(blank); }
      setPageTurn(null);
      setNotes(remaining);
      const neighbor = candidates[Math.min(Math.max(0, navigationNotes.findIndex((note) => note.id === current.id)), candidates.length - 1)];
      const next = neighbor ? saveQueue.read(neighbor.id) ?? neighbor : null;
      replaceDraft(next);
      setEditorMode(next ? editorViews.current.get(next.id)?.mode ?? "edit" : "edit");
      closeMenus();
      setDeletedUndo({ note: snapshot, index, stored });
    } catch { setToast(t("deleteFailed", locale)); void saveSnapshot(); }
    finally { navigationLock.current = false; setIsNavigating(false); }
  }

  async function undoDelete(): Promise<void> {
    if (!deletedUndo || navigationLock.current || exitLock.current || transferLock.current) return;
    const undo = deletedUndo;
    navigationLock.current = true; setIsNavigating(true);
    try {
      if (!await saveSnapshot()) return;
      const note = undo.stored ? await window.desktopTabs.restoreNote(undo.note.id) : undo.note;
      rememberEditorView();
      if (undo.stored) saveQueue.restore(note); else saveQueue.track(note);
      setNotes((items) => { const next = items.filter((item) => item.id !== note.id && (saveQueue.isStored(item.id) || hasNoteContent(item))); next.splice(Math.min(undo.index, next.length), 0, note); return next; });
      replaceDraft(note); setEditorMode("edit"); setDeletedUndo(null); setToast(t("noteRestored", locale));
    } catch { setToast(t("restoreFailed", locale)); }
    finally { navigationLock.current = false; setIsNavigating(false); }
  }

  function removeAttachment(id: string): void {
    const current = draftRef.current;
    if (!current || exiting || transferring || isDelegated) return;
    const patch = { content: removeAttachmentImages(current.content, id), attachments: current.attachments.filter((item) => item.id !== id) };
    updateDraft(patch);
    setAttachmentUndo({ original: current, removed: { ...current, ...patch } });
  }

  async function undoAttachmentRemoval(): Promise<void> {
    const current = draftRef.current;
    if (!attachmentUndo || !current || exiting || transferring || isDelegated) return;
    const { original, removed } = attachmentUndo;
    if (current.id !== removed.id || current.content !== removed.content || current.attachments.map((item) => item.id).join() !== removed.attachments.map((item) => item.id).join()) return;
    updateDraft({ content: original.content, attachments: original.attachments });
    await saveSnapshot();
  }

  async function handleAttachments(load: (noteId: string) => Promise<{ attachments: NoteAttachment[]; failures?: number; error?: string }>, insertion?: ImageInsertion): Promise<void> {
    const noteId = draftRef.current?.id;
    if (!noteId || pickingLock.current || navigationLock.current || transferLock.current || closeLock.current || exitLock.current || (!isSingleNote && openNoteIdsRef.current.includes(noteId))) {
      setToast(t("attachmentImportUnavailable", locale)); return;
    }
    pickingLock.current = true;
    setPickingFiles(true);
    let finishImport!: () => void;
    importIdle.current = new Promise<void>((resolve) => { finishImport = resolve; });
    try {
      const result = await load(noteId);
      const current = saveQueue.read(noteId);
      const moveCaret = current && insertion && contentWithAttachmentImages(current.content, current.attachments) === insertion.content;
      const next = appendAttachments(current, result.attachments, insertion);
      if (next && result.attachments.length) {
        setAttachmentUndo(null);
        saveQueue.track(next);
        if (draftRef.current?.id === noteId) replaceDraft(next);
        setNotes((items) => items.map((item) => item.id === noteId ? next : item));
        if (!await saveNoteId(noteId)) return;
        if (moveCaret) {
          const imageId = result.attachments.filter((item) => item.mimeType.startsWith("image/")).at(-1)?.id;
          const blocks = noteContentBlocks(next.content, next.attachments);
          const lastImage = blocks.findIndex((block) => block.type === "image" && block.attachment.id === imageId);
          const after = blocks[lastImage + 1];
          if (lastImage >= 0 && after?.type === "text") window.requestAnimationFrame(() => {
            if (draftRef.current?.id !== noteId || draftRef.current.content !== next.content
              || !document.activeElement?.closest(".inline-note-content")) return;
            noteEditorRef.current?.setSelectionRange(after.start, after.start);
            noteEditorRef.current?.focus();
          });
        }
      }
      if (result.failures) {
        const key = result.error === "ATTACHMENT_TOO_LARGE" ? "attachmentTooLarge"
          : result.error === "ATTACHMENT_TOO_MANY" ? "attachmentTooMany"
          : result.error === "UNSUPPORTED_CLIPBOARD_IMAGE" ? "unsupportedClipboardImage" : "importFilesFailed";
        setToast(result.attachments.length ? t("attachmentPartialImport", locale).replace("{count}", String(result.failures)) : t(key, locale));
      } else if (result.attachments.length) {
        setToast(t(result.attachments.every((attachment) => attachment.mimeType.startsWith("image/")) ? "imagesInserted" : "attachmentsAdded", locale)
          .replace("{count}", String(result.attachments.length)));
      }
      closeMenus();
    } catch { setToast(t("importFilesFailed", locale)); }
    finally { pickingLock.current = false; setPickingFiles(false); finishImport(); }
  }

  async function handlePickFiles(): Promise<void> {
    await handleAttachments(async () => ({ attachments: await window.desktopTabs.pickFiles() }));
  }

  async function handleImportFiles(files: File[], imageOnly: boolean, insertion?: ImageInsertion): Promise<void> {
    await handleAttachments((noteId) => importAttachmentBatch(files,
      (file) => window.desktopTabs.importAttachment(noteId, file, imageOnly)), insertion);
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

  async function handleSync(provider: SyncProviderId, confirmed?: Note): Promise<void> {
    if (!isSingleNote && draftRef.current && openNoteIdsRef.current.includes(draftRef.current.id)) return;
    if (provider === "notion") {
      const noteId = draftRef.current?.id;
      if (noteId) setSyncFeedback({ noteId, message: t("notionUnavailable", locale) });
      return;
    }
    if (!draftRef.current || syncLock.current || exitLock.current) return;
    let snapshot = confirmed ?? draftRef.current;
    if (confirmed && noteSyncHash(draftRef.current) !== noteSyncHash(confirmed)) { setToast(t("syncConflictNewEdits", locale)); setSyncConflict(null); return; }
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
      if (confirmed && noteSyncHash(latest) !== noteSyncHash(confirmed)) { setToast(t("syncConflictNewEdits", locale)); return; }
      snapshot = latest;
      const result = await window.desktopTabs.syncNote(snapshot, provider, confirmed ? { overwriteRemote: true } : undefined);
      if (result.note && saveQueue.read(result.note.id)) saveQueue.acceptStored(result.note);
      if (result.status === "synced") {
        const warnings = (result.warnings ?? []).map(() => t("syncImagesAsLinks", locale));
        const message = result.note?.syncState === "local" || (draftRef.current?.id === snapshot.id && draftRef.current.content !== snapshot.content)
          ? t("syncNewerChanges", locale) : `${t("syncSuccess", locale)} ${providerLabels[provider]}`;
        setSyncFeedback({ noteId: snapshot.id, message: [message, ...warnings].join(" "), url: result.remoteUrl });
      } else if (result.status === "conflict") {
        setSyncConflict({ note: snapshot, provider, url: result.remoteUrl, scope: result.scope });
        setSyncFeedback({ noteId: snapshot.id, message: t("syncConflictNeedsReview", locale), url: result.remoteUrl, error: true });
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

  async function checkFeishu(): Promise<void> {
    if (checkingFeishu) return;
    setCheckingFeishu(true); setFeishuCheck(null);
    const generation = feishuCheckGeneration.current;
    try {
      const result = await window.desktopTabs.checkFeishuConnection();
      if (generation !== feishuCheckGeneration.current) return;
      setFeishuCheck(result.status === "connected" ? { message: t(result.scope === "target" ? "feishuTargetChecked" : "feishuAuthChecked", locale).replace("{ms}", String(result.latencyMs)), error: false }
        : { message: t(syncErrorMessages[result.message] ?? (result.message === "not-configured" ? "syncNotConfigured" : "syncError"), locale), error: true });
    } catch { setFeishuCheck({ message: t("secureStorageUnavailable", locale), error: true }); }
    finally { setCheckingFeishu(false); }
  }

  function openAiConfig(): void {
    if (isSingleNote) { void window.desktopTabs.openMainWindow(true).catch(() => setToast(t("windowActionFailed", locale))); return; }
    setLoadingConfig(true);
    setConfigLoadError(false);
    setConfigLoadAttempt((attempt) => attempt + 1);
    setEditingProvider(null);
    setEditingAi(true);
    setOpenMenu("settings");
  }

  async function handleAiOperation(operation: AiOperation): Promise<void> {
    const current = draftRef.current;
    if (!current || polishLock.current || exitLock.current || (!isSingleNote && openNoteIdsRef.current.includes(current.id))) return;
    if (!current.content.trim()) { setToast(t("aiEmpty", locale)); return; }
    const noteId = current.id;
    const request = { id: randomUUID(), noteId, started: false, cancelled: false, interrupted: false };
    aiRequest.current = request;
    polishLock.current = true;
    setPolishingId(noteId);
    setRunningAiOperation(operation);
    setPolishFeedback(null);
    setAiMenuOpen(false);
    let finishPolish!: () => void;
    polishIdle.current = new Promise<void>((resolve) => { finishPolish = resolve; });
    try {
      if (!await saveNoteId(noteId)) return;
      if (request.cancelled) return;
      request.started = true;
      const result = operation === "polish"
        ? await window.desktopTabs.polishNote(noteId, request.id)
        : await window.desktopTabs.aiNote(noteId, operation, request.id);
      if (request.cancelled || result.status === "cancelled") return;
      if (result.status === "not-configured") {
        setPolishFeedback({ noteId, operation, key: "aiNotConfigured", error: true });
        openAiConfig();
      } else if (result.status === "error") {
        setPolishFeedback({ noteId, operation, key: result.message === "note-missing" && operation !== "polish" ? "aiTransformMissing" : aiErrorMessages[result.message] ?? "aiError", error: true });
      } else {
        if (result.content !== result.originalContent && saveQueue.read(noteId)) {
          setAiPreviews((previews) => ({ ...previews, [noteId]: { operation, originalContent: result.originalContent, content: result.content } }));
          if (draftRef.current?.id === noteId && !request.interrupted && windowFocusRef.current) setShowAiPreview(true);
          setPolishFeedback({ noteId, operation, key: "aiPreviewReady" });
        } else await applyAiResult(noteId, result.originalContent, result.content, operation);
      }
    } catch (error) {
      if (!request.cancelled) setPolishFeedback({ noteId, operation, key: error === "AI_CONFIG_UNAVAILABLE" ? "aiSecureUnavailable" : "aiError", error: true });
    } finally { aiRequest.current = null; polishLock.current = false; setPolishingId(null); setRunningAiOperation(null); finishPolish(); }
  }

  async function cancelAi(): Promise<void> {
    const request = aiRequest.current;
    if (!request || request.cancelled) return;
    request.cancelled = true;
    setPolishFeedback(null);
    setToast(t("aiCancelled", locale));
    if (request.started) {
      try { if (!await window.desktopTabs.cancelAiNote(request.noteId, request.id) && aiRequest.current === request) setToast(t("aiCancelFailed", locale)); }
      catch { setToast(t("aiCancelFailed", locale)); }
    }
  }

  async function handlePolish(): Promise<void> {
    await handleAiOperation("polish");
  }

  async function applyAiResult(noteId: string, originalContent: string, content: string, operation: AiOperation): Promise<boolean> {
    let applied = applyPolish(saveQueue.read(noteId), originalContent, content);
    if (applied.status !== "applied") {
      setPolishFeedback({ noteId, operation, key: applied.status === "changed" ? (operation === "polish" ? "aiPolishChanged" : "aiTransformChanged")
        : applied.status === "missing" ? (operation === "polish" ? "aiPolishMissing" : "aiTransformMissing") : aiOperationMeta[operation].unchangedKey, error: applied.status !== "unchanged" });
      return false;
    }
    try {
      if (!await saveNoteId(noteId)) return false;
      await window.desktopTabs.snapshotAiNote(noteId, originalContent);
    } catch {
      setPolishFeedback({ noteId, operation, key: saveQueue.read(noteId)?.content !== originalContent ? "aiPreviewChanged" : "aiSnapshotFailed", error: true });
      return false;
    }
    applied = applyPolish(saveQueue.read(noteId), originalContent, content);
    if (applied.status !== "applied") { setPolishFeedback({ noteId, operation, key: "aiPreviewChanged", error: true }); return false; }
    saveQueue.track(applied.note);
    setAttachmentUndo(null);
    if (draftRef.current?.id === noteId) replaceDraft(applied.note);
    setNotes((items) => items.map((item) => item.id === noteId ? applied.note : item));
    setPolishChanges((changes) => ({ ...changes, [noteId]: applied.change }));
    setPolishChangeOperations((operations) => ({ ...operations, [noteId]: operation }));
    const saved = await saveNoteId(noteId);
    if (saveQueue.read(noteId)?.content === applied.note.content) setPolishFeedback({ noteId, operation, key: saved ? aiOperationMeta[operation].successKey : "aiTransformUnsaved", error: !saved });
    return true;
  }

  function discardAiPreview(noteId: string): void {
    setAiPreviews((previews) => { const next = { ...previews }; delete next[noteId]; return next; });
    setShowAiPreview(false);
  }

  async function replaceWithAiPreview(): Promise<void> {
    const current = draftRef.current;
    if (!current || polishLock.current || exitLock.current || transferLock.current || navigationLock.current || isDelegated) return;
    const preview = aiPreviews[current.id];
    navigationLock.current = true; setIsNavigating(true);
    try { if (preview && await applyAiResult(current.id, preview.originalContent, preview.content, preview.operation)) discardAiPreview(current.id); }
    finally { navigationLock.current = false; setIsNavigating(false); }
  }

  async function openRecovery(): Promise<void> {
    closeMenus(); setShowRecovery(true); setRecoveryLoading(true); setRecoveryError(false);
    try { setRecoveryEntries(await window.desktopTabs.listRecovery()); }
    catch { setRecoveryError(true); }
    finally { setRecoveryLoading(false); }
  }

  async function restoreRecovery(entryId: string): Promise<void> {
    if (recoveryLoading || navigationLock.current || exiting) return;
    setRecoveryLoading(true); setRecoveryError(false);
    navigationLock.current = true; setIsNavigating(true);
    try {
      await saveQueue.flush();
      const note = await window.desktopTabs.restoreRecovery(entryId);
      rememberEditorView(); saveQueue.restore(note);
      setNotes((items) => [note, ...items.filter((item) => item.id !== note.id)]);
      clearAiChange(note.id); discardAiPreview(note.id); replaceDraft(note); setEditorMode("edit");
      setShowRecovery(false); setToast(t("recoveryRestored", locale));
    } catch { setRecoveryError(true); }
    finally { setRecoveryLoading(false); navigationLock.current = false; setIsNavigating(false); }
  }

  async function saveAiPreviewAsNote(): Promise<void> {
    const current = draftRef.current;
    if (!current || navigationLock.current || exitLock.current || transferLock.current) return;
    const preview = aiPreviews[current.id] ?? (polishChanges[current.id] ? { content: polishChanges[current.id].polishedContent } : undefined);
    if (!preview) return;
    navigationLock.current = true; setIsNavigating(true);
    try {
      if (!await saveSnapshot()) return;
      const note = await window.desktopTabs.createNoteCopy(current.id, preview.content);
      discardAiPreview(current.id);
      dismissAiFeedback(current.id);
      if (isSingleNote) await window.desktopTabs.openMainWindow();
      else {
        rememberEditorView(); saveQueue.acceptExternal(note);
        replaceDraft(note); setEditorMode("edit"); closeMenus();
      }
      setToast(t("aiCopySaved", locale));
    } catch { setToast(t("saveFailed", locale)); }
    finally { navigationLock.current = false; setIsNavigating(false); }
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
    setLoadingConfig(true);
    setConfigLoadError(false);
    setConfigLoadAttempt((attempt) => attempt + 1);
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
      providerDraft.current = null;
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
      providerDraft.current = null;
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

  function configuredShortcut(action: ShortcutActionId): string | undefined {
    const shortcut = shortcutConfigs.find((config) => config.action === action);
    return shortcut ? displayShortcut(shortcut.accelerator) : undefined;
  }

  function shortcutTitle(label: string, action: ShortcutActionId): string {
    const shortcut = configuredShortcut(action);
    return shortcut ? t("shortcutTip", locale).replace("{shortcut}", () => shortcut).replace("{action}", () => label) : label;
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
    if (!draft || navigationNotes.length < 2) return;
    const index = navigationNotes.findIndex((note) => note.id === draft.id);
    const nextIndex = (index + offset + navigationNotes.length) % navigationNotes.length;
    void selectNote(navigationNotes[nextIndex], offset < 0 ? "previous" : "next");
  }

  async function toggleFavorite(): Promise<void> {
    if (!draft || isDelegated || navigationLock.current || exiting) return;
    updateDraft({ favorite: !draft.favorite });
    if (await saveSnapshot()) setToast(t(draft.favorite ? "favoriteRemoved" : "favoriteAdded", locale));
  }

  async function toggleArchive(): Promise<void> {
    const current = draftRef.current;
    if (!current || isSingleNote || isDelegated || navigationLock.current || exiting) return;
    navigationLock.current = true; setIsNavigating(true);
    try {
      updateDraft({ archived: !current.archived });
      if (!await saveSnapshot()) return;
      if (!current.archived) {
        rememberEditorView();
        const next = notes.find((note) => note.id !== current.id && !note.archived) ?? createNote();
        saveQueue.track(next); replaceDraft(next);
        setNotes((items) => items.some((note) => note.id === next.id) ? items : [next, ...items]);
        setEditorMode(editorViews.current.get(next.id)?.mode ?? "edit");
      }
      closeMenus(); setToast(t(current.archived ? "noteUnarchived" : "noteArchived", locale));
    } finally { navigationLock.current = false; setIsNavigating(false); }
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
      previewScroll: (pureMode ? shellRef.current?.querySelector(".note-book")?.scrollTop : previewRef.current?.scrollTop) ?? previous?.previewScroll ?? 0, mode: editorMode,
    });
    writeWorkspaceView(window.localStorage, current.id, editorViews.current.get(current.id), !isSingleNote);
  }

  const viewTimer = useRef<number | null>(null);
  const rememberViewRef = useRef(rememberEditorView);
  rememberViewRef.current = rememberEditorView;
  useEffect(() => {
    const save = (event: Event): void => {
      const target = event.type === "selectionchange" ? document.activeElement : event.target;
      if (!(target instanceof HTMLElement) || !target.closest(".note-book")) return;
      if (viewTimer.current !== null) window.clearTimeout(viewTimer.current);
      viewTimer.current = window.setTimeout(() => rememberViewRef.current(), 150);
    };
    const flush = (): void => rememberViewRef.current();
    document.addEventListener("selectionchange", save);
    document.addEventListener("scroll", save, true);
    window.addEventListener("blur", flush);
    window.addEventListener("pagehide", flush);
    return () => { document.removeEventListener("selectionchange", save); document.removeEventListener("scroll", save, true); window.removeEventListener("blur", flush); window.removeEventListener("pagehide", flush); if (viewTimer.current !== null) window.clearTimeout(viewTimer.current); };
  }, []);

  function toggleEditorMode(): void {
    if (!draftRef.current || exitLock.current || transferLock.current || closeLock.current || navigationLock.current || isDelegated) return;
    rememberEditorView();
    setEditorMode((current) => current === "edit" ? "preview" : "edit");
  }

  async function togglePureMode(): Promise<void> {
    if (!isSingleNote || !loaded || pureModeLock.current || exiting || transferring || showHelp || showAiPreview) return;
    pureModeLock.current = true;
    setChangingPureMode(true);
    rememberEditorView();
    closeMenus();
    try {
      await window.desktopTabs.setNotePureMode(!pureMode);
      setPureMode(!pureMode);
    } catch { setToast(t("windowActionFailed", locale)); }
    finally { pureModeLock.current = false; setChangingPureMode(false); }
  }
  exitPureMode.current = () => { void togglePureMode(); };

  function handleEditorModeKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
    const mac = navigator.platform.toLowerCase().includes("mac");
    const modifier = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    if (modifier && event.key === "," && !event.altKey && !event.shiftKey && !event.nativeEvent.isComposing && !event.repeat && !recordingShortcut && !showHelp && !showAiPreview && !showRecovery && !exiting) {
      event.preventDefault(); toggleMenu("settings"); return;
    }
    if (!modifier || event.key.toLowerCase() !== "e" || event.altKey || event.shiftKey || event.repeat || event.nativeEvent.isComposing || event.defaultPrevented) return;
    if (!draft || exiting || transferring || isNavigating || isDelegated || openMenu || aiMenuOpen || recordingShortcut || showHelp || showAiPreview || showRecovery) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, select"))) return;
    event.preventDefault();
    toggleEditorMode();
  }

  useLayoutEffect(() => {
    if (!draft) return;
    const view = editorViews.current.get(draft.id);
    const editor = noteEditorRef.current;
    if (editorMode === "edit" && !isDelegated && editor) {
      if (view) { editor.setSelectionRange(view.start, view.end); editor.scrollTop = view.scroll; }
      editor.focus({ preventScroll: true });
    } else if (previewRef.current) {
      const scroller = pureMode ? shellRef.current?.querySelector(".note-book") : previewRef.current;
      if (scroller) scroller.scrollTop = view?.previewScroll ?? 0;
      previewRef.current.focus({ preventScroll: true });
    }
  }, [draft?.id, editorMode, isDelegated, pureMode]);

  const shortcutHandler = useRef<(action: ShortcutActionId) => void>(() => {});
  shortcutHandler.current = (action) => {
    if (recordingShortcut || exitLock.current) return;
    if (action === "toggleWindow") {
      if (openMenu === "settings") return;
      if (editorMode === "preview" || isDelegated) previewRef.current?.focus({ preventScroll: true });
      else noteEditorRef.current?.focus({ preventScroll: true });
    }
    if (action === "newNote") void handleNewNote();
    if (action === "previousNote") selectRelativeNote(-1);
    if (action === "nextNote") selectRelativeNote(1);
  };
  useEffect(() => window.desktopTabs.onShortcutAction((action) => shortcutHandler.current(action)), []);

  const selectHandler = useRef(selectNote);
  selectHandler.current = selectNote;
  const selectFromList = useCallback((note: Note, query: string) => { void (async () => {
    await selectHandler.current(note);
    if (draftRef.current?.id === note.id && query) { setEditorMode("edit"); setNoteFind({ noteId: note.id, query, index: 0 }); }
  })(); }, []);
  const activeFind = draft && noteFind?.noteId === draft.id ? noteFind : null;
  const findMatches = useMemo(() => activeFind && draft ? noteSearchMatches(contentWithAttachmentImages(draft.content, draft.attachments), activeFind.query) : [], [activeFind, draft?.content, attachmentSignature]);
  useLayoutEffect(() => {
    if (!activeFind || !draft) return;
    const match = findMatches[activeFind.index % Math.max(1, findMatches.length)];
    if (match) noteEditorRef.current?.revealRange(match.start, match.end);
    else {
      const file = draft.attachments.find((item) => noteSearchMatches(item.name, activeFind.query).length);
      const element = [...document.querySelectorAll<HTMLElement>("[data-attachment-id]")].find((node) => node.dataset.attachmentId === file?.id);
      element?.scrollIntoView({ block: "nearest" }); element?.querySelector("button")?.focus({ preventScroll: true });
    }
  }, [activeFind, findMatches, draft?.id]);

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
        for (const note of await window.desktopTabs.listNotes(released)) {
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
      if (note) void (async () => {
        await selectHandler.current(note);
        if (draftRef.current?.id === id) focusEditor();
      })();
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
    rememberEditorView();
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
  const activeAiPreview = draft ? aiPreviews[draft.id] ?? (activePolishChange ? {
    operation: polishChangeOperations[draft.id] ?? "polish", originalContent: activePolishChange.originalContent, content: activePolishChange.polishedContent,
  } : undefined) : undefined;
  const aiPreviewApplied = !!draft && !aiPreviews[draft.id] && canUndoPolish;
  const remoteDocumentUrl = activeSyncFeedback?.url ?? draft?.feishu?.url;
  const syncStatusKey: MessageKey = syncingId === draft?.id ? "syncing" : activeSyncFeedback?.error || draft?.syncState === "error" ? "syncStatusError"
    : draft?.syncState === "synced" ? "syncStatusSynced" : draft?.feishu?.syncedAt ? "syncStatusChanged" : "syncStatusLocal";
  const activeNoteIndex = navigationNotes.findIndex((note) => note.id === draft?.id);
  const previousNote = activeNoteIndex >= 0 && navigationNotes.length > 1 ? navigationNotes[(activeNoteIndex - 1 + navigationNotes.length) % navigationNotes.length] : undefined;
  const nextNote = activeNoteIndex >= 0 && navigationNotes.length > 1 ? navigationNotes[(activeNoteIndex + 1) % navigationNotes.length] : undefined;
  usePureNoteSize(shellRef, pureMode && loaded, pureSizeError, openMenu || showHelp || showAiPreview ? 320 : 72);

  const editorActions = useRef({ updateDraft, openLink, handleOpenAttachment, removeAttachment, handleImportFiles, locale, pureMode });
  editorActions.current = { updateDraft, openLink, handleOpenAttachment, removeAttachment, handleImportFiles, locale, pureMode };
  const changeContent = useCallback((content: string) => editorActions.current.updateDraft({ content }), []);
  const openEditorLink = useCallback((url: string) => { void editorActions.current.openLink(url); }, []);
  const openEditorAttachment = useCallback((attachment: NoteAttachment) => { void editorActions.current.handleOpenAttachment(attachment); }, []);
  const removeEditorAttachment = useCallback((id: string) => editorActions.current.removeAttachment(id), []);
  const importEditorFiles = useCallback((files: File[], imageOnly: boolean, insertion?: ImageInsertion) => { void editorActions.current.handleImportFiles(files, imageOnly, insertion); }, []);
  const previewReady = useCallback(() => {
    const note = draftRef.current;
    const preview = previewRef.current;
    if (!note || !preview) return;
    const scroller = editorActions.current.pureMode ? shellRef.current?.querySelector(".note-book") : preview;
    if (scroller) scroller.scrollTop = editorViews.current.get(note.id)?.previewScroll ?? 0;
    preview.focus({ preventScroll: true });
  }, []);
  const rejectEditorImport = useCallback((directory: boolean) => setToast(t(directory ? "attachmentDirectoryUnsupported" : "attachmentImportUnavailable", editorActions.current.locale)), []);

  return (
    <main ref={shellRef} onPointerDownCapture={() => { if (aiRequest.current) aiRequest.current.interrupted = true; }} onKeyDownCapture={() => { if (aiRequest.current) aiRequest.current.interrupted = true; }} className={`app-shell note-window${pureMode ? " pure-mode" : ""}`} data-window-focused={isWindowFocused} onKeyDown={handleEditorModeKeyDown} onClick={() => openMenu && closeMenus()}
      onContextMenu={(event) => { if (pureMode && !(event.target as HTMLElement).closest(".popover, .panel-backdrop")) { event.preventDefault(); toggleMenu("actions"); } }}>
      {!pureMode && <header className="window-bar">
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
          {!isSingleNote && <button className="window-tool" disabled={!loaded || isNavigating || exiting || transferring} aria-label={t("quickCapture", locale)} title={shortcutTitle(t("quickCapture", locale), "newNote")} onClick={() => void handleNewNote()}><Plus size={14} /></button>}
          <button className="window-tool editor-mode-switch" role="switch" aria-label={t("togglePreview", locale)} aria-keyshortcuts={navigator.platform.toLowerCase().includes("mac") ? "Meta+E" : "Control+E"} aria-checked={editorMode === "preview"} disabled={!draft || exiting || isDelegated || transferring || isNavigating} title={t(editorMode === "edit" ? "switchToPreview" : "switchToEdit", locale).replace("{shortcut}", displayShortcut("CommandOrControl+E"))} onClick={toggleEditorMode}><Eye size={14} /></button>
          {!isSingleNote && <button className="window-tool" data-menu-trigger="notes" disabled={!loaded || exiting} aria-label={t("viewNotes", locale)} title={t("viewNotes", locale)} aria-expanded={openMenu === "notes"} onPointerUp={handleNotesMenuPointerUp} onPointerCancel={() => { notesMenuPointerUp.current = false; }} onClick={handleNotesMenuClick}><Layers3 size={14} /></button>}
          <button className={`window-tool pinned-badge ${isPinned ? "active" : ""}`} aria-pressed={isPinned} aria-label={t(isPinned ? "unpinWindow" : "pinWindow", locale)} title={isPinned ? `${t("pinned", locale)} · ${t("unpinWindow", locale)}` : t("pinWindow", locale)} onClick={() => void handleTogglePin()}><Pin size={14} /></button>
          <button className="window-tool" data-menu-trigger="actions" aria-label={t("moreActions", locale)} title={t("moreActions", locale)} onClick={() => toggleMenu("actions")}><MoreHorizontal size={16} /></button>
          <button className="window-tool minimize" disabled={exiting} aria-label={t("minimize", locale)} title={t("minimize", locale)} onClick={() => void hideWindow(true)}><Minus size={14} /></button>
          <button className="window-tool close" disabled={exiting} aria-label={t(isSingleNote ? "closeNoteWindow" : "hideMainWindow", locale)} title={isSingleNote ? t("closeNoteWindow", locale) : shortcutTitle(t("hideMainWindow", locale), "toggleWindow")} onClick={() => void hideWindow()}><X size={14} /></button>
        </div>
      </header>}

      {pureMode && <div className="pure-drag-edge" aria-hidden="true" onMouseDown={(event) => { if (event.button === 0) void startDragging().catch(pureSizeError); }} />}

      <section className="note-surface" onClick={(event) => {
        event.stopPropagation();
        if (!(event.target as HTMLElement).closest(".popover, button")) closeMenus();
      }}>
        <NoteBook previousNote={isSingleNote ? undefined : previousNote} nextNote={isSingleNote ? undefined : nextNote} currentIndex={isSingleNote ? 0 : activeNoteIndex} total={isSingleNote ? 1 : navigationNotes.length}
          locale={locale} busy={isNavigating || exiting} turn={pageTurn} onTurnEnd={finishPageTurn}
          previousShortcut={configuredShortcut("previousNote")} nextShortcut={configuredShortcut("nextNote")}
          onPrevious={() => selectRelativeNote(-1)} onNext={() => selectRelativeNote(1)} onShowNotes={() => toggleMenu("notes")}>
        <div className="note-editor">
          {activeFind && <div className="note-find-bar" role="search"><span>{findMatches.length ? `${activeFind.index % findMatches.length + 1} / ${findMatches.length}` : t("attachmentMatch", locale)}</span>
            <button disabled={findMatches.length < 2} aria-label={t("previousMatch", locale)} onClick={() => setNoteFind({ ...activeFind, index: (activeFind.index - 1 + findMatches.length) % findMatches.length })}>↑</button>
            <button disabled={findMatches.length < 2} aria-label={t("nextMatch", locale)} onClick={() => setNoteFind({ ...activeFind, index: (activeFind.index + 1) % findMatches.length })}>↓</button>
            <button aria-label={t("closeSearch", locale)} onClick={() => { setNoteFind(null); noteEditorRef.current?.focus(); }}><X size={12} /></button></div>}
          {draft ? <NoteEditor note={draft} preview={!activeFind && (editorMode === "preview" || isDelegated)} readOnly={exiting || transferring || isDelegated}
            autoSize={pureMode} textSize={preferences.fontSize}
            importDisabled={isNavigating || openMenu === "settings"}
            importing={pickingFiles} onImportFiles={importEditorFiles}
            onImportRejected={rejectEditorImport}
            locale={locale} editorRef={noteEditorRef} previewRef={previewRef} onChange={changeContent}
            onOpenLink={openEditorLink} onOpenAttachment={openEditorAttachment}
            onRemoveAttachment={removeEditorAttachment} onPreviewReady={previewReady} /> : <div className="empty-note"><Sparkles size={21} /><span>{t(!loaded ? loadError ? "loadFailed" : "loadingNotes" : "emptyTitle", locale)}</span>
            {loadError ? <button className="inline-new-button" onClick={() => void loadNotes()}>{t("retryLoad", locale)}</button>
              : loaded && <button className="inline-new-button" title={shortcutTitle(t("startWriting", locale), "newNote")} onClick={() => void handleNewNote()}>{t("startWriting", locale)}</button>}</div>}
        </div>

        {!pureMode && <footer className="note-footer" data-ai-menu-open={aiMenuOpen} onClick={(event) => event.stopPropagation()}>
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
              <button className="hover-tool" data-menu-trigger="settings" aria-label={t("settings", locale)} title={t("settings", locale)} aria-expanded={openMenu === "settings"} onClick={() => toggleMenu("settings")}><Settings2 size={15} /></button>
            </div>
          </div>
          {draft && (draft.feishu?.syncedAt || draft.syncState === "error" || syncingId === draft.id || activeSyncFeedback?.error) && <span className="persistent-sync-status" role="status">{syncingId === draft.id && <LoaderCircle size={11} className="spin" />}{t(syncStatusKey, locale)}</span>}
        </footer>}
        </NoteBook>

        <FeedbackStack locale={locale}>
          {!preferences.captureHintSeen && loaded && !isSingleNote && <div data-priority={0} className="sync-feedback capture-hint" role="status"><span>{t("captureHint", locale)}</span><button className="dismiss-feedback" aria-label={t("dismissMessage", locale)} onClick={() => updatePreferences({ captureHintSeen: true })}><X size={12} /></button></div>}
          {deletedUndo && <div data-priority={70} className="sync-feedback" role="status"><span>{t("deletedNoteUndo", locale).replace("{title}", () => getNoteTitle(deletedUndo.note.content) || t("untitled", locale))}</span><button disabled={isNavigating || exiting || transferring} onClick={() => void undoDelete()}>{t("undoDelete", locale)}</button></div>}
          {attachmentUndo && attachmentUndo.removed.id === draft?.id && <div data-priority={70} className="sync-feedback" role="status"><span>{t("attachmentRemoved", locale)}</span><button disabled={exiting || isDelegated || transferring} onClick={() => void undoAttachmentRemoval()}>{t("undoRemove", locale)}</button></div>}
          {isDelegated && draft && <div data-priority={20} className="sync-feedback independent-feedback" role="status"><span>{t("independentNote", locale)}</span><button onClick={() => void handleOpenNoteWindow(draft.id)}>{t("focusNoteWindow", locale)}</button></div>}
          {polishingId === draft?.id && <div data-priority={50} className="sync-feedback" role="status">{t(runningAiOperation ? aiOperationMeta[runningAiOperation].processingKey : "aiPolishing", locale)}<button onClick={() => void cancelAi()}>{t("cancelAi", locale)}</button></div>}
          {syncingId === draft?.id && <div data-priority={50} className="sync-feedback" role="status">{t("syncing", locale)}</div>}
          {activePolishFeedback && <div data-priority={activePolishFeedback.error ? 80 : 40} className={`sync-feedback ai-feedback ${activePolishFeedback.error ? "error" : ""}`} role="status">
            <div className="ai-feedback-row"><span className="ai-feedback-message">{t(activePolishFeedback.key, locale)}</span>
              <div className="ai-feedback-controls">
                {canUndoPolish && <button className="undo-polish" disabled={!!polishingId || exiting || isDelegated || transferring} onClick={() => void handleUndoPolish()}>{t(activeAiOperation === "polish" ? "aiUndo" : "aiUndoTransform", locale)}</button>}
                <button className="dismiss-feedback" aria-label={t("dismissMessage", locale)} onClick={() => dismissAiFeedback(activePolishFeedback.noteId)}><X size={12} /></button>
              </div>
            </div>
            {(activePolishFeedback.error || activePolishFeedback.key === activeAiMeta.unchangedKey) && <button className="retry-sync" disabled={!!polishingId || exiting || isDelegated || transferring} onClick={() => void handleAiOperation(activeAiOperation)}>{t(activeAiOperation === "polish" ? "aiRetry" : "aiRetryTransform", locale)}</button>}
            {["aiPolishUnchanged", "aiAuthError", "aiEndpointError"].includes(activePolishFeedback.key) && <button className="ai-feedback-settings" disabled={exiting} onClick={openAiConfig}>{t("aiModelSettings", locale)}</button>}
            {activeAiPreview && <button onClick={() => setShowAiPreview(true)}>{t("aiViewResult", locale)}</button>}
          </div>}
          {exiting && <div className="sync-feedback" role="status">{t("finishingExit", locale)}</div>}
          {(saveState === "error" || failedSaves.size > 0) && <div data-priority={100} className="sync-feedback error" role="alert"><span>{t("saveFailed", locale)}</span>
            <button className="retry-save" disabled={saveState === "saving" || exiting} onClick={() => void retrySave()}>{t("retrySave", locale)}</button></div>}
          {activeSyncFeedback && <div data-priority={activeSyncFeedback.error ? 90 : 30} className={`sync-feedback ${activeSyncFeedback.error ? "error" : ""}`} role="status"><span>{activeSyncFeedback.message}</span>
            {syncConflict && syncConflict.note.id === draft?.id && <div className="sync-conflict-actions"><button onClick={() => void openLink(syncConflict.url)}>{t("reviewRemote", locale)}</button><button disabled={!!syncingId || exiting || isDelegated || transferring} onClick={() => { const conflict = syncConflict; setSyncConflict(null); void handleSync(conflict.provider, conflict.note); }}>{t("overwriteRemote", locale)}</button><button onClick={() => { setSyncConflict(null); setSyncFeedback({ noteId: draft!.id, message: t("syncConflictCancelled", locale), url: syncConflict.url }); }}>{t("keepRemote", locale)}</button></div>}
            {activeSyncFeedback.error && syncConflict?.note.id !== draft?.id && <button className="retry-sync" disabled={!!syncingId || exiting || isDelegated || transferring} onClick={() => void handleSync("feishu")}>{t("retrySync", locale)}</button>}
            <button className="dismiss-feedback" aria-label={t("dismissMessage", locale)} onClick={() => setSyncFeedback(null)}><X size={12} /></button></div>}
        </FeedbackStack>

        {openMenu === "notes" && <div className="popover notes-popover" onBlur={handlePopoverBlur}><NoteList notes={notes} activeNote={draft} locale={locale} newNoteTip={shortcutTitle(t("newNote", locale), "newNote")} onSelect={selectFromList} onNew={() => void handleNewNote()} onOpen={(id) => void handleOpenNoteWindow(id)} openNoteIds={openNoteIds} onClose={() => { closeMenus(); focusEditor(); }} /></div>}
        {openMenu === "actions" && <div className="popover actions-popover" onBlur={handlePopoverBlur}>
          {isSingleNote && <button disabled={!loaded || changingPureMode || exiting || transferring} onClick={() => void togglePureMode()}><Expand size={14} />{t(pureMode ? "exitPureMode" : "enterPureMode", locale)}</button>}
          {pureMode && <button onClick={() => { closeMenus(); toggleEditorMode(); }}><Eye size={14} />{t("togglePreview", locale)}</button>}
          {pureMode && <button disabled={exiting} onClick={() => void hideWindow()}><X size={14} />{t("closeNoteWindow", locale)}</button>}
          {!isSingleNote && <>
            <button disabled={!loaded || isNavigating || exiting || transferring} title={shortcutTitle(t("newNote", locale), "newNote")} onClick={() => void handleNewNote()}><CirclePlus size={14} />{t("newNote", locale)}</button>
            <button disabled={!draft || !hasNoteContent(draft) || exiting || transferring} onClick={() => draft && void handleOpenNoteWindow(draft.id)}><PanelTop size={14} />{t(isDelegated ? "focusNoteWindow" : "openNoteWindow", locale)}</button>
          </>}
          <button disabled={!draft || isNavigating || isDelegated || exiting} onClick={() => void toggleFavorite()}><Star size={14} />{t(draft?.favorite ? "removeFavorite" : "addFavorite", locale)}</button>
          {canUndoPolish && <button disabled={!!polishingId || exiting || isDelegated || transferring} onClick={() => { closeMenus(); void handleUndoPolish(); }}><CornerUpLeft size={14} />{t(activeAiOperation === "polish" ? "aiUndo" : "aiUndoTransform", locale)}</button>}
          {activeAiPreview && <button onClick={() => { closeMenus(); setShowAiPreview(true); }}><Sparkles size={14} />{t("aiViewResult", locale)}</button>}
          {isSingleNote ? <button disabled={exiting || transferring} onClick={() => void closeSingleNote(true)}><CornerUpLeft size={14} />{t("returnToMain", locale)}</button> : <>
            <button disabled={!draft || isNavigating || isDelegated || exiting} onClick={() => void toggleArchive()}><Layers3 size={14} />{t(draft?.archived ? "unarchiveNote" : "archiveNote", locale)}</button>
            <button disabled={!draft || isNavigating || pickingFiles || exiting || transferring} onClick={() => void handleDelete()}><Trash2 size={14} />{t("deleteNote", locale)}</button>
          </>}
          <button className="compact-minimize" onClick={() => void hideWindow(true)}><Minus size={14} />{t("minimize", locale)}</button>
          {!isSingleNote && <button onClick={() => void openRecovery()}><CornerUpLeft size={14} />{t("recoveryHistory", locale)}</button>}
          <button onClick={() => { closeMenus(); setShowHelp(true); }}><BookOpen size={14} />{t("usageGuide", locale)}</button>
          {!isSingleNote && <button disabled={exiting || transferring} onClick={() => { closeMenus(); void window.desktopTabs.quitApplication().catch(() => setToast(t("windowActionFailed", locale))); }}><LogOut size={14} />{t("quitApplication", locale)}</button>}
        </div>}
        {openMenu === "settings" && <div className={`popover settings-popover ${editingAi || editingProvider || editingShortcuts ? "settings-detail-panel" : ""}`} role={editingAi || editingProvider || editingShortcuts ? "dialog" : undefined} aria-modal={editingAi || editingProvider || editingShortcuts ? true : undefined} aria-label={t("settings", locale)}>
          {!editingAi && !editingProvider && !editingShortcuts && <label className="font-size-setting"><span>{t("readingFontSize", locale)} <output>{preferences.fontSize}</output></span><input type="range" aria-label={t("readingFontSize", locale)} min={12} max={22} step={1} value={preferences.fontSize} onChange={(event) => updatePreferences({ fontSize: Number(event.target.value) })} /></label>}
          {(editingAi || editingProvider || editingShortcuts) && <div className="settings-detail-header"><span>{t("settings", locale)}</span><button aria-label={t("closePanel", locale)} onClick={() => { closeMenus(); focusEditor(); }}><X size={16} /></button></div>}
          {isSingleNote ? <>
            <div className="popover-title">{t("noteTheme", locale)}</div>
            <div className="theme-grid">{themeOptions.map((option) => <button key={option.id} disabled={exiting || transferring} className={`theme-choice ${activeTheme === option.id ? "selected" : ""}`} onClick={() => updateDraft({ theme: option.id })}><span className="theme-swatch" style={{ backgroundColor: option.swatch }} /><span>{t(option.labelKey, locale)}</span>{activeTheme === option.id && <Check size={12} />}</button>)}</div>
            <button className="provider-setting" onClick={() => void window.desktopTabs.openMainWindow(true).catch(() => setToast(t("windowActionFailed", locale)))}><Settings2 size={14} />{t("openMainSettings", locale)}</button>
          </> : editingShortcuts ? <>
            <button className="popover-back" onClick={() => setEditingShortcuts(false)}>‹ {t("back", locale)}</button>
            <div className="popover-title">{t("keyboardShortcuts", locale)}</div>
            <div className="shortcut-list">{shortcutConfigs.map((shortcut) => <div className="shortcut-row" key={shortcut.action}><span>{t(shortcutLabelKeys[shortcut.action], locale)}</span><button className={`shortcut-capture ${recordingShortcut === shortcut.action ? "recording" : ""}`} onClick={() => setRecordingShortcut(shortcut.action)} onKeyDown={(event) => void handleShortcutKeyDown(shortcut.action, event)}>{recordingShortcut === shortcut.action ? t("pressShortcut", locale) : displayShortcut(shortcut.accelerator)}</button></div>)}</div>
            <button className="reset-shortcuts" onClick={() => void handleResetShortcuts()}>{t("resetShortcuts", locale)}</button>
          </> : (editingAi || editingProvider) && (loadingConfig || configLoadError) ? <>
            <button className="popover-back" onClick={() => { setEditingAi(false); setEditingProvider(null); }}>‹ {t("back", locale)}</button>
            <p className={`credential-hint ${configLoadError ? "ai-config-error" : ""}`} role={configLoadError ? "alert" : "status"}>
              {t(configLoadError ? editingAi ? "aiSecureUnavailable" : "secureStorageUnavailable" : "configLoading", locale)}</p>
            {configLoadError && <button className="secondary-action" onClick={() => { setLoadingConfig(true); setConfigLoadError(false); setConfigLoadAttempt((attempt) => attempt + 1); }}>{t("configRetry", locale)}</button>}
          </> : editingAi ? <Suspense fallback={<p role="status">{t("viewLoading", locale)}</p>}><AiSettings config={aiConfig} locale={locale} draft={aiSettingsDraft} onDraftChange={setAiSettingsDraft} onClose={() => setEditingAi(false)}
            onSaved={(config) => { setAiSettingsDraft(null); setAiConfig(config); setEditingAi(false); setToast(t("configSaved", locale)); }}
            onCleared={() => { setAiSettingsDraft(null); setAiConfig(null); setEditingAi(false); setToast(t("configCleared", locale)); }} /></Suspense> : editingProvider ? <>
            <button className="popover-back" onClick={() => setEditingProvider(null)}>‹ {t("back", locale)}</button>
            <div className="provider-heading"><span className={`provider-glyph ${editingProvider === "notion" ? "notion-glyph" : "feishu-glyph"}`}>{editingProvider === "notion" ? "N" : "飞"}</span><strong>{providerLabels[editingProvider]}</strong>{syncConfigs[editingProvider] && <span className="configured-label">{t("configured", locale)}</span>}</div>
            {editingProvider === "feishu" && <><label className="credential-field"><span>{t("feishuSyncMode", locale)}</span><select value={feishuMode} onChange={(event) => setFeishuMode(event.target.value as FeishuSyncMode)}><option value="create">{t("feishuCreateMode", locale)}</option><option value="append">{t("feishuAppendMode", locale)}</option></select></label>
              {feishuMode === "append" ? <><label className="credential-field"><span>{t("targetDocumentUrl", locale)}</span><input type="url" value={targetDocumentUrl} onChange={(event) => setTargetDocumentUrl(event.target.value)} placeholder={t("targetDocumentPlaceholder", locale)} autoComplete="off" /></label><p className="credential-hint">{t("appendModeHint", locale)}</p></> : <p className="credential-hint">{t("createModeHint", locale)}</p>}</>}
            <label className="credential-field"><span>{t("appId", locale)}</span><input value={appId} onChange={(event) => setAppId(event.target.value)} autoComplete="off" /></label>
            <label className="credential-field"><span>{t("appSecret", locale)}</span><input type="password" value={appSecret} onChange={(event) => setAppSecret(event.target.value)} placeholder={syncConfigs[editingProvider] ? t("savedSecretPlaceholder", locale) : t("appSecretPlaceholder", locale)} autoComplete="new-password" /></label>
            {editingProvider === "feishu" && <>{feishuMode === "create" && <><label className="credential-field"><span>{t("collaboratorEmail", locale)}</span><input type="email" value={collaboratorEmail} onChange={(event) => setCollaboratorEmail(event.target.value)} autoComplete="email" /></label><p className="credential-hint">{t("collaboratorHint", locale)}</p></>}<p className="credential-hint">{t("syncTextOnly", locale)}</p><button className="setup-help" onClick={() => void openLink("https://open.feishu.cn/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/document-docx/docx-v1/document/convert")}><ExternalLink size={11} />{t("feishuSetupHelp", locale)}</button></>}
            <button className="ai-test-button" disabled={checkingFeishu || !syncConfigs.feishu || appId.trim() !== syncConfigs.feishu.appId || !!appSecret || feishuMode !== (syncConfigs.feishu.syncMode ?? "create") || targetDocumentUrl.trim() !== (syncConfigs.feishu.targetDocumentUrl ?? "")} onClick={() => void checkFeishu()}>{checkingFeishu ? t("checkingFeishu", locale) : t("checkSavedFeishu", locale)}</button>
            <p className="credential-hint">{t("feishuCheckHint", locale)}</p>
            {feishuCheck && <p className={`credential-hint ${feishuCheck.error ? "ai-config-error" : ""}`} role={feishuCheck.error ? "alert" : "status"}>{feishuCheck.message}</p>}
            <div className="credential-actions"><button className="secondary-action" onClick={() => setEditingProvider(null)}>{t("cancel", locale)}</button><button className="primary-action" onClick={() => void handleSaveProviderConfig()}>{t("saveConfig", locale)}</button></div>
            {syncConfigs[editingProvider] && <button className="clear-config" onClick={() => void handleClearProviderConfig()}>{t("clearConfig", locale)}</button>}
          </> : <>
            <div className="popover-title">{t("language", locale)}</div>
            <div className="locale-switch" role="group" aria-label={t("language", locale)}>
              <button className={locale === "zh" ? "selected" : ""} aria-pressed={locale === "zh"} onClick={() => setLocale("zh")}><Languages size={13} />{t("languageChinese", locale)}</button>
              <button className={locale === "en" ? "selected" : ""} aria-pressed={locale === "en"} onClick={() => setLocale("en")}><Languages size={13} />{t("languageEnglish", locale)}</button>
            </div>
            <div className="popover-title">{t("noteTheme", locale)}</div>
            <div className="theme-grid">{themeOptions.map((option) => <button key={option.id} disabled={exiting || transferring || isDelegated} className={`theme-choice ${activeTheme === option.id ? "selected" : ""}`} onClick={() => updateDraft({ theme: option.id })}><span className="theme-swatch" style={{ backgroundColor: option.swatch }} /><span>{t(option.labelKey, locale)}</span>{activeTheme === option.id && <Check size={12} />}</button>)}</div>
            <label className="opacity-setting" htmlFor="theme-opacity"><span>{t("globalThemeOpacity", locale)}</span><output>{Math.round(activeThemeOpacity * 100)}%</output></label>
            <input id="theme-opacity" className="opacity-slider" type="range" min={Math.round(MIN_THEME_OPACITY * 100)} max="100" step="2" value={Math.round(activeThemeOpacity * 100)} onChange={(event) => updatePreferences({ themeOpacity: Number(event.target.value) / 100 })} aria-label={t("globalThemeOpacity", locale)} />
            <div className="popover-title settings-section-title">{t("aiSettings", locale)}</div>
            <button className="provider-setting" onClick={openAiConfig}><Sparkles size={15} /><span>{t("aiPolish", locale)}</span><small>{t(aiConfig ? "configured" : "viewConfig", locale)}</small><ChevronRight size={13} /></button>
            <div className="popover-title settings-section-title">{t("syncSettings", locale)}</div>
            <button className="provider-setting" onClick={() => openProviderConfig("feishu")}><span className="provider-glyph feishu-glyph">飞</span><span>{t("feishu", locale)}</span><small>{t(syncConfigs.feishu ? "configured" : "viewConfig", locale)}</small><ChevronRight size={13} /></button>
            <button className="provider-setting" onClick={() => setEditingShortcuts(true)}><Settings2 size={15} /><span>{t("keyboardShortcuts", locale)}</span><ChevronRight size={13} /></button>
          </>}
        </div>}
      </section>
      {showRecovery && <div className="panel-backdrop" onClick={(event) => event.stopPropagation()}><section className="detail-panel recovery-panel" role="dialog" aria-modal="true" aria-labelledby="recovery-title" onKeyDown={(event) => { if (event.key === "Escape" && !recoveryLoading) { event.stopPropagation(); setShowRecovery(false); focusEditor(); } }}>
        <header className="detail-panel-header"><strong id="recovery-title">{t("recoveryHistory", locale)}</strong><button disabled={recoveryLoading} aria-label={t("closePanel", locale)} onClick={() => { setShowRecovery(false); focusEditor(); }}><X size={16} /></button></header>
        <p className="credential-hint">{t("recoveryRetention", locale)}</p>
        {recoveryError && <p className="credential-hint" role="alert">{t("recoveryFailed", locale)}<button disabled={recoveryLoading} onClick={() => void openRecovery()}>{t("retryLoad", locale)}</button></p>}
        {recoveryLoading ? <p role="status">{t("loadingNotes", locale)}</p> : <div className="recovery-list">{recoveryEntries.length ? recoveryEntries.map((entry) => <div className="recovery-row" key={entry.id}><div><strong>{getNoteTitle(entry.title) || t("untitled", locale)}</strong><small>{t(entry.reason === "deleted" ? "recoveryDeleted" : entry.reason === "ai-before" ? "recoveryAiBefore" : "recoveryRestoreBefore", locale)} · {new Date(entry.createdAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US")}</small></div><button disabled={recoveryLoading} onClick={() => void restoreRecovery(entry.id)}>{t("restoreVersion", locale)}</button></div>) : <p>{t("recoveryEmpty", locale)}</p>}</div>}
      </section></div>}
      {showHelp && <div className="panel-backdrop" onClick={(event) => event.stopPropagation()}><section className="detail-panel" role="dialog" aria-modal="true" aria-labelledby="usage-guide-title" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setShowHelp(false); focusEditor(); } }}><header className="detail-panel-header"><strong id="usage-guide-title">{t("usageGuide", locale)}</strong><button autoFocus aria-label={t("closePanel", locale)} onClick={() => { setShowHelp(false); focusEditor(); }}><X size={16} /></button></header><Suspense fallback={<p role="status">{t("viewLoading", locale)}</p>}><MarkdownPreview content={t("usageGuideContent", locale)} locale={locale} onOpenLink={(url) => void openLink(url)} /></Suspense></section></div>}
      {showAiPreview && activeAiPreview && draft && <div className="panel-backdrop" onClick={(event) => event.stopPropagation()}><section className="detail-panel ai-result-panel" role="dialog" aria-modal="true" aria-labelledby="ai-result-title" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setShowAiPreview(false); focusEditor(); } }}>
        <header className="detail-panel-header"><strong id="ai-result-title">{t(aiOperationMeta[activeAiPreview.operation].labelKey, locale)}</strong><button autoFocus aria-label={t("closePanel", locale)} onClick={() => { setShowAiPreview(false); focusEditor(); }}><X size={16} /></button></header>
        {(aiPreviewApplied || draft.content !== activeAiPreview.originalContent) && <p className="credential-hint">{t(aiPreviewApplied ? "aiComparisonApplied" : "aiPreviewChanged", locale)}</p>}
        <Suspense fallback={<p role="status">{t("viewLoading", locale)}</p>}><AiComparison key={draft.id} originalContent={activeAiPreview.originalContent} content={activeAiPreview.content} noteId={draft.id} attachments={draft.attachments} locale={locale} onOpenLink={(url) => void openLink(url)} onOpenAttachment={(attachment) => void handleOpenAttachment(attachment)}
          onEdit={aiPreviewApplied || isNavigating ? undefined : (content) => setAiPreviews((previews) => ({ ...previews, [draft.id]: { ...activeAiPreview, content } }))} /></Suspense>
        <div className="detail-panel-actions"><button disabled={exiting || isNavigating} onClick={() => { if (aiPreviewApplied) setShowAiPreview(false); else { discardAiPreview(draft.id); dismissAiFeedback(draft.id); } }}>{t(aiPreviewApplied ? "closePanel" : "aiKeepOriginal", locale)}</button><button disabled={exiting || isNavigating} onClick={() => void saveAiPreviewAsNote()}>{t("aiSaveAsNote", locale)}</button>{aiPreviewApplied ? <button disabled={!!polishingId || exiting || isDelegated || transferring} onClick={() => { setShowAiPreview(false); void handleUndoPolish(); }}>{t("aiUndoTransform", locale)}</button> : <button className="primary-action" disabled={draft.content !== activeAiPreview.originalContent || !!polishingId || exiting || isDelegated || transferring || isNavigating} onClick={() => void replaceWithAiPreview()}>{t("aiReplaceOriginal", locale)}</button>}</div>
      </section></div>}
      {toast && !(toast === t("saveFailed", locale) && (saveState === "error" || failedSaves.size > 0)) && <div className="toast" role="status"><Info size={14} />{toast}</div>}
    </main>
  );
}
