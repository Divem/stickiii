import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

// Own QA application identity, data and vault namespace; never attach to the
// installed application. The driver only terminates processes it starts.
const cwd = resolve(fileURLToPath(new URL("..", import.meta.url)));
const root = await mkdtemp(join(tmpdir(), "desk-tabs-window-smoke-"));
console.log(`Window QA data: ${root}`);
async function run(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}
await run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "tauri", "--", "build", "--debug", "--no-bundle", "--config",
  JSON.stringify({ identifier: "com.dawinyuan.desktabs.windowsqa", productName: "贴贴便签 Window QA" })]);
const fixtures = [..."abc"].map((key, index) => ({
  id: `qa-window-${key}`, content: `窗口 ${key.toUpperCase()}\n原始便签`, attachments: [],
  createdAt: "2026-10-03T00:00:00Z", updatedAt: `2026-10-03T00:00:0${3-index}Z`, syncState: "local", theme: ["paper", "sage", "sky"][index],
}));
await writeFile(join(root, "notes.json"), JSON.stringify(fixtures));
const binary = join(cwd, "src-tauri", "target", "debug", `desk-tabs${process.platform === "win32" ? ".exe" : ""}`);
async function result(phase) {
  const notes = JSON.parse(await readFile(join(root, "notes.json"), "utf8"));
  const note = notes.find((note) => note.id === `qa-window-phase-${phase === 1 ? "one" : "two"}`);
  return note ? JSON.parse(note.content) : null;
}
async function phase(number) {
  await new Promise((resolve, reject) => {
    const child = spawn(binary, [], { cwd, stdio: "inherit", env: { ...process.env, DESK_TABS_DEV_DATA_DIR: root, DESK_TABS_DEV_WINDOW_SMOKE: String(number) } });
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timeout); clearInterval(poll);
      if (error) { child.kill("SIGTERM"); reject(error); } else resolve();
    };
    const timeout = setTimeout(() => finish(new Error(`Window phase ${number} did not finish; results: ${root}`)), 60000);
    const poll = setInterval(() => { void result(number).then((value) => {
      if (value && !value.passed) finish(new Error(JSON.stringify(value)));
    }).catch(() => {}); }, 200);
    child.on("error", finish);
    child.on("exit", (code) => finish(code === 0 ? undefined : new Error(`Window QA exited with ${code}`)));
  });
  const value = await result(number);
  assert.equal(value?.passed, true, JSON.stringify(value));
  console.log(JSON.stringify(value));
  return value;
}
const first = await phase(1);
const layouts = JSON.parse(await readFile(join(root, "note-windows.json"), "utf8"));
assert.equal(layouts["qa-window-a"].open, true);
assert.equal(layouts["qa-window-a"].pinned, true);
assert.equal(layouts["qa-window-b"].open, false);
assert.equal(layouts["qa-window-c"].open, false);
const second = await phase(2);
await writeFile(join(root, "qa-result.json"), JSON.stringify({ passed: true, platform: process.platform, first, layouts, second }, null, 2));
console.log(`Window QA passed. Evidence: ${join(root, "qa-result.json")}`);
