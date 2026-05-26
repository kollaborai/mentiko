#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repoRoot, "lib", "mentiko-cli-generation.mjs");
const tmp = `/tmp/test-mentiko-cli-generation-${process.pid}`;
const runDir = join(tmp, "runs", "run-token-file");
const artifactsDir = join(runDir, "artifacts");
const tokenDir = join(runDir, ".internal");
const artifactPath = join(artifactsDir, "generation-result.json");
const fetchHookPath = join(tmp, "fetch-hook.mjs");
const fetchLogPath = join(tmp, "fetch-log.json");
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✔ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✖ ${name}`);
    console.log(`    ${error.message}`);
    failed += 1;
  }
}

await test("generation import uses run-scoped token file when env token is absent", async () => {
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(artifactsDir, { recursive: true });
  mkdirSync(tokenDir, { recursive: true });
  writeFileSync(artifactPath, JSON.stringify({ title: "Imported Task", type: "task", priority: 2 }));
  writeFileSync(join(tokenDir, "generation-import-token"), "token-from-file\n", { mode: 0o600 });
  writeFileSync(fetchHookPath, `
import { writeFileSync } from "node:fs";

globalThis.fetch = async (url, init = {}) => {
  const headers = Object.fromEntries(Object.entries(init.headers || {}));
  writeFileSync(process.env.TEST_FETCH_LOG, JSON.stringify({
    url: String(url),
    method: init.method || "GET",
    authorization: headers.Authorization || headers.authorization || "",
    body: init.body || "",
  }));
  const ok = (headers.Authorization || headers.authorization) === "Bearer token-from-file";
  return {
    ok,
    status: ok ? 200 : 401,
    text: async () => JSON.stringify({ success: ok }),
  };
};
`, "utf8");

  const result = spawnSync("node", [
    cliPath,
    "import",
    artifactPath,
    "--job",
    "job-token-file",
    "--kind",
    "task",
    "--run",
    "run-token-file",
  ], {
    encoding: "utf8",
    timeout: 5000,
    env: {
      ...process.env,
      NODE_OPTIONS: `--import ${fetchHookPath}`,
      TEST_FETCH_LOG: fetchLogPath,
      MENTIKO_WEB_URL: "http://mentiko.test",
      MENTIKO_JOB_IMPORT_TOKEN: "",
      BETTER_AUTH_SECRET: "",
      NAMESPACE_ID: "default",
      ORG_ID: "default",
    },
  });

  assert(result.status === 0, `expected import success, got ${result.status}: ${result.stderr || result.stdout}`);
  const observed = JSON.parse(readFileSync(fetchLogPath, "utf8"));
  assert(observed.url === "http://mentiko.test/api/jobs/job-token-file/complete", `wrong callback url: ${observed.url}`);
  assert(observed.authorization === "Bearer token-from-file", `wrong auth: ${observed.authorization}`);
  assert(JSON.parse(observed.body).runId === "run-token-file", "runId missing from callback body");
  assert(existsSync(artifactPath), "artifact should stay in place");
});

if (failed > 0) {
  console.log(`\n${failed} failed, ${passed} passed`);
  process.exit(1);
}

console.log(`\n${passed} passed`);
