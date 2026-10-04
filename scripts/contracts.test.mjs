import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getNoteTitle, isNoteThemeId, normalizeStoredNote, normalizeThemeOpacity } from "../src/shared/notes.ts";
import { SyncConfigStore } from "./fixtures/legacy-config-store.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("note titles use only the first line without changing the content", () => {
  for (const [content, title] of [
    ["第一行\n后续内容", "第一行"],
    ["  First line  \r\nNext line", "First line"],
    ["First line\rNext line", "First line"],
    ["\n第二行不是标题", ""],
    ["   \n后续内容", ""],
    ["", ""],
  ]) {
    assert.equal(getNoteTitle(content), title);
  }
});

test("note themes are independent values stored on each note", () => {
  assert.equal(isNoteThemeId("sage"), true);
  assert.equal(isNoteThemeId("ink"), true);
  assert.equal(isNoteThemeId("unknown"), false);
  const first = normalizeStoredNote({ id: "one", content: "One", attachments: [], createdAt: "", updatedAt: "", syncState: "local", theme: "sage" });
  const second = normalizeStoredNote({ id: "two", content: "Two", attachments: [], createdAt: "", updatedAt: "", syncState: "local", theme: "sky" });
  assert.equal(first.theme, "sage");
  assert.equal(second.theme, "sky");
});

test("legacy note opacity stays bounded for the global setting migration", () => {
  assert.equal(normalizeThemeOpacity(0.55), 0.55);
  assert.equal(normalizeThemeOpacity(0.1), 0.4);
  assert.equal(normalizeThemeOpacity(1.4), 1);
  assert.equal(normalizeThemeOpacity("0.8"), undefined);
  const first = normalizeStoredNote({ id: "one", content: "One", attachments: [], createdAt: "", updatedAt: "", syncState: "local", themeOpacity: 0.55 });
  const second = normalizeStoredNote({ id: "two", content: "Two", attachments: [], createdAt: "", updatedAt: "", syncState: "local", themeOpacity: 0.8 });
  const legacy = normalizeStoredNote({ id: "legacy", content: "Legacy", attachments: [], createdAt: "", updatedAt: "", syncState: "local" });
  assert.equal(first.themeOpacity, 0.55);
  assert.equal(second.themeOpacity, 0.8);
  assert.equal("themeOpacity" in legacy, false);
});

test("legacy notes preserve their text and metadata and migrate only once", () => {
  const note = {
    id: "legacy-note",
    content: "原有正文\n第二行",
    attachments: [{ id: "attachment", name: "example.txt", mimeType: "text/plain", size: 4, storedPath: "/attachments/example.txt" }],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
    syncState: "local",
  };
  const legacy = { ...note, title: "原有标题" };
  const migrated = normalizeStoredNote(legacy);
  assert.deepEqual(migrated, { ...note, content: "原有标题\n原有正文\n第二行" });
  assert.deepEqual(normalizeStoredNote(JSON.parse(JSON.stringify(migrated))), migrated);
  assert.equal(legacy.title, "原有标题");
  assert.equal(legacy.content, note.content);
  for (const title of ["未命名记录", "Untitled note", "", "   "]) {
    assert.deepEqual(normalizeStoredNote({ ...note, title }), note);
  }
  assert.deepEqual(normalizeStoredNote(note), note);
  assert.equal(normalizeStoredNote({ ...note, title: "只有标题", content: "" }).content, "只有标题");
});

test("shared note contract contains attachments and sync state", async () => {
  const source = await read("src/shared/types.ts");
  assert.match(source, /attachments: NoteAttachment\[\]/);
  assert.match(source, /syncState/);
});

test("Tauri keeps native privileges scoped to the local main window", async () => {
  const [source, types, permissions] = await Promise.all([read("src-tauri/src/lib.rs"), read("src/shared/types.ts"), read("src-tauri/capabilities/main.json")]);
  assert.match(types, /CommandOrControl\+Shift\+Space/);
  assert.match(source, /UNTRUSTED_WINDOW/);
  assert.deepEqual(JSON.parse(permissions).windows, ["main"]);
  assert.equal(JSON.parse(permissions).remote, undefined);
  assert.ok(JSON.parse(permissions).permissions.every((p) => !/^(fs|shell|http):/.test(p)));
});

test("theme opacity is user-configurable and the window can reveal the desktop behind it", async () => {
  const [main, renderer, types] = await Promise.all([read("src-tauri/tauri.conf.json"), read("src/renderer/App.tsx"), read("src/shared/types.ts")]);
  assert.match(types, /themeOpacity\?: number/);
  assert.match(renderer, /type="range"/);
  assert.match(renderer, /themeOpacity/);
  assert.equal(JSON.parse(main).app.windows[0].transparent, true);
});

