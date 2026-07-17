#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const shell = readFileSync(join(root, "lib", "session-log-resolver.sh"), "utf8");
const source = readFileSync(join(root, "web", "lib", "runs", "session-log-resolver-cli.ts"), "utf8");
const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");

assert.match(shell, /runner-session-log-resolver\.js/);
assert.match(shell, /_session_log_resolver_cli/);
for (const name of ["encode_cwd_slug", "resolve_log_dir", "resolve_session_log", "find_conversation_files"]) {
  const start = shell.indexOf(`${name}()`);
  assert.notEqual(start, -1, `${name} must remain callable by source-based legacy callers`);
  const body = shell.slice(start, shell.indexOf("}\n", start) + 2);
  assert.match(body, /_session_log_resolver_cli/);
  assert.doesNotMatch(body, /\b(agent_profile|find|grep|stat|date|sed|awk)\b/);
}
assert.match(source, /profileTranscriptConfig|resolveSessionLog|findConversationFiles/);
assert.match(dockerfile, /session-log-resolver-cli\.ts/);
assert.match(dockerfile, /runner-session-log-resolver\.js/);

const temp = mkdtempSync(join(tmpdir(), "mentiko-session-log-bundle-parity-"));
try {
  const output = join(temp, "runner-session-log-resolver.js");
  execFileSync("npx", ["esbuild", "lib/runs/session-log-resolver-cli.ts", "--bundle", "--platform=node", "--target=node20", `--outfile=${output}`], { cwd: join(root, "web"), stdio: "pipe" });
  assert.equal(readFileSync(output, "utf8"), readFileSync(join(root, "lib", "runner-session-log-resolver.js"), "utf8"), "typed session-log resolver bundle is stale");
  console.log("PASS: session log resolver shell boundary and bundle parity");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
