#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const shell = readFileSync(join(root, "lib", "version-control.sh"), "utf8").replace(/^\s*#.*$/gm, "");
const typed = readFileSync(join(root, "web", "lib", "runner-v2", "version-control.ts"), "utf8");
const cli = readFileSync(join(root, "web", "lib", "runner-v2", "version-control-cli.ts"), "utf8");

for (const pattern of [
  /\bjq\b/, /\bsed\b/, /\bawk\b/, /\bgrep\b/, /\bsort\b/, /\bcomm\b/, /\bmd5\b/, /JSON\.parse/,
  /\bwhile\b/, /\bfor\b/, /\bdiff\s+-u/, /\|\|\s*(true|echo)/,
]) {
  if (pattern.test(shell)) throw new Error(`version-control.sh still owns contract logic: ${pattern}`);
}
if (!shell.includes("runner-version-control.js")) throw new Error("version-control.sh must invoke the typed bundle");
if (!typed.includes("export function createVersion") || !typed.includes("export function rollback")) {
  throw new Error("typed version-control owner is incomplete");
}
if (!cli.includes("runVersionControlCli")) throw new Error("typed version-control CLI is missing");
if (!existsSync(join(root, "lib", "runner-version-control.js"))) throw new Error("compiled version-control bundle is missing");
console.log("PASS: version-control.sh is an invocation-only adapter");
