import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = createRequire(import.meta.url).resolve("@tauri-apps/cli/tauri.js");
const source = join(root, "assets", "branding", "desk-tabs-mascot.png");
const nativeIcons = join(root, "src-tauri", "icons");
const publicDirectory = join(root, "public");
const temporary = mkdtempSync(join(tmpdir(), "desk-tabs-icons-"));

try {
  // Tauri exports all native sizes from the same transparent mascot original.
  execFileSync(process.execPath, [cli, "icon", source, "--output", nativeIcons], { cwd: root, stdio: "inherit" });
  execFileSync(process.execPath, [cli, "icon", source, "--output", temporary,
    "--png", "64", "--png", "256", "--png", "1024"], { cwd: root, stdio: "inherit" });
  mkdirSync(publicDirectory, { recursive: true });
  copyFileSync(join(temporary, "256x256.png"), join(publicDirectory, "desk-tabs-logo.png"));
  copyFileSync(join(temporary, "64x64.png"), join(publicDirectory, "desk-tabs-favicon.png"));
  copyFileSync(join(temporary, "1024x1024.png"), join(root, "assets", "branding", "desk-tabs-icon.png"));
  copyFileSync(join(nativeIcons, "icon.icns"), join(root, "assets", "branding", "desk-tabs.icns"));
  console.log("✓ Generated mascot icons → src-tauri/icons/, public/ and assets/branding/");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
