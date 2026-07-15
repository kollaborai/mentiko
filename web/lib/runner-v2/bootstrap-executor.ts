import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";
import { pty } from "@/lib/pty/pty-client";
import { shellEscape } from "@/lib/api/audit-exec";
import config from "@/lib/config";
import { buildAgentBootstrapPlan, type AgentBootstrapPlan } from "@/lib/runner-v2/agent-bootstrap-plan";
import { createRunnerAgentState, transitionRunnerAgentState } from "@/lib/runner-v2/agent-state";
import { classifyCliReadiness, type CliReadinessResult } from "@/lib/runner-v2/readiness-policy";
import { addRunSession, readRunJson, updateRunJson, updateRunStatus, type RunAgentRecord } from "@/lib/runner-v2/run-state";
import {
  type AgentAttemptPhase,
  type AgentAttemptTerminalReason,
  classifyReadinessFailure,
  createAgentAttempt,
  isTerminalAgentAttemptPhase,
  readRunnerV2AttemptState,
  recordAgentAttemptProcess,
  releaseAgentAttempt,
  submitAgentAttemptInstructions,
  transitionAgentAttempt,
} from "@/lib/runner-v2/agent-attempt";
import type { RunnerV2LaunchContext, RunnerV2LaunchResult } from "@/lib/runner-v2/types";
import type { AgentProfileReadinessConfig } from "@/lib/types";

export interface RunnerV2BootstrapExecutor {
  remove(name: string): Promise<void>;
  spawn(name: string, cmd?: string, args?: string[], opts?: { cwd?: string; env?: Record<string, string> }): Promise<{ name: string; pid: number }>;
  sendKeys(name: string, text: string): Promise<void>;
  /** send raw bytes with no daemon-appended enter (used for bare enter retries) */
  sendRaw?(name: string, text: string): Promise<void>;
  capture(name: string, lines?: number): Promise<string>;
}

const TERMINAL_RUN_STATUSES = new Set(["blocked", "failed", "stopped", "completed", "cancelled"]);

/**
 * `run.json` and AgentAttempt are terminal authority. The .state file is only
 * a live overlay: it cannot justify another bootstrap after completion. This
 * prevents the completion -> stale-state -> relaunch missing-script race.
 */
export class TerminalBootstrapStateError extends Error {}

export class TypedMonitorRuntimeMissingError extends Error {}

/**
 * The monitor is part of the typed launch contract. Validate the checked-in
 * runtime bundle before allocating an agent PTY, so a local checkout with an
 * unbuilt bundle fails closed without leaving an unmonitored live agent.
 */
export function assertTypedMonitorRuntimeAvailable(codeRoot: string = config.codeRoot): void {
  const monitorBundle = join(codeRoot, "lib", "monitor-v2.js");
  if (!existsSync(monitorBundle) || !statSync(monitorBundle).isFile()) {
    throw new TypedMonitorRuntimeMissingError(`typed monitor runtime bundle missing: ${monitorBundle}`);
  }
}

export async function startRunnerV2Bootstrap(context: RunnerV2LaunchContext): Promise<RunnerV2LaunchResult> {
  if (context.env.WORKSPACE_TYPE && context.env.WORKSPACE_TYPE !== "local") {
    return {
      support: "unsupported",
      reason: `runner-v2 typed bootstrap only supports local workspaces, got ${context.env.WORKSPACE_TYPE}`,
      fallbackAllowed: true,
    };
  }

  try {
    assertTypedMonitorRuntimeAvailable();
  } catch (error) {
    return {
      support: "unsupported",
      reason: error instanceof Error ? error.message : "typed monitor runtime bundle missing",
      fallbackAllowed: false,
    };
  }

  let plan: AgentBootstrapPlan;
  try {
    plan = buildAgentBootstrapPlan({
      chainPath: context.chainPath,
      runDir: context.runDir,
      runId: context.runId,
      agentId: context.agentId,
      workspacePath: context.workspacePath,
      env: context.env,
    });
  } catch (error) {
    return {
      support: "unsupported",
      reason: error instanceof Error ? error.message : "runner-v2 bootstrap planning failed",
      fallbackAllowed: true,
    };
  }

  try {
    await executeLocalBootstrap(plan, context, pty);
    return {
      support: "supported",
      mode: "typed-plan",
      sessionName: plan.sessionName,
    };
  } catch (error) {
    if (error instanceof BootstrapReadinessBlockedError) {
      return {
        support: "supported",
        mode: "typed-plan",
        sessionName: plan.sessionName,
      };
    }
    return {
      support: "unsupported",
      reason: error instanceof Error ? error.message : "runner-v2 typed bootstrap failed",
      fallbackAllowed: false,
    };
  }
}

