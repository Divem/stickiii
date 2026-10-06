// Debug-only driver, gated by an explicitly isolated application data directory.
(async () => {
  if (window.__qaWindowStarted) return;
  window.__qaWindowStarted = true;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const wait = async (fn, label = "condition") => {
    for (let i = 0; i < 200; i++) { const result = await fn(); if (result) return result; await pause(100); }
    throw new Error(`WINDOW_SMOKE_TIMEOUT: ${label}`);
  };
  const check = (value, label) => { if (!value) throw new Error(label); };
  const setContent = (editor, content) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(editor, content);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const denied = async (fn) => { try { await fn(); return false; } catch { return true; } };
  const checkAiComparison = async (noteId) => {
    const originalPolish = window.desktopTabs.polishNote;
    const before = (await window.desktopTabs.listNotes()).find((note) => note.id === noteId).content;
    // Exercise the real renderer and native saves without paid model calls.
    window.desktopTabs.polishNote = async () => ({ status: "polished", originalContent: before, content: before + "\nAI_QA_RESULT" });
    try {
      document.querySelector('button[aria-label="AI 润色"]').click();
      const panel = await wait(() => document.querySelector(".ai-result-panel"), "AI comparison shown");
      check((await window.desktopTabs.listNotes()).find((note) => note.id === noteId).content === before, "AI_PREVIEW_KEEPS_ORIGINAL");
      check(panel.querySelector(".ai-diff-inline ins")?.textContent.includes("AI_QA_RESULT"), "AI_ADDITIONS_MARKED");
      const tabs = panel.querySelectorAll(".ai-comparison-tabs button");
      tabs[0].click();
      await wait(() => panel.querySelector(".markdown-preview"), "AI original view");
      check([...panel.querySelectorAll('input[type="checkbox"]')].every((item) => item.disabled), "AI_ORIGINAL_READ_ONLY");
      tabs[1].click();
      await wait(() => panel.querySelector(".markdown-preview")?.textContent.includes("AI_QA_RESULT"), "AI result view");
      tabs[2].click();
      await wait(() => panel.querySelector(".ai-diff-scroll"), "AI differences restored");
      const action = (text) => [...document.querySelectorAll(".ai-result-panel .detail-panel-actions button")].find((button) => button.textContent === text);
      action("替换原文").click();
      await wait(async () => (await window.desktopTabs.listNotes()).find((note) => note.id === noteId).content.includes("AI_QA_RESULT"), "AI applied and saved");
      document.querySelector('button[aria-label="更多操作"]').click();
      const review = await wait(() => [...document.querySelectorAll(".actions-popover button")].find((button) => button.textContent === "查看 AI 结果"), "AI comparison after apply");
      review.click();
      const undo = await wait(() => action("撤销 AI 修改"), "AI comparison undo");
      undo.click();
      await wait(async () => (await window.desktopTabs.listNotes()).find((note) => note.id === noteId).content === before, "AI comparison undo saved");
      return true;
    } finally { window.desktopTabs.polishNote = originalPolish; }
  };
  const checkAttachments = async (noteId) => {
    const zone = await wait(() => document.querySelector(".attachment-drop-zone"), "attachment drop zone");
    const editor = document.querySelector("textarea.note-content");
    const before = (await window.desktopTabs.listNotes()).find((note) => note.id === noteId).attachments.length;
    const canvas = document.createElement("canvas");
    canvas.width = 800; canvas.height = 1600;
    const drawing = canvas.getContext("2d");
    drawing.fillStyle = "#80a98b"; drawing.fillRect(0, 0, canvas.width, canvas.height);
    const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const clipboard = new DataTransfer();
    clipboard.items.add(new File([png], "image.png", { type: "image/png" }));
    editor.setSelectionRange(editor.value.length, editor.value.length);
    editor.dispatchEvent(new Event("select", { bubbles: true }));
    check(!editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true })), "IMAGE_PASTE_INTERCEPTED");
    await wait(async () => (await window.desktopTabs.listNotes()).find((note) => note.id === noteId)?.attachments.length === before + 1, "pasted image saved");
    await wait(() => !document.querySelector(".attachment-import-status"), "paste idle");
    const image = (await window.desktopTabs.listNotes()).find((note) => note.id === noteId).attachments.find((file) => file.mimeType === "image/png");
    check(image.previewDataUrl.startsWith("data:image/png;base64,") && image.name.startsWith("screenshot-"), "PASTE_PREVIEW");
    const imageLink = await wait(() => document.querySelector(".inline-note-content .note-image-link"), "image link in edit mode");
    check(imageLink.textContent === image.name && imageLink.getBoundingClientRect().height <= 32, "EDIT_IMAGE_COMPACT_LINK");
    check(!document.querySelector(".inline-note-content img"), "EDIT_IMAGE_NOT_INLINE");
    imageLink.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    const inline = await wait(() => document.querySelector(".note-image-hover-preview img"), "hover image preview");
    await wait(() => inline.complete && inline.naturalWidth > 0, "inline image decoded");
    const hover = document.querySelector(".note-image-hover-preview").getBoundingClientRect();
    check(hover.left >= 0 && hover.top >= 0 && hover.right <= innerWidth && hover.bottom <= innerHeight, "HOVER_IMAGE_WITHIN_WINDOW");
    check(Math.abs(inline.getBoundingClientRect().width / inline.getBoundingClientRect().height - inline.naturalWidth / inline.naturalHeight) < 0.01, "HOVER_IMAGE_ASPECT_RATIO");
    imageLink.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: editor }));
    await wait(() => !document.querySelector(".note-image-hover-preview"), "hover preview dismissed");
    imageLink.focus();
    await wait(() => document.querySelector(".note-image-hover-preview"), "keyboard image preview");
    imageLink.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await wait(() => !document.querySelector(".note-image-hover-preview"), "escape closes image preview");
    editor.focus();
    const checkImageFit = (img, root, label) => {
      const rect = img.getBoundingClientRect();
      check(rect.width > 0 && rect.height > 0, `${label}_VISIBLE`);
      check(Math.abs(rect.width / rect.height - img.naturalWidth / img.naturalHeight) < 0.01, `${label}_ASPECT_RATIO`);
      check(rect.width <= root.clientWidth + 1 && rect.height <= root.clientHeight - 95, `${label}_TEXT_SPACE`);
    };
    check(!document.querySelector(".attachment-strip .attachment-card img"), "IMAGE_NOT_ATTACHMENT_CARD");
    const textEditors = document.querySelectorAll("textarea.note-content");
    check(textEditors.length >= 2, "TEXT_BEFORE_AND_AFTER_IMAGE");
    setContent(textEditors[0], textEditors[0].value + "图片前继续输入\n\n");
    setContent(textEditors[textEditors.length - 1], "\n\n图片后继续输入");
    await wait(async () => {
      const saved = (await window.desktopTabs.listNotes()).find((note) => note.id === noteId);
      return saved.content.includes("图片前继续输入") && saved.content.includes("图片后继续输入") && saved.content.includes(`attachment:${image.id}`);
    }, "text on both sides persisted");
    check((await window.desktopTabs.attachmentPreview(noteId, image.id)).startsWith("data:image/png;base64,"), "BOUND_IMAGE_PREVIEW");
    check(await denied(() => window.desktopTabs.attachmentPreview(noteId, "foreign-attachment")), "FOREIGN_ATTACHMENT_PREVIEW_DENIED");
    if (context.noteId) check(await denied(() => window.desktopTabs.attachmentPreview("qa-window-b", image.id)), "CHILD_PREVIEW_NOTE_SCOPE");
    const text = new DataTransfer(); text.setData("text/plain", "ordinary text");
    check(editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: text, bubbles: true, cancelable: true })), "TEXT_PASTE_UNCHANGED");
    document.querySelector(".editor-mode-switch").click();
    await wait(() => editor.hidden, "preview before drop");
    await wait(() => document.querySelector(".markdown-preview .note-image-open img")?.naturalWidth > 0, "inline image in preview");
    checkImageFit(document.querySelector(".markdown-preview .note-image-open img"), document.querySelector(".markdown-preview"), "PREVIEW_IMAGE_FIT");
    const dropped = new DataTransfer();
    dropped.items.add(new File(["QA attachment"], "qa-report.txt", { type: "text/plain" }));
    check(!zone.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dropped, bubbles: true, cancelable: true })), "FILE_DRAG_ACCEPTED");
    await wait(() => document.querySelector(".attachment-drop-hint"), "drop hint");
    check(!zone.dispatchEvent(new DragEvent("drop", { dataTransfer: dropped, bubbles: true, cancelable: true })), "FILE_DROP_INTERCEPTED");
    await wait(async () => (await window.desktopTabs.listNotes()).find((note) => note.id === noteId)?.attachments.length === before + 2, "dropped file saved");
    await wait(() => !document.querySelector(".attachment-import-status") && !document.querySelector(".attachment-drop-hint"), "drop idle");
    document.querySelector(".editor-mode-switch").click();
    await wait(() => !editor.hidden, "edit after drop");
    return true;
  };
  const context = await window.desktopTabs.getWindowContext();
  const phase = window.__qaWindowPhase;
  if (context.noteId) {
    if (phase === 2) return;
    const originalSave = window.desktopTabs.saveNote;
    try {
      const notes = await window.desktopTabs.listNotes();
      check(notes.length === 1 && notes[0].id === context.noteId, "CHILD_DATA_SCOPE");
      check(await denied(() => window.desktopTabs.saveNote({ ...notes[0], id: "qa-other-note", content: "forbidden" })), "CHILD_WRITE_SCOPE");
      check(await denied(() => window.desktopTabs.listShortcuts()), "CHILD_GLOBAL_SCOPE");
      check(await denied(() => window.desktopTabs.getAiConfig(true)), "CHILD_LEGACY_AI_CONFIG_DENIED");
      check(await denied(() => window.desktopTabs.listSyncConfigs(true)), "CHILD_LEGACY_SYNC_CONFIG_DENIED");
      check(await denied(() => window.desktopTabs.restoreNote(context.noteId)), "CHILD_RESTORE_DENIED");
      check(await denied(() => window.desktopTabs.checkFeishuConnection()), "CHILD_CONNECTION_CHECK_DENIED");
      check(await denied(() => window.desktopTabs.createNoteCopy("qa-other-note", "forbidden")), "CHILD_COPY_NOTE_SCOPE");
      const editor = await wait(() => document.querySelector("textarea.note-content"), "child editor");
      check(!document.querySelector('button[aria-label="快速记录"]') && !document.querySelector('button[aria-label="查看便签"]'), "CHILD_MANAGEMENT_CONTROLS");
      if (context.noteId === "qa-window-a") {
        check(await denied(() => window.desktopTabs.importAttachment("qa-window-b", new File(["private"], "private.txt"), false)), "CHILD_IMPORT_NOTE_SCOPE");
        check(await checkAttachments(context.noteId), "CHILD_ATTACHMENT_IMPORT");
        setContent(editor, "窗口 A\n**独立编辑预览**");
        await wait(async () => (await window.desktopTabs.listNotes())[0].content.includes("独立编辑预览"), "child autosave");
        document.querySelector(".editor-mode-switch").click();
        await wait(() => [...document.querySelectorAll("strong")].some((node) => node.textContent === "独立编辑预览"), "child preview");
        document.querySelector(".editor-mode-switch").click();
        await wait(() => !editor.hidden, "child return edit");
        check(await checkAiComparison(context.noteId), "CHILD_AI_COMPARISON");
        document.querySelector('button[aria-label="置顶"]').click();
        await wait(() => document.querySelector(".pinned-badge.active"), "A pinned");
        // A failed close must preserve the window and its latest editable draft.
        window.desktopTabs.saveNote = async () => { throw new Error("QA_SAVE_FAILURE"); };
        setContent(editor, "窗口 A\n关闭失败保留草稿");
        document.querySelector(".window-tool.close").click();
        await wait(() => document.querySelector(".retry-save") && !editor.readOnly, "failed close recovery");
        window.desktopTabs.saveNote = originalSave;
        setContent(editor, "窗口 A\nCHILD_A_PASS");
        document.querySelector(".retry-save").click();
        await wait(async () => (await window.desktopTabs.listNotes())[0].content.includes("CHILD_A_PASS"), "A retry saved");
        setContent(editor, "窗口 A\nCHILD_A_PASS\nEXIT_DRAFT_PASS");
        window.desktopTabs.saveNote = async () => { throw new Error("QA_CHILD_EXIT_FAILURE"); };
        const disposeCancel = window.desktopTabs.onExitCancelled(() => {
          window.desktopTabs.saveNote = originalSave;
          setTimeout(() => document.querySelector(".retry-save")?.click(), 0);
          disposeCancel();
        });
      } else if (context.noteId === "qa-window-b") {
        setContent(editor, "窗口 B\nCHILD_B_PASS");
        // Capture runs before the app's close handler, injecting a last
        // keystroke before its flush without waiting for autosave.
        window.addEventListener("desk-tabs:window:close-requested", () => {
          setContent(editor, "窗口 B\nCHILD_B_PASS\n删除前最新草稿");
        }, { capture: true, once: true });
      } else if (context.noteId === "qa-window-c") {
        setContent(editor, "窗口 C\nCHILD_C_PASS");
        await wait(async () => (await window.desktopTabs.listNotes())[0].content.includes("CHILD_C_PASS"), "C saved");
        setContent(editor, "窗口 C\nCHILD_C_PASS\nRETURN_LATEST");
        await wait(async () => (await window.desktopTabs.listNotes())[0].content.includes("RETURN_LATEST"), "C latest saved");
        document.querySelector('button[aria-label="更多操作"]').click();
        const back = await wait(() => [...document.querySelectorAll(".actions-popover button")].find((node) => node.textContent === "回到主窗口编辑"), "return action");
        back.click();
      }
    } catch (error) {
      window.desktopTabs.saveNote = originalSave;
      const notes = await window.desktopTabs.listNotes();
      await window.desktopTabs.saveNote({ ...notes[0], content: `CHILD_FAILURE: ${error}` });
    }
    return;
  }
  const result = {};
  let error;
  const title = phase === 1 ? "qa-window-phase-one" : "qa-window-phase-two";
  try {
    if (phase === 2) {
      await wait(async () => (await window.desktopTabs.getWindowContext()).openNoteIds.includes("qa-window-a"), "restored window");
      await wait(async () => (await window.desktopTabs.getWindowContext()).readyNoteIds.includes("qa-window-a"), "restored renderer ready");
      result.restored = !(await window.desktopTabs.getWindowContext()).openNoteIds.includes("qa-window-b")
        && !(await window.desktopTabs.getWindowContext()).openNoteIds.includes("qa-window-c");
      const a = (await window.desktopTabs.listNotes()).find((note) => note.id === "qa-window-a");
      result.savedLatestOnExit = a.content.includes("CHILD_A_PASS");
      result.mainRemainsReadOnly = await denied(() => window.desktopTabs.saveNote({ ...a, content: "stale restored write" }));
      await window.desktopTabs.deleteNote("qa-window-a");
      result.restoredDelete = !(await window.desktopTabs.getWindowContext()).openNoteIds.includes("qa-window-a");
    } else {
      const copy = await window.desktopTabs.createNoteCopy("qa-window-b", "QA separate AI result");
      result.copyPreservesOriginal = copy.id !== "qa-window-b" && copy.content === "QA separate AI result"
        && (await window.desktopTabs.listNotes()).find((note) => note.id === "qa-window-b").content === "窗口 B\n原始便签";
      await window.desktopTabs.deleteNote(copy.id);
      const restoredCopy = await window.desktopTabs.restoreNote(copy.id);
      result.nativeRestore = restoredCopy.id === copy.id && restoredCopy.content === copy.content;
      await window.desktopTabs.deleteNote(copy.id);
      if (navigator.platform.startsWith("Mac")) {
        const button = await wait(() => document.querySelector('button[aria-label="查看便签"]:not(:disabled)'), "list button ready");
        await window.desktopTabs.setPinnedWindow(true);
        const bounds = button.getBoundingClientRect();
        const now = new Date().toISOString();
        await window.desktopTabs.saveNote({ id: "qa-window-native-click", content: JSON.stringify({
          x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2,
        }), attachments: [], createdAt: now, updatedAt: now, syncState: "local" });
        await wait(() => document.querySelector(".note-window")?.dataset.windowFocused === "false", "native QA takes focus");
        await wait(() => document.hasFocus(), "first mouse click activates main");
        await wait(() => document.querySelector(".notes-popover"), "first mouse click opens note list");
        result.firstClickOpensNotes = button.getAttribute("aria-expanded") === "true"
          && document.activeElement === document.querySelector(".notes-search input");
        const popover = document.querySelector(".notes-popover");
        document.querySelector(".notes-search input").blur();
        await settle();
        check(popover.isConnected, "NON_FOCUSABLE_PANEL_CLICK_KEEPS_LIST");
        result.nonFocusablePanelKeepsList = true;
        document.querySelector(".notes-search input").focus();
        button.focus();
        await settle(); // Focus loss and click are separate native input events.
        button.click();
        await settle();
        await wait(() => !document.querySelector(".notes-popover"), "focused list trigger closes note list once");
        result.listTriggerClosesOnce = true;
        button.click();
        await settle();
        await wait(() => document.querySelector(".notes-popover"), "list trigger reopens note list once");
        result.listTriggerOpensOnce = true;
        const actions = document.querySelector('button[aria-label="更多操作"]');
        actions.focus();
        await settle();
        actions.click();
        await settle();
        await wait(() => document.querySelector(".actions-popover") && !document.querySelector(".notes-popover"), "switch from notes to actions once");
        result.menuSwitchesOnce = true;
        button.click();
        await wait(() => document.querySelector(".notes-popover"), "notes reopened after actions");
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await settle();
        check(!document.querySelector(".notes-popover"), "ESCAPE_CLOSES_LIST");
        result.escapeClosesList = true;
        button.click();
        await wait(() => document.querySelector(".notes-popover"), "notes reopened before outside click");
        document.querySelector(".note-surface").click();
        await settle();
        await wait(() => !document.querySelector(".notes-popover"), "outside click closes note list");
        result.outsideClickClosesList = true;
        button.click();
        await wait(() => document.querySelector(".notes-popover"), "notes reopened before focus leaves");
        document.querySelector("textarea.note-content").focus();
        await settle();
        check(!document.querySelector(".notes-popover"), "FOCUS_OUTSIDE_CLOSES_LIST");
        result.focusOutsideClosesList = true;
        button.click();
        await wait(() => document.querySelector(".notes-popover"), "notes reopened before window blur");
        window.dispatchEvent(new FocusEvent("blur"));
        await settle();
        check(!document.querySelector(".notes-popover"), "WINDOW_BLUR_CLOSES_LIST");
        result.windowBlurClosesList = true;
        window.dispatchEvent(new FocusEvent("focus"));
        await window.desktopTabs.deleteNote("qa-window-native-click");
        await window.desktopTabs.setPinnedWindow(false);
      }
      // Safari can blur the auto-focused search field with relatedTarget=null
      // before dispatching a row's click. The list must still handle one
      // pointer release after that focus transition for both list actions.
      const listButton = document.querySelector('button[aria-label="查看便签"]');
      for (const key of ["B", "A"]) {
        listButton.click();
        const row = await wait(() => [...document.querySelectorAll(".popover-note")].find((button) => button.title === `窗口 ${key}`), "history row before blur");
        document.querySelector(".notes-search input").blur();
        await settle();
        check(row.isConnected, "HISTORY_ROW_SURVIVES_SEARCH_BLUR");
        row.click();
        await wait(() => document.querySelector("textarea.note-content")?.value.startsWith(`窗口 ${key}\n`), "history row selects note after blur");
      }
      result.historyRowsAfterSearchBlur = true;
      result.aiComparisonAndUndo = await checkAiComparison("qa-window-a");
      const markdownEditor = document.querySelector("textarea.note-content");
      const originalText = markdownEditor.value;
      setContent(markdownEditor, "窗口 A\n- task");
      await settle(); markdownEditor.focus();
      markdownEditor.setSelectionRange(markdownEditor.value.length, markdownEditor.value.length);
      markdownEditor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await wait(() => markdownEditor.value === "窗口 A\n- task\n- ", "native Markdown list continuation");
      check(document.execCommand("undo"), "NATIVE_MARKDOWN_UNDO_AVAILABLE");
      await wait(() => markdownEditor.value === "窗口 A\n- task", "native list undo");
      markdownEditor.setSelectionRange(7, 11);
      const boldKey = () => new KeyboardEvent("keydown", { key: "b", metaKey: navigator.platform.startsWith("Mac"), ctrlKey: !navigator.platform.startsWith("Mac"), bubbles: true, cancelable: true });
      markdownEditor.dispatchEvent(boldKey());
      await wait(() => markdownEditor.value === "窗口 A\n- **task**", "native bold selection");
      markdownEditor.dispatchEvent(boldKey());
      await wait(() => markdownEditor.value === "窗口 A\n- task", "native bold toggle back");
      setContent(markdownEditor, "窗口 A\n\n- [ ] 原生待办\n\n- [x] 已完成");
      await settle(); document.querySelector(".editor-mode-switch").click();
      const taskCheckbox = await wait(() => document.querySelector('.markdown-preview input[type="checkbox"]:not(:disabled)'), "native editable task");
      taskCheckbox.click();
      await wait(() => markdownEditor.value.includes("- [x] 原生待办"), "native task updates source");
      document.querySelector(".editor-mode-switch").click();
      await wait(() => !markdownEditor.hidden, "native task returns to edit");
      setContent(markdownEditor, originalText);
      await wait(async () => (await window.desktopTabs.listNotes()).find((note) => note.id === "qa-window-a").content === originalText, "native Markdown original restored");
      result.markdownListUndoBoldAndTasks = true;
      result.mainAttachmentImport = await checkAttachments("qa-window-a");
      // Use the actual main menu to open A rather than bypassing React handoff.
      document.querySelector('button[aria-label="更多操作"]').click();
      const open = await wait(() => [...document.querySelectorAll(".actions-popover button")].find((node) => node.textContent === "独立窗口打开"), "main open action");
      open.click();
      await wait(async () => (await window.desktopTabs.getWindowContext()).openNoteIds.includes("qa-window-a"), "A opened");
      const mainA = (await window.desktopTabs.listNotes()).find((note) => note.id === "qa-window-a");
      result.mainWriteBlocked = await denied(() => window.desktopTabs.saveNote({ ...mainA, content: "stale main draft" }));
      result.mainImportBlocked = await denied(() => window.desktopTabs.importAttachment("qa-window-a", new File(["stale"], "stale.txt"), false));
      result.mainPreview = !!await wait(() => document.querySelector(".independent-feedback") && document.querySelector("textarea.note-content")?.hidden, "main readonly preview");
      await window.desktopTabs.openNoteWindow("qa-window-a");
      result.reused = (await window.desktopTabs.getWindowContext()).openNoteIds.filter((id) => id === "qa-window-a").length === 1;
      await wait(async () => (await window.desktopTabs.listNotes()).some((note) => note.id === "qa-window-a" && note.content.includes("CHILD_A_PASS")), "A checks before list interaction");
      await window.desktopTabs.openMainWindow();
      await wait(() => document.hasFocus() && document.querySelector(".note-window")?.dataset.windowFocused === "true", "main focused for list");
      document.querySelector('button[aria-label="查看便签"]').click();
      const bRow = await wait(() => [...document.querySelectorAll(".note-list-row")].find((row) => row.querySelector(".popover-note")?.title === "窗口 B"), "B list entry");
      const listOpen = bRow.querySelector(".note-list-open");
      const list = document.querySelector(".notes-popover");
      result.listEntryLayout = listOpen.getBoundingClientRect().width <= 30 && list.scrollWidth <= list.clientWidth + 1;
      document.querySelector(".notes-search input").blur();
      await settle();
      check(listOpen.isConnected, "INDEPENDENT_BUTTON_SURVIVES_SEARCH_BLUR");
      listOpen.click();
      await wait(async () => (await window.desktopTabs.getWindowContext()).openNoteIds.includes("qa-window-b"), "B opened from list");
      result.independentAfterSearchBlur = true;
      await wait(async () => (await window.desktopTabs.getWindowContext()).readyNoteIds.includes("qa-window-b"), "B ready before opening C");
      await window.desktopTabs.openNoteWindow("qa-window-c");
      result.multiple = (await window.desktopTabs.getWindowContext()).openNoteIds.length === 3;
      await wait(async () => (await window.desktopTabs.listNotes()).some((note) => note.id === "qa-window-a" && note.content.includes("CHILD_A_PASS")), "A checks");
      await wait(() => document.querySelector(".markdown-preview")?.textContent.includes("CHILD_A_PASS"), "main live update");
      result.childAndMainUpdates = true;
      await wait(async () => (await window.desktopTabs.listNotes()).some((note) => note.id === "qa-window-b" && note.content.includes("CHILD_B_PASS")), "B checks");
      let latestBeforeDelete = (await window.desktopTabs.listNotes()).some((note) => note.id === "qa-window-b" && note.content.includes("删除前最新草稿"));
      const dispose = window.desktopTabs.onNoteChanged(({ note }) => { if (note.id === "qa-window-b" && note.content.includes("删除前最新草稿")) latestBeforeDelete = true; });
      await window.desktopTabs.deleteNote("qa-window-b");
      await wait(() => latestBeforeDelete, "latest B draft saved before deletion");
      dispose();
      result.deleteFlush = latestBeforeDelete;
      result.deletedWindow = !(await window.desktopTabs.getWindowContext()).openNoteIds.includes("qa-window-b")
        && !(await window.desktopTabs.listNotes()).some((note) => note.id === "qa-window-b");
      // C returns to main through its own menu. A remains open for restart QA.
      await wait(async () => (await window.desktopTabs.listNotes()).some((note) => note.id === "qa-window-c" && note.content.includes("CHILD_C_PASS")), "C checks");
      await wait(async () => !(await window.desktopTabs.getWindowContext()).openNoteIds.includes("qa-window-c"), "C returned");
      result.returnToMain = !!await wait(() => document.querySelector("textarea.note-content")?.value.includes("RETURN_LATEST") && !document.querySelector("textarea.note-content")?.hidden, "main selected C with latest draft");
      result.otherWindowsUnaffected = (await window.desktopTabs.getWindowContext()).openNoteIds.join() === "qa-window-a";
      await window.desktopTabs.quitApplication();
      result.multiWindowExitCancelled = !!await wait(() => document.querySelector(".toast")?.textContent.includes("退出未完成"), "child exit failure cancels application exit");
      result.latestChildDraftSaved = !!await wait(async () => (await window.desktopTabs.listNotes()).some((note) => note.id === "qa-window-a" && note.content.includes("EXIT_DRAFT_PASS")), "child retry after cancelled exit");
    }
  } catch (failure) { error = `${failure}; UI=${JSON.stringify({ title: document.querySelector(".window-note-name")?.textContent,
    editor: document.querySelector("textarea.note-content")?.value, hidden: document.querySelector("textarea.note-content")?.hidden,
    body: document.body.innerText.slice(0,1200), context: await window.desktopTabs.getWindowContext() })}`; }
  const passed = !error && Object.values(result).every(Boolean);
  const now = new Date().toISOString();
  await window.desktopTabs.saveNote({ id: title, content: JSON.stringify({ passed, phase, result, error }), attachments: [], createdAt: now, updatedAt: now, syncState: "local" });
  await window.desktopTabs.quitApplication();
})();
