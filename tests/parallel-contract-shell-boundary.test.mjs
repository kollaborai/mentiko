#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

for (const file of ["parallel-launcher.sh", "parallel-coordinator.sh"]) {
  const source = readFileSync(join(import.meta.dirname, "..", "lib", file), "utf8").replace(/^\s*#.*$/gm, "");
  for (const pattern of [/\bjq\b/, /JSON\.parse/, /node\s+-e/, /\.tracking\b/, /\bmkdir\b[^\n]*parallel/, /\bdate\b[^\n]*%Y/]) {
    if (pattern.test(source)) throw new Error(`${file} still owns parallel contract state: ${pattern}`);
  }
  if (file === "parallel-launcher.sh" && !source.includes("runner-parallel-contract.js")) throw new Error(`${file} must invoke the typed parallel contract`);
  if (file === "parallel-launcher.sh" && source.includes('source "$SCRIPT_DIR/chain-runner.sh"')) throw new Error(`${file} must not source the monolithic runner`);
  if (file === "parallel-coordinator.sh" && !source.includes("parallel-launcher.sh")) throw new Error(`${file} must delegate to the typed launcher boundary`);
}
console.log("PASS: parallel shell adapters own no tracking contract");

const chainRunner = readFileSync(join(import.meta.dirname, "..", "lib", "chain-runner.sh"), "utf8").replace(/^\s*#.*$/gm, "");
for (const pattern of [/\.tracking\b/, /\bmkdir\b[^\n]*parallel/, /echo\s+['\"]status:\s+running/]) {
  if (pattern.test(chainRunner)) throw new Error(`chain-runner still owns parallel tracking state: ${pattern}`);
}
if (!chainRunner.includes("runner-parallel-contract.js")) throw new Error("chain-runner must invoke the typed parallel contract");
console.log("PASS: chain-runner delegates parallel state to the typed contract");
