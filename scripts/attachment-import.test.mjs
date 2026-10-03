import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { appendAttachments, clipboardImages, importAttachmentBatch, MAX_ATTACHMENT_BYTES } from "../src/renderer/attachmentImport.ts";
import { NoteSaveQueue } from "../src/renderer/noteSaveQueue.ts";
import { desktopTabs } from "../src/renderer/desktop.ts";
import { contentWithAttachmentImages } from "../src/shared/markdown.ts";

globalThis.window = Object.assign(new EventTarget(), { crypto: globalThis.crypto });
afterEach(() => clearMocks());
const note = (id) => ({ id, content: "Original", attachments: [], createdAt: "old", updatedAt: "old", syncState: "local", theme: "sage", feishu: { documentId: "remote" } });
const file = (name, size = 3, type = "application/octet-stream") => ({ name, size, type });
const attachment = { id: "image", name: "screenshot.png", size: 3, mimeType: "image/png", storedPath: "/managed/image.png" };

test("image-only clipboards are imported while plain text and mixed web content retain native paste", () => {
  const image = file("image.png", 3, "image/png");
  const data = (text, files) => ({ getData: () => text, files });
  assert.deepEqual(clipboardImages(data("", [image])), [image]);
  assert.deepEqual(clipboardImages(data("Copied text", [image])), []);
  assert.deepEqual(clipboardImages(data("文字", [])), []);
  assert.deepEqual(clipboardImages(data("", [file("report.pdf")])), []);
});

test("imports append to the latest original note after typing and switching, preserving remote metadata", async () => {
  const writes = [];
  const queue = new NoteSaveQueue(async (value) => { writes.push(value); return value; });
  queue.seed([note("A"), note("B")]);
  let release;
  const pending = importAttachmentBatch([file("image.png")], () => new Promise((resolve) => { release = resolve; }));
  queue.track({ ...queue.read("A"), content: "New typing" });
  const selectedNote = "B";
  release(attachment);
  const result = await pending;
  queue.track(appendAttachments(queue.read("A"), result.attachments));
  await queue.flush("A");
  assert.equal(selectedNote, "B");
  assert.equal(queue.read("B").attachments.length, 0);
  assert.equal(writes[0].id, "A");
  assert.equal(writes[0].content, "New typing\n\n![screenshot.png](attachment:image)\n\n");
  assert.equal(writes[0].theme, "sage");
  assert.deepEqual(writes[0].feishu, { documentId: "remote" });
  assert.deepEqual(writes[0].attachments, [attachment]);
});

test("late attachment results cannot recreate a deleted note", async () => {
  const queue = new NoteSaveQueue(async (value) => value);
  queue.seed([note("A")]);
  await queue.remove("A", async () => {});
  assert.equal(appendAttachments(queue.read("A"), [attachment]), undefined);
});

test("pasted images insert at the selection, while text edits during import are retained", () => {
  const original = { ...note("A"), content: "Before selected After" };
  const insertion = { content: original.content, start: 7, end: 15 };
  const result = appendAttachments(original, [attachment], insertion);
  assert.equal(result.content, "Before \n\n![screenshot.png](attachment:image)\n\n After");
  const typing = appendAttachments({ ...original, content: "Before new typing After" }, [attachment], insertion);
  assert.ok(typing.content.endsWith("new typing After"));
  const changedPrefix = appendAttachments({ ...original, content: "Rewritten before import finished" }, [attachment], insertion);
  assert.ok(changedPrefix.content.startsWith("Rewritten before import finished\n\n!"));
  assert.equal(appendAttachments(original, [{ ...attachment, mimeType: "text/plain" }], insertion).content, original.content);
  const legacy = { ...note("A"), content: "Selected remains", attachments: [attachment] };
  const legacyInsertion = { content: contentWithAttachmentImages(legacy.content, legacy.attachments), start: 0, end: 8 };
  const second = { ...attachment, id: "second" };
  const updated = appendAttachments(legacy, [second], legacyInsertion);
  assert.equal(updated.content.includes("Selected"), false);
  assert.ok(updated.content.includes("attachment:image"));
  assert.ok(updated.content.includes("attachment:second"));
});

test("image preview bridge sends only a note and attachment identity", async () => {
  const calls = [];
  mockIPC((command, payload) => { calls.push({ command, payload }); return "data:image/png;base64,YWJj"; });
  assert.equal(await desktopTabs.attachmentPreview("A", "image"), "data:image/png;base64,YWJj");
  assert.deepEqual(calls, [{ command: "attachment_preview", payload: { noteId: "A", attachmentId: "image" } }]);
});

test("a failed or oversized file preserves successful imports and files are processed sequentially", async () => {
  const calls = [];
  let active = false;
  const result = await importAttachmentBatch([file("ok"), file("large", MAX_ATTACHMENT_BYTES + 1), file("broken"), file("last")], async (value) => {
    assert.equal(active, false); active = true;
    calls.push(value.name);
    await Promise.resolve(); active = false;
    if (value.name === "broken") throw new Error("Cannot read");
    return { ...attachment, id: value.name };
  });
  assert.deepEqual(calls, ["ok", "broken", "last"]);
  assert.deepEqual(result.attachments.map((item) => item.id), ["ok", "last"]);
  assert.equal(result.failures, 2);
  assert.equal(result.error, "ATTACHMENT_TOO_LARGE");
  const rejected = await importAttachmentBatch(Array.from({ length: 21 }, () => file("one")), () => assert.fail("Must reject before reading"));
  assert.equal(rejected.error, "ATTACHMENT_TOO_MANY");
});

test("the byte import bridge sends a bound note and content without any external path or filesystem capability", async () => {
  const previousReader = globalThis.FileReader;
  globalThis.FileReader = class {
    readAsDataURL() { this.result = "data:application/octet-stream;base64,YWJj"; this.onload(); }
  };
  const calls = [];
  mockIPC((command, payload) => { calls.push({ command, payload }); return attachment; });
  try {
    assert.deepEqual(await desktopTabs.importAttachment("A", file("test.txt"), false), attachment);
    assert.deepEqual(calls, [{ command: "import_attachment", payload: { noteId: "A", name: "test.txt", dataBase64: "YWJj", imageOnly: false } }]);
    await assert.rejects(desktopTabs.importAttachment("A", file("large", MAX_ATTACHMENT_BYTES + 1), false), (error) => error === "ATTACHMENT_TOO_LARGE");
    assert.equal(calls.length, 1);
  } finally { globalThis.FileReader = previousReader; }
});
