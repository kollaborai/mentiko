import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { pty } from "@/lib/pty/pty-client";
import { shellEscape } from "@/lib/api/audit-exec";
import { buildAgentBootstrapPlan, type AgentBootstrapPlan } from "@/lib/runner-v2/agent-bootstrap-plan";
import type { RunnerV2LaunchContext, RunnerV2LaunchResult } from "@/lib/runner-v2/types";

export interface RunnerV2BootstrapExecutor {
  remove(name: string): Promise<void>;
  spawn(name: string, cmd?: string, args?: string[], opts?: { cwd?: string; env?: Record<string, string> }): Promise<{ name: string; pid: number }>;
  sendKeys(name: string, text: string): Promise<void>;
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
  mkdirSync(plan.artifactsDir, { recursive: true });
  mkdirSync(plan.eventsDir, { recursive: true });
  mkdirSync(dirname(plan.statePath), { recursive: true });
  writeFileSync(plan.instructionPath, buildInitialInstructions(plan, context), { mode: 0o600 });
  writeFileSync(plan.statePath, buildInitialState(plan), { mode: 0o600 });

  const startScriptPath = join(context.runDir, "artifacts", `${plan.agentId}-start.sh`);
  writeFileSync(startScriptPath, buildStartScript(plan), { mode: 0o700 });
  chmodSync(startScriptPath, 0o700);

  await executor.remove(plan.sessionName);
  await executor.spawn(plan.sessionName, "zsh", [], {
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
  registerRunSession(context, plan);
  const startCommand = `cd ${shellEscape(plan.projectRoot)} && bash ${shellEscape(startScriptPath)}`;
  await executor.sendKeys(plan.sessionName, `${startCommand}\r`);
  await waitForBootstrapReadiness(plan, executor);
  await executor.sendKeys(plan.sessionName, `${plan.instructionPointer}\r`);
  await startMonitorSession(plan, executor);
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
  const run = JSON.parse(readFileSync(runJsonPath, "utf8")) as {
    sessions?: string[];
    agents?: Array<{ id?: string; session?: string; status?: string; name?: string }>;
  };
  run.sessions = Array.from(new Set([...(Array.isArray(run.sessions) ? run.sessions : []), plan.sessionName]));
  if (Array.isArray(run.agents)) {
    const agent = run.agents.find((item) => item.id === plan.agentId);
    if (agent) {
      agent.session = plan.sessionName;
      if (!agent.status || agent.status === "pending") agent.status = "running";
    }
  }
  writeFileSync(runJsonPath, `${JSON.stringify(run, null, 2)}\n`);
}

async function waitForBootstrapReadiness(
  plan: AgentBootstrapPlan,
  executor: RunnerV2BootstrapExecutor,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  let lastOutput = "";
  while (Date.now() < deadline) {
    const output = await executor.capture(plan.sessionName, 80);
    lastOutput = output;
    if (output.includes(plan.localStartCommand) || output.includes(plan.instructionPointer)) {
      throw new Error("runner-v2 bootstrap command echoed without starting agent CLI");
    }
    if (isLikelyAgentPrompt(output)) return;
    await sleep(500);
  }
  throw new Error(`runner-v2 typed bootstrap timed out waiting for agent CLI readiness; last_output=${lastOutput.slice(-500)}`);
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