export async function executeLocalBootstrap(
  plan: AgentBootstrapPlan,
  context: RunnerV2LaunchContext,
  executor: RunnerV2BootstrapExecutor,
): Promise<void> {
  const runJsonPath = join(context.runDir, "run.json");
  assertBootstrapLaunchable(runJsonPath, context.runId, plan.agentId);
  const attempt = createAgentAttempt({
    runJsonPath,
    runId: context.runId,
    agentId: plan.agentId,
    leaseId: plan.sessionName,
  });
  const admission = await acquireChainAdmission({
    runJsonPath,
    runId: context.runId,
    agentId: plan.agentId,
    env: context.env,
  });
  if (!admission.admitted) {
    transitionAgentAttempt({
      runJsonPath,
      attemptId: attempt.id,
      to: "human_action_required",
      reason: "concurrency_cap_blocked",
      detail: admission.reason,
    });
    return;
  }
  transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "lease_acquired" });

  mkdirSync(plan.artifactsDir, { recursive: true });
  mkdirSync(plan.eventsDir, { recursive: true });
  mkdirSync(dirname(plan.statePath), { recursive: true });
  writeFileSync(plan.instructionPath, buildInitialInstructions(plan, context), { mode: 0o600 });
  createRunnerAgentState(plan.statePath, buildInitialState(plan));

  const startScriptPath = join(context.runDir, "artifacts", `${plan.agentId}-start.sh`);
  writeFileSync(startScriptPath, buildStartScript(plan), { mode: 0o700 });
  chmodSync(startScriptPath, 0o700);

  try {
    await executor.remove(plan.sessionName);
    const spawned = await executor.spawn(plan.sessionName, "zsh", [], {
      cwd: plan.projectRoot,
      env: sanitizePtyEnv({
        PATH: context.env.PATH || process.env.PATH || "",
        HOME: context.env.HOME || process.env.HOME || "",
        SHELL: context.env.SHELL || process.env.SHELL || "",
        TERM: context.env.TERM || process.env.TERM || "xterm-256color",
        MENTIKO_RUNNER_V2_ACTIVE: "1",
        MENTIKO_RUNNER_V2_MODE: "typed-plan",
        ...plan.runContextExports,
      }),
    });
    transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "pty_allocated" });
    recordAgentAttemptProcess({
      runJsonPath,
      attemptId: attempt.id,
      processPid: spawned.pid,
      ptySessionId: spawned.name,
    });
    transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "process_spawned" });

    registerRunSession(context, plan);
    const startCommand = `cd ${shellEscape(plan.projectRoot)} && bash ${shellEscape(startScriptPath)}`;
    await executor.sendKeys(plan.sessionName, `${startCommand}\r`);
    await waitForBootstrapReadiness(plan, executor, attempt.id, runJsonPath);
    transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "ready_for_instructions" });
    const submission = submitAgentAttemptInstructions({
      runJsonPath,
      attemptId: attempt.id,
      idempotencyKey: `${context.runId}:${plan.agentId}:${plan.instructionPath}`,
      instructionPath: plan.instructionPath,
      pointer: plan.instructionPointer,
    });
    if (submission.delivered) {
      // no trailing \r: the pointer is multi-line, so the CLI receives it as a
      // bracketed paste and an embedded enter is swallowed into the paste body.
      // The pty daemon's non-raw send appends its own enter after the paste
      // settle delay; confirmInstructionSubmission then verifies the composer
      // actually accepted it (a CLI still running boot checks — e.g. MCP auth —
      // renders the composer but drops enters) and retries bare enters.
      await executor.sendKeys(plan.sessionName, plan.instructionPointer);
      const confirmed = await confirmInstructionSubmission(plan, executor);
      if (confirmed) {
        transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "instructions_submitted" });
      } else {
        transitionAgentAttempt({
          runJsonPath,
          attemptId: attempt.id,
          to: "stuck",
          reason: "instruction_submission_unconfirmed",
          detail: "composer still holds the pasted instructions after enter retries; session left alive for monitor rescue",
        });
      }
    }
    await startMonitorSession(plan, executor);
  } catch (error) {
    if (error instanceof BootstrapReadinessBlockedError) {
      return;
    }
    await executor.remove(plan.sessionName).catch(() => undefined);
    await executor.remove(plan.monitorSessionName).catch(() => undefined);
    releaseAgentAttempt({ runJsonPath, attemptId: attempt.id });
    throw error;
  }
}

