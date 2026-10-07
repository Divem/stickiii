import test from "node:test";
import assert from "node:assert/strict";
import { readWorkspaceView, writeWorkspaceView } from "../src/renderer/workspaceView.ts";

test("workspace memory merges window positions, keeps active note explicit, and stores no content", () => {
  const data = new Map(); const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const first = { start: 5, end: 9, scroll: 240, previewScroll: 20, mode: "edit" };
  writeWorkspaceView(storage, "a", first, true);
  writeWorkspaceView(storage, "b", { ...first, mode: "preview" });
  assert.equal(readWorkspaceView(storage).activeNoteId, "a");
  assert.deepEqual(readWorkspaceView(storage).views.a, first);
  assert.equal(readWorkspaceView(storage).views.b.mode, "preview");
  assert.equal([...data.values()][0].includes("content"), false);
});

test("corrupt position memory and invalid ranges cannot break note loading", () => {
  assert.deepEqual(readWorkspaceView({ getItem: () => "invalid" }), { views: {} });
  const value = JSON.stringify({ activeNoteId: 42, views: { a: { start: -1, end: 0, scroll: 0, previewScroll: 0, mode: "edit" } } });
  const loaded = readWorkspaceView({ getItem: () => value });
  assert.equal(loaded.activeNoteId, undefined); assert.deepEqual(Object.keys(loaded.views), []);
});