test("shortcut registry exposes four configurable global actions", async () => {
  const [types, main, preload] = await Promise.all([read("src/shared/types.ts"), read("src-tauri/src/lib.rs"), read("src/renderer/desktop.ts")]);
  for (const action of ["toggleWindow", "newNote", "previousNote", "nextNote"]) assert.match(types, new RegExp(action));
  assert.match(main, /list_shortcuts/);
  assert.match(main, /save_shortcuts/);
  assert.match(main, /register_shortcuts/);
  assert.match(preload, /onShortcutAction/);
});

test("native shell keeps the small note window and cursor positioning", async () => {
  const [source, config] = await Promise.all([read("src-tauri/src/lib.rs"), read("src-tauri/tauri.conf.json")]);
  const window = JSON.parse(config).app.windows[0];
  assert.equal(window.width, 440);
  assert.equal(window.height, 390);
  assert.notEqual(window.alwaysOnTop, true);
  assert.match(source, /cursor_position/);
  assert.match(source, /set_visible_on_all_workspaces/);
  assert.match(source, /set_always_on_top\(pinned/);
  assert.match(source, /accept_first_mouse\(true\)/);
  assert.match(JSON.stringify(window), /acceptFirstMouse/);
});

test("desktop bridge exposes pin control and the renderer puts note switching in the top bar", async () => {
  const [preload, renderer, noteList, noteBook] = await Promise.all([read("src/renderer/desktop.ts"), read("src/renderer/App.tsx"), read("src/renderer/NoteList.tsx"), read("src/renderer/NoteBook.tsx")]);
  assert.match(preload, /setPinnedWindow/);
  assert.match(renderer, /handleTogglePin/);
  assert.match(renderer, /viewNotes/);
  assert.match(renderer, /<NoteList /);
  assert.match(noteList, /notes-header/);
  assert.match(noteList, /notes-new-button/);
  assert.match(renderer, /onPointerUp=\{handleNotesMenuPointerUp\}/);
  assert.match(noteBook, /note-page-position/);
  assert.match(noteList, /onPointerUp/);
});

test("unconfigured Feishu and unimplemented Notion report honest states", async () => {
  const [notion, feishu] = await Promise.all([read("src/platform/sync/notion.ts"), read("src/platform/sync/feishu.ts")]);
  assert.match(notion, /not-implemented/);
  assert.match(feishu, /createFeishuAdapter/);
});

test("unimplemented Notion has no visible renderer entry point", async () => {
  const renderer = await read("src/renderer/App.tsx");
  assert.match(renderer, /\(\["feishu"\] as const\)\.map/);
  assert.doesNotMatch(renderer, /provider-setting" onClick=\{\(\) => openProviderConfig\("notion"\)\}/);
});

test("credentials use the system vault and the bridge receives no bearer tokens", async () => {
  const [native, bridge] = await Promise.all([read("src-tauri/src/credentials.rs"), read("src/renderer/desktop.ts")]);
  assert.match(native, /keyring::Entry/);
  assert.match(native, /struct PublicConfig/);
  assert.doesNotMatch(bridge, /tenant_access_token/);
  assert.match(bridge, /appSecret: ""/);
});

test("sync config store preserves secrets privately and exposes only configured state", async () => {
  let encrypted = Buffer.alloc(0);
  const store = new SyncConfigStore(
    "/tmp/desk-tabs-contract-sync-config.bin",
    {
      available: () => true,
      encrypt: () => Buffer.from("encrypted-payload"),
      decrypt: () => JSON.stringify({}),
    },
    async (_path, data) => {
      encrypted = data;
    },
  );

  const saved = await store.save({ provider: "feishu", appId: "cli_test", appSecret: "secret-value" });
  assert.deepEqual(saved, { status: "saved", provider: "feishu" });
  assert.equal(encrypted.toString(), "encrypted-payload");
  const configs = await store.list();
  assert.equal(configs.length, 1);
  assert.equal(configs[0].provider, "feishu");
  assert.equal(configs[0].appId, "cli_test");
  assert.equal(configs[0].appSecretConfigured, true);
  assert.equal(typeof configs[0].updatedAt, "string");
  assert.equal("appSecret" in configs[0], false);
  assert.deepEqual(await store.clear("feishu"), { status: "cleared", provider: "feishu" });
  assert.deepEqual(await store.list(), []);
});
