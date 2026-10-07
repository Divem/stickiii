import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bumpVersion, checkVersion, packagingBump, withPackageVersion } from "./version.mjs";

function fixture(t, version = "0.1.0") {
  const root = mkdtempSync(join(tmpdir(), "stickiii-version-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "src-tauri"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "desk-tabs", version, scripts: { build: "unchanged" } }, null, 2) + "\n");
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ name: "desk-tabs", version, packages: { "": { version }, "node_modules/fixture": { version: "1.2.3" } } }, null, 2) + "\n");
  writeFileSync(join(root, "src-tauri/Cargo.toml"), `[package]\nname = "desk-tabs"\nversion = "${version}"\npublish = false\n\n[dependencies]\nfixture = "1.2.3"\n`);
  writeFileSync(join(root, "src-tauri/Cargo.lock"), `version = 4\n\n[[package]]\nname = "desk-tabs"\nversion = "${version}"\ndependencies = ["fixture"]\n\n[[package]]\nname = "fixture"\nversion = "1.2.3"\n`);
  writeFileSync(join(root, "src-tauri/tauri.conf.json"), JSON.stringify({ version: "../package.json" }));
  return root;
}

test("patch, minor and major synchronize npm and Rust while preserving dependencies and Tauri's reference", (t) => {
  for (const [release, expected] of [["patch", "0.7.10"], ["minor", "0.8.0"], ["major", "1.0.0"]]) {
    const root = fixture(t, "0.7.9");
    assert.equal(bumpVersion(root, release), expected);
    assert.equal(checkVersion(root), expected);
    const pkg = JSON.parse(readFileSync(join(root, "package.json")));
    assert.equal(pkg.scripts.build, "unchanged");
    assert.equal(JSON.parse(readFileSync(join(root, "package-lock.json"))).packages["node_modules/fixture"].version, "1.2.3");
    assert.match(readFileSync(join(root, "src-tauri/Cargo.lock"), "utf8"), /name = "fixture"\nversion = "1.2.3"/);
    assert.equal(JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"))).version, "../package.json");
  }
});

test("version drift is rejected before modifying any version file", (t) => {
  for (const path of ["package-lock.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]) {
    const root = fixture(t);
    const changed = join(root, path);
    writeFileSync(changed, readFileSync(changed, "utf8").replaceAll("0.1.0", "0.1.1"));
    const before = readFileSync(join(root, "package.json"), "utf8");
    assert.throws(() => bumpVersion(root, "patch"), /不一致/);
    assert.equal(readFileSync(join(root, "package.json"), "utf8"), before);
    assert.equal(existsSync(join(root, ".stickiii-package.lock")), false);
  }
});

test("partial version write failure rolls back prior files and preserves the conflicting temporary file", (t) => {
  const root = fixture(t);
  const conflict = join(root, `package-lock.json.${process.pid}.tmp`);
  writeFileSync(conflict, "existing");
  assert.throws(() => bumpVersion(root, "patch"), /EEXIST/);
  assert.equal(checkVersion(root), "0.1.0");
  assert.equal(readFileSync(conflict, "utf8"), "existing");
});

test("packaging defaults to patch and rejects ambiguous arguments", () => {
  assert.equal(packagingBump([]), "patch");
  assert.equal(packagingBump(["--no-bump"]), null);
  assert.equal(packagingBump(["--bump", "minor"]), "minor");
  for (const args of [["--bump"], ["--bump", "unknown"], ["--no-bump", "--bump", "patch"], ["--anything"]]) assert.throws(() => packagingBump(args));
});

test("build runs with the assigned version, and its record contains source status and artifact checksum", (t) => {
  const root = fixture(t);
  let calls = 0;
  const artifact = join(root, "fixture.exe"); writeFileSync(artifact, "abc");
  const record = withPackageVersion(root, "test", [], (version) => {
    calls++; assert.equal(version, "0.1.1"); assert.equal(checkVersion(root), version);
    assert.throws(() => bumpVersion(root, "minor"), /持有/);
    return [artifact];
  });
  assert.equal(calls, 1);
  assert.equal(record.version, "0.1.1");
  assert.equal(record.sourceCommit, null); assert.equal(record.sourceDirty, null);
  assert.deepEqual(record.artifacts, [{ path: "fixture.exe", sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" }]);
  assert.deepEqual(JSON.parse(readFileSync(join(root, "src-tauri/target/release/bundle/build-0.1.1-test.json"))), record);
});

test("failed build retains the allocated version, releases its lock and permits an explicit retry", (t) => {
  const root = fixture(t);
  assert.throws(() => withPackageVersion(root, "test", [], () => { throw Error("build failed"); }), /build failed/);
  assert.equal(checkVersion(root), "0.1.1");
  assert.equal(existsSync(join(root, ".stickiii-package.lock")), false);
  assert.equal(existsSync(join(root, "src-tauri/target/release/bundle/build-0.1.1-test.json")), false);
  withPackageVersion(root, "test", ["--no-bump"], () => []);
  assert.equal(checkVersion(root), "0.1.1");
  withPackageVersion(root, "test", [], () => []);
  assert.equal(checkVersion(root), "0.1.2");
});

test("invalid version syntax and an independent Tauri version cannot silently diverge", (t) => {
  for (const version of ["01.1.0", "0.1.0-beta", "0.1", ""])
    assert.throws(() => checkVersion(fixture(t, version)), /X.Y.Z/);
  const root = fixture(t);
  writeFileSync(join(root, "src-tauri/tauri.conf.json"), '{"version":"0.1.0"}');
  assert.throws(() => bumpVersion(root, "patch"), /Tauri/);
  assert.equal(JSON.parse(readFileSync(join(root, "package.json"))).version, "0.1.0");
});
