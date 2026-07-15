import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = new URL("..", import.meta.url).pathname;

function sourceWithoutComments(path) {
  return readFileSync(join(root, path), "utf8")
    .split("\n")
    .map((line) => line.replace(/#.*/, ""))
    .join("\n");
}

test("agent activity capture shell is an invocation-only adapter", () => {
  const source = sourceWithoutComments("lib/agent-activity-capture.sh");
  assert.match(source, /runner-activity-capture\.js/);
  assert.match(source, /node\s+"\$cli"\s+"\$\{args\[@\]\}"/);
  for (const forbidden of [
    "jq", "awk", "sed", "date", "find", "git ", "cp ", "cat ", "mkdir ",
    "resolve_log_dir", "find_conversation_files", "_run_record_cli", "while ",
  ]) {
    assert.doesNotMatch(source, new RegExp(forbidden.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")), forbidden);
  }
  assert.doesNotMatch(source, /\|\|\s*true/, "no swallowed typed errors");
});
