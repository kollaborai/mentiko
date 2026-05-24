#!/usr/bin/env node
/**
 * lib/chain-runner.mjs tests
 *
 * Deterministic unit behavior/error coverage with explicit mocks.
 */

import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";

const TMP = `/tmp/test-chain-runner-mocked-${process.pid}`;
const REPO_ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(REPO_ROOT, "lib", "chain-runner.mjs");
const NODE_BIN = dirname(execFileSync("which", ["node"], { encoding: "utf-8" }).trim());
const NAMESPACE_ID = "default";
const ORG_ID = "default";
const MOCK_BIN = join(TMP, "mock-bin");

const NAMESPACE_ROOT = join(TMP, "namespaces", NAMESPACE_ID);
const CHAINS_DIR = join(NAMESPACE_ROOT, "chains");
const RUNS_DIR = join(NAMESPACE_ROOT, "runs");
const EVENTS_DIR = join(NAMESPACE_ROOT, "events");
const STATE_DIR = join(NAMESPACE_ROOT, "state");
const LOGS_DIR = join(NAMESPACE_ROOT, "logs");
const PROFILES_DIR = join(NAMESPACE_ROOT, "agent-profiles");

const tests = [];
const counters = { chainId: 0 };
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`assertion failed: ${message}`);
  }
}

function test(name, fn) {
  tests.push({ name, fn });
}

async function runTests() {
  for (const t of tests) {
    try {
      const out = t.fn();
      if (out && typeof out.then === "function") await out;
      console.log(`  ✔ ${t.name}`);
      passed += 1;
    } catch (err) {
      console.log(`  ✖ ${t.name}`);
      console.log(`    ${err.message}`);
      failed += 1;
    }
  }
}

function resetWorkspace() {
  rmSync(NAMESPACE_ROOT, { recursive: true, force: true });
  mkdirSync(CHAINS_DIR, { recursive: true });
  mkdirSync(RUNS_DIR, { recursive: true });
  mkdirSync(EVENTS_DIR, { recursive: true });
  mkdirSync(STATE_DIR, { recursive: true });
  mkdirSync(LOGS_DIR, { recursive: true });
  mkdirSync(PROFILES_DIR, { recursive: true });
}

function nextChainSlug(base) {
  counters.chainId += 1;
  return `${base}-${counters.chainId}-${Date.now()}`;
}

function writeChainFile(chain) {
  const chainDir = join(CHAINS_DIR, chain.id);
  mkdirSync(chainDir, { recursive: true });
  const chainPath = join(chainDir, "chain.json");
  writeFileSync(chainPath, JSON.stringify(chain, null, 2));
  return chainPath;
}

function makeChain(name, agents = [], config = {}) {
  const slug = nextChainSlug(name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  const chain = {
    name,
    description: `${name} description`,
    agents,
    config: { max_rounds: 3, ...config },
  };
  return { path: writeChainFile({ ...chain, id: slug }), slug };
}

function makeProfile(profileId, overrides = {}) {
  const profile = {
    id: profileId,
    name: `Profile ${profileId}`,
    cli: "mock-cli",
    isDefault: false,
    pipe_flag: "--print",
    ...overrides,
  };
  writeFileSync(
    join(PROFILES_DIR, `${profileId}.json`),
    JSON.stringify(profile, null, 2)
  );
  return profile;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function readRun(runId) {
  return readJson(join(RUNS_DIR, runId, "run.json"));
}

function writeMockCurl() {
  mkdirSync(MOCK_BIN, { recursive: true });
  const curl = join(MOCK_BIN, "curl");
  writeFileSync(
    curl,
    `#!/usr/bin/env bash\n` +
      `set -euo pipefail\n` +
      `url="\${!#}"\n` +
      `case "$url" in\n` +
      `  */api/tasks/task-success)\n` +
      `    cat <<'JSON'\n` +
      `{"data":{"issue":{"title":"Mock task","description":"Build and run","issue_type":"feature","priority":"P1"}}}\n` +
      `JSON\n` +
      `    ;;\n` +
      `  */api/tasks/task-success/comments)\n` +
      `    cat <<'JSON'\n` +
      `{"data":{"comments":[{"created_at":"2026-01-01T00:00:00Z","author":"tester","text":"mock comment"}]}}\n` +
      `JSON\n` +
      `    ;;\n` +
      `  */api/tasks/task-missing)\n` +
      `    cat <<'JSON'\n` +
      `{\"data\":{}}\n` +
      `JSON\n` +
      `    ;;\n` +
      `  */api/tasks/task-missing/comments)\n` +
      `    cat <<'JSON'\n` +
      `{\"data\":{\"comments\":[]}}\n` +
      `JSON\n` +
      `    ;;\n` +
      `  */api/tasks/task-fail*)\n` +
      `    exit 1\n` +
      `    ;;\n` +
      `  *)\n` +
      `    echo '{}'\n` +
      `    ;;\n` +
      `esac\n`,
    { mode: 0o755 }
  );
}

function runChain(args, extraEnv = {}) {
  return execFileSync("node", [SCRIPT, ...args], {
    env: {
      ...process.env,
      HOME: process.env.HOME || "/tmp",
      MENTIKO_GLOBAL_ROOT: TMP,
      NAMESPACE_ID,
      ORG_ID,
      PATH: `${MOCK_BIN}:${NODE_BIN}:/usr/bin:/bin`,
      ...extraEnv,
    },
    encoding: "utf-8",
    timeout: 8000,
  });
}

function runChainFail(args, extraEnv = {}) {
  try {
    runChain(args, extraEnv);
    return null;
  } catch (err) {
    return {
      status: err.status || 1,
      stdout: err.stdout || "",
      stderr: err.stderr || "",
    };
  }
}

function withMockFetch() {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 204,
      json: async () => ({}),
    };
  };
  return () => {
    global.fetch = original;
    return calls;
  };
}

