import test from "node:test";
import assert from "node:assert/strict";
import { NoteSaveQueue } from "../src/renderer/noteSaveQueue.ts";

const note = (id, content = "Text") => ({ id, content, attachments: [], theme: "paper", createdAt: "old", updatedAt: "old", syncState: "local" });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test("browsing clean notes preserves their order and modification time without writing", async () => {
  const calls = [];
  const queue = new NoteSaveQueue(async (value) => { calls.push(value); return value; });
  const notes = [note("A"), note("B"), note("C")];
  queue.seed(notes);
  for (const id of ["A", "B", "C", "A"]) await queue.flush(id);
  assert.deepEqual(calls, []);
  assert.deepEqual(notes.map((item) => queue.read(item.id).updatedAt), ["old", "old", "old"]);
});

test("a slow flush persists edits typed during saving before a caller can switch notes", async () => {
  const started = deferred();
  const release = deferred();
  const writes = [];
  const queue = new NoteSaveQueue(async (snapshot) => {
    writes.push(snapshot.content);
    if (writes.length === 1) { started.resolve(); await release.promise; }
    return { ...snapshot, feishu: { appId: "app", documentId: "native-doc" }, updatedAt: "saved" };
  });
  queue.seed([note("A", "Original")]);
  queue.track(note("A", "Before switch"));
  const switching = queue.flush("A");
  await started.promise;
  queue.track(note("A", "Typed during saving"));
  release.resolve();
  await switching;
  assert.deepEqual(writes, ["Before switch", "Typed during saving"]);
  assert.equal(queue.read("A").content, "Typed during saving");
  assert.equal(queue.read("A").feishu.documentId, "native-doc");
  assert.equal(queue.isDirty("A"), false);
});

test("queued saves coalesce to the latest draft and never write an older queued snapshot", async () => {
  const calls = [];
  const queue = new NoteSaveQueue(async (snapshot) => { calls.push(snapshot.content); return snapshot; });
  queue.seed([note("A", "Original")]);
  queue.track(note("A", "First edit"));
  const first = queue.save("A");
  queue.track(note("A", "Latest edit"));
  const second = queue.save("A");
  await Promise.all([first, second]);
  assert.deepEqual(calls, ["Latest edit"]);
});

test("a failed write keeps the latest draft and does not poison the retry queue", async () => {
  let failed = true;
  let stored;
  const queue = new NoteSaveQueue(async (snapshot) => {
    if (failed) throw new Error("LOCAL_SAVE_FAILED");
    stored = snapshot;
    return snapshot;
  });
  queue.seed([note("A", "Original")]);
  queue.track(note("A", "Unsaved"));
  await assert.rejects(queue.flush("A"), /LOCAL_SAVE_FAILED/);
  queue.track(note("A", "Latest after failure"));
  assert.equal(queue.isDirty("A"), true);
  failed = false;
  await queue.flush();
  assert.equal(stored.content, "Latest after failure");
  assert.equal(queue.isDirty("A"), false);
});

test("deletion waits for in-flight writes and a queued save cannot revive the deleted note", async () => {
  const started = deferred();
  const release = deferred();
  const events = [];
  const queue = new NoteSaveQueue(async (snapshot) => {
    started.resolve();
    await release.promise;
    events.push("saved");
    return snapshot;
  });
  queue.track(note("A"));
  const saving = queue.save("A");
  await started.promise;
  const removing = queue.remove("A", async () => { events.push("deleted"); });
  const late = queue.save("A");
  release.resolve();
  await Promise.all([saving, removing, late]);
  assert.deepEqual(events, ["saved", "deleted"]);
  assert.equal(queue.read("A"), undefined);
});

test("exit flushing includes background drafts and skips unused empty drafts", async () => {
  const saved = [];
  const queue = new NoteSaveQueue(async (snapshot) => { saved.push(snapshot.id); return snapshot; });
  queue.seed([note("A", "Original")]);
  queue.track(note("A", "Updated"));
  queue.track(note("B", "Background edit"));
  queue.track(note("empty", ""));
  await queue.flush();
  assert.deepEqual(saved, ["A", "B"]);
  assert.equal(queue.isStored("empty"), false);
});

test("attachment removal and theme changes are saved even when text is unchanged", async () => {
  const attachment = { id: "image", name: "image.png", size: 10, mimeType: "image/png", storedPath: "/managed/image.png" };
  const original = { ...note("A"), attachments: [attachment] };
  const writes = [];
  const queue = new NoteSaveQueue(async (snapshot) => { writes.push(snapshot); return snapshot; });
  queue.seed([original]);
  queue.track({ ...original, attachments: [], theme: "ink" });
  await queue.flush("A");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].theme, "ink");
  assert.deepEqual(writes[0].attachments, []);
});

test("returning ownership accepts the independent window's latest content without resaving stale main text", async () => {
  const writes = [];
  const queue = new NoteSaveQueue(async (snapshot) => { writes.push(snapshot.content); return snapshot; });
  queue.seed([note("A", "Main original"), note("B", "Other note")]);
  queue.track(note("A", "Obsolete main snapshot"));
  const fromWindow = { ...note("A", "Independent latest"), updatedAt: "native-latest", theme: "sage" };
  queue.acceptExternal(fromWindow);
  await queue.flush();
  assert.equal(queue.read("A").content, "Independent latest");
  assert.equal(queue.read("A").updatedAt, "native-latest");
  assert.equal(queue.isDirty("A"), false);
  assert.equal(queue.read("B").content, "Other note");
  assert.deepEqual(writes, []);
  queue.track({ ...queue.read("A"), content: "Editing again in main" });
  await queue.flush("A");
  assert.deepEqual(writes, ["Editing again in main"]);
});

test("an external saved notification arriving after deletion cannot revive the removed note", async () => {
  const accepted = [];
  const queue = new NoteSaveQueue(async (snapshot) => snapshot, (saved) => accepted.push(saved));
  queue.seed([note("A")]);
  await queue.remove("A", async () => {});
  queue.acceptExternal(note("A", "Late independent window notification"));
  assert.equal(queue.read("A"), undefined);
  assert.deepEqual(accepted, []);
  await queue.flush();
});

test("delayed independent window notifications cannot replace a newer stored snapshot", () => {
  const queue = new NoteSaveQueue(async (snapshot) => snapshot);
  const latest = { ...note("A", "Latest"), updatedAt: "2026-10-03T12:01:00Z" };
  queue.seed([latest]);
  queue.acceptExternal({ ...latest, content: "Old notification", updatedAt: "2026-10-03T12:00:00Z" });
  assert.equal(queue.read("A").content, "Latest");
});
