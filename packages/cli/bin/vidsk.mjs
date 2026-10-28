#!/usr/bin/env node
// Runs the built CLI when available, otherwise the TypeScript sources through tsx (dev/monorepo use).
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, "../dist/main.js");
if (existsSync(built) && !process.env.VIDSK_FROM_SOURCE) {
  await import(pathToFileURL(built).href);
} else {
  const require = createRequire(import.meta.url);
  const tsx = pathToFileURL(require.resolve("tsx/esm")).href;
  const child = spawn(process.execPath, ["--conditions=source", "--import", tsx, join(here, "../src/main.ts"), ...process.argv.slice(2)], { stdio: "inherit" });
  child.on("exit", (code, sig) => (sig ? process.kill(process.pid, sig) : process.exit(code ?? 0)));
}