function assertBootstrapLaunchable(
  runJsonPath: string,
  runId: string,
  agentId: string,
): void {
  const run = readRunJson(runJsonPath);
  if (run.id !== runId) {
    throw new TerminalBootstrapStateError(`runner-v2 bootstrap run id ${runId} does not match durable run record ${run.id}`);
  }
  if (TERMINAL_RUN_STATUSES.has(run.status)) {
    throw new TerminalBootstrapStateError(`runner-v2 bootstrap rejected: run ${run.id} is terminal (${run.status})`);
  }

  const latestAttempt = [...readRunnerV2AttemptState(runJsonPath).attempts]
    .reverse()
    .find((attempt) => attempt.runId === runId && attempt.agentId === agentId);
  if (!latestAttempt || !isTerminalAgentAttemptPhase(latestAttempt.phase)) return;

  // An environment occurrence id is only a caller claim, not durable proof of
  // a newer route. Existing routed launches are replayed from their persisted
  // acceptance receipt by adapters.ts before bootstrap is reached; a direct
  // bootstrap therefore fails closed on terminal attempt evidence.
  throw new TerminalBootstrapStateError(
    `runner-v2 bootstrap rejected: agent ${agentId} has terminal attempt ${latestAttempt.id} (${latestAttempt.phase})`,
  );
}

function buildStartScript(plan: AgentBootstrapPlan): string {
  return [
    "#!/usr/bin/env bash",
    "set -e",
    "trap 'rm -f \"$0\"' EXIT",
    `cd ${shellEscape(plan.projectRoot)}`,
    "unset CLAUDECODE",
    ...Object.entries(plan.runContextExports).map(([key, value]) => `export ${key}=${shellEscape(value)}`),
    plan.localStartCommand,
    "",
  ].join("\n");
}

function buildInitialInstructions(plan: AgentBootstrapPlan, context: RunnerV2LaunchContext): string {
  return [
    `You are: ${plan.agentName}`,
    `Run-ID: ${context.runId}`,
    `Agent-ID: ${plan.agentId}`,
    "",
    `Your chain run is ${context.chainName}.`,
    `Artifacts directory: ${plan.artifactsDir}`,
    `Events directory: ${plan.eventsDir}`,
    "",
    "Read the chain JSON for your full task context:",
    context.chainPath,
    "",
    "When the instructions are complete, finish with AGENT_COMPLETE on its own final line.",
  ].join("\n");
}

function buildInitialState(plan: AgentBootstrapPlan) {
  return {
    session: plan.sessionName,
    agent_id: plan.agentId,
    round: "1",
    started: new Date().toISOString(),
    emits: plan.runContextExports.MENTIKO_AGENT_EMITS || "",
    workspace: "local",
  };
}

function registerRunSession(context: RunnerV2LaunchContext, plan: AgentBootstrapPlan): void {
  const runJsonPath = join(context.runDir, "run.json");
  if (!existsSync(runJsonPath)) return;
  // Shell-created runs only contain agents that have already launched. Routed
  // typed targets therefore need the same append-if-absent registration used by
  // the canonical run-state API; mapping the existing array silently omitted a
  // new target and made durable launch acceptance reject a live PTY.
  addRunSession(runJsonPath, plan.sessionName, plan.agentId, plan.agentName);
}

