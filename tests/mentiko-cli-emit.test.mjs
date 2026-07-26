// tests for lib/mentiko-cli-emit.mjs — the `mentiko emit` HTTP client + fallback.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const root = new URL("..", import.meta.url).pathname;
const cli = join(root, "lib", "mentiko-cli-emit.mjs");
const { parseEmitArgs } = await import(`file://${cli}`);

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log(`  ok - ${name}`); };

await ok("parses the five flags; scope defaults to run", () => {
  const p = parseEmitArgs(["--scope", "ingress", "--event", "chain-complete", "--source", "a1", "--run-id", "r1", "--data", '{"x":1}']);
  assert.equal(p.scope, "ingress");
  assert.equal(p.event, "chain-complete");
  assert.equal(p.source, "a1");
  assert.equal(p.runId, "r1");
  assert.equal(p.data, '{"x":1}');
  const d = parseEmitArgs(["--event", "e"]);
  assert.equal(d.scope, "run");
  assert.equal(d.event, "e");
});

await ok("missing event -> usage, exit 1", async () => {
  const res = await new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, "emit", "--source", "a"], { cwd: root });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("exit", (code) => resolve({ code, stderr }));
  });
  assert.equal(res.code, 1);
  assert.match(res.stderr, /usage: mentiko emit/);
});

// THE contract: an unreachable server must degrade to a local write, never fail
// closed. An agent that cannot emit wedges a chain hop.
await ok("dead server -> local fallback writes the event + loud log (exit 0)", async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "mentiko-emit-fallback-"));
  mkdirSync(join(tmpRoot, "events"), { recursive: true });
  try {
    const res = await new Promise((resolve) => {
      const child = spawn(process.execPath, [cli, "emit",
        "--scope", "run", "--event", "agent-complete", "--source", "test-agent",
        "--run-id", "test-run-123", "--data", "{}", "--web-url", "http://127.0.0.1:9"],
        { env: { ...process.env, EVENTS_DIR: join(tmpRoot, "events"), MENTIKO_GLOBAL_ROOT: tmpRoot }, cwd: root });
      let stderr = "";
      child.stderr.on("data", (d) => { stderr += d; });
      child.on("exit", (code) => resolve({ code, stderr }));
    });
    assert.equal(res.code, 0, `fallback should exit 0, got ${res.code}: ${res.stderr}`);
    assert.match(res.stderr, /ops route unavailable|writing event locally/i);
    const events = readdirSync(join(tmpRoot, "events")).filter((f) => f.endsWith(".event"));
    assert(events.length > 0, "fallback wrote no event file");
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

console.log(`\nmentiko-cli-emit: ${passed}/${passed} passed`);
