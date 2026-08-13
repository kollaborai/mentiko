// tests for lib/mentiko-cli-org.mjs — agents/secrets/workspaces gate logic.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const root = new URL("..", import.meta.url).pathname;
const cli = join(root, "lib", "mentiko-cli-org.mjs");

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log(`  ok - ${name}`); };

function run(sub, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, sub, ...args], { env: { ...process.env, ...env }, cwd: root });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

await ok("unknown command -> exit 2", async () => {
  const { code, stderr } = await run("bogus", []);
  assert.equal(code, 2);
  assert.match(JSON.parse(stderr).error.message, /unknown command/);
});

await ok("create_agent needs --name + --prompt -> exit 2", async () => {
  const { code, stderr } = await run("create_agent", ["--name", "x"]);
  assert.equal(code, 2);
  assert.match(JSON.parse(stderr).error.message, /--name and --prompt/);
});

await ok("create_secret needs name/env-var/value -> exit 2", async () => {
  const { code, stderr } = await run("create_secret", ["--name", "x", "--env-var", "X"]);
  assert.equal(code, 2);
  assert.match(JSON.parse(stderr).error.message, /--name, --env-var, --value/);
});

await ok("no credential -> exit 3 (auth failure, not a crash)", async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "mentiko-org-test-"));
  try {
    const { code, stderr } = await run("list_agents", ["--web-url", "http://127.0.0.1:9"], { MENTIKO_GLOBAL_ROOT: tmpRoot });
    assert.equal(code, 3);
    assert.match(JSON.parse(stderr).error.message, /not authenticated|mentiko auth/i);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

console.log(`\nmentiko-cli-org: ${passed}/${passed} passed`);
