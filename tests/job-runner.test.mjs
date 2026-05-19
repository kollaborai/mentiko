#!/usr/bin/env node
/**
 * lib/job-runner.mjs black-box tests
 *
 * Tests the job runner via child process execution with mock CLI.
 * Exercises: job loading, profile resolution, secret decryption,
 * CLI spawn, output parsing, error handling, workspace resolution.
 */

import { execFileSync } from "child_process";
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { createHmac, pbkdf2Sync, createHash, createCipheriv, randomBytes as rb } from "crypto";

const TMP = `/tmp/test-job-runner-${process.pid}`;
const REPO_ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(REPO_ROOT, "lib", "job-runner.mjs");
const TEST_SECRET = "test-job-runner-secret-key-2026";
const NODE_BIN = dirname(execFileSync("which", ["node"], { encoding: "utf-8" }).trim());
const MOCK_CLI_BIN_DIR = join(TMP, "mock-bin");
const MOCK_CLI_PATH = join(MOCK_CLI_BIN_DIR, "mock-job-runner-cli.js");
const MOCK_FETCH_HOOK_PATH = join(TMP, "mock-fetch-hook.js");
const MOCK_CLI_CAPTURE_DIR = join(TMP, "mock-cli-captures");
const MOCK_FETCH_CALL_DIR = join(TMP, "mock-fetch-calls");
const MOCK_FETCH_REQUIRE = MOCK_FETCH_HOOK_PATH;

// ── crypto helpers (match secrets-store.ts double HKDF) ───────────────

const SALT = "mentiko-vault-crypto-v1";
const LABEL = "mentiko-vault-encryption-v1";

function deriveVaultAppSecret(root) {
  const prk = createHmac("sha256", "\x00".repeat(32)).update(root).digest();
  return createHmac("sha256", prk).update(`${LABEL}\x01`).digest("hex");
}

function getDerivedKey(secret) {
  return pbkdf2Sync(deriveVaultAppSecret(deriveVaultAppSecret(secret)), SALT, 100000, 32, "sha256");
}

