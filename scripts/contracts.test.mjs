import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("shared note contract contains attachments and sync state", async () => {
  const source = await read("src/shared/types.ts");
  assert.match(source, /attachments: NoteAttachment\[\]/);
  assert.match(source, /syncState/);
});

test("main process keeps node integration disabled and registers the global shortcut", async () => {
  const source = await read("src/main.ts");
  assert.match(source, /nodeIntegration: false/);
  assert.match(source, /CommandOrControl\+Shift\+Space/);
  assert.match(source, /contextIsolation: true/);
});

test("sync providers are explicit and currently return an honest not-configured state", async () => {
  const [notion, feishu] = await Promise.all([read("src/platform/sync/notion.ts"), read("src/platform/sync/feishu.ts")]);
  assert.match(notion, /not-configured/);
  assert.match(feishu, /not-configured/);
});
