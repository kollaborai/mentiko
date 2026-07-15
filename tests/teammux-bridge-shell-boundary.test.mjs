import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const source = readFileSync(join(root, "lib", "teammux-bridge.sh"), "utf8")
  .split("\n")
  .map((line) => line.replace(/#.*/, ""))
  .join("\n");

assert.match(source, /exec node .*runner-teammux-bridge\.js/);
for (const forbidden of ["jq", "grep", "sed", "awk", "cat ", "date ", "mkdir ", "while ", "for "]) {
  assert.doesNotMatch(source, new RegExp(forbidden.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")), `shell bridge must not own ${forbidden.trim()}`);
}
assert.doesNotMatch(source, /fallback|compatibility/i);
execFileSync("bash", ["-n", join(root, "lib", "teammux-bridge.sh")]);

console.log("team-mux bridge shell boundary: typed invocation-only adapter");