async function waitForBootstrapReadiness(
  plan: AgentBootstrapPlan,
  executor: RunnerV2BootstrapExecutor,
  attemptId: string,
  runJsonPath: string,
): Promise<void> {
  // Profile-driven classification is the only readiness gate — no hardcoded
  // prompt heuristics. A profile-less session mirrors v1 cli_readiness_check's
  // missing-profile arm ("unknown"), so resolvePlanReadinessPolicy always yields
  // a policy and classifyCliReadiness decides every case.
  const readinessPolicy = resolvePlanReadinessPolicy(plan);
  const failClosed = planReadinessFailClosed(plan);
  const deadline = Date.now() + readinessTimeoutMs(plan);
  const pollMs = readinessPollMs(plan);
  let lastOutput = "";
  while (Date.now() < deadline) {
    const output = await executor.capture(plan.sessionName, 80);
    lastOutput = output;
    if (output.includes(plan.localStartCommand) || output.includes(plan.instructionPointer)) {
      const failure = classifyReadinessFailure(output);
      transitionAgentAttempt({
        runJsonPath,
        attemptId,
        to: failure.phase,
        reason: failure.reason,
        detail: "bootstrap command echoed without starting agent CLI",
      });
      throw new Error("runner-v2 bootstrap command echoed without starting agent CLI");
    }
    const readiness = classifyCliReadiness({
      readiness: readinessPolicy.readiness,
      profileMissing: readinessPolicy.profileMissing,
      output,
      failClosed,
    });
    if (readiness.status === "ready") return;
    if (isTerminalReadinessStatus(readiness.status)) {
      const failure = classifyPolicyReadinessFailure(readiness, output);
      blockStartupForReadiness({
        plan,
        runJsonPath,
        output,
        readiness,
        reason: `startup_recovery:${readiness.status}: ${readiness.reason}`,
      });
      transitionAgentAttempt({
        runJsonPath,
        attemptId,
        to: failure.phase,
        reason: failure.reason,
        detail: failure.detail,
      });
      throw new BootstrapReadinessBlockedError(`runner-v2 typed bootstrap readiness ${readiness.status}: ${readiness.reason}`);
    }
    // unknown / not-yet-ready: v1 legacy proceeds immediately (return 0);
    // fail-closed keeps polling through the grace window and blocks at the deadline.
    if (!failClosed) return;
    await sleep(pollMs);
  }
  // fail-closed deadline: nothing ever proved readiness. Mirror v1's post-loop
  // mark_state_blocked + mark_run_agent_blocked (return 1) — write artifacts,
  // keep the session alive, submit no instructions.
  const timeoutSeconds = Math.floor(readinessTimeoutMs(plan) / 1000);
  const readiness: CliReadinessResult = {
    status: "unknown",
    reason: `CLI readiness unresolved after ${timeoutSeconds}s`,
  };
  blockStartupForReadiness({
    plan,
    runJsonPath,
    output: lastOutput,
    readiness,
    reason: `startup_recovery:unknown: ${readiness.reason}`,
  });
  transitionAgentAttempt({
    runJsonPath,
    attemptId,
    to: "startup_failed",
    reason: "readiness_deadline_expired",
    detail: lastOutput.slice(-500),
  });
  throw new BootstrapReadinessBlockedError(`runner-v2 typed bootstrap timed out waiting for profile readiness; last_output=${lastOutput.slice(-500)}`);
}

class BootstrapReadinessBlockedError extends Error {}

function resolvePlanReadinessPolicy(plan: AgentBootstrapPlan): {
  readiness?: AgentProfileReadinessConfig | null;
  profileMissing?: boolean;
} {
  if (plan.profileReadiness) {
    return { readiness: plan.profileReadiness };
  }
  // No resolvable profile path -> v1 cli_readiness_check treats a missing profile
  // as "unknown" (profileMissing), never a prompt-shape guess.
  if (!plan.profilePath || !existsSync(plan.profilePath)) {
    return { profileMissing: true };
  }
  try {
    const profile = JSON.parse(readFileSync(plan.profilePath, "utf8")) as {
      readiness?: AgentProfileReadinessConfig;
    };
    return { readiness: profile.readiness ?? null };
  } catch {
    return { profileMissing: true };
  }
}

function isTerminalReadinessStatus(status: CliReadinessResult["status"]): boolean {
  return status === "blocked" || status === "recover" || status === "retry" || status === "no_ready_signal";
}

