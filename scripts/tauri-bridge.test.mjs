import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { desktopTabs } from "../src/renderer/desktop.ts";
import { noteSyncHash } from "../src/platform/sync/feishuApi.ts";

globalThis.window = Object.assign(new EventTarget(), { crypto: globalThis.crypto });
const emit = async (event, detail) => window.dispatchEvent(new CustomEvent(`desk-tabs:${event}`, { detail }));
afterEach(() => clearMocks());

const note = { id: "native-note", content: "Title\nbody", attachments: [], createdAt: "", updatedAt: "", syncState: "local" };
const config = { provider: "feishu", appId: "cli_native", appSecretConfigured: true, collaboratorEmail: "user@example.com", syncMode: "create", updatedAt: "" };

test("configuration reads default to public metadata and legacy access must be requested explicitly", async () => {
  const calls = [];
  mockIPC((command, payload) => { calls.push({ command, payload }); return command === "list_sync_configs" ? [] : null; });
  await desktopTabs.listSyncConfigs();
  await desktopTabs.getAiConfig();
  await desktopTabs.listSyncConfigs(true);
  await desktopTabs.getAiConfig(true);
  assert.deepEqual(calls, [
    { command: "list_sync_configs", payload: { loadSaved: false } },
    { command: "get_ai_config", payload: { loadSaved: false } },
    { command: "list_sync_configs", payload: { loadSaved: true } },
    { command: "get_ai_config", payload: { loadSaved: true } },
  ]);
});

test("native synchronization keeps authentication out of the renderer and checkpoints identity before writing", async () => {
  const calls = [];
  let document;
  let revision = 1;
  let children = [];
  mockIPC(async (command, payload) => {
    calls.push({ command, payload });
    if (command === "sync_begin") return { status: "ready", jobId: "native-job", note, config };
    if (command === "sync_checkpoint") { document = structuredClone(payload.document); return; }
    if (command === "sync_finish") return { ...payload.result, note: { ...note, feishu: document, syncState: "synced" } };
    assert.equal(command, "feishu_request");
    assert.equal(payload.jobId, "native-job");
    const path = payload.path.split("?")[0];
    const data = (value) => ({ code: 0, data: value });
    if (path.endsWith("/blocks/convert")) return data({ first_level_block_ids: ["body"], blocks: [{ block_id: "body", block_type: 2, text: { elements: [{ text_run: { content: "body" } }] } }] });
    if (path === "/docx/v1/documents") {
      assert.equal(document.creationPending, true);
      return data({ document: { document_id: "NativeDoc", revision_id: revision, title: "Title" } });
    }
    if (path === "/docx/v1/documents/NativeDoc") return data({ document: { document_id: "NativeDoc", revision_id: revision, title: "Title" } });
    if (path.endsWith("/blocks/NativeDoc") && payload.method === "GET") return data({ block: { block_id: "NativeDoc", children } });
    if (path.endsWith("/descendant")) {
      assert.equal(document.documentId, "NativeDoc");
      children = ["RealBody"];
      return data({ document_revision_id: ++revision });
    }
    if (path.includes("/permissions/")) return data({});
    assert.fail(`Unexpected native operation: ${payload.method} ${path}`);
  });
  const result = await desktopTabs.syncNote(note, "feishu");
  assert.equal(result.status, "synced");
  assert.equal(result.note.feishu.documentId, "NativeDoc");
  assert.equal(document.contentHash, noteSyncHash(note));
  assert.ok(calls.every(({ payload }) => !JSON.stringify(payload).includes("tenant_access_token")));
  assert.ok(calls.filter(({ command }) => command === "feishu_request").every(({ payload }) => !payload.headers && !payload.appSecret));
});

test("unconfigured channels finish without issuing any network operations", async () => {
  const calls = [];
  mockIPC((command) => {
    calls.push(command);
    return { status: "result", result: { status: "not-configured", provider: "feishu" } };
  });
  assert.equal((await desktopTabs.syncNote(note, "feishu")).status, "not-configured");
  assert.deepEqual(calls, ["sync_begin"]);
});

test("an unknown native write preserves its recovery checkpoint and releases the job", async () => {
  let pending = false;
  let finished = false;
  mockIPC((command, payload) => {
    if (command === "sync_begin") return { status: "ready", jobId: "native-job", note, config };
    if (command === "sync_checkpoint") { pending = payload.document.creationPending; return; }
    if (command === "sync_finish") { finished = true; return payload.result; }
    if (payload.path.endsWith("/blocks/convert")) return { code: 0, data: { first_level_block_ids: ["body"], blocks: [{ block_id: "body", block_type: 2 }] } };
    return Promise.reject({ message: "network", uncertain: true });
  });
  const result = await desktopTabs.syncNote(note, "feishu");
  assert.equal(result.message, "create-uncertain");
  assert.equal(pending, true);
  assert.equal(finished, true);
});

test("disposing a shortcut subscription prevents late callbacks", async () => {
  mockIPC(() => {}, { shouldMockEvents: true });
  const actions = [];
  const dispose = desktopTabs.onShortcutAction((action) => actions.push(action));
  await emit("shortcut:action", "newNote");
  assert.deepEqual(actions, ["newNote"]);
  dispose();
  await emit("shortcut:action", "nextNote");
  assert.deepEqual(actions, ["newNote"]);
});

test("exit completion uses a scoped command and disposed exit listeners cannot finish a later request", async () => {
  const completions = [];
  mockIPC((command, payload) => {
    if (command === "complete_exit") completions.push(payload.saved);
  }, { shouldMockEvents: true });
  let requested = 0;
  const dispose = desktopTabs.onExitRequested(() => { requested++; });
  await emit("app:exit-requested", null);
  assert.equal(requested, 1);
  await desktopTabs.completeExit(false);
  await desktopTabs.completeExit(true);
  assert.deepEqual(completions, [false, true]);
  dispose();
  await emit("app:exit-requested", null);
  assert.equal(requested, 1);
});

test("independent window commands expose only named note and lifecycle actions", async () => {
  const calls = [];
  mockIPC((command, payload) => { calls.push({ command, payload }); });
  await desktopTabs.openNoteWindow("A");
  await desktopTabs.focusNoteWindow("A");
  await desktopTabs.closeNoteWindow(true, true);
  await desktopTabs.openMainWindow(true);
  await desktopTabs.completeExit(true, "exit-generation");
  assert.deepEqual(calls, [
    { command: "open_note_window", payload: { noteId: "A" } },
    { command: "focus_note_window", payload: { noteId: "A" } },
    { command: "close_note_window", payload: { saved: true, returnToMain: true } },
    { command: "open_main_window", payload: { settings: true } },
    { command: "complete_exit", payload: { saved: true, requestId: "exit-generation" } },
  ]);
});

test("window listeners preserve exit generation and stop after disposal", async () => {
  mockIPC(() => {}, { shouldMockEvents: true });
  const requests = [];
  let closed = 0;
  const disposeExit = desktopTabs.onExitRequested((id) => requests.push(id));
  const disposeClose = desktopTabs.onCloseRequested(() => closed++);
  await emit("app:exit-requested", "generation-one");
  await emit("window:close-requested", null);
  disposeExit(); disposeClose();
  await emit("app:exit-requested", "generation-two");
  await emit("window:close-requested", null);
  assert.deepEqual(requests, ["generation-one"]);
  assert.equal(closed, 1);
});
