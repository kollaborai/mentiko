// tests for lib/mentiko-cli-run.mjs — the `mentiko run` HTTP client.
// Pure helpers are unit-tested; the entrypoint behaviors (usage error,
// --dry-run skips HTTP, no-credential failure) are exercised by subprocess.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = new URL("..", import.meta.url).pathname;
const cli = join(root, "lib", "mentiko-cli-run.mjs");
const { parseRunArgs, deriveChainId, buildRequestBody } = await import(`file://${cli}`);

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log(`  ok - ${name}`); };

// ------------------------------------------------------------- parseRunArgs
ok("parses the five flags", () => {
  const o = parseRunArgs(["c.json", "--workspace", "/w", "--start", "a1", "--task", "T-1", "--debug", "--dry-run"]);
  assert.equal(o.chainPath, "c.json");
  assert.equal(o.workspacePath, "/w");
  assert.equal(o.startAgent, "a1");
  assert.equal(o.taskId, "T-1");
  assert.equal(o.debug, true);
  assert.equal(o.dryRun, true);
});

ok("--web-url is a global passthrough (not rejected, not a run field)", () => {
  const o = parseRunArgs(["c.json", "--web-url", "http://127.0.0.1:3200", "--debug"]);
  assert.equal(o.chainPath, "c.json");
  assert.equal(o.debug, true);
  assert.equal("web-url" in o, false);
});

ok("rejects an unknown flag", () => {
  assert.throws(() => parseRunArgs(["c.json", "--bogus"]), /unsupported mentiko run option: --bogus/);
});

ok("rejects a second positional", () => {
  assert.throws(() => parseRunArgs(["c.json", "extra"]), /unexpected positional argument: extra/);
});

ok("rejects a flag missing its value", () => {
  assert.throws(() => parseRunArgs(["c.json", "--start"]), /--start requires a value/);
});

ok("requires a chain path", () => {
  assert.throws(() => parseRunArgs(["--debug"]), /usage: mentiko run/);
});

ok("retires --parallel with a pointer to the replacement", () => {
  assert.throws(() => parseRunArgs(["c.json", "--parallel"]), /--parallel was retired/);
});

// ------------------------------------------------------------- deriveChainId
ok("chains/<id>/chain.json -> <id>", () => {
  assert.equal(deriveChainId("/x/chains/my-chain/chain.json"), "my-chain");
});

ok("<id>.json -> <id>", () => {
  assert.equal(deriveChainId("/tmp/my-chain.json"), "my-chain");
});

ok("bare id -> id", () => {
  assert.equal(deriveChainId("my-chain"), "my-chain");
});

// ------------------------------------------------------------- buildRequestBody
ok("body shape: chainId + startAgent + debug, workspace resolved", () => {
  const body = buildRequestBody({ chainPath: "my-chain", workspacePath: "rel", startAgent: "a1", debug: true });
  assert.equal(body.chainId, "my-chain");
  assert.equal(body.startAgent, "a1");
  assert.equal(body.debug, true);
  assert.equal(body.workspacePath, resolve("rel"));
});

ok("--task maps to taskId, NOT task (task is the userPrompt on the route)", () => {
  const body = buildRequestBody({ chainPath: "my-chain", taskId: "T-1" });
  assert.equal(body.taskId, "T-1");
  assert.equal("task" in body, false);
});

ok("omits unset fields (no debug/startAgent/workspace leak)", () => {
  const body = buildRequestBody({ chainPath: "my-chain" });
  assert.deepEqual(body, { chainId: "my-chain" });
});

ok("rejects a chainPath that yields an invalid chain id", () => {
  assert.throws(() => buildRequestBody({ chainPath: "" }), /not valid/);
});

// ------------------------------------------------------------- subprocess behaviors
function runCli(args, env = {}) {
  return new Promise((resolveFn) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: { ...process.env, ...env },
      cwd: root,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("exit", (code) => resolveFn({ code, stdout, stderr }));
  });
}

ok("entrypoint: no chain path -> exit 2 + JSON usage error", async () => {
  const { code, stderr } = await runCli(["--debug"]);
  assert.equal(code, 2);
  const parsed = JSON.parse(stderr);
  assert.equal(parsed.ok, false);
  assert.match(parsed.error.message, /usage: mentiko run/);
});

ok("--dry-run does NOT attempt HTTP (delegates to the local bundle)", async () => {
  // A dead web-url plus a nonexistent chain: the bundle errors on the chain, but
  // the key signal is that stderr never claims the server is unreachable — proving
  // --dry-run short-circuits before any ops request.
  const { code, stderr } = await runCli(
    ["/no/such/chain.json", "--dry-run", "--web-url", "http://127.0.0.1:9"],
  );
  assert.notEqual(code, 0);
  assert.doesNotMatch(stderr, /cannot reach|web process running/i);
});

ok("no credential -> exit 3 + actionable JSON error (not a crash)", async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "mentiko-run-test-"));
  try {
    const { code, stderr } = await runCli(
      ["some-chain", "--web-url", "http://127.0.0.1:9"],
      { MENTIKO_GLOBAL_ROOT: tmpRoot }, // empty sidecar -> no credential
    );
    assert.equal(code, 3);
    const parsed = JSON.parse(stderr);
    assert.equal(parsed.ok, false);
    assert.match(parsed.error.message, /not authenticated|mentiko auth/i);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

console.log(`\nmentiko-cli-run: ${passed}/${passed} passed`);
