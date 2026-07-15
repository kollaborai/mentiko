import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const source = readFileSync(join(root, "lib", "notification-dispatcher.sh"), "utf8")
  .split("\n")
  .map((line) => line.replace(/#.*/, ""))
  .join("\n");

// the shell forwards primitive arguments to the compiled notification bundle
assert.match(source, /runner-notification-dispatcher\.js/);
assert.match(source, /node "\$cli"/);
// no data-contract ownership remains in the shell
for (const forbidden of ["jq", "grep", "sed", "awk", "cat ", "curl", "date ", "while ", "for "]) {
  assert.doesNotMatch(source, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `notification-dispatcher shell must not own ${forbidden.trim()}`);
}
assert.doesNotMatch(source, /fallback|compatibility/i);
// the source-compatible bash function interface is preserved
for (const fn of [
  "dispatch-notification",
  "dispatch-chain-completed",
  "dispatch-chain-failed",
  "dispatch-chain-stopped",
  "dispatch-agent-completed",
  "dispatch-agent-failed",
  "dispatch-chain-stalled",
]) {
  assert.match(source, new RegExp(`export -f ${fn}`));
}
execFileSync("bash", ["-n", join(root, "lib", "notification-dispatcher.sh")]);

console.log("notification-dispatcher shell boundary: typed invocation-only adapter");