async function withImmediateTimeout(fn) {
  const original = global.setTimeout;
  let depth = 0;
  global.setTimeout = (cb, ms, ...args) => {
    // only fire immediately for our deliberate sleep (2s delay in launchAgent)
    // pass through short intervals and undici internal timers
    if (depth > 10 || (ms && ms < 1000)) {
      return original(cb, ms, ...args);
    }
    depth++;
    try { cb(...args); } catch {}
    depth--;
    return 1;
  };
  try {
    return await fn();
  } finally {
    global.setTimeout = original;
  }
}

function createMockPtyManager() {
  const calls = {
    spawn: [],
    sendKeys: [],
    startLog: [],
    stopLog: [],
    destroyAll: 0,
  };
  const sessions = new Map();

  const manager = {
    spawn(name, cmd, args, options) {
      calls.spawn.push({ name, cmd, args, options });
      const session = {
        startLog: () => calls.startLog.push(name),
        stopLog: () => calls.stopLog.push(name),
        capture: () => "AGENT_COMPLETE",
      };
      sessions.set(name, session);
      return name;
    },
    get(name) {
      const session = sessions.get(name);
      if (!session) {
        throw new Error(`session not found: ${name}`);
      }
      return session;
    },
    sendKeys(name, text) {
      calls.sendKeys.push({ name, text });
    },
    kill() {},
    destroyAll() {
      calls.destroyAll += 1;
    },
  };

  return { manager, calls };
}

process.env.MENTIKO_GLOBAL_ROOT = TMP;
process.env.NAMESPACE_ID = NAMESPACE_ID;
process.env.ORG_ID = ORG_ID;
writeMockCurl();
resetWorkspace();

const { ChainRunner } = await import(`file://${SCRIPT}`);

// CLI behavior and error tests

test("shows help with --help", () => {
  const output = runChain(["--help"]);
  assert(output.includes("usage:"), "usage missing");
  assert(output.includes("--workspace"), "workspace option missing");
  assert(output.includes("--dry-run"), "dry-run option missing");
});

test("shows help when args are missing", () => {
  const output = runChain([]);
  assert(output.includes("usage:"), "usage missing");
  assert(output.includes("chain-runner.mjs"), "title missing");
});

test("exits 1 when chain file is missing", () => {
  const result = runChainFail(["/tmp/nonexistent-chain.json", "--dry-run"]);
  assert(result !== null, "expected failure");
  assert(result.status === 1, `expected exit 1, got ${result.status}`);
  assert(
    result.stderr.includes("not found") || result.stdout.includes("not found"),
    `missing not-found message: ${result.stdout}${result.stderr}`
  );
});

test("requires --workspace when not dry-run", () => {
  resetWorkspace();
  const { path } = makeChain("ws-required", []);
  const result = runChainFail([path]);
  assert(result !== null, "expected failure");
  assert(result.status === 1, `expected exit 1, got ${result.status}`);
  assert(
    result.stderr.includes("--workspace") || result.stdout.includes("--workspace"),
    `expected workspace requirement: ${result.stdout}${result.stderr}`
  );
});

