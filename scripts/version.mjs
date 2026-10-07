import { closeSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const releases = ["patch", "minor", "major"];

export function packagingBump(args) {
  if (!args.length) return "patch";
  if (args.length === 1 && args[0] === "--no-bump") return null;
  if (args.length === 2 && args[0] === "--bump" && releases.includes(args[1])) return args[1];
  throw Error("使用 --bump patch|minor|major，或 --no-bump 复用当前版本。");
}

function versionFiles(directory) {
  const paths = ["package.json", "package-lock.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"];
  const texts = paths.map((path) => readFileSync(join(directory, path), "utf8"));
  const pkg = JSON.parse(texts[0]);
  const lock = JSON.parse(texts[1]);
  const cargo = texts[2].split(/(?=^\[)/m).filter((part) => /^\[package\]\s/m.test(part));
  const cargoLock = texts[3].split(/(?=^\[\[package\]\])/m).filter((part) => /^name = "desk-tabs"\s*$/m.test(part));
  if (cargo.length !== 1 || cargoLock.length !== 1) throw Error("找不到唯一的 Rust 应用版本段。");
  const versions = [pkg.version, lock.version, lock.packages?.[""]?.version,
    /^version = "([^"]+)"/m.exec(cargo[0])?.[1], /^version = "([^"]+)"/m.exec(cargoLock[0])?.[1]];
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(pkg.version) || versions.some((version) => version !== pkg.version)) throw Error("npm 与 Rust 版本不一致，或版本不是 X.Y.Z；请先修正，再升版。");
  if (JSON.parse(readFileSync(join(directory, "src-tauri/tauri.conf.json"), "utf8")).version !== "../package.json") throw Error("Tauri 版本必须引用 ../package.json。");
  return { paths, texts, pkg, lock, cargo: cargo[0], cargoLock: cargoLock[0], version: pkg.version };
}

export function checkVersion(directory = root) { return versionFiles(directory).version; }

function withVersionLock(directory, run) {
  const path = join(directory, ".stickiii-package.lock");
  let fd;
  try { fd = openSync(path, "wx", 0o600); }
  catch (error) {
    if (error.code === "EEXIST") throw Error("已有升版/打包任务持有 .stickiii-package.lock；确认没有任务运行后才能清理残留锁。");
    throw error;
  }
  try { writeFileSync(fd, `${process.pid}\n`); return run(); }
  finally { closeSync(fd); rmSync(path); }
}

function atomicWrite(path, content) {
  const temporary = `${path}.${process.pid}.tmp`;
  let created = false;
  try {
    const fd = openSync(temporary, "wx", statSync(path).mode);
    created = true;
    try { writeFileSync(fd, content); } finally { closeSync(fd); }
    renameSync(temporary, path);
  } finally { if (created) rmSync(temporary, { force: true }); }
}

function updateVersion(directory, release) {
  const files = versionFiles(directory);
  if (!releases.includes(release)) throw Error("升版类型必须是 patch、minor 或 major。");
  const numbers = files.version.split(".").map(Number);
  const index = { major: 0, minor: 1, patch: 2 }[release];
  if (numbers.some((number) => !Number.isSafeInteger(number)) || !Number.isSafeInteger(numbers[index] + 1)) throw Error("版本号超出安全整数范围。");
  numbers[index]++;
  numbers.fill(0, index + 1);
  const next = numbers.join(".");
  files.pkg.version = next; files.lock.version = next; files.lock.packages[""].version = next;
  const replace = (part) => part.replace(/^version = "[^"]+"/m, `version = "${next}"`);
  const texts = [JSON.stringify(files.pkg, null, 2) + "\n", JSON.stringify(files.lock, null, 2) + "\n",
    files.texts[2].replace(files.cargo, replace(files.cargo)), files.texts[3].replace(files.cargoLock, replace(files.cargoLock))];
  const written = [];
  try {
    texts.forEach((text, i) => { atomicWrite(join(directory, files.paths[i]), text); written.push(i); });
  } catch (error) {
    for (const i of written.reverse()) atomicWrite(join(directory, files.paths[i]), files.texts[i]);
    throw error;
  }
  console.log(`版本 ${files.version} → ${next}`);
  return next;
}

export function bumpVersion(directory, release) { return withVersionLock(directory, () => updateVersion(directory, release)); }

export function withPackageVersion(directory, target, args, build) {
  const release = packagingBump(args);
  return withVersionLock(directory, () => {
    const version = release ? updateVersion(directory, release) : checkVersion(directory);
    const startedAt = new Date().toISOString();
    let sourceCommit = null, sourceDirty = null;
    try {
      const git = (args) => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      sourceCommit = git(["rev-parse", "HEAD"]); sourceDirty = !!git(["status", "--porcelain"]);
    } catch { /* An exported source tree need not contain .git. */ }
    // Keep the assigned version after a failed build: partial artifacts may exist.
    const artifacts = build(version);
    const record = { version, target, startedAt, completedAt: new Date().toISOString(), sourceCommit, sourceDirty,
      artifacts: artifacts.map((path) => ({ path: relative(directory, path), sha256: createHash("sha256").update(readFileSync(path)).digest("hex") })) };
    const output = join(directory, "src-tauri/target/release/bundle", `build-${version}-${target}.json`);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify(record, null, 2) + "\n");
    console.log(`✓ 构建记录 ${output}`);
    return record;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, ...rest] = process.argv.slice(2);
  if (rest.length || !["check", ...releases].includes(action)) throw Error("使用 npm run version:check，或 npm run version:bump -- patch|minor|major。");
  if (action === "check") console.log(`版本一致：${checkVersion()}`);
  else bumpVersion(root, action);
}
