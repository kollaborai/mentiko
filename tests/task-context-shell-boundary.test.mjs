import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const source = readFileSync(join(root, "lib", "chain-runner.sh"), "utf8");
const start = source.indexOf("load_task_context() {");
const end = source.indexOf("# -------------------------------------------------------------------\n# substitute_placeholders", start);
assert.ok(start >= 0 && end > start, "task context function must remain discoverable");
const body = source.slice(start, end).replace(/^\s*#.*$/gm, "");

assert.match(body, /runner-task-context\.js/);
assert.match(body, /source "\$env_file"/);
for (const forbidden of ["curl", "jq", "sed", "awk", "grep", "cat", "JSON.parse", "echo \"\$task_json\""]) {
  assert.doesNotMatch(body, new RegExp(forbidden.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")), forbidden);
}
assert.doesNotMatch(body, /\|\|\s*echo/, "no shell fallback payload");
execFileSync("bash", ["-n", join(root, "lib", "chain-runner.sh")]);

console.log("task context shell boundary: typed invocation and env handoff only");
