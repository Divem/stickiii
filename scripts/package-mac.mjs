import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") throw new Error("package:mac requires macOS");
const root = fileURLToPath(new URL("../", import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const config = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const { productName } = config;
execFileSync("npm", ["exec", "--", "tauri", "build", "--bundles", "app"], { cwd: root, stdio: "inherit" });

const bundle = join(root, "src-tauri", "target", "release", "bundle");
const app = join(bundle, "macos", `${productName}.app`);
// A linker's ad-hoc signature covers only the binary. Seal the complete bundle
// for local installs, while preserving a configured release signing identity.
if (!config.bundle?.macOS?.signingIdentity && !process.env.APPLE_SIGNING_IDENTITY) {
  execFileSync("codesign", ["--force", "--sign", "-", app], { stdio: "inherit" });
}
execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
const architecture = execFileSync("lipo", ["-archs", join(app, "Contents", "MacOS", "desk-tabs")], { encoding: "utf8" }).trim();
const label = architecture.includes("arm64") && architecture.includes("x86_64") ? "universal" : architecture === "arm64" ? "aarch64" : "x64";
const output = join(bundle, "dmg", `${productName}_${version}_${label}.dmg`);
const staging = mkdtempSync(join(tmpdir(), "desk-tabs-dmg-"));
try {
  cpSync(app, join(staging, `${productName}.app`), { recursive: true, dereference: false });
  symlinkSync("/Applications", join(staging, "Applications"), "dir");
  mkdirSync(join(bundle, "dmg"), { recursive: true });
  // Create directly from staging: no mounted volume, Finder automation or detach race.
  execFileSync("hdiutil", ["create", "-volname", productName, "-srcfolder", staging, "-ov", "-format", "UDZO", "-imagekey", "zlib-level=9", output], { stdio: "inherit" });
  execFileSync("hdiutil", ["verify", output], { stdio: "inherit" });
  console.log(`✓ Packaged ${app}\n✓ Verified ${output}`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
