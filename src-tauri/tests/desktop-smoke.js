// Executed only in a debug build with an explicitly isolated QA data directory.
// Uses the real WKWebView, React handlers, Tauri IPC and Rust storage.
(async () => {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const wait = async (predicate) => {
    for (let i = 0; i < 100; i++) {
      const result = await predicate();
      if (result) return result;
      await pause(100);
    }
    throw new Error("DESKTOP_SMOKE_TIMEOUT");
  };
  const result = { input: false, initialFocus: false, preview: false, editorPosition: false, slowSwitch: false, emptyDraft: false,
    cleanNavigation: false, exitFailureRecovery: false, pin: false, attachments: false, sync: false, crud: false };
  const setContent = (editor, content) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(editor, content);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const exitContent = "Desktop exit saves the latest draft before the debounce timer";
  let error;
  try {
    const editor = await wait(() => document.querySelector("textarea.note-content"));
    result.initialFocus = document.activeElement === editor;
    const content = "Tauri interaction smoke\n\n**Markdown preview**\n" + "Long note line\n".repeat(100);
    editor.focus();
    setContent(editor, content);
    await wait(async () => (await window.desktopTabs.listNotes()).some((note) => note.content === content));
    result.input = true;
    editor.setSelectionRange(8, 16);
    editor.scrollTop = 200;
    const position = { start: editor.selectionStart, end: editor.selectionEnd, scroll: editor.scrollTop };
    const preview = document.querySelector("button.editor-mode-switch");
    if (!preview) throw new Error("PREVIEW_CONTROL_MISSING");
    preview.click();
    await wait(() => [...document.querySelectorAll("strong")].some((strong) => strong.textContent === "Markdown preview"));
    result.preview = true;
    preview.click();
    await wait(() => !editor.hidden && document.activeElement === editor);
    result.editorPosition = document.querySelector("textarea.note-content") === editor && editor.selectionStart === position.start
      && editor.selectionEnd === position.end && editor.scrollTop === position.scroll;
    result.pin = await window.desktopTabs.setPinnedWindow(true) === true && await window.desktopTabs.setPinnedWindow(false) === false;
    result.attachments = await window.desktopTabs.openAttachment("/tmp/unowned.txt") === "INVALID_ATTACHMENT_PATH";
    if ((await window.desktopTabs.listSyncConfigs()).length) throw new Error("QA_CREDENTIALS_NOT_EMPTY");
    const notes = await window.desktopTabs.listNotes();
    result.sync = (await window.desktopTabs.syncNote(notes.find((note) => note.content === content), "feishu")).status === "not-configured";
    const shadow = { ...notes[0], id: "desktop-smoke-delete", content: "temporary note", attachments: [] };
    await window.desktopTabs.saveNote(shadow);
    await window.desktopTabs.deleteNote(shadow.id);
    result.crud = !(await window.desktopTabs.listNotes()).some((note) => note.id === shadow.id);

    const originalSave = window.desktopTabs.saveNote;
    let writeStarted = false;
    let delay = true;
    window.desktopTabs.saveNote = async (snapshot) => {
      if (delay) { delay = false; writeStarted = true; await pause(300); }
      return originalSave(snapshot);
    };
    try {
      setContent(editor, "Before delayed switch");
      document.querySelector('button[aria-label="快速记录"]').click();
      await wait(() => writeStarted);
      setContent(editor, "Typed during delayed switch");
      await wait(() => document.querySelector("textarea.note-content") !== editor);
      const stored = await window.desktopTabs.listNotes();
      const saved = stored.find((note) => note.content === "Typed during delayed switch");
      result.slowSwitch = !!saved;
      result.emptyDraft = !stored.some((note) => note.content === "" && note.attachments.length === 0);
      if (!saved) throw new Error("LATEST_DRAFT_LOST");
      document.querySelector('button[aria-label="查看便签"]').click();
      const row = await wait(() => [...document.querySelectorAll(".popover-note")].find((button) => button.title === saved.content));
      row.click();
      await wait(() => document.querySelector("textarea.note-content")?.value === saved.content);
      const after = (await window.desktopTabs.listNotes()).find((note) => note.id === saved.id);
      result.cleanNavigation = after.updatedAt === saved.updatedAt;
    } finally { window.desktopTabs.saveNote = originalSave; }

    const activeEditor = document.querySelector("textarea.note-content");
    window.desktopTabs.saveNote = async () => { throw new Error("QA_SAVE_FAILURE"); };
    try {
      setContent(activeEditor, "Recoverable exit draft");
      await window.desktopTabs.quitApplication();
      await wait(() => document.querySelector(".save-state.error") && document.querySelector(".retry-save"));
      await wait(() => !activeEditor.readOnly);
      window.desktopTabs.saveNote = originalSave;
      document.querySelector(".retry-save").click();
      await wait(async () => (await window.desktopTabs.listNotes()).some((note) => note.content === "Recoverable exit draft"));
      result.exitFailureRecovery = activeEditor.value === "Recoverable exit draft";
    } finally { window.desktopTabs.saveNote = originalSave; }
  } catch (failure) { error = String(failure); }
  const passed = !error && Object.values(result).every(Boolean);
  const time = new Date().toISOString();
  await window.desktopTabs.saveNote({ id: "desktop-smoke-result", content: JSON.stringify({ passed, result, error, exitContent }), attachments: [], createdAt: time, updatedAt: time, syncState: "local" });
  const currentEditor = document.querySelector("textarea.note-content");
  if (passed && currentEditor) setContent(currentEditor, exitContent);
  await window.desktopTabs.quitApplication();
})();