function classifyPolicyReadinessFailure(readiness: CliReadinessResult, output: string): {
  phase: Extract<AgentAttemptPhase, "startup_failed" | "human_action_required">;
  reason: AgentAttemptTerminalReason;
  detail: string;
} {
  const suffix = output.slice(-500);
  const detail = `${readiness.reason}${readiness.pattern ? ` (${readiness.pattern})` : ""}${suffix ? `; last_output=${suffix}` : ""}`;
  if (readiness.status === "blocked") {
    return { phase: "human_action_required", reason: "readiness_policy_blocked", detail };
  }
  if (readiness.status === "recover") {
    return { phase: "startup_failed", reason: "readiness_policy_recoverable", detail };
  }
  if (readiness.status === "retry") {
    return { phase: "startup_failed", reason: "readiness_policy_retry", detail };
  }
  return { phase: "startup_failed", reason: "readiness_no_ready_signal", detail };
}

function blockStartupForReadiness(input: {
  plan: AgentBootstrapPlan;
  runJsonPath: string;
  output: string;
  readiness: CliReadinessResult;
  reason: string;
}): void {
  writeStartupReadinessArtifacts(input.plan, input.output, input.readiness);
  markStateBlocked(input.plan.statePath, input.reason);
  markRunAgentBlocked(input.runJsonPath, input.plan.agentId, input.reason);
}

function writeStartupReadinessArtifacts(
  plan: AgentBootstrapPlan,
  output: string,
  readiness: CliReadinessResult,
): void {
  mkdirSync(plan.artifactsDir, { recursive: true });
  writeFileSync(join(plan.artifactsDir, `${plan.agentId}-startup-capture.txt`), output);
  writeFileSync(join(plan.artifactsDir, `${plan.agentId}-startup-readiness.json`), `${JSON.stringify(readiness, null, 2)}\n`);
}

function markStateBlocked(statePath: string, reason: string): void {
  transitionRunnerAgentState(statePath, "blocked", reason);
}

