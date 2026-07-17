#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

for (const file of ["parallel-launcher.sh", "parallel-coordinator.sh"]) {
  if (existsSync(join(import.meta.dirname, "..", "lib", file))) {
    throw new Error(`${file} was retired and must not return as a parallel orchestration fallback`);
  }
}
console.log("PASS: retired parallel shell adapters have no executable fallback");

const chainRunner = readFileSync(join(import.meta.dirname, "..", "lib", "chain-runner.sh"), "utf8").replace(/^\s*#.*$/gm, "");
for (const pattern of [/\.tracking\b/, /\bmkdir\b[^\n]*parallel/, /echo\s+['\"]status:\s+running/]) {
  if (pattern.test(chainRunner)) throw new Error(`chain-runner still owns parallel tracking state: ${pattern}`);
}
if (!chainRunner.includes("runner-v2-direct-run.js")) throw new Error("chain-runner must exec the typed direct runner");
if (chainRunner.includes("parallel")) throw new Error("chain-runner must not retain a parallel execution branch");
console.log("PASS: chain-runner has no parallel ownership and only execs typed direct run");
