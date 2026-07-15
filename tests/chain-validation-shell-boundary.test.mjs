#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dirname, "..", "lib", "validate.sh"), "utf8").replace(/^\s*#.*$/gm, "");
for (const pattern of [/\bjq\b/, /JSON\.parse/, /node\s+-e/, /\bwhile\b/, /\bfor\b/, /\bsed\b/, /\bgrep\b/, /\bawk\b/]) {
  if (pattern.test(source)) throw new Error(`validate.sh still owns chain contract logic: ${pattern}`);
}
if (!source.includes("runner-chain-validation.js")) throw new Error("validate.sh must invoke the typed chain validator");
console.log("PASS: validate.sh is an invocation-only adapter");
