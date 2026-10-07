import test from "node:test";
import assert from "node:assert/strict";
import { applyPolish, undoPolish } from "../src/renderer/notePolish.ts";
import { NoteSaveQueue } from "../src/renderer/noteSaveQueue.ts";
import { desktopTabs } from "../src/renderer/desktop.ts";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";

globalThis.window = { crypto: globalThis.crypto };

const note = (content = "Original") => ({ id: "A", content, attachments: [{ id: "file", storedPath: "/managed/file.txt" }],
  theme: "sage", createdAt: "created", updatedAt: "old", syncState: "synced", feishu: { documentId: "remote" } });

test("polishing and undo preserve attachments, theme and remote metadata and save through the existing queue", async () => {
  const writes = [];
  const queue = new NoteSaveQueue(async (snapshot) => { writes.push(snapshot); return snapshot; });
  const original = note();
  queue.seed([original]);
  const result = applyPolish(queue.read("A"), "Original", "Polished");
  assert.equal(result.status, "applied");
  assert.equal(result.note.attachments, original.attachments);
  assert.equal(result.note.feishu, original.feishu);
  assert.equal(result.note.theme, "sage");
  assert.equal(result.note.syncState, "local");
  assert.equal(result.note.createdAt, "created");
  queue.track(result.note);
  await queue.flush("A");
  queue.track(undoPolish(queue.read("A"), result.change));
  await queue.flush("A");
  assert.deepEqual(writes.map((item) => item.content), ["Polished", "Original"]);
  assert.equal(queue.isDirty("A"), false);
});

test("late polish results cannot overwrite newer typing or revive a deleted note", async () => {
  const queue = new NoteSaveQueue(async (value) => value);
  queue.seed([note()]);
  queue.track(note("Typed while waiting"));
  assert.equal(applyPolish(queue.read("A"), "Original", "Polished").status, "changed");
  assert.equal(queue.read("A").content, "Typed while waiting");
  await queue.remove("A", async () => {});
  assert.equal(applyPolish(queue.read("A"), "Original", "Polished").status, "missing");
  assert.equal(queue.read("A"), undefined);
});

test("undo cannot erase edits after a polish or change a different note", () => {
  const result = applyPolish(note(), "Original", "Polished");
  assert.equal(undoPolish(note("New edit"), result.change), undefined);
  assert.equal(undoPolish({ ...result.note, id: "B" }, result.change), undefined);
  assert.equal(applyPolish(note(), "Original", "Original").status, "unchanged");
});

test("a polish for a background note is saved without touching the selected note", async () => {
  const writes = [];
  const queue = new NoteSaveQueue(async (value) => { writes.push(value.id); return value; });
  const selected = { ...note("Selected text"), id: "B" };
  queue.seed([note(), selected]);
  const result = applyPolish(queue.read("A"), "Original", "Polished");
  queue.track(result.note);
  await queue.flush("A");
  assert.equal(queue.read("B"), selected);
  assert.deepEqual(writes, ["A"]);
});

test("AI desktop methods use scoped commands and polish sends only a note ID", async () => {
  const calls = [];
  mockIPC((command, payload) => {
    calls.push({ command, payload });
    if (command === "get_ai_config") return { baseUrl: "https://api.example.com/v1", model: "model", apiKeyConfigured: true };
    if (command === "polish_note") return { status: "polished", originalContent: "Original", content: "Polished" };
    return { status: command === "clear_ai_config" ? "cleared" : "saved" };
  });
  try {
    const config = await desktopTabs.getAiConfig();
    assert.equal("apiKey" in config, false);
    assert.equal((await desktopTabs.polishNote("A")).status, "polished");
    await desktopTabs.saveAiConfig({ baseUrl: "https://api.example.com/v1", model: "model", apiKey: "test-key" });
    await desktopTabs.testAiConnection({ baseUrl: "https://api.example.com/v1", model: "unsaved-model", apiKey: "" });
    await desktopTabs.clearAiConfig();
    assert.deepEqual(calls.map((item) => item.command), ["get_ai_config", "polish_note", "save_ai_config", "test_ai_connection", "clear_ai_config"]);
    assert.deepEqual(calls[1].payload, { noteId: "A" });
    assert.deepEqual(calls[3].payload, { input: { baseUrl: "https://api.example.com/v1", model: "unsaved-model", apiKey: "" } });
  } finally { clearMocks(); }
});

test("AI transform actions send only a note ID and a fixed operation", async () => {
  const calls = [];
  mockIPC((command, payload) => {
    calls.push({ command, payload });
    return { status: "transformed", originalContent: "Original", content: "Translated" };
  });
  try {
    await desktopTabs.aiNote("A", "translate");
    assert.deepEqual(calls, [{ command: "ai_note", payload: { noteId: "A", operation: "translate" } }]);
  } finally { clearMocks(); }
});

test("AI cancellation uses the same scoped request identity as generation", async () => {
  const calls = [];
  mockIPC((command, payload) => { calls.push({ command, payload }); return true; });
  try {
    await desktopTabs.polishNote("A", "request-a");
    await desktopTabs.aiNote("A", "translate", "request-b");
    await desktopTabs.cancelAiNote("A", "request-b");
    assert.deepEqual(calls, [
      { command: "polish_note", payload: { noteId: "A", requestId: "request-a" } },
      { command: "ai_note", payload: { noteId: "A", operation: "translate", requestId: "request-b" } },
      { command: "cancel_ai_note", payload: { noteId: "A", requestId: "request-b" } },
    ]);
  } finally { clearMocks(); }
});
