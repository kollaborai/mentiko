import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const source = readFileSync(join(root, "lib", "audit-ship.sh"), "utf8")
  .split("\n")
  .map((line) => line.replace(/#.*/, ""))
  .join("\n");

assert.match(source, /exec node .*runner-audit-ship\.js/);
for (const forbidden of ["jq", "grep", "sed", "awk", "cat ", "date ", "mkdir ", "mktemp", "while ", "for ", "rclone", "curl", "sleep ", "read "]) {
  assert.doesNotMatch(source, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `audit-ship shell must not own ${forbidden.trim()}`);
}
assert.doesNotMatch(source, /fallback|compatibility/i);
execFileSync("bash", ["-n", join(root, "lib", "audit-ship.sh")]);

console.log("audit-ship shell boundary: typed invocation-only adapter");
