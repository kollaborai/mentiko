#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } = require("fs");
const { tmpdir } = require("os");
const { dirname, join, resolve } = require("path");
const { spawnSync } = require("child_process");

const codeRoot = resolve(join(__dirname, "..", ".."));
const tempRoot = mkdtempSync(join(tmpdir(), "mentiko-runner-v2-watched-"));
// Keep the derived daemon socket below macOS's Unix-socket path limit.
const dataRoot = join("/tmp", `mentiko-v2-data-${process.pid}`);
const workspace = join(tempRoot, "workspace");
const runsDir = join(dataRoot, "namespaces", "default", "runs");
const runId = `run-${Date.now()}-${process.pid.toString(16)}`;
const runDir = join(runsDir, runId);
const profilesDir = join(dataRoot, "namespaces", "default", "agent-profiles");

process.env.MENTIKO_CODE_ROOT = codeRoot;
process.env.MENTIKO_ROOT = codeRoot;
process.env.MENTIKO_GLOBAL_ROOT = dataRoot;
process.env.MENTIKO_PROJECT_ROOT = join(dataRoot, "namespaces", "default");
process.env.MENTIKO_NAMESPACE_ID = "default";
process.env.NAMESPACE_ID = "default";
process.env.ORG_ID = "default";
process.env.PROJECT_ID = "default";
process.env.MENTIKO_RUNNER_V2 = "1";
process.env.MENTIKO_RUNNER_V2_COMPLETION = "1";
process.env.MENTIKO_MONITOR_INTERVAL = "1";
process.env.MENTIKO_MONITOR_MARKER_TAIL = "80";
process.env.MENTIKO_READINESS_FAIL_CLOSED = "1";
process.env.MENTIKO_CLI_READY_TIMEOUT = "8";
process.env.MENTIKO_CLI_READY_POLL = "1";
process.env.STUB_CLI = join(codeRoot, "web", "e2e", "engine", "fixtures", "stub-agent-cli.sh");

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: "commonjs",
  moduleResolution: "node",
  baseUrl: ".",
});
require("ts-node/register/transpile-only");
require("tsconfig-paths").register({
  baseUrl: resolve(__dirname, ".."),
  paths: { "@/*": ["*"] },
});
const { derivePtyDaemonName } = require("../lib/config");
const ptyDaemon = derivePtyDaemonName(dataRoot, "default", "default");
process.env.PTY_DAEMON = ptyDaemon;

