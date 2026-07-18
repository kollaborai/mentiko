#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
const source = readFileSync(join(import.meta.dirname, "..", "lib", "cli-readiness-enhanced.sh"), "utf8").replace(/^\s*#.*$/gm, "");
for (const pattern of [/\bwhile\b/, /\bsleep\b/, /transport_(capture|has_session|pid)/, /cli_readiness_(check|field)/, /\|\|\s*true/]) if (pattern.test(source)) throw new Error(`readiness shell must not own polling/classification/fallback: ${pattern}`);
if (!source.includes("_cli_readiness_cli wait")) throw new Error("readiness shell must invoke typed wait");
console.log("PASS: readiness shell is an invocation-only adapter");
