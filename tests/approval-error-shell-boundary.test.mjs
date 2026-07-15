#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const approval = readFileSync(join(root, "lib", "approval-gate.sh"), "utf8");
const error = readFileSync(join(root, "lib", "error-handling.sh"), "utf8");

function executableSource(source) {
  return source.split("\n").map((line) => line.replace(/#.*/, "")).join("\n");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const approvalCode = executableSource(approval);
const errorCode = executableSource(error);

for (const forbidden of ["jq", "JSON.parse", "date ", "sleep ", "mkdir"]) {
  assert(!approvalCode.includes(forbidden), `approval gate must not own ${forbidden.trim()} contract logic`);
}
for (const forbidden of ["jq", "JSON.parse", "grep", "awk", "sed", "date ", "sleep ", "mkdir", "curl", "slack-integration"]) {
  assert(!errorCode.includes(forbidden), `error handling must not own ${forbidden.trim()} contract logic`);
}
assert(!/\n\s*(?:while|for)\s+/.test(approvalCode), "approval gate must not own polling loops");
assert(!/\n\s*(?:while|for)\s+/.test(errorCode), "error handling must not own orchestration loops");
assert(approvalCode.includes("runner-approval-gate.js"), "approval shell boundary must invoke typed approval bundle");
assert(errorCode.includes("runner-error-handling.js"), "error shell boundary must invoke typed error bundle");
assert(approvalCode.includes("MENTIKO_PROJECT_ROOT:?"), "approval shell boundary must require configured project root");
assert(errorCode.includes("STATE_DIR:?"), "error shell boundary must require configured state root");
console.log("approval/error shell boundaries: typed-only");