test("dry-run prints chain and agent details", () => {
  resetWorkspace();
  const { path } = makeChain("dry-run", [
    { id: "agent-a", name: "Agent A", triggers: ["manual-start"], emits: "a-done", prompt: "do a" },
    { id: "agent-b", name: "Agent B", triggers: ["a-done"], emits: "b-done", prompt: "do b" },
  ]);
  const output = runChain([path, "--dry-run"]);
  assert(output.includes("dry-run"), "missing chain name");
  assert(output.includes("[agent-a]"), "missing agent a");
  assert(output.includes("[agent-b]"), "missing agent b");
  assert(output.includes("triggers"), "missing triggers");
});

// Unit behavior tests with mocks

test("constructor loads task context and substitutes placeholders", async () => {
  resetWorkspace();
  const { path } = makeChain("task-context", [{ id: "agent-a", name: "Agent A", triggers: ["manual-start"], prompt: "do {TASK}" }]);
  const runner = new ChainRunner(path, {
    workspace: TMP,
    task: "task-success",
    goal: "ship it",
  });
  assert(runner.taskContext !== null, "expected taskContext");
  assert(runner.taskContext.id === "task-success", "wrong task id");
  const mapped = runner._substitute(
    "{TASK_ID}|{TASK_TITLE}|{TASK_DESCRIPTION}|{TASK_TYPE}|{TASK_PRIORITY}|{TASK_CONTEXT}|{TASK_COMMENTS}|{GOAL}|{CHAIN_NAME}"
  );
  assert(mapped.includes("task-success"), `missing task id: ${mapped}`);
  assert(mapped.includes("Mock task"), `missing task title: ${mapped}`);
  assert(mapped.includes("Build and run"), `missing task description: ${mapped}`);
  assert(mapped.includes("feature"), `missing task type: ${mapped}`);
  assert(mapped.includes("P1"), `missing priority: ${mapped}`);
  assert(mapped.includes("mock comment"), `missing comments: ${mapped}`);
  assert(mapped.includes("ship it"), `missing goal: ${mapped}`);
  assert(mapped.includes("task-context"), `missing chain name: ${mapped}`);
});

test("falls back to goal when task context cannot resolve", () => {
  resetWorkspace();
  const { path } = makeChain("task-fallback", [{ id: "agent-a", name: "Agent A", triggers: ["manual-start"], prompt: "do {TASK}" }]);
  const runner = new ChainRunner(path, {
    workspace: TMP,
    task: "task-missing",
    goal: "fallback goal",
  });
  const mapped = runner._substitute("{TASK}|{TASK_CONTEXT}|{TASK_ID}|{GOAL}|{CHAIN_NAME}");
  assert(runner.taskContext === null, "expected null context");
  assert(
    mapped.startsWith("fallback goal|||fallback goal|"),
    `wrong fallback path: ${mapped}`
  );
});

test("keeps deterministic null context when task endpoint fails", () => {
  resetWorkspace();
  const { path } = makeChain("task-fail", [{ id: "agent-a", name: "Agent A", triggers: ["manual-start"], prompt: "do {TASK}" }]);
  const runner = new ChainRunner(path, { workspace: TMP, task: "task-fail", goal: "still run" });
  const mapped = runner._substitute("{TASK}|{TASK_CONTEXT}|{GOAL}");
  assert(runner.taskContext === null, "expected taskContext null");
  assert(mapped === "still run||still run", `unexpected substitution: ${mapped}`);
});

test("_findAgentByTrigger handles case-insensitive matches", () => {
  resetWorkspace();
  const { path } = makeChain("trigger-match", [
    { id: "a", name: "A", triggers: ["manual-start"], emits: "A-DONE", prompt: "a" },
    { id: "b", name: "B", triggers: ["a-done"], emits: "B-DONE", prompt: "b" },
  ]);
  const runner = new ChainRunner(path, { workspace: TMP });
  const match = runner._findAgentByTrigger("a-done");
  assert(match && match.id === "b", `wrong match: ${match?.id}`);
});

test("_findFirstAgent prefers manual-start trigger", () => {
  resetWorkspace();
  const { path } = makeChain("first-agent", [
    { id: "a", name: "A", triggers: ["event"], emits: "x", prompt: "a" },
    { id: "b", name: "B", triggers: ["manual-start"], emits: "y", prompt: "b" },
  ]);
  const runner = new ChainRunner(path, { workspace: TMP });
  const first = runner._findFirstAgent();
  assert(first.id === "b", `wrong first agent: ${first.id}`);
});

