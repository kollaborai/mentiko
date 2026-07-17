#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const runner = join(root, "lib", "chain-runner.sh");
const source = readFileSync(runner, "utf8");
const completionStart = source.indexOf("build_completion_contract() {");
const completionEnd = source.indexOf("build_agent_context_block() {", completionStart);
if (completionStart < 0 || completionEnd < 0) throw new Error("missing completion contract shell boundary");
const completionBoundary = source.slice(completionStart, completionEnd);

if (!completionBoundary.includes("runner-completion-contract.js")) {
  throw new Error("chain runner must invoke the compiled typed completion-contract CLI");
}
if (/cat\s*<<|COMPLETION CONTRACT:|summary\.json|JSON\.parse/.test(completionBoundary)) {
  throw new Error("chain runner must not construct completion/artifact data contracts in shell");
}
for (const flag of ["--agent-id", "--artifacts-dir", "--events-dir", "--core-generation-chain"]) {
  if (!completionBoundary.includes(flag)) throw new Error(`missing typed completion-contract argument ${flag}`);
}

execFileSync("bash", ["-n", runner]);
console.log("PASS: chain-runner completion contract remains a typed CLI boundary");
