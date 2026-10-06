import test from "node:test";
import assert from "node:assert/strict";
import { compareAiText } from "../src/renderer/aiTextDiff.ts";

function verify(before, after) {
  const changes = compareAiText(before, after);
  assert.equal(changes.filter((part) => part.kind !== "added").map((part) => part.text).join(""), before);
  assert.equal(changes.filter((part) => part.kind !== "removed").map((part) => part.text).join(""), after);
  return changes;
}

test("AI comparison preserves unchanged text and highlights Chinese edits without splitting emoji", () => {
  assert.deepEqual(verify("我们主要主要做测试。", "我们主要做测试。"), [
    { kind: "equal", text: "我们主要" }, { kind: "removed", text: "主要" }, { kind: "equal", text: "做测试。" },
  ]);
  const emoji = verify("准备😀", "准备😃");
  assert.deepEqual(emoji, [{ kind: "equal", text: "准备" }, { kind: "removed", text: "😀" }, { kind: "added", text: "😃" }]);
  const paragraphs = verify("first old\n\nunchanged\n\nlast old", "first new\n\nunchanged\n\nlast new");
  assert.ok(paragraphs.some((part) => part.kind === "equal" && part.text.includes("\n\nunchanged\n\n")));
});

test("AI comparison faithfully retains Markdown, whitespace, empty text and unrelated replacements", () => {
  for (const [before, after] of [["", "text"], ["text", ""], ["same", "same"], ["\n\n", "\n"],
    ["# Title\n- [ ] task\n```js\nx=1\n```\n", "# Title\n- [x] task\n```js\nx=2\n```\n"],
    [" leading\r\nend\n", "leading\r\nend"], ["你好 world 🌱", "Hello 世界 🍀"]]) verify(before, after);
  assert.deepEqual(compareAiText("", ""), []);
});

test("AI comparison bounds large input work while retaining both full versions", () => {
  const prefix = "same\n".repeat(5000);
  const suffix = "\nend".repeat(5000);
  const changes = verify(prefix + "old" + suffix, prefix + "new" + suffix);
  assert.equal(changes.filter((part) => part.kind !== "equal").map((part) => part.text).join(""), "oldnew");
  verify("a".repeat(65536), "b".repeat(65536));
  verify("a\n".repeat(10000), "b\n".repeat(10000));
});
