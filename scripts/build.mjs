import { execFileSync } from "node:child_process";

execFileSync("npm", ["run", "build:renderer"], { stdio: "inherit" });
execFileSync("npm", ["run", "build:main"], { stdio: "inherit" });
console.log("✓ build complete → dist/");
