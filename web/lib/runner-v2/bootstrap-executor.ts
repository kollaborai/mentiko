import { chmodSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { pty } from "@/lib/pty/pty-client";
import { shellEscape } from "@/lib/api/audit-exec";
import { buildAgentBootstrapPlan, type AgentBootstrapPlan } from "@/lib/runner-v2/agent-bootstrap-plan";
import { updateRunJson } from "@/lib/runner-v2/run-state";
import {
  classifyReadinessFailure,
  createAgentAttempt,
  recordAgentAttemptProcess,
  releaseAgentAttempt,
  submitAgentAttemptInstructions,
  transitionAgentAttempt,
} from "@/lib/runner-v2/agent-attempt";
import type { RunnerV2LaunchContext, RunnerV2LaunchResult } from "@/lib/runner-v2/types";

export interface RunnerV2BootstrapExecutor {
  remove(name: string): Promise<void>;
  spawn(name: string, cmd?: string, args?: string[], opts?: { cwd?: string; env?: Record<string, string> }): Promise<{ name: string; pid: number }>;
  sendKeys(name: string, text: string): Promise<void>;
  /** send raw bytes with no daemon-appended enter (used for bare enter retries) */
  sendRaw?(name: string, text: string): Promise<void>;
  capture(name: string, lines?: number): Promise<string>;
}

export async function startRunnerV2Bootstrap(context: RunnerV2LaunchContext): Promise<RunnerV2LaunchResult> {
  if (context.env.WORKSPACE_TYPE && context.env.WORKSPACE_TYPE !== "local") {
    return {
      support: "unsupported",
      reason: `runner-v2 typed bootstrap only supports local workspaces, got ${context.env.WORKSPACE_TYPE}`,
      fallbackAllowed: true,
    };
  }

  let plan: AgentBootstrapPlan;
  try {
    plan = buildAgentBootstrapPlan({
      chainPath: context.chainPath,
      runDir: context.runDir,
      runId: context.runId,
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
  const attempt = createAgentAttempt({
    runJsonPath,
    runId: context.runId,
    agentId: plan.agentId,
    leaseId: plan.sessionName,
  });
  transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "lease_acquired" });

  mkdirSync(plan.artifactsDir, { recursive: true });
  mkdirSync(plan.eventsDir, { recursive: true });
  mkdirSync(dirname(plan.statePath), { recursive: true });
  writeFileSync(plan.instructionPath, buildInitialInstructions(plan, context), { mode: 0o600 });
  writeFileSync(plan.statePath, buildInitialState(plan), { mode: 0o600 });

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
    await executor.remove(plan.sessionName).catch(() => undefined);
    await executor.remove(plan.monitorSessionName).catch(() => undefined);
    releaseAgentAttempt({ runJsonPath, attemptId: attempt.id });
    throw error;
  }
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

function buildInitialState(plan: AgentBootstrapPlan): string {
  return [
    "status: running",
    `session: ${plan.sessionName}`,
    `agent_id: ${plan.agentId}`,
    "round: 1",
    `started: ${new Date().toISOString()}`,
    `emits: ${plan.runContextExports.MENTIKO_AGENT_EMITS || ""}`,
    "workspace: local",
    "",
  ].join("\n");
}

function registerRunSession(context: RunnerV2LaunchContext, plan: AgentBootstrapPlan): void {
  const runJsonPath = join(context.runDir, "run.json");
  if (!existsSync(runJsonPath)) return;
  updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${runJsonPath}`);
    const agents = Array.isArray(current.agents)
      ? current.agents.map((agent) => {
        if (agent.id !== plan.agentId) return agent;
        return {
          ...agent,
          session: plan.sessionName,
          status: !agent.status || agent.status === "pending" ? "running" : agent.status,
        };
      })
      : [];
    return {
      ...current,
      sessions: Array.from(new Set([...(Array.isArray(current.sessions) ? current.sessions : []), plan.sessionName])),
      agents,
    };
  });
}

async function waitForBootstrapReadiness(
  plan: AgentBootstrapPlan,
  executor: RunnerV2BootstrapExecutor,
  attemptId: string,
  runJsonPath: string,
): Promise<void> {
  const deadline = Date.now() + 15_000;
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
    if (isLikelyAgentPrompt(output)) return;
    await sleep(500);
  }
  const failure = classifyReadinessFailure(lastOutput);
  transitionAgentAttempt({
    runJsonPath,
    attemptId,
    to: failure.phase,
    reason: failure.reason,
    detail: failure.detail,
  });
  throw new Error(`runner-v2 typed bootstrap timed out waiting for agent CLI readiness; last_output=${lastOutput.slice(-500)}`);
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
  await sleep(pollMs);
  while (Date.now() < deadline) {
    const output = await executor.capture(plan.sessionName, 60);
    if (!isComposerHoldingInput(output)) return true;
    if (enterRetries < maxEnterRetries) {
      enterRetries += 1;
      if (executor.sendRaw) await executor.sendRaw(plan.sessionName, "\r");
      else await executor.sendKeys(plan.sessionName, "");
    }
    await sleep(pollMs);
  }
  return false;
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

function isLikelyAgentPrompt(output: string): boolean {
  const normalized = output.toLowerCase();
  return normalized.includes("claude")
    || normalized.includes("codex")
    || normalized.includes("aider")
    || normalized.includes("kollab")
    || normalized.includes(">")
    || normalized.includes("how can i help")
    || normalized.includes("repl")
    || normalized.includes("ready");
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