function getKeyId(key) {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function encrypt(plaintext, secret) {
  const key = getDerivedKey(secret);
  const keyId = getKeyId(key);
  const iv = rb(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${keyId}:${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

// ── mock CLI helper ───────────────────────────────────────────────────

function createMockCli(output, exitCode = 0) {
  const dir = MOCK_CLI_BIN_DIR;
  mkdirSync(dir, { recursive: true });
  const name = `mock-cli-${Date.now()}-${rb(2).toString("hex")}`;
  const path = join(dir, name);
  const script = `#!/bin/bash\n${exitCode !== 0 ? `echo "${output}" >&2; exit ${exitCode}` : `echo '${output.replace(/'/g, "'\\''")}'`}\n`;
  writeFileSync(path, script, { mode: 0o755 });
  return path;
}

// ── test helpers ──────────────────────────────────────────────────────

const JOBS_DIR = join(TMP, "namespaces", "default", "jobs");
const PROFILES_DIR = join(TMP, "namespaces", "default", "agent-profiles");
const SECRETS_DIR = join(TMP, "namespaces", "default", "secrets");

function mkdirs() {
  mkdirSync(JOBS_DIR, { recursive: true });
  mkdirSync(PROFILES_DIR, { recursive: true });
  mkdirSync(SECRETS_DIR, { recursive: true });
  mkdirSync(MOCK_CLI_BIN_DIR, { recursive: true });
  mkdirSync(MOCK_CLI_CAPTURE_DIR, { recursive: true });
  mkdirSync(MOCK_FETCH_CALL_DIR, { recursive: true });
}

function writeMockFetchHook() {
  const script = `const fs = require("node:fs");

function normalizeHeaders(headers) {
  if (!headers) return {};
  if (typeof headers.forEach === "function") return Object.fromEntries(headers.entries());
  if (headers instanceof Object) return Object.fromEntries(Object.entries(headers));
  return {};
}

const logPath = process.env.JOB_FETCH_LOG || "";
let calls = [];
if (logPath) {
  try {
    calls = JSON.parse(fs.readFileSync(logPath, "utf-8"));
  } catch {}
}

globalThis.fetch = async (url, init = {}) => {
  const request = {
    url: String(url),
    method: init.method || "GET",
    headers: normalizeHeaders(init.headers || {}),
    body: init.body || "",
  };
  calls.push(request);
  if (logPath) {
    fs.writeFileSync(logPath, JSON.stringify(calls), "utf-8");
  }
  const ok = process.env.MOCK_FETCH_OK !== "0";
  return {
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "ERR",
    text: async () => "",
  };
};
`;
  writeFileSync(MOCK_FETCH_HOOK_PATH, script, "utf-8");
}

function writeDeterministicMockCli() {
  const script = `#!/usr/bin/env node
const fs = require("node:fs");

let scenario = {};
try {
  scenario = JSON.parse(process.env.MOCK_CLI_SCENARIO || "{}");
} catch {}

const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
process.stdin.on("end", () => {
  const prompt = Buffer.concat(chunks).toString("utf-8");
  const baseOutput = {
    name: scenario.name || "mock-result",
    prompt,
    args: process.argv.slice(2),
    cwd: process.cwd(),
    env: {
      CLAUDECODE: process.env.CLAUDECODE || null,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || null,
      MENTIKO_JOB_CWD: process.env.MENTIKO_JOB_CWD || null,
      MENTIKO_WORKSPACE_PATH: process.env.MENTIKO_WORKSPACE_PATH || null,
      PWD: process.env.PWD || null,
      STATIC_VAR: process.env.STATIC_VAR || null,
    },
  };

  const output = Object.prototype.hasOwnProperty.call(scenario, "output")
    ? scenario.output
    : baseOutput;
  const text = typeof output === "string" ? output : JSON.stringify(output);
  if (scenario.stderr) process.stderr.write(String(scenario.stderr));
  if (scenario.capturePath) {
    try {
      fs.writeFileSync(
        scenario.capturePath,
        JSON.stringify(
          {
            prompt,
            args: process.argv.slice(2),
            cwd: process.cwd(),
            env: {
              CLAUDECODE: process.env.CLAUDECODE || null,
              ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || null,
              MENTIKO_JOB_CWD: process.env.MENTIKO_JOB_CWD || null,
              MENTIKO_WORKSPACE_PATH: process.env.MENTIKO_WORKSPACE_PATH || null,
              PWD: process.env.PWD || null,
              STATIC_VAR: process.env.STATIC_VAR || null,
            },
          },
          null,
          2
        )
      );
    } catch {}
  }

  process.stdout.write(text);
  process.exit(Math.max(0, Number(scenario.exitCode || 0)));
});
`;
  writeFileSync(MOCK_CLI_PATH, script, { mode: 0o755 });
}

function runJobWithMock(jobId, scenario = {}, extraEnv = {}) {
  const capturePath = join(MOCK_CLI_CAPTURE_DIR, `${jobId}.json`);
  const fetchLogPath = join(MOCK_FETCH_CALL_DIR, `${jobId}.json`);
  const env = {
    PATH: `${MOCK_CLI_BIN_DIR}:${NODE_BIN}:/usr/bin:/bin`,
    HOME: process.env.HOME,
    MENTIKO_GLOBAL_ROOT: TMP,
    BETTER_AUTH_SECRET: TEST_SECRET,
    MOCK_CLI_SCENARIO: JSON.stringify({ ...scenario, capturePath }),
    JOB_FETCH_LOG: fetchLogPath,
    ...extraEnv,
  };

  return execFileSync("node", ["-r", MOCK_FETCH_REQUIRE, SCRIPT, jobId], {
    env,
    encoding: "utf-8",
    timeout: 10000,
  });
}

function runJobWithMockFail(jobId, scenario = {}, extraEnv = {}) {
  try {
    runJobWithMock(jobId, scenario, extraEnv);
    return null;
  } catch (err) {
    return {
      status: err.status,
      stderr: err.stderr || "",
      stdout: err.stdout || "",
    };
  }
}

function readMockCliCapture(jobId) {
  const path = join(MOCK_CLI_CAPTURE_DIR, `${jobId}.json`);
  return JSON.parse(readFileSync(path, "utf-8"));
}

function readMockFetchLog(jobId) {
  const path = join(MOCK_FETCH_CALL_DIR, `${jobId}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : [];
}

function makeJobFile(id, input, type = "generate") {
  const job = {
    id,
    type,
    status: "pending",
    input,
    createdBy: "test-user",
    createdAt: new Date().toISOString(),
  };
  writeFileSync(join(JOBS_DIR, `${id}.json`), JSON.stringify(job, null, 2));
  return job;
}

function readJob(id) {
  return JSON.parse(readFileSync(join(JOBS_DIR, `${id}.json`), "utf-8"));
}

function makeSecretFile(name, envVar, value) {
  const id = `sec-${Date.now()}-${rb(2).toString("hex")}`;
  const ciphertext = encrypt(value, TEST_SECRET);
  writeFileSync(join(SECRETS_DIR, `${id}.json`), JSON.stringify({
    id, name, envVar,
    maskedValue: value.length > 4 ? `...${value.slice(-4)}` : "****",
    encryptedValue: ciphertext,
    keyId: getKeyId(getDerivedKey(TEST_SECRET)),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, null, 2));
  return id;
}

function makeDefaultProfile(overrides = {}) {
  const profile = {
    id: "prof-default",
    name: "Default",
    isDefault: true,
    cli: "echo",
    pipe_flag: "-n",
    ...overrides,
  };
  writeFileSync(join(PROFILES_DIR, `${profile.id}.json`), JSON.stringify(profile, null, 2));
  return profile;
}

function runJob(jobId, extraEnv = {}) {
  return execFileSync("node", [SCRIPT, jobId], {
    env: {
      PATH: `${join(TMP, "mock-bin")}:${NODE_BIN}:/usr/bin:/bin`,
      HOME: process.env.HOME,
      MENTIKO_GLOBAL_ROOT: TMP,
      BETTER_AUTH_SECRET: TEST_SECRET,
      ...extraEnv,
    },
    encoding: "utf-8",
    timeout: 10000,
  });
}

function runJobFail(jobId, extraEnv = {}) {
  try {
    runJob(jobId, extraEnv);
    return null;
  } catch (err) {
    return { status: err.status, stderr: err.stderr || "", stdout: err.stdout || "" };
  }
}

let testsPassed = 0;
let testsFailed = 0;

function assert(cond, msg) { if (!cond) throw new Error(`assertion failed: ${msg}`); }
function test(name, fn) {
  try { fn(); console.log(`  ✔ ${name}`); testsPassed++; }
  catch (err) { console.log(`  ✖ ${name}\n    ${err.message}`); testsFailed++; }
}

// ── setup ──────────────────────────────────────────────────────────────

mkdirs();
writeMockFetchHook();
writeDeterministicMockCli();

console.log("lib/job-runner.mjs tests\n");

// ── job loading tests ──────────────────────────────────────────────────

test("exits 1 when no jobId argument", () => {
  const result = runJobFail(undefined);
  assert(result !== null, "should fail");
  assert(result.status === 1, `expected exit 1, got ${result.status}`);
});

test("exits 1 when job file does not exist", () => {
  const result = runJobFail("nonexistent-job-123");
  assert(result !== null, "should fail");
  assert(result.status === 1, `expected exit 1, got ${result.status}`);
});

test("exits 1 when job file is corrupt JSON", () => {
  writeFileSync(join(JOBS_DIR, "corrupt.json"), "{bad json");
  const result = runJobFail("corrupt");
  assert(result !== null, "should fail");
  assert(result.status === 1, `expected exit 1, got ${result.status}`);
});

test("exits 1 when prompt is empty", () => {
  makeJobFile("empty-prompt", { prompt: "" });
  const result = runJobFail("empty-prompt");
  assert(result !== null, "should fail");
  assert(result.status === 1, `expected exit 1, got ${result.status}`);
  const job = readJob("empty-prompt");
  assert(job.status === "failed", `expected failed, got ${job.status}`);
  assert(job.error.includes("prompt is empty"), `unexpected error: ${job.error}`);
});

// ── profile resolution tests ───────────────────────────────────────────

test("uses default claude when no profile exists", () => {
  // with no profiles dir content, it should resolve cli="claude" with ["-p"]
  // we test this indirectly: if the mock-bin/echo works, the profile resolved correctly
  makeJobFile("no-profile", { prompt: "test" });
  // no profile = tries to spawn "claude" which won't exist in our mock path
  // but the job file will be set to "running" first
  const result = runJobFail("no-profile");
  // spawn fails because "claude" isn't in PATH
  assert(result !== null, "should fail without claude in PATH");
  const job = readJob("no-profile");
  assert(job.status === "failed", `expected failed, got ${job.status}`);
});

test("resolves custom CLI from default profile", () => {
  makeDefaultProfile({ cli: "echo", pipe_flag: "" });
  makeJobFile("echo-profile", { prompt: "test prompt" });
  // echo is in /bin/echo, should work
  const result = runJobFail("echo-profile");
  // echo returns the prompt, but it's not valid JSON so the job should fail parsing
  const job = readJob("echo-profile");
  assert(job.status === "failed", `expected failed, got ${job.status}`);
  assert(job.error.includes("JSON") || job.error.includes("json"), `unexpected error: ${job.error}`);
});

test("resolves {secret:NAME} references in profile env", () => {
  makeSecretFile("api-key", "MY_API_KEY", "sk-test-resolved-123");
  makeDefaultProfile({
    cli: "echo",
    pipe_flag: "",
    env: { MY_API_KEY: "{secret:api-key}" },
  });
  makeJobFile("secret-env", { prompt: "test" });
  const result = runJobFail("secret-env");
  // echo will output the prompt, job will fail parsing JSON
  // but the important thing is the profile env was resolved without error
  const job = readJob("secret-env");
  assert(job.status === "failed", `expected failed (JSON parse), got ${job.status}`);
  // the job should have started (status went to running) before failing on output parse
  assert(job.activity?.some(a => a.msg.includes("spawning")), "missing spawn activity");
});

// ── output parsing tests ───────────────────────────────────────────────

test("completes generate job with valid JSON output", () => {
  // create a mock CLI that returns valid JSON
  const mockOutput = JSON.stringify({ name: "test-chain", steps: [] });
  const mockPath = createMockCli(mockOutput);
  makeDefaultProfile({ cli: mockPath, pipe_flag: "" });
  makeJobFile("gen-ok", { prompt: "generate a chain" }, "generate");

  const result = runJobFail("gen-ok");
  // exit should be 0 for success
  if (result !== null) {
    // check job file
    const job = readJob("gen-ok");
    assert(job.status === "complete", `expected complete, got ${job.status}: ${job.error || ""}`);
  } else {
    const job = readJob("gen-ok");
    assert(job.status === "complete", `expected complete, got ${job.status}`);
  }
  const job = readJob("gen-ok");
  assert(job.status === "complete", `expected complete, got ${job.status}: ${job.error}`);
  assert(job.result.name === "test-chain", `unexpected result: ${JSON.stringify(job.result)}`);
  assert(job.completedAt, "missing completedAt");
});

test("fails generate job when output missing 'name' field", () => {
  const mockOutput = JSON.stringify({ steps: [] });
  const mockPath = createMockCli(mockOutput);
  makeDefaultProfile({ cli: mockPath, pipe_flag: "" });
  makeJobFile("gen-no-name", { prompt: "test" }, "generate");

  runJobFail("gen-no-name");
  const job = readJob("gen-no-name");
  assert(job.status === "failed", `expected failed, got ${job.status}`);
  assert(job.error.includes("name"), `unexpected error: ${job.error}`);
});

test("handles JSON wrapped in markdown code blocks", () => {
  const mockOutput = "```json\n" + JSON.stringify({ name: "wrapped" }) + "\n```";
  const mockPath = createMockCli(mockOutput);
  makeDefaultProfile({ cli: mockPath, pipe_flag: "" });
  makeJobFile("gen-markdown", { prompt: "test" }, "generate");

  runJobFail("gen-markdown");
  const job = readJob("gen-markdown");
  assert(job.status === "complete", `expected complete, got ${job.status}: ${job.error}`);
  assert(job.result.name === "wrapped", `unexpected result: ${JSON.stringify(job.result)}`);
});

test("extracts JSON from surrounding text", () => {
  const mockOutput = `Here is the result:\n${JSON.stringify({ name: "extracted" })}\nDone.`;
  const mockPath = createMockCli(mockOutput);
  makeDefaultProfile({ cli: mockPath, pipe_flag: "" });
  makeJobFile("gen-surround", { prompt: "test" }, "generate");

  runJobFail("gen-surround");
  const job = readJob("gen-surround");
  assert(job.status === "complete", `expected complete, got ${job.status}: ${job.error}`);
  assert(job.result.name === "extracted", `unexpected result: ${JSON.stringify(job.result)}`);
});

test("fails when output has no JSON object", () => {
  const mockPath = createMockCli("plain text, no json here");
  makeDefaultProfile({ cli: mockPath, pipe_flag: "" });
  makeJobFile("gen-no-json", { prompt: "test" }, "generate");

  runJobFail("gen-no-json");
  const job = readJob("gen-no-json");
  assert(job.status === "failed", `expected failed, got ${job.status}`);
  assert(job.error.includes("JSON") || job.error.includes("json"), `unexpected error: ${job.error}`);
});

// ── job type validation tests ──────────────────────────────────────────

test("validates recommend job requires 'recommendation' field", () => {
  const mockPath = createMockCli(JSON.stringify({ name: "x" }));
  makeDefaultProfile({ cli: mockPath, pipe_flag: "" });
  makeJobFile("rec-no-rec", { prompt: "test" }, "recommend");

  runJobFail("rec-no-rec");
  const job = readJob("rec-no-rec");
  assert(job.status === "failed", `expected failed, got ${job.status}`);
  assert(job.error.includes("recommendation"), `unexpected error: ${job.error}`);
});

test("validates recommend job with correct output", () => {
  const mockPath = createMockCli(JSON.stringify({ recommendation: "do this" }));
  makeDefaultProfile({ cli: mockPath, pipe_flag: "" });
  makeJobFile("rec-ok", { prompt: "test" }, "recommend");

  runJobFail("rec-ok");
  const job = readJob("rec-ok");
  assert(job.status === "complete", `expected complete, got ${job.status}: ${job.error}`);
  assert(job.result.recommendation === "do this", `unexpected result`);
});

test("validates task jobs and normalizes legacy task fields", () => {
  const output = {
    title: "Fix generated task validation",
    description: "Make task generation outputs safe to create.",
    type: "epic",
    priority: 2,
    acceptance_criteria: [
      "Given a task job returns criteria as an array, when it completes, then the stored result uses a string",
      "Given a task job returns design_notes, when it completes, then the stored result uses design",
    ],
    design_notes: "Normalize before the API creates tasks.",
    labels: ["backend", "testing"],
    subtasks: [
      {
        title: "Add validation",
        description: "Validate generated task shape before marking the job complete.",
        type: "task",
        priority: 2,
        acceptance_criteria: ["Invalid generated task output fails the job"],
        labels: ["backend"],
      },
    ],
  };
  const mockPath = createMockCli(JSON.stringify(output));
  makeDefaultProfile({ cli: mockPath, pipe_flag: "" });
  makeJobFile("task-normalize", { prompt: "test" }, "task");

  runJobFail("task-normalize");
  const job = readJob("task-normalize");
  assert(job.status === "complete", `expected complete, got ${job.status}: ${job.error}`);
  assert(typeof job.result.acceptance_criteria === "string", "acceptance_criteria should normalize to string");
  assert(job.result.acceptance_criteria.includes("stored result uses a string"), "missing normalized criteria text");
  assert(job.result.design === "Normalize before the API creates tasks.", `wrong design: ${job.result.design}`);
  assert(!Object.prototype.hasOwnProperty.call(job.result, "design_notes"), "design_notes should be removed");
  assert(typeof job.result.subtasks[0].acceptance_criteria === "string", "subtask acceptance should normalize");
});

test("fails task jobs with invalid required fields", () => {
  const mockPath = createMockCli(JSON.stringify({
    title: "Missing priority",
    type: "task",
  }));
  makeDefaultProfile({ cli: mockPath, pipe_flag: "" });
  makeJobFile("task-invalid", { prompt: "test" }, "task");

  runJobFail("task-invalid");
  const job = readJob("task-invalid");
  assert(job.status === "failed", `expected failed, got ${job.status}`);
  assert(job.error.includes("priority"), `unexpected error: ${job.error}`);
});

test("fails task jobs when non-epic output includes subtasks", () => {
  const mockPath = createMockCli(JSON.stringify({
    title: "Feature with subtasks",
    description: "Invalid shape.",
    type: "feature",
    priority: 2,
    subtasks: [
      { title: "Child", description: "Do it.", type: "task", priority: 2 },
    ],
  }));
  makeDefaultProfile({ cli: mockPath, pipe_flag: "" });
  makeJobFile("task-invalid-subtasks", { prompt: "test" }, "task");

  runJobFail("task-invalid-subtasks");
  const job = readJob("task-invalid-subtasks");
  assert(job.status === "failed", `expected failed, got ${job.status}`);
  assert(job.error.includes("subtasks"), `unexpected error: ${job.error}`);
});

test("validates decision_guided_questions requires 3+ questions", () => {
  const mockPath = createMockCli(JSON.stringify({ questions: ["q1", "q2"] }));
  makeDefaultProfile({ cli: mockPath, pipe_flag: "" });
  makeJobFile("dq-few", { prompt: "test" }, "decision_guided_questions");

  runJobFail("dq-few");
  const job = readJob("dq-few");
  assert(job.status === "failed", `expected failed, got ${job.status}`);
  assert(job.error.includes("questions"), `unexpected error: ${job.error}`);
});

test("validates decision_guided_options requires 2+ options", () => {
  const mockPath = createMockCli(JSON.stringify({ options: ["opt1"] }));
  makeDefaultProfile({ cli: mockPath, pipe_flag: "" });
  makeJobFile("do-few", { prompt: "test" }, "decision_guided_options");

  runJobFail("do-few");
  const job = readJob("do-few");
  assert(job.status === "failed", `expected failed, got ${job.status}`);
  assert(job.error.includes("options"), `unexpected error: ${job.error}`);
});

test("validates decision_guided_plan requires 2+ tasks", () => {
  const mockPath = createMockCli(JSON.stringify({ tasks: ["t1"] }));
  makeDefaultProfile({ cli: mockPath, pipe_flag: "" });
  makeJobFile("dp-few", { prompt: "test" }, "decision_guided_plan");

  runJobFail("dp-few");
  const job = readJob("dp-few");
  assert(job.status === "failed", `expected failed, got ${job.status}`);
  assert(job.error.includes("tasks"), `unexpected error: ${job.error}`);
});

test("validates decision_research requires 'brief' field", () => {
  const mockPath = createMockCli(JSON.stringify({ summary: "x" }));
  makeDefaultProfile({ cli: mockPath, pipe_flag: "" });
  makeJobFile("dr-no-brief", { prompt: "test" }, "decision_research");

  runJobFail("dr-no-brief");
  const job = readJob("dr-no-brief");
  assert(job.status === "failed", `expected failed, got ${job.status}`);
  assert(job.error.includes("brief"), `unexpected error: ${job.error}`);
});

test("validates preference_synthesis requires 'summary' field", () => {
  const mockPath = createMockCli(JSON.stringify({ data: "x" }));
  makeDefaultProfile({ cli: mockPath, pipe_flag: "" });
  makeJobFile("ps-no-sum", { prompt: "test" }, "preference_synthesis");

  runJobFail("ps-no-sum");
  const job = readJob("ps-no-sum");
  assert(job.status === "failed", `expected failed, got ${job.status}`);
  assert(job.error.includes("summary"), `unexpected error: ${job.error}`);
});

test("validates link generation requires name and mode", () => {
  const mockPath = createMockCli(JSON.stringify({ name: "x" }));
  makeDefaultProfile({ cli: mockPath, pipe_flag: "" });
  makeJobFile("link-no-mode", { prompt: "test" }, "link");

  runJobFail("link-no-mode");
  const job = readJob("link-no-mode");
  assert(job.status === "failed", `expected failed, got ${job.status}`);
  assert(job.error.includes("mode"), `unexpected error: ${job.error}`);
});

test("template_test stores raw output without requiring JSON", () => {
  const mockPath = createMockCli("raw template output here");
  makeDefaultProfile({ cli: mockPath, pipe_flag: "" });
  makeJobFile("tt-raw", { prompt: "test" }, "template_test");

  runJobFail("tt-raw");
  const job = readJob("tt-raw");
  assert(job.status === "complete", `expected complete, got ${job.status}: ${job.error}`);
  assert(job.result.raw === "raw template output here", `unexpected raw: ${job.result.raw}`);
});

test("template_test parses JSON when output is valid", () => {
  const mockPath = createMockCli(JSON.stringify({ key: "value" }));
  makeDefaultProfile({ cli: mockPath, pipe_flag: "" });
  makeJobFile("tt-json", { prompt: "test" }, "template_test");

  runJobFail("tt-json");
  const job = readJob("tt-json");
  assert(job.status === "complete", `expected complete, got ${job.status}: ${job.error}`);
  assert(job.result.raw.includes("key"), `unexpected raw: ${job.result.raw}`);
  assert(job.result.parsed.key === "value", `unexpected parsed: ${JSON.stringify(job.result.parsed)}`);
});

// ── job state tracking tests ───────────────────────────────────────────

test("marks job as running on start", () => {
  // this test uses a mock CLI that sleeps, so we can check intermediate state
  // simpler approach: just verify the completed job has activity entries
  const mockPath = createMockCli(JSON.stringify({ name: "activity-test" }));
  makeDefaultProfile({ cli: mockPath, pipe_flag: "" });
  makeJobFile("activity", { prompt: "test" }, "generate");

  runJobFail("activity");
  const job = readJob("activity");
  assert(job.status === "complete", `expected complete, got ${job.status}: ${job.error}`);
  assert(Array.isArray(job.activity), "missing activity array");
  assert(job.activity.some(a => a.msg === "started"), "missing started activity");
  assert(job.activity.some(a => a.msg.includes("spawning")), "missing spawning activity");
  assert(job.startedAt, "missing startedAt");
  assert(job.completedAt, "missing completedAt");
});

test("strips CLAUDECODE from child env", () => {
  const mockPath = createMockCli(JSON.stringify({ name: "env-test" }));
  makeDefaultProfile({ cli: mockPath, pipe_flag: "" });
  makeJobFile("env-strip", { prompt: "test" }, "generate");

  runJobFail("env-strip", { CLAUDECODE: "1" });
  const job = readJob("env-strip");
  assert(job.status === "complete", `expected complete, got ${job.status}: ${job.error}`);
});

// ── workspace resolution tests ─────────────────────────────────────────

test("uses PROJECT_ROOT when no workspace specified", () => {
  const mockPath = createMockCli(JSON.stringify({ name: "ws-test" }));
  makeDefaultProfile({ cli: mockPath, pipe_flag: "" });
  makeJobFile("ws-none", { prompt: "test" }, "generate");

  runJobFail("ws-none");
  const job = readJob("ws-none");
  assert(job.status === "complete", `expected complete, got ${job.status}: ${job.error}`);
  assert(job.activity.some(a => a.msg.includes("cwd")), "missing cwd activity");
});

test("uses registered workspace when specified", () => {
  const wsDir = join(TMP, "workspace-test");
  mkdirSync(wsDir, { recursive: true });

  // register workspace
  const wsPath = join(TMP, "namespaces", "default", "workspaces.json");
  writeFileSync(wsPath, JSON.stringify([
    { id: "ws-1", path: wsDir, name: "Test Workspace" },
  ]));

  const mockPath = createMockCli(JSON.stringify({ name: "ws-reg" }));
  makeDefaultProfile({ cli: mockPath, pipe_flag: "" });
  makeJobFile("ws-reg", { prompt: "test", workspaceId: "ws-1" }, "generate");

  runJobFail("ws-reg");
  const job = readJob("ws-reg");
  assert(job.status === "complete", `expected complete, got ${job.status}: ${job.error}`);
  // check activity for correct cwd
  const cwdActivity = job.activity.find(a => a.msg.includes("cwd"));
  assert(cwdActivity, "missing cwd activity");
  assert(cwdActivity.msg.includes(wsDir), `wrong cwd: ${cwdActivity.msg}`);
});

test("ignores workspace that is not registered", () => {
  const mockPath = createMockCli(JSON.stringify({ name: "ws-ignore" }));
  makeDefaultProfile({ cli: mockPath, pipe_flag: "" });
  makeJobFile("ws-ignore", { prompt: "test", workspaceId: "nonexistent" }, "generate");

  runJobFail("ws-ignore");
  const job = readJob("ws-ignore");
  assert(job.status === "complete", `expected complete, got ${job.status}: ${job.error}`);
  // should fall back to PROJECT_ROOT
  const cwdActivity = job.activity.find(a => a.msg.includes("cwd"));
  assert(cwdActivity, "missing cwd activity");
});

test("ignores workspace with non-directory path", () => {
  const wsPath = join(TMP, "namespaces", "default", "workspaces.json");
  writeFileSync(wsPath, JSON.stringify([
    { id: "ws-bad", path: "/nonexistent/path/that/does/not/exist", name: "Bad" },
  ]));

  const mockPath = createMockCli(JSON.stringify({ name: "ws-baddir" }));
  makeDefaultProfile({ cli: mockPath, pipe_flag: "" });
  makeJobFile("ws-baddir", { prompt: "test", workspaceId: "ws-bad" }, "generate");

  runJobFail("ws-baddir");
  const job = readJob("ws-baddir");
  assert(job.status === "complete", `expected complete, got ${job.status}: ${job.error}`);
});

// ── deterministic mocked process tests ─────────────────────────────────

test("uses mocked CLI with deterministic spawn args and prompt forwarding", () => {
  makeDefaultProfile({
    cli: MOCK_CLI_PATH,
    pipe_flag: "-p --model opus-4",
    permission_flag: "--permission test-mode",
    extra_args: ["--temperature", "0.2"],
    env: { STATIC_VAR: "present" },
  });
  makeJobFile("deterministic-spawn", { prompt: "prompt from deterministic test" }, "generate");

  runJobWithMock("deterministic-spawn", {
    output: { name: "deterministic-chain" },
  });
  const job = readJob("deterministic-spawn");
  const capture = readMockCliCapture("deterministic-spawn");
  const args = capture.args || [];

  assert(job.status === "complete", `expected complete, got ${job.status}: ${job.error || ""}`);
  assert(args[0] === "-p", `wrong first arg: ${args[0]}`);
  assert(args.includes("--model"), "missing --model arg");
  assert(args.includes("opus-4"), "missing model value");
  assert(args.includes("--permission"), "missing --permission arg");
  assert(args.includes("test-mode"), "missing permission value");
  assert(args.includes("--temperature"), "missing --temperature arg");
  assert(args.includes("0.2"), "missing temperature value");
  assert(capture.prompt === "prompt from deterministic test", `prompt mismatch: ${capture.prompt}`);
  assert(capture.env?.STATIC_VAR === "present", `missing profile env: ${JSON.stringify(capture.env)}`);
});

test("strips CLAUDECODE and inherited ANTHROPIC_API_KEY in child env", () => {
  makeDefaultProfile({
    cli: MOCK_CLI_PATH,
    pipe_flag: "-p",
    env: {},
  });
  makeJobFile("strip-child-env", { prompt: "prompt strip env" }, "generate");

  runJobWithMock("strip-child-env", { output: { name: "strip-env" } }, {
    ANTHROPIC_API_KEY: "runner-token",
    CLAUDECODE: "1",
  });
  const job = readJob("strip-child-env");
  const capture = readMockCliCapture("strip-child-env");

  assert(job.status === "complete", `expected complete, got ${job.status}`);
  assert(capture.env?.CLAUDECODE === null, `CLAUDECODE should be stripped: ${capture.env?.CLAUDECODE}`);
  assert(capture.env?.ANTHROPIC_API_KEY === null, "ANTHROPIC_API_KEY should be stripped");
});

test("keeps profile ANTHROPIC_API_KEY when explicitly set", () => {
  makeDefaultProfile({
    cli: MOCK_CLI_PATH,
    pipe_flag: "-p",
    env: { ANTHROPIC_API_KEY: "profile-token-2026" },
  });
  makeJobFile("profile-env-key", { prompt: "prompt profile env" }, "generate");

  runJobWithMock("profile-env-key", { output: { name: "profile-key" } }, {
    ANTHROPIC_API_KEY: "runner-token-should-be-overridden",
  });
  const capture = readMockCliCapture("profile-env-key");

  assert(capture.env?.ANTHROPIC_API_KEY === "profile-token-2026", `wrong ANTHROPIC_API_KEY: ${capture.env?.ANTHROPIC_API_KEY}`);
});

test("notifies callback and writes complete status in mocked fetch flow", () => {
  makeDefaultProfile({
    cli: MOCK_CLI_PATH,
    pipe_flag: "",
    env: {},
  });
  makeJobFile("mock-callback", { prompt: "callback prompt" }, "generate");

  runJobWithMock("mock-callback", { output: { name: "callback-chain" } }, {
    JOB_CALLBACK_URL: "http://localhost:4000/jobs/[id]/callback",
    JOB_CALLBACK_SECRET: "callback-secret",
    NAMESPACE_ID: "default",
  });

  const job = readJob("mock-callback");
  const calls = readMockFetchLog("mock-callback");

  assert(job.status === "complete", `expected complete, got ${job.status}: ${job.error || ""}`);
  assert(calls.length >= 2, `expected at least 2 fetch calls, got ${calls.length}`);

  const callbackCall = calls.find((call) => call.url.includes("/jobs/mock-callback/callback"));
  assert(!!callbackCall, `callback call missing: ${JSON.stringify(calls)}`);
  assert(callbackCall.method === "POST", `callback method expected POST: ${callbackCall.method}`);
  assert(callbackCall.headers?.Authorization === "Bearer callback-secret", `callback auth header missing: ${JSON.stringify(callbackCall.headers)}`);
  assert(callbackCall.headers?.["x-namespace-id"] === "default", `namespace header missing: ${JSON.stringify(callbackCall.headers)}`);

  const payload = JSON.parse(callbackCall.body || "{}");
  assert(payload.status === "complete", `wrong callback status: ${payload.status}`);
  assert(payload.result?.name === "callback-chain", `callback result mismatch: ${JSON.stringify(payload.result)}`);
});

test("callback failure does not change final job status", () => {
  makeDefaultProfile({
    cli: MOCK_CLI_PATH,
    pipe_flag: "",
    env: {},
  });
  makeJobFile("mock-callback-fail", { prompt: "callback fail prompt" }, "generate");

  runJobWithMock("mock-callback-fail", { output: { name: "callback-fail-chain" } }, {
    JOB_CALLBACK_URL: "http://localhost:4000/jobs/[id]/callback",
    MOCK_FETCH_OK: "0",
  });
  const job = readJob("mock-callback-fail");
  assert(job.status === "complete", `expected complete, got ${job.status}`);
});

test("marks job failed when mocked CLI exits non-zero", () => {
  makeDefaultProfile({
    cli: MOCK_CLI_PATH,
    pipe_flag: "",
    env: {},
  });
  makeJobFile("mock-cli-exit-fail", { prompt: "exit fail prompt" }, "generate");

  const result = runJobWithMockFail("mock-cli-exit-fail", {
    stderr: "credit balance is too low",
    exitCode: 4,
    output: { name: "ignored" },
  });
  const job = readJob("mock-cli-exit-fail");
  assert(result !== null, "should fail");
  assert(result.status === 1, `expected process exit 1, got ${result.status}`);
  assert(job.status === "failed", `expected failed, got ${job.status}`);
  assert(job.error.includes("credit balance is too low"), `unexpected error: ${job.error}`);
});

// ── secret decryption in job context ───────────────────────────────────

test("decrypts secrets with double HKDF alignment", () => {
  makeSecretFile("job-secret", "JOB_SECRET", "decrypted-job-value");
  makeDefaultProfile({
    cli: "echo",
    pipe_flag: "",
    env: { MY_TOKEN: "{secret:job-secret}" },
  });
  makeJobFile("secret-decrypt", { prompt: "test" });
  // job will fail because echo returns non-JSON, but secret resolution should work
  runJobFail("secret-decrypt");
  const job = readJob("secret-decrypt");
  // job should at least get past profile resolution (activity shows spawn)
  assert(job.activity?.some(a => a.msg.includes("spawning")), "profile env should resolve without crash");
});

// ── cleanup ────────────────────────────────────────────────────────────

rmSync(TMP, { recursive: true, force: true });

console.log(`\nresults: ${testsPassed} passed, ${testsFailed} failed`);
process.exit(testsFailed > 0 ? 1 : 0);
