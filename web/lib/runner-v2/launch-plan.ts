import { readFileSync } from "fs";
import { join, resolve } from "path";
import config from "@/lib/config";
import { shellEscape } from "@/lib/api/audit-exec";
import { buildAgentBootstrapPlan } from "@/lib/runner-v2/agent-bootstrap-plan";
import type { RunnerV2LaunchContext } from "@/lib/runner-v2/types";

const AGENT_CHAIN_BIN = join(config.binDir, "mentiko");
const CHAIN_RUNNER = join(config.codeRoot, "lib", "chain-runner.sh");

export interface RunnerV2LaunchPlan {
  shell: "/bin/zsh";
  args: ["-lc", string];
  cwd: string;
  env: NodeJS.ProcessEnv;
  detached: true;
  mode: "shell-compat" | "typed-plan";
}

function optionalArg(name: string, value?: string): string {
  return value ? ` ${name} ${shellEscape(value)}` : "";
}

export function buildRunnerV2LaunchPlan(context: RunnerV2LaunchContext): RunnerV2LaunchPlan {
  return buildRunnerV2TypedInitialLaunchPlan(context);
}

export function buildRunnerV2ShellCompatLaunchPlan(context: RunnerV2LaunchContext): RunnerV2LaunchPlan {
  const binPath = resolve(AGENT_CHAIN_BIN);
  const command = [
    `${shellEscape(binPath)} run ${shellEscape(context.chainPath)}`,
    optionalArg("--workspace", context.workspacePath),
    optionalArg("--task", context.taskId),
    context.debug ? " --debug" : "",
  ].join("");

  return {
    shell: "/bin/zsh",
    args: ["-lc", command],
    cwd: context.cwd,
    detached: true,
    mode: "shell-compat",
    env: {
      ...context.env,
      MENTIKO_RUNNER_V2_ACTIVE: "1",
      MENTIKO_RUNNER_V2_MODE: "shell-compat",
    },
  };
}

export function buildRunnerV2TypedInitialLaunchPlan(context: RunnerV2LaunchContext): RunnerV2LaunchPlan {
  const chainRunner = resolve(CHAIN_RUNNER);
  const binPath = resolve(AGENT_CHAIN_BIN);
  const chain = readLaunchChain(context.chainPath);
  if (typeof chain.config?.schedule === "string" && chain.config.schedule.trim().length > 0) {
    throw new Error("runner-v2 typed launch defers scheduled chains to shell schedule semantics");
  }
  const bootstrap = buildAgentBootstrapPlan({
    chainPath: context.chainPath,
    runDir: context.runDir,
    runId: context.runId,
    workspacePath: context.workspacePath,
    env: context.env,
  });
  const firstAgent = bootstrap.agentId;
  const typedCommand = [
    `bash ${shellEscape(chainRunner)} ${shellEscape(context.chainPath)}`,
    optionalArg("--workspace", context.workspacePath),
    optionalArg("--task", context.taskId),
    context.debug ? " --debug" : "",
    ` --start ${shellEscape(firstAgent)}`,
  ].join("");
  const fallbackCommand = [
    `exec ${shellEscape(binPath)} run ${shellEscape(context.chainPath)}`,
    optionalArg("--workspace", context.workspacePath),
    optionalArg("--task", context.taskId),
    context.debug ? " --debug" : "",
  ].join("");
  const command = `${typedCommand} || ${fallbackCommand}`;

  return {
    shell: "/bin/zsh",
    args: ["-lc", command],
    cwd: context.cwd,
    detached: true,
    mode: "typed-plan",
    env: {
      ...context.env,
      MENTIKO_RUNNER_V2_ACTIVE: "1",
      MENTIKO_RUNNER_V2_MODE: "typed-plan",
    },
  };
}

interface LaunchChainAgent {
  id?: unknown;
  triggers?: unknown;
}

interface LaunchChainFile {
  config?: {
    schedule?: unknown;
  };
  agents?: LaunchChainAgent[];
}

function readLaunchChain(chainPath: string): LaunchChainFile {
  return JSON.parse(readFileSync(chainPath, "utf8")) as LaunchChainFile;
}
