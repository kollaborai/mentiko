#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("fs");
const { mkdtemp } = require("fs/promises");
const { tmpdir } = require("os");
const { dirname, join, resolve } = require("path");

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

async function main() {
  const codeRoot = resolve(join(__dirname, "..", ".."));
  const tempRoot = await mkdtemp(join(tmpdir(), "mentiko-runner-v2-proof-"));
  const proofPath = resolve(process.argv[2] || join(codeRoot, "docs", "orchestration", "contracts", "runner-v2-runtime-proof.json"));

  process.env.MENTIKO_CODE_ROOT = codeRoot;
  process.env.MENTIKO_GLOBAL_ROOT = join(tempRoot, "global");
  process.env.MENTIKO_NAMESPACE_ID = "runner-v2-proof";
  process.env.NAMESPACE_ID = "runner-v2-proof";
  process.env.ORG_ID = "default";
  process.env.PROJECT_ID = "default";

  const { runSyntheticRunnerV2ProbeWithDispatch } = require("../lib/runner-v2/probe");
  const { buildAgentBootstrapPlan } = require("../lib/runner-v2/agent-bootstrap-plan");
  const { executeLocalBootstrap } = require("../lib/runner-v2/bootstrap-executor");
  const runDir = join(tempRoot, "run");
  const profilesDir = join(tempRoot, "profiles");
  const workspaceDir = join(tempRoot, "workspace");
  const launchChainPath = join(runDir, "typed-launch-chain.json");
  mkdirSync(runDir, { recursive: true });
  mkdirSync(profilesDir, { recursive: true });
  mkdirSync(workspaceDir, { recursive: true });
  writeFileSync(join(profilesDir, "stub.json"), JSON.stringify({
    id: "stub",
    cli: "claude",
    env: {
      ANTHROPIC_API_KEY: "{secret:ANTHROPIC_API_KEY}",
      MUST_NOT_INLINE: "proof-secret",
    },
  }, null, 2));
  writeFileSync(launchChainPath, JSON.stringify({
    id: "typed-launch-proof",
    name: "Typed Launch Proof",
    default_agent_profile: "stub",
    agents: [
      { id: "first", name: "First", triggers: [] },
      { id: "manual", name: "Manual", triggers: ["manual-start"] },
    ],
  }, null, 2));
  // typed bootstrap persists AgentAttempt records into run.json; live launches
  // create it in chain-run-service before bootstrap, so the proof must too.
  writeFileSync(join(runDir, "run.json"), JSON.stringify({
    id: "run-probe",
    chain: "Typed Launch Proof",
    chainId: "typed-launch-proof",
    goal: "prove typed launch",
    started: new Date().toISOString(),
    status: "running",
    debug: false,
    agents: [{ id: "manual", name: "Manual", status: "pending", session: "" }],
    sessions: [],
    workspacePath: workspaceDir,
  }, null, 2));
  const bootstrapPlan = buildAgentBootstrapPlan({
    chainPath: launchChainPath,
    runDir,
    runId: "run-probe",
    workspacePath: workspaceDir,
    env: {
      AGENT_PROFILES_DIR: profilesDir,
      MENTIKO_RUN_ID: "run-probe",
      MENTIKO_RUNNER_V2: "1",
      PATH: process.env.PATH || "",
      SECRET_THAT_MUST_NOT_LEAK: "proof-parent-secret",
    },
  });
  const calls = [];
  const executor = {
    async has(name) {
      calls.push({ op: "has", name });
      return false;
    },
    async remove(name) {
      calls.push({ op: "remove", name });
    },
    async spawn(name, cmd, args, opts) {
      calls.push({ op: "spawn", name, cmd, args, opts });
      return { name, pid: 123 };
    },
    async sendKeys(name, text) {
      calls.push({ op: "sendKeys", name, text });
    },
    async capture() {
      return "claude ready >";
    },
  };
  await executeLocalBootstrap(bootstrapPlan, {
    chainPath: launchChainPath,
    runDir,
    runId: "run-probe",
    chainName: "Typed Launch Proof",
    workspacePath: workspaceDir,
    logFd: 1,
    cwd: codeRoot,
    env: {
      NODE_ENV: "test",
      MENTIKO_RUN_ID: "run-probe",
      MENTIKO_RUNNER_V2: "1",
      PATH: process.env.PATH || "",
      SECRET_THAT_MUST_NOT_LEAK: "proof-parent-secret",
    },
  }, executor);
  const startScriptPath = join(runDir, "artifacts", "manual-start.sh");
  const startScript = readFileSync(startScriptPath, "utf8");
  const instructionText = readFileSync(bootstrapPlan.instructionPath, "utf8");
  const stateText = readFileSync(bootstrapPlan.statePath, "utf8");
  const sessionSpawn = calls.find((call) => call.op === "spawn" && call.name === bootstrapPlan.sessionName);
  const monitorSpawn = calls.find((call) => call.op === "spawn" && call.name === bootstrapPlan.monitorSessionName);
  const daemonSpawns = calls.filter((call) => (
    call.op === "spawn"
    && (call.name === "mentiko-watchdog" || call.name === "mentiko-chain-watcher")
  ));
  const pointerSend = calls.find((call) => call.op === "sendKeys" && String(call.text).includes(bootstrapPlan.instructionPath));
  const startSend = calls.find((call) => call.op === "sendKeys" && String(call.text).includes(startScriptPath));
  const sessionEnv = sessionSpawn && sessionSpawn.opts ? sessionSpawn.opts.env || {} : {};
  const flattenedCalls = JSON.stringify(calls);
  const admittedRun = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
  writeFileSync(join(runDir, "typed-bootstrap-calls.json"), JSON.stringify(calls, null, 2));

  // --- readiness block scenario: a matched blocked_pattern must block startup
  // before instructions, mirroring v1 wait_for_profile_readiness (blocked ->
  // write_startup_recovery_artifacts + mark_state_blocked + mark_run_agent_blocked
  // + return 1, session left alive, no instruction paste). Same typed
  // executeLocalBootstrap, real disk, deterministic mocked capture.
  const blockRunDir = join(tempRoot, "block-run");
  const blockProfilesDir = join(tempRoot, "block-profiles");
  const blockWorkspace = join(tempRoot, "block-workspace");
  const blockChainPath = join(blockRunDir, "typed-block-chain.json");
  mkdirSync(blockRunDir, { recursive: true });
  mkdirSync(blockProfilesDir, { recursive: true });
  mkdirSync(blockWorkspace, { recursive: true });
  writeFileSync(join(blockProfilesDir, "blocker.json"), JSON.stringify({
    id: "blocker",
    cli: "claude",
    readiness: {
      enabled: true,
      blocked_patterns: [{ name: "auth-required", type: "text", value: "Log in required", action: "block", risk: "high" }],
    },
  }, null, 2));
  writeFileSync(blockChainPath, JSON.stringify({
    id: "typed-block-proof",
    name: "Typed Block Proof",
    default_agent_profile: "blocker",
    agents: [{ id: "manual", name: "Manual", triggers: ["manual-start"] }],
  }, null, 2));
  writeFileSync(join(blockRunDir, "run.json"), JSON.stringify({
    id: "run-block",
    chain: "Typed Block Proof",
    chainId: "typed-block-proof",
    status: "running",
    agents: [{ id: "manual", name: "Manual", status: "pending", session: "" }],
    sessions: [],
    workspacePath: blockWorkspace,
  }, null, 2));
  const blockPlan = buildAgentBootstrapPlan({
    chainPath: blockChainPath,
    runDir: blockRunDir,
    runId: "run-block",
    workspacePath: blockWorkspace,
    env: {
      AGENT_PROFILES_DIR: blockProfilesDir,
      MENTIKO_RUN_ID: "run-block",
      MENTIKO_RUNNER_V2: "1",
      PATH: process.env.PATH || "",
    },
  });
  const blockCalls = [];
  const blockExecutor = {
    async remove(name) { blockCalls.push({ op: "remove", name }); },
    async spawn(name, cmd, args, opts) { blockCalls.push({ op: "spawn", name, cmd, args, opts }); return { name, pid: 456 }; },
    async sendKeys(name, text) { blockCalls.push({ op: "sendKeys", name, text }); },
    async capture() { return "Log in required\nclaude ready >"; },
  };
  await executeLocalBootstrap(blockPlan, {
    chainPath: blockChainPath,
    runDir: blockRunDir,
    runId: "run-block",
    chainName: "Typed Block Proof",
    workspacePath: blockWorkspace,
    logFd: 1,
    cwd: codeRoot,
    env: { NODE_ENV: "test", MENTIKO_RUN_ID: "run-block", MENTIKO_RUNNER_V2: "1", PATH: process.env.PATH || "" },
  }, blockExecutor);
  writeFileSync(join(blockRunDir, "typed-block-calls.json"), JSON.stringify(blockCalls, null, 2));
  const blockRun = JSON.parse(readFileSync(join(blockRunDir, "run.json"), "utf8"));
  const blockState = readFileSync(blockPlan.statePath, "utf8");
  const blockCaptureArtifact = join(blockRunDir, "artifacts", "manual-startup-capture.txt");
  const blockReadinessArtifact = join(blockRunDir, "artifacts", "manual-startup-readiness.json");
  const blockAttempt = ((blockRun.runnerV2 || {}).attempts || [])[0] || {};
  const blockInstructionSend = blockCalls.find((call) => call.op === "sendKeys" && String(call.text).includes(blockPlan.instructionPath));
  const blockSessionRemoves = blockCalls.filter((call) => call.op === "remove" && call.name === blockPlan.sessionName).length;
  const blockMonitorSpawn = blockCalls.find((call) => call.op === "spawn" && call.name === blockPlan.monitorSessionName);

  // --- cap admission block scenario: when all chain slots are occupied, typed
  // bootstrap must mirror v1 cap_acquire_chain_slot by marking the run/agent
  // blocked before any PTY allocation or instruction submission.
  const capRunDir = join(tempRoot, "cap-run");
  const capProfilesDir = join(tempRoot, "cap-profiles");
  const capWorkspace = join(tempRoot, "cap-workspace");
  const capChainPath = join(capRunDir, "typed-cap-chain.json");
  mkdirSync(capRunDir, { recursive: true });
  mkdirSync(capProfilesDir, { recursive: true });
  mkdirSync(capWorkspace, { recursive: true });
  writeFileSync(join(capProfilesDir, "stub.json"), JSON.stringify({
    id: "stub",
    cli: "claude",
    readiness: { enabled: true, ready_patterns: [{ name: "ready", value: "claude ready" }] },
  }, null, 2));
  writeFileSync(capChainPath, JSON.stringify({
    id: "typed-cap-proof",
    name: "Typed Cap Proof",
    default_agent_profile: "stub",
    agents: [{ id: "manual", name: "Manual", triggers: ["manual-start"] }],
  }, null, 2));
  writeFileSync(join(capRunDir, "run.json"), JSON.stringify({
    id: "run-cap",
    chain: "Typed Cap Proof",
    chainId: "typed-cap-proof",
    status: "running",
    agents: [{ id: "manual", name: "Manual", status: "pending", session: "" }],
    sessions: [],
    workspacePath: capWorkspace,
  }, null, 2));
  mkdirSync(join(capRunDir, "run-existing"), { recursive: true });
  writeFileSync(join(capRunDir, "run-existing", "run.json"), JSON.stringify({
    id: "run-existing",
    status: "running",
    agents: [{ id: "other", name: "Other", status: "running", session: "other-session" }],
    sessions: ["other-session"],
  }, null, 2));
  const capPlan = buildAgentBootstrapPlan({
    chainPath: capChainPath,
    runDir: capRunDir,
    runId: "run-cap",
    workspacePath: capWorkspace,
    env: {
      AGENT_PROFILES_DIR: capProfilesDir,
      MENTIKO_RUN_ID: "run-cap",
      MENTIKO_RUNNER_V2: "1",
      PATH: process.env.PATH || "",
    },
  });
  const capCalls = [];
  const capExecutor = {
    async remove(name) { capCalls.push({ op: "remove", name }); },
    async spawn(name, cmd, args, opts) { capCalls.push({ op: "spawn", name, cmd, args, opts }); return { name, pid: 789 }; },
    async sendKeys(name, text) { capCalls.push({ op: "sendKeys", name, text }); },
    async capture() { return "claude ready >"; },
  };
  await executeLocalBootstrap(capPlan, {
    chainPath: capChainPath,
    runDir: capRunDir,
    runId: "run-cap",
    chainName: "Typed Cap Proof",
    workspacePath: capWorkspace,
    logFd: 1,
    cwd: codeRoot,
    env: {
      NODE_ENV: "test",
      MENTIKO_RUN_ID: "run-cap",
      MENTIKO_RUNNER_V2: "1",
      MENTIKO_MAX_CONCURRENT_CHAINS: "1",
      MENTIKO_CAP_MAX_WAIT_SECS: "0",
      MENTIKO_CAP_POLL_SECS: "0.01",
      PATH: process.env.PATH || "",
    },
  }, capExecutor);
  writeFileSync(join(capRunDir, "typed-cap-calls.json"), JSON.stringify(capCalls, null, 2));
  const capRun = JSON.parse(readFileSync(join(capRunDir, "run.json"), "utf8"));
  const capAttempt = ((capRun.runnerV2 || {}).attempts || [])[0] || {};

  const result = await runSyntheticRunnerV2ProbeWithDispatch({
    runDir,
    env: { MENTIKO_RUNNER_V2: "1" },
    dryRun: false,
    dispatchExternalEffects: true,
    namespaceId: "runner-v2-proof",
    orgId: "default",
  });

  const eventPath = join(runDir, "events", "run-probe-writer-draft-ready.event");
  const externalOutboxPath = join(runDir, "external-effects.jsonl");
  const dispatchAuditPath = join(runDir, "external-effects.dispatch.jsonl");
  const checks = [
    check("probe-ok", result.status === "ok", result.status),
    check("live-mode", result.status === "ok" && result.mode === "live", result.status === "ok" ? result.mode : "skipped"),
    check("event-processed", existsSync(eventPath) && readFileSync(eventPath, "utf8").includes("processed: true"), eventPath),
    check("external-outbox", existsSync(externalOutboxPath) && readFileSync(externalOutboxPath, "utf8").includes("\"status\":\"queued\""), externalOutboxPath),
    check("external-dispatch-audit", existsSync(dispatchAuditPath) && readFileSync(dispatchAuditPath, "utf8").includes("\"status\":\"dispatched\""), dispatchAuditPath),
    check("typed-bootstrap-session", !!sessionSpawn && bootstrapPlan.sessionName.includes("manual"), bootstrapPlan.sessionName),
    check("typed-bootstrap-no-shell-start", !startScript.includes("chain-runner.sh") && !flattenedCalls.includes("--start 'manual'"), startScriptPath),
    check("typed-bootstrap-no-secret-env", !JSON.stringify(sessionEnv).includes("proof-parent-secret") && !startScript.includes("proof-secret"), startScriptPath),
    check("typed-bootstrap-instructions-written", instructionText.includes("Agent-ID: manual") && !!pointerSend, bootstrapPlan.instructionPath),
    check("typed-bootstrap-state-written", stateText.includes("status: running") && stateText.includes("agent_id: manual"), bootstrapPlan.statePath),
    check("typed-bootstrap-monitor-started", !!monitorSpawn && String(monitorSpawn.args || "").includes("-lc"), bootstrapPlan.monitorSessionName),
    check("typed-bootstrap-start-before-pointer", calls.indexOf(startSend) >= 0 && calls.indexOf(pointerSend) > calls.indexOf(startSend), join(runDir, "typed-bootstrap-calls.json")),
    check("typed-bootstrap-no-daemon-launch", daemonSpawns.length === 0, join(runDir, "typed-bootstrap-calls.json")),
    check("typed-cap-admitted-running", admittedRun.status === "running" && (admittedRun.agents || []).some((agent) => agent.id === "manual" && agent.status === "running"), join(runDir, "run.json")),
    check("typed-cap-blocked-no-spawn", capRun.status === "blocked" && capCalls.length === 0 && (capRun.agents || []).some((agent) => agent.id === "manual" && agent.status === "blocked"), join(capRunDir, "run.json")),
    check("typed-cap-attempt-human-action", capAttempt.phase === "human_action_required" && capAttempt.terminalReason === "concurrency_cap_blocked", capAttempt.phase || null),
    check("typed-block-no-instructions", !blockInstructionSend, blockPlan.instructionPath),
    check("typed-block-run-blocked", blockRun.status === "blocked" && (blockRun.agents || []).some((agent) => agent.id === "manual" && agent.status === "blocked"), join(blockRunDir, "run.json")),
    check("typed-block-state-blocked", blockState.includes("status: blocked") && blockState.includes("blocked_reason:"), blockPlan.statePath),
    check("typed-block-startup-artifacts", existsSync(blockCaptureArtifact) && existsSync(blockReadinessArtifact) && JSON.parse(readFileSync(blockReadinessArtifact, "utf8")).status === "blocked", blockReadinessArtifact),
    check("typed-block-attempt-human-action", blockAttempt.phase === "human_action_required" && blockAttempt.terminalReason === "readiness_policy_blocked", blockAttempt.phase || null),
    check("typed-block-session-alive", blockSessionRemoves === 1 && !blockMonitorSpawn, join(blockRunDir, "typed-block-calls.json")),
  ];

  const status = checks.every((item) => item.status === "pass") ? "passed" : "failed";
  const proof = {
    schema_version: "runner-v2-runtime-proof/v1",
    generated_at: new Date().toISOString(),
    mode: "live",
    flag: "MENTIKO_RUNNER_V2",
    temp_root: tempRoot,
    status,
    checks,
    probe_summary: result.status === "ok"
      ? {
        status: result.status,
        mode: result.mode,
        launchesStarted: result.adapter.launchesStarted.length,
        externalDispatch: result.externalDispatch,
      }
      : { status: result.status },
  };

  mkdirSync(dirname(proofPath), { recursive: true });
  writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify({ status, proofPath, checks }, null, 2));
  if (status !== "passed") process.exitCode = 1;
}

function check(id, ok, evidence) {
  return { id, status: ok ? "pass" : "fail", evidence };
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
