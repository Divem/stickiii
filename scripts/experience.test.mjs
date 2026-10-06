import test from "node:test";
import assert from "node:assert/strict";
import { noteSearchSnippet } from "../src/renderer/noteSearch.ts";
import { continueMarkdownList, toggleMarkdownBold, toggleMarkdownTask } from "../src/renderer/markdownEditing.ts";
import { NoteSaveQueue } from "../src/renderer/noteSaveQueue.ts";

test("search snippets show body matches and preserve original case", () => {
  assert.deepEqual(noteSearchSnippet("同名标题\n\n需要区分的正文", "区分"), { before: "同名标题 需要", match: "区分", after: "的正文" });
  assert.deepEqual(noteSearchSnippet("Title\nAn EXAMPLE", "example"), { before: "…itle An ", match: "EXAMPLE", after: "" });
  assert.equal(noteSearchSnippet("anything", ""), null);
  assert.equal(noteSearchSnippet("anything", "missing"), null);
  const long = noteSearchSnippet(`${"前".repeat(80)}命中${"后".repeat(80)}`, "命中");
  assert.equal(long.before, `…${"前".repeat(8)}`);
  assert.equal(long.after, `${"后".repeat(40)}…`);
});

test("Markdown list editing handles tasks, ordered lists, empty items and code fences", () => {
  for (const [text, next] of [["- first", "\n- "], ["1. first", "\n2. "], ["  - [x] done", "\n  - [ ] "]]) {
    assert.equal(continueMarkdownList(text, text.length, text.length).text, next);
  }
  assert.deepEqual(continueMarkdownList("Title\n- ", 8, 8), { start: 6, end: 8, text: "", selectionStart: 6, selectionEnd: 6 });
  for (const text of ["plain line", "```md\n- code", "~~~\n- code", "    - indented code"]) assert.equal(continueMarkdownList(text, text.length, text.length), null);
  assert.equal(continueMarkdownList("- selected", 2, 5), null);
  const afterCode = "```\ncode\n```\n- text";
  assert.equal(continueMarkdownList(afterCode, afterCode.length, afterCode.length).text, "\n- ");
});

test("bold toggles selection without changing surrounding text; tasks use their original source line", () => {
  assert.deepEqual(toggleMarkdownBold("text", 0, 4), { start: 0, end: 4, text: "**text**", selectionStart: 2, selectionEnd: 6 });
  assert.equal(toggleMarkdownBold("**text**", 2, 6).text, "text");
  assert.equal(toggleMarkdownBold("**text**", 0, 8).text, "text");
  assert.equal(toggleMarkdownBold("```\ntext", 4, 8), null);
  assert.equal(toggleMarkdownTask("# Title\n- [ ] one\n\n- [x] two", 4, false), "# Title\n- [ ] one\n\n- [ ] two");
  assert.equal(toggleMarkdownTask("```\n- [ ] code\n```", 2, true), "```\n- [ ] code\n```");
});

test("restored notes leave the queue tombstone and can accept subsequent external updates", async () => {
  const note = { id: "undo", content: "Before", attachments: [], createdAt: "old", updatedAt: "old", syncState: "local" };
  const queue = new NoteSaveQueue(async (value) => value);
  queue.seed([note]); await queue.remove(note.id, async () => {});
  queue.acceptExternal(note); assert.equal(queue.read(note.id), undefined);
  queue.restore(note); assert.equal(queue.isDirty(note.id), false);
  queue.acceptExternal({ ...note, content: "Later", updatedAt: "2026-10-06" });
  assert.equal(queue.read(note.id).content, "Later");
});
