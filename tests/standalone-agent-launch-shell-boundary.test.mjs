#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const launcher = readFileSync(join(root, "lib", "launch-agent.sh"), "utf8");
const functions = readFileSync(join(root, "lib", "agent-functions.sh"), "utf8");
const cli = readFileSync(join(root, "bin", "mentiko"), "utf8");
const typed = readFileSync(join(root, "web", "lib", "runner-v2", "standalone-agent-launch.ts"), "utf8");

function exportedFunction(source, name) {
  const start = source.indexOf(`${name}() {`);
  assert.notEqual(start, -1, `missing ${name} exported boundary`);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}

assert.match(launcher, /^#!\/bin\/bash[\s\S]*exec node .*runner-v2-standalone-agent-launch\.js/m);
assert.doesNotMatch(launcher, /\b(source|grep|sed|xargs|date|sleep|new_pty_session|send-message|_agent_state_cli)\b/);
assert.match(cli, /launch\)[\s\S]*exec node "\$LIB_DIR\/runner-v2-standalone-agent-launch\.js"/);
assert.doesNotMatch(cli, /launch\)[\s\S]*launch-agent\.sh/);
const fromSpec = exportedFunction(functions, "new-agent-from-spec");
assert.match(fromSpec, /node "\$_AF_SCRIPT_DIR\/runner-v2-standalone-agent-launch\.js" "\$@"/);
assert.doesNotMatch(fromSpec, /\b(grep|sed|xargs|date|sleep|new_pty_session|send-message|new-agent-session|_agent_state_cli|runner-v2-standalone-monitor)\b/);
for (const required of ["readStandaloneAgentSpec", "pty.spawn", "createRunnerAgentState", "standaloneAgentInstruction", "runner-v2-standalone-monitor.js"]) {
  assert.ok(typed.includes(required), `typed standalone launcher missing ${required}`);
}
console.log("PASS: standalone spec launch is TypeScript-owned; shell only forwards to the compiled entrypoint");
