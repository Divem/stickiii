import { execFileSync } from "node:child_process";
import { readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { withPackageVersion } from "./version.mjs";

if (process.platform !== "win32") throw Error("package:win requires Windows");
const root = fileURLToPath(new URL("../", import.meta.url));
const [mode, ...args] = process.argv.slice(2);
if (!["default", "managed", "offline"].includes(mode)) throw Error("Unknown Windows installer mode");
withPackageVersion(root, `win-${mode}`, args, (version) => {
  const command = ["exec", "--", "tauri", "build", "--bundles", "nsis"];
  if (mode !== "default") command.push("--config", `src-tauri/tauri.${mode}.conf.json`);
  // Node on Windows requires a shell for the trusted npm.cmd executable.
  execFileSync("npm.cmd", command, { cwd: root, stdio: "inherit", shell: true });
  const directory = join(root, "src-tauri/target/release/bundle/nsis");
  const installers = readdirSync(directory).filter((name) => name.includes(`_${version}_`) && name.endsWith(".exe") && !/-(managed|offline)\.exe$/.test(name));
  if (!installers.length) throw Error("No installer found for the assigned version");
  return installers.map((name) => {
    const source = join(directory, name);
    if (mode === "default") return source;
    const destination = join(directory, name.replace(/\.exe$/, `-${mode}.exe`));
    renameSync(source, destination);
    return destination;
  });
});
