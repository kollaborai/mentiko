// tests for lib/mentiko-cli-tasks.mjs — the gate logic (dispatch, required args,
// the --yes discipline on close, the no-credential exit). The ops calls themselves
// are the shared opsRequest proven in phases 1-2; these pin the CLI surface.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const root = new URL("..", import.meta.url).pathname;
const cli = join(root, "lib", "mentiko-cli-tasks.mjs");

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

await ok("unknown task command -> exit 2", async () => {
  const { code, stderr } = await run("bogus_task", []);
  assert.equal(code, 2);
  assert.match(JSON.parse(stderr).error.message, /unknown task command/);
});

await ok("create_task without --subject -> exit 2", async () => {
  const { code, stderr } = await run("create_task", []);
  assert.equal(code, 2);
  assert.match(JSON.parse(stderr).error.message, /--subject/);
});

await ok("get_task without --id -> exit 2", async () => {
  const { code } = await run("get_task", []);
  assert.equal(code, 2);
});

await ok("close_task without --yes -> exit 2 (destructive discipline)", async () => {
  const { code, stderr } = await run("close_task", ["--id", "TASK-1"]);
  assert.equal(code, 2);
  assert.match(JSON.parse(stderr).error.message, /--yes required/);
});

await ok("link_task without --depends-on -> exit 2", async () => {
  const { code } = await run("link_task", ["--id", "TASK-1"]);
  assert.equal(code, 2);
});

await ok("no credential -> exit 3 (auth failure, not a crash)", async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "mentiko-tasks-test-"));
  try {
    const { code, stderr } = await run("list_tasks", ["--web-url", "http://127.0.0.1:9"], { MENTIKO_GLOBAL_ROOT: tmpRoot });
    assert.equal(code, 3);
    assert.match(JSON.parse(stderr).error.message, /not authenticated|mentiko auth/i);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

console.log(`\nmentiko-cli-tasks: ${passed}/${passed} passed`);