test("launchAgent uses resolved profile command and env", async () => {
  resetWorkspace();
  const { path } = makeChain("profile-launch", [
    { id: "agent-a", name: "Agent A", triggers: ["manual-start"], emits: "done", prompt: "write {GOAL}", agent_profile: "agent-profile" },
  ]);
  makeProfile("agent-profile", {
    cli: "mock-cli",
    pipe_flag: "--pipe",
    permission_flag: "--allow",
    model: "mock-model",
    extra_args: ["--temp", "0.2"],
    env: { FOO: "bar", TARGET: "unit" },
  });
  const runner = new ChainRunner(path, { workspace: TMP, goal: "ship it", });
  const { manager, calls } = createMockPtyManager();
  runner.mgr = manager;

  await withImmediateTimeout(async () => {
    await runner.launchAgent(runner.chain.agents[0], 2);
  });

  assert(calls.spawn.length === 1, "spawn should be called");
  assert(calls.spawn[0].cmd === "mock-cli", `wrong cmd: ${calls.spawn[0].cmd}`);
  assert(
    calls.spawn[0].args.join(" ") === "--pipe --allow --model mock-model --temp 0.2",
    `wrong args: ${calls.spawn[0].args.join(",")}`
  );
  assert(calls.spawn[0].options.cwd === TMP, "session cwd should use workspace");
  assert(calls.spawn[0].options.env.FOO === "bar", "env should merge profile vars");
  assert(calls.spawn[0].options.env.TARGET === "unit", "env should merge profile vars");
  assert(
    calls.sendKeys.length === 1 && calls.sendKeys[0].text.includes("You are: Agent A"),
    "did not send instructions"
  );
  assert(
    calls.sendKeys[0].text.includes("ship it"),
    "did not substitute task placeholder"
  );
});

test("launchAgent normalizes Claude bypass profile flags for current CLI", async () => {
  resetWorkspace();
  const { path } = makeChain("claude-profile-launch", [
    { id: "agent-a", name: "Agent A", triggers: ["manual-start"], emits: "done", prompt: "write", agent_profile: "claude-profile" },
  ]);
  makeProfile("claude-profile", {
    cli: "claude",
    pipe_flag: "-p",
    permission_flag: "--dangerously-skip-permissions",
    model: "haiku",
  });
  const runner = new ChainRunner(path, { workspace: TMP });
  const { manager, calls } = createMockPtyManager();
  runner.mgr = manager;

  await withImmediateTimeout(async () => {
    await runner.launchAgent(runner.chain.agents[0], 1);
  });

  assert(calls.spawn.length === 1, "spawn should be called");
  assert(calls.spawn[0].cmd === "claude", `wrong cmd: ${calls.spawn[0].cmd}`);
  assert(
    calls.spawn[0].args.join(" ") === "-p --allow-dangerously-skip-permissions --permission-mode bypassPermissions --model haiku",
    `wrong args: ${calls.spawn[0].args.join(" ")}`
  );
});

test("launchAgent skips stale chain default and uses namespace default profile", async () => {
  resetWorkspace();
  const { path } = makeChain("stale-chain-default", [
    { id: "agent-a", name: "Agent A", triggers: ["manual-start"], emits: "done", prompt: "run it" },
  ]);
  const chain = readJson(path);
  chain.default_agent_profile = "claude-opus-4-7";
  writeFileSync(path, JSON.stringify(chain, null, 2));
  makeProfile("kollabor", {
    cli: "kollab",
    model: "glm-4.7",
    isDefault: true,
  });
  const runner = new ChainRunner(path, { workspace: TMP });
  const { manager, calls } = createMockPtyManager();
  runner.mgr = manager;

  await withImmediateTimeout(async () => {
    await runner.launchAgent(runner.chain.agents[0], 1);
  });

  assert(calls.spawn.length === 1, "spawn should be called");
  assert(calls.spawn[0].cmd === "kollab", `wrong cmd: ${calls.spawn[0].cmd}`);
  assert(
    calls.spawn[0].args.join(" ") === "--print --model glm-4.7",
    `wrong args: ${calls.spawn[0].args.join(" ")}`
  );
});

test("launchAgent refuses bare claude fallback when no profile resolves", async () => {
  resetWorkspace();
  const { path } = makeChain("no-profile", [
    { id: "agent-a", name: "Agent A", triggers: ["manual-start"], emits: "done", prompt: "run it" },
  ]);
  const runner = new ChainRunner(path, { workspace: TMP });
  const { manager } = createMockPtyManager();
  runner.mgr = manager;

  let thrown = false;
  try {
    await withImmediateTimeout(async () => {
      await runner.launchAgent(runner.chain.agents[0], 1);
    });
  } catch (err) {
    thrown = true;
    assert(err.message.includes("no agent profile resolved"), `wrong error: ${err.message}`);
  }
  assert(thrown, "expected missing profile error");
});

