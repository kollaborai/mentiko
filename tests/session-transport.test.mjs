#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dirname, "..");
const tmp = mkdtempSync(join(tmpdir(), "mentiko-session-transport-"));
const fakePtyMgr = join(tmp, "fake-pty-mgr");
const logFile = join(tmp, "pty.log");
const configSh = join(repoRoot, "lib", "config.sh");
const sessionTransport = join(repoRoot, "lib", "session-transport.sh");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✔ ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`  ✖ ${name}`);
    console.log(`    ${err.message}`);
    failed += 1;
  }
}

writeFileSync(fakePtyMgr, `#!/bin/sh
echo "daemon=$PTY_DAEMON args=$*" >> "${logFile}"
case "$1" in
  status) [ -f "${tmp}/daemon.ready" ] && exit 0 || exit 1 ;;
  daemon) touch "${tmp}/daemon.ready"; exit 0 ;;
  spawn) exit 0 ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 });

test("session transport scopes pty-manager by root and namespace", () => {
  execFileSync("bash", ["-lc", `
set -euo pipefail
export MENTIKO_PTY_MGR_BIN=${JSON.stringify(fakePtyMgr)}
export MENTIKO_GLOBAL_ROOT=/tmp/mentiko-cache-proof-123
export MENTIKO_CODE_ROOT=${JSON.stringify(repoRoot)}
export NAMESPACE_ID=cacheproof
export ORG_ID=default
source ${JSON.stringify(configSh)}
source ${JSON.stringify(sessionTransport)} >/dev/null
transport_new_session smoke sh -lc true
`], { encoding: "utf8" });

  const log = readFileSync(logFile, "utf8");
  assert(log.includes("args=status"), `status should be checked: ${log}`);
  assert(log.includes("args=daemon"), `daemon should be started: ${log}`);
  assert(log.includes("args=spawn smoke sh -lc true"), `spawn should run: ${log}`);
  assert(log.includes("daemon=mentiko-"), `daemon should be named: ${log}`);
  assert(log.includes("cacheproof"), `daemon should include namespace: ${log}`);
  assert(!log.includes("daemon= args="), `daemon should not be empty/default: ${log}`);
});

rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