async function main() {
  mkdirSync(runDir, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  mkdirSync(profilesDir, { recursive: true });
  const ptyPreflight = preflightPtyDaemon();
  if (!ptyPreflight.ok) {
    const proofPath = resolve(process.argv[2] || join(codeRoot, "docs", "orchestration", "contracts", "runner-v2-watched-proof.json"));
    const proof = {
      schema_version: "runner-v2-watched-proof/v1",
      generated_at: new Date().toISOString(),
      status: "skipped",
      reason: "pty daemon unavailable",
      evidence: ptyPreflight.evidence,
      temp_root: tempRoot,
      pty_daemon: ptyDaemon,
      checks: [check("pty-daemon", false, ptyPreflight.evidence)],
    };
    mkdirSync(dirname(proofPath), { recursive: true });
    writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
    console.log(JSON.stringify({ status: proof.status, proofPath, reason: proof.reason, evidence: proof.evidence }, null, 2));
    return;
  }
  spawnSync("git", ["init", "-q"], { cwd: workspace, stdio: "ignore" });
  spawnSync("git", ["-c", "user.email=e2e@local", "-c", "user.name=e2e", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: workspace, stdio: "ignore" });

  writeProfile("stub-default", "complete", true);
  writeProfile("stub-advisor", "advisor-probe", false);

  const chainPath = join(runDir, "chain.json");
  const runJsonPath = join(runDir, "run.json");
  writeJson(chainPath, {
    id: "runner-v2-watched-proof",
    name: "Runner V2 Watched Proof",
    version: "1.0.0",
    default_agent_profile: "stub-default",
    config: {
      monitor: true,
      monitor_interval: 1,
      project_root: workspace,
      max_rounds: 2,
    },
    agents: [
      {
        id: "writer",
        name: "Writer",
        prompt: "write proof",
        emits: "draft-ready",
        triggers: ["manual-start"],
      },
    ],
  });
  writeJson(runJsonPath, {
    id: runId,
    chain: "Runner V2 Watched Proof",
    chainId: "runner-v2-watched-proof",
    goal: "prove watched v2 path",
    started: new Date().toISOString(),
    status: "running",
    debug: false,
    agents: [{ id: "writer", name: "Writer", status: "pending", session: "" }],
    sessions: [],
    workspacePath: workspace,
  });

  const { startRunnerV2Launch } = require("../lib/runner-v2/controller");
  const logPath = join(runDir, "output.log");
  const logFd = openSync(logPath, "w");
  const result = await startRunnerV2Launch({
    chainPath,
    runDir,
    runId,
    chainName: "Runner V2 Watched Proof",
    workspacePath: workspace,
    logFd,
    cwd: codeRoot,
    env: {
      ...process.env,
      MENTIKO_RUN_ID: runId,
      RUN_ID: runId,
      RUNS_DIR: runsDir,
      EVENTS_DIR: join(dataRoot, "namespaces", "default", "events"),
      STATE_DIR: join(dataRoot, "namespaces", "default", "state"),
      AGENT_PROFILES_DIR: profilesDir,
    },
  });
  closeSync(logFd);

  if (result.support !== "supported") {
    throw new Error(`runner-v2 launch unsupported: ${result.reason}`);
  }
  if (result.child) result.child.unref();

  const terminal = await pollTerminal(runJsonPath, 90);
  const run = JSON.parse(readFileSync(runJsonPath, "utf8"));
  const eventDir = join(dataRoot, "namespaces", "default", "events");
  const { pty } = require("../lib/pty/pty-client");
  const monitorSessionName = `monitor-${result.sessionName}`;
  const monitorInfo = await pty.info(monitorSessionName).catch((error) => ({ error: error.message }));
  const monitorCapture = await pty.capture(monitorSessionName, 120).catch((error) => `capture-error: ${error.message}`);
  const sessions = await pty.list().catch(() => []);
  const completeSessions = sessions.filter((session) => session.name && session.name.includes("complete-"));
  const completionCaptures = [];
  for (const session of completeSessions) {
    completionCaptures.push({
      info: session,
      output: await pty.capture(session.name, 160).catch((error) => `capture-error: ${error.message}`),
    });
  }
  const monitorEvidencePath = join(runDir, "monitor-capture.txt");
  writeFileSync(monitorEvidencePath, `${JSON.stringify({ monitorInfo, monitorCapture, completionCaptures }, null, 2)}\n`);
  const proof = {
    schema_version: "runner-v2-watched-proof/v1",
    generated_at: new Date().toISOString(),
    status: terminal === "completed" ? "passed" : "failed",
    temp_root: tempRoot,
    pty_daemon: ptyDaemon,
    checks: [
      check("launch-supported", result.mode === "typed-plan", result.mode),
      check("run-completed", terminal === "completed", terminal),
      check("agent-complete", run.agents?.[0]?.status === "complete", run.agents?.[0]?.status),
      check("attempt-completed", run.runnerV2?.attempts?.[0]?.phase === "completed", run.runnerV2?.attempts?.[0]?.phase),
      check("attempt-terminal-reason", run.runnerV2?.attempts?.[0]?.terminalReason === "completed_from_declared_event", run.runnerV2?.attempts?.[0]?.terminalReason),
      check("attempt-process-evidence", !!run.runnerV2?.attempts?.[0]?.processEvidence?.processPid, run.runnerV2?.attempts?.[0]?.processEvidence || null),
      check("event-written", eventExists(eventDir, "draft-ready"), eventDir),
      check("completion-session", Array.isArray(run.sessions) && run.sessions.some((session) => session.includes("writer")), run.sessions || []),
      check("typed-bootstrap-session", typeof result.sessionName === "string" && result.sessionName.includes("writer"), result.sessionName || ""),
      check("monitor-session-alive-or-exited-with-output", !!monitorInfo && monitorCapture.length > 0, monitorEvidencePath),
      check("completion-session-spawned", completeSessions.length > 0, completeSessions.map((session) => session.name)),
    ],
  };
  proof.status = proof.checks.every((item) => item.status === "pass") ? "passed" : "failed";
  const proofPath = resolve(process.argv[2] || join(codeRoot, "docs", "orchestration", "contracts", "runner-v2-watched-proof.json"));
  mkdirSync(dirname(proofPath), { recursive: true });
  writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify({ status: proof.status, proofPath, checks: proof.checks }, null, 2));
  stopPrivatePtyDaemon();
  if (proof.status !== "passed") process.exitCode = 1;
}

