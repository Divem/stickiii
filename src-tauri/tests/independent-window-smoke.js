// Debug-only driver, gated by an explicitly isolated application data directory.
(async () => {
  if (window.__qaWindowStarted) return;
  window.__qaWindowStarted = true;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
  const checkAttachments = async (noteId) => {
    const zone = await wait(() => document.querySelector(".attachment-drop-zone"), "attachment drop zone");
    const editor = document.querySelector("textarea.note-content");
    const before = (await window.desktopTabs.listNotes()).find((note) => note.id === noteId).attachments.length;
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII="), (char) => char.charCodeAt(0));
    const clipboard = new DataTransfer();
    clipboard.items.add(new File([png], "image.png", { type: "image/png" }));
    check(!editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true })), "IMAGE_PASTE_INTERCEPTED");
    await wait(async () => (await window.desktopTabs.listNotes()).find((note) => note.id === noteId)?.attachments.length === before + 1, "pasted image saved");
    await wait(() => !document.querySelector(".attachment-import-status"), "paste idle");
    const image = (await window.desktopTabs.listNotes()).find((note) => note.id === noteId).attachments.find((file) => file.mimeType === "image/png");
    check(image.previewDataUrl.startsWith("data:image/png;base64,") && image.name.startsWith("screenshot-"), "PASTE_PREVIEW");
    const text = new DataTransfer(); text.setData("text/plain", "ordinary text");
    check(editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: text, bubbles: true, cancelable: true })), "TEXT_PASTE_UNCHANGED");
    document.querySelector(".editor-mode-switch").click();
    await wait(() => editor.hidden, "preview before drop");
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
      listOpen.click();
      await wait(async () => (await window.desktopTabs.getWindowContext()).openNoteIds.includes("qa-window-b"), "B opened from list");
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