function markRunAgentBlocked(runJsonPath: string, agentId: string, reason: string): void {
  const now = new Date().toISOString();
  updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${runJsonPath}`);
    const agents: RunAgentRecord[] = Array.isArray(current.agents) ? current.agents : [];
    const hasAgent = agents.some((agent) => agent.id === agentId);
    return {
      ...current,
      status: "blocked",
      // A blocked startup is terminal for the run even though the PTY remains
      // available for recovery. Do not claim the blocked agent completed.
      completed: current.completed || now,
      blockedAt: typeof current.blockedAt === "string" ? current.blockedAt : now,
      blockedReason: reason,
      agents: hasAgent
        ? agents.map((agent) => agent.id === agentId
          ? {
              ...agent,
              status: "blocked",
              lastHeartbeat: now,
              lastMessage: reason,
            }
          : agent)
        : [
            ...agents,
            {
              id: agentId,
              name: agentId,
              session: "",
              status: "blocked",
              lastHeartbeat: now,
              lastMessage: reason,
            },
          ],
    };
  });
}

async function acquireChainAdmission(input: {
  runJsonPath: string;
  runId: string;
  agentId: string;
  env: Record<string, string | undefined>;
}): Promise<{ admitted: true } | { admitted: false; reason: string }> {
  if (input.env.MENTIKO_CAP_DISABLED === "1") {
    updateRunStatus(input.runJsonPath, "running");
    return { admitted: true };
  }

  const cap = Number(input.env.MENTIKO_MAX_CONCURRENT_CHAINS ?? 4);
  if (!Number.isFinite(cap) || cap <= 0) {
    updateRunStatus(input.runJsonPath, "running");
    return { admitted: true };
  }

  updateRunStatus(input.runJsonPath, "pending");
  const maxWaitMs = secondsEnv(input.env.MENTIKO_CAP_MAX_WAIT_SECS, 300) * 1000;
  const pollMaxMs = secondsEnv(input.env.MENTIKO_CAP_POLL_MAX_SECS, 15) * 1000;
  const started = Date.now();
  let pollMs = secondsEnv(input.env.MENTIKO_CAP_POLL_SECS, 2) * 1000;
  let queued = false;

  while (true) {
    const release = acquireCapLock(input.runJsonPath, input.env);
    if (release) {
      try {
        const active = countRunningChains(input.runJsonPath, input.runId);
        if (active < cap) {
          updateRunStatus(
            input.runJsonPath,
            "running",
            queued ? `admitted from queue (${active + 1}/${cap} chains active)` : undefined,
          );
          return { admitted: true };
        }
      } finally {
        release();
      }
    }

    const elapsedMs = Date.now() - started;
    if (elapsedMs >= maxWaitMs) {
      const elapsedSeconds = Math.floor(elapsedMs / 1000);
      const reason = `concurrency cap: waited ${elapsedSeconds}s for a chain slot (limit ${cap}); blocked`;
      markRunAgentBlocked(input.runJsonPath, input.agentId, reason);
      updateRunStatus(input.runJsonPath, "blocked", reason);
      return { admitted: false, reason };
    }

    if (!queued) {
      queued = true;
      updateRunStatus(input.runJsonPath, "pending", `queued: waiting for a chain slot (limit ${cap})`);
    }
    await sleep(pollMs);
    pollMs = Math.min(pollMs * 2, pollMaxMs);
  }
}

function secondsEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function acquireCapLock(runJsonPath: string, env: Record<string, string | undefined>): (() => void) | null {
  const lockDir = join(runsRootFor(runJsonPath), ".cap.lock");
  try {
    mkdirSync(lockDir, { recursive: false });
    writeFileSync(join(lockDir, "pid"), String(process.pid));
    return () => {
      rmSync(lockDir, { recursive: true, force: true });
    };
  } catch {
    if (capLockIsBreakable(lockDir, env)) {
      rmSync(lockDir, { recursive: true, force: true });
    }
    return null;
  }
}

function capLockIsBreakable(lockDir: string, env: Record<string, string | undefined>): boolean {
  try {
    const pid = Number(readFileSync(join(lockDir, "pid"), "utf8").trim());
    if (Number.isFinite(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
      } catch {
        return true;
      }
    }
    const staleMs = secondsEnv(env.CAP_LOCK_STALE_SECS, 60) * 1000;
    return Date.now() - statSync(lockDir).mtimeMs >= staleMs;
  } catch {
    return true;
  }
}

function countRunningChains(runJsonPath: string, currentRunId: string): number {
  const root = runsRootFor(runJsonPath);
  if (!existsSync(root)) return 0;
  let count = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("run-") || entry.name === currentRunId) continue;
    const siblingRunJson = join(root, entry.name, "run.json");
    if (siblingRunJson === runJsonPath || !existsSync(siblingRunJson)) continue;
    try {
      const status = JSON.parse(readFileSync(siblingRunJson, "utf8")).status;
      if (status === "running") count += 1;
    } catch {
      // Malformed run records do not occupy a cap slot; the v1 counter's jq
      // failure path similarly treats them as empty.
    }
  }
  return count;
}

function runsRootFor(runJsonPath: string): string {
  const runDir = dirname(runJsonPath);
  return basename(runDir).startsWith("run-") ? dirname(runDir) : runDir;
}

function readinessTimeoutMs(plan: AgentBootstrapPlan): number {
  const configured = Number(envValue(plan, "MENTIKO_CLI_READY_TIMEOUT"));
  return Number.isFinite(configured) && configured > 0 ? configured * 1000 : 90_000;
}

function readinessPollMs(plan: AgentBootstrapPlan): number {
  const configured = Number(envValue(plan, "MENTIKO_CLI_READY_POLL"));
  // v1 default: MENTIKO_CLI_READY_POLL seconds, 2s (lib/chain-runner.sh wait_for_profile_readiness)
  return Number.isFinite(configured) && configured > 0 ? configured * 1000 : 2000;
}

function planReadinessFailClosed(plan: AgentBootstrapPlan): boolean {
  return envValue(plan, "MENTIKO_READINESS_FAIL_CLOSED") === "1";
}

function envValue(plan: AgentBootstrapPlan, key: string): string | undefined {
  return plan.runContextExports[key] || process.env[key];
}

/**
 * Verify the pasted instructions were actually submitted, retrying bare enters
 * while the composer still holds them. Evidence over hope: readiness heuristics
 * can pass while the CLI is still initializing (it paints the composer during
 * MCP/auth checks but drops enters), which strands the paste unsubmitted.
 * Poll/deadline are env-tunable for tests.
 */
async function confirmInstructionSubmission(
  plan: AgentBootstrapPlan,
  executor: RunnerV2BootstrapExecutor,
): Promise<boolean> {
  const pollMs = Number(process.env.MENTIKO_RUNNER_V2_SUBMISSION_POLL_MS) || 1_500;
  const deadlineMs = Number(process.env.MENTIKO_RUNNER_V2_SUBMISSION_DEADLINE_MS) || 20_000;
  const maxEnterRetries = 4;
  const deadline = Date.now() + deadlineMs;
  let enterRetries = 0;
  // give the daemon's own delayed enter a beat before the first check
  if (!(await sleepBeforeSubmissionDeadline(pollMs, deadline))) return false;
  while (Date.now() < deadline) {
    const output = await awaitSubmissionOperation(
      () => executor.capture(plan.sessionName, 60),
      deadline,
    );
    if (output === SUBMISSION_DEADLINE_EXCEEDED) return false;
    if (!isComposerHoldingInput(output)) return true;
    if (enterRetries < maxEnterRetries) {
      enterRetries += 1;
      const enterResult = await awaitSubmissionOperation(
        () => executor.sendRaw
          ? executor.sendRaw(plan.sessionName, "\r")
          : executor.sendKeys(plan.sessionName, ""),
        deadline,
      );
      if (enterResult === SUBMISSION_DEADLINE_EXCEEDED) return false;
    }
    if (!(await sleepBeforeSubmissionDeadline(pollMs, deadline))) return false;
  }
  return false;
}

const SUBMISSION_DEADLINE_EXCEEDED = Symbol("submission deadline exceeded");

/**
 * The PTY client has its own socket timeout. Do not let one slow RPC extend
 * the submission promise past its advertised wall-clock deadline. The RPC may
 * still settle later, but its handlers stay attached and this caller performs
 * no further retry after the deadline; the durable attempt is marked stuck and
 * its monitor remains responsible for recovery.
 */
async function awaitSubmissionOperation<T>(
  operation: () => Promise<T>,
  deadline: number,
): Promise<T | typeof SUBMISSION_DEADLINE_EXCEEDED> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) return SUBMISSION_DEADLINE_EXCEEDED;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<T | typeof SUBMISSION_DEADLINE_EXCEEDED>((resolve, reject) => {
      timeout = setTimeout(() => resolve(SUBMISSION_DEADLINE_EXCEEDED), remainingMs);
      try {
        void operation().then(resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function sleepBeforeSubmissionDeadline(delayMs: number, deadline: number): Promise<boolean> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) return false;
  await sleep(Math.min(delayMs, remainingMs));
  return Date.now() < deadline;
}

/**
 * The composer is the LAST line containing the ❯ prompt; content after it
 * means unsubmitted input (an accepted paste re-renders in history with a
 * `>` prefix instead). Menus/dialogs also use ❯ as a selection caret — an
 * enter retry there picks the default option, which the readiness failure
 * classifier already treats as human_action_required territory.
 */
function isComposerHoldingInput(output: string): boolean {
  const lines = output.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const idx = lines[i].indexOf("❯"); // ❯
    if (idx === -1) continue;
    return lines[i].slice(idx + 1).trim().length > 0;
  }
  return false;
}

async function startMonitorSession(
  plan: AgentBootstrapPlan,
  executor: RunnerV2BootstrapExecutor,
): Promise<void> {
  await executor.remove(plan.monitorSessionName);
  await executor.spawn(plan.monitorSessionName, "bash", ["-lc", plan.monitorCommand], {
    cwd: plan.projectRoot,
    env: sanitizePtyEnv({
      PATH: plan.runContextExports.PATH || process.env.PATH || "",
      MENTIKO_RUNNER_V2_ACTIVE: "1",
      MENTIKO_RUNNER_V2_MODE: "typed-plan",
      ...plan.runContextExports,
    }),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizePtyEnv(env: Record<string, string | undefined>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") sanitized[key] = value;
  }
  return sanitized;
}