test("launchAgent falls back to chain cli and args", async () => {
  resetWorkspace();
  const { path } = makeChain("fallback-launch", [
    { id: "agent-a", name: "Agent A", triggers: ["manual-start"], emits: "done", prompt: "run it" },
  ], {
    cli: "chain-cmd",
    cli_args: ["--alpha", "beta"],
  });
  const runner = new ChainRunner(path, { workspace: TMP });
  const { manager, calls } = createMockPtyManager();
  runner.mgr = manager;

  await withImmediateTimeout(async () => {
    await runner.launchAgent(runner.chain.agents[0], 1);
  });

  assert(calls.spawn.length === 1, "spawn should be called");
  assert(calls.spawn[0].cmd === "chain-cmd", `wrong fallback cmd: ${calls.spawn[0].cmd}`);
  assert(
    calls.spawn[0].args.join(" ") === "--alpha beta",
    `wrong fallback args: ${calls.spawn[0].args.join(" ")}`
  );
});

test("run follows chained events and marks run completed", async () => {
  resetWorkspace();
  makeProfile("default-profile", { isDefault: true });
  const { path } = makeChain("run-success", [
    { id: "agent-a", name: "A", triggers: ["manual-start"], emits: "a-done", prompt: "one" },
    { id: "agent-b", name: "B", triggers: ["a-done"], emits: "b-done", prompt: "two" },
    { id: "agent-c", name: "C", triggers: ["none"], emits: "", prompt: "three" },
  ], { session_prefix: "case" });
  const runner = new ChainRunner(path, { workspace: TMP });
  const { manager, calls: managerCalls } = createMockPtyManager();
  runner.mgr = manager;

  const restoreFetch = withMockFetch();
  runner.waitForCompletion = async (agentId) => ({ agentId, status: "completed", exitCode: 0 });

  await withImmediateTimeout(() => runner.run());
  const calls = restoreFetch();
  const runData = readRun(runner.runId);

  assert(runData.status === "completed", `run not completed: ${runData.status}`);
  assert(runData.agents.length === 2, `agent count mismatch: ${runData.agents.length}`);
  assert(runData.agents.every((a) => a.status === "completed"), "agents not completed");
  assert(managerCalls.stopLog.length >= 2, "logs should stop for started sessions");
  assert(calls.length > 0, "sysLog should be triggered");
  assert(existsSync(join(EVENTS_DIR, `${runData.agents[0].id}-a-done.event`)) || readdirSync(EVENTS_DIR).length === 1, "missing emitted event");
});

test("run marks run failed and rethrows when first agent throws", async () => {
  resetWorkspace();
  makeProfile("default-profile", { isDefault: true });
  const { path } = makeChain("run-throw", [
    { id: "agent-a", name: "A", triggers: ["manual-start"], emits: "a-done", prompt: "one" },
    { id: "agent-b", name: "B", triggers: ["a-done"], emits: "b-done", prompt: "two" },
  ]);
  const runner = new ChainRunner(path, { workspace: TMP });
  const { manager } = createMockPtyManager();
  runner.mgr = manager;
  const restoreFetch = withMockFetch();
  runner.waitForCompletion = async () => {
    throw new Error("agent boom");
  };

  let thrown = false;
  try {
    await withImmediateTimeout(() => runner.run());
  } catch (err) {
    thrown = true;
    assert(err.message.includes("agent boom"), `wrong error: ${err.message}`);
  }
  restoreFetch();
  const runData = readRun(runner.runId);
  assert(thrown, "expected error to bubble up");
  assert(runData.status === "failed", `status should be failed: ${runData.status}`);
});

test("run errors when requested start agent id is missing", async () => {
  resetWorkspace();
  const { path } = makeChain("run-start-missing", [
    { id: "agent-a", name: "A", triggers: ["manual-start"], emits: "", prompt: "one" },
    { id: "agent-b", name: "B", triggers: ["x"], emits: "", prompt: "two" },
  ]);
  const runner = new ChainRunner(path, {
    workspace: TMP,
    startAgent: "not-here",
  });

  let thrown = false;
  try {
    await runner.run();
  } catch (err) {
    thrown = true;
    assert(err.message.includes("starting agent not found"), `wrong error: ${err.message}`);
  }
  const runData = readRun(runner.runId);
  assert(thrown, "expected missing start agent error");
  assert(runData.status === "failed", `status should be failed: ${runData.status}`);
});

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
mkdirSync(MOCK_BIN, { recursive: true });
writeMockCurl();
process.env.PATH = `${MOCK_BIN}:${NODE_BIN}:/usr/bin:/bin`;
resetWorkspace();

await runTests();

console.log(`\nresults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