function writeProfile(id, mode, isDefault) {
  writeJson(join(profilesDir, `${id}.json`), {
    id,
    name: `Runner V2 Stub ${mode}`,
    cli: process.env.STUB_CLI,
    log_path: join(tempRoot, "stub-logs"),
    isDefault,
    isAdvisorDefault: !isDefault,
    readiness: { enabled: true, ready_patterns: [{ name: "stub-ready", type: "text", value: "REPL ready" }] },
    env: { STUB_MODE: mode },
  });
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function pollTerminal(runJsonPath, timeoutSeconds) {
  const terminal = new Set(["completed", "complete", "failed", "stopped", "cancelled", "blocked"]);
  const deadline = Date.now() + timeoutSeconds * 1000;
  let last = "missing";
  while (Date.now() < deadline) {
    if (existsSync(runJsonPath)) {
      last = JSON.parse(readFileSync(runJsonPath, "utf8")).status || "unknown";
      if (terminal.has(last)) return last;
    }
    await new Promise((resolvePoll) => setTimeout(resolvePoll, 1000));
  }
  return `timeout:${last}`;
}

function eventExists(eventDir, eventName) {
  const candidates = [
    join(eventDir, `${runId}-writer-${eventName}.event`),
    join(eventDir, "archive", `${runId}-writer-${eventName}.event`),
  ];
  return candidates.some((path) => existsSync(path) && readFileSync(path, "utf8").includes(`event: ${eventName}`));
}

function check(id, ok, evidence) {
  return { id, status: ok ? "pass" : "fail", evidence };
}

function stopPrivatePtyDaemon() {
  const ptyMgr = process.env.PTY_MGR_BIN || findPtyMgr();
  if (!ptyMgr) return;
  spawnSync(ptyMgr, ["kill", "all"], { env: { ...process.env, PTY_DAEMON: ptyDaemon }, stdio: "ignore" });
  spawnSync(ptyMgr, ["stop"], { env: { ...process.env, PTY_DAEMON: ptyDaemon }, stdio: "ignore" });
}

function findPtyMgr() {
  const found = spawnSync("zsh", ["-lc", "command -v pty-mgr || test -x \"$HOME/.pty-mgr/bin/pty-mgr\" && echo \"$HOME/.pty-mgr/bin/pty-mgr\""], { encoding: "utf8" });
  if (found.status !== 0) return "";
  return found.stdout.trim().split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("/") && existsSync(line)) || "";
}

function preflightPtyDaemon() {
  const ptyMgr = process.env.PTY_MGR_BIN || findPtyMgr();
  if (!ptyMgr) return { ok: false, evidence: "pty-mgr not found" };
  const started = spawnSync(ptyMgr, ["daemon"], {
    env: { ...process.env, PTY_DAEMON: ptyDaemon },
    encoding: "utf8",
    timeout: 15000,
  });
  if (started.status !== 0) {
    return {
      ok: false,
      evidence: (started.stderr || started.stdout || `exit ${started.status}; signal ${started.signal || "none"}; error ${started.error?.message || "none"}`).trim(),
    };
  }
  const status = spawnSync(ptyMgr, ["status"], {
    env: { ...process.env, PTY_DAEMON: ptyDaemon },
    encoding: "utf8",
    timeout: 5000,
  });
  return status.status === 0
    ? { ok: true, evidence: status.stdout.trim() }
    : { ok: false, evidence: (status.stderr || status.stdout || `exit ${status.status}`).trim() };
}

process.on("exit", stopPrivatePtyDaemon);
main().catch((error) => {
  stopPrivatePtyDaemon();
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
