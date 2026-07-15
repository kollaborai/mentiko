import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const root = join(import.meta.dirname, "..");
const source = readFileSync(join(root, "lib", "concurrency-cap.sh"), "utf8");
const executableSource = source.replace(/^\s*#.*$/gm, "");

test("concurrency cap is an invocation-only shell boundary", () => {
  assert.match(source, /runner-concurrency-admission\.js/);
  assert.match(source, /wait-chain/);
  assert.match(source, /wait-agent/);
  assert.match(source, /PTY_CMD/);
  for (const pattern of [/\bwhile\s+(?:true|\[\[)/, /\bfor\s+(?:\w+\s+)?in\b/, /\bsleep\b/, /\bdate\b/, /\bawk\b/, /\bjq\b/, /\bgrep\b/, /update-run-status/, /transport_list_sessions/]) {
    assert.doesNotMatch(executableSource, pattern, `shell cap must not own admission behavior: ${pattern}`);
  }
});
