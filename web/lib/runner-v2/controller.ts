import { spawn } from "child_process";
import { startRunnerV2Bootstrap } from "@/lib/runner-v2/bootstrap-executor";
import { loadRunnerV2Contract } from "@/lib/runner-v2/contracts";
import { buildRunnerV2ExternalLaunchPlan } from "@/lib/runner-v2/launch-plan";
import type { RunnerV2LaunchContext, RunnerV2LaunchResult } from "@/lib/runner-v2/types";

export interface RunnerV2TypedExecutorSupport {
  support: "supported" | "unsupported";
  mode?: "typed-plan";
  reason?: string;
}

export async function startRunnerV2Launch(context: RunnerV2LaunchContext): Promise<RunnerV2LaunchResult> {
  let contract;
  try {
    contract = loadRunnerV2Contract();
  } catch (error) {
    return {
      support: "unsupported",
      reason: error instanceof Error ? error.message : "runner-v2 contract load failed",
    };
  }
  if (contract.default_runner !== "typed") {
    return {
      support: "unsupported",
      reason: "contract does not declare the typed default runner",
    };
  }

  const bootstrap = await startRunnerV2Bootstrap(context);
  if (bootstrap.support === "supported") return bootstrap;

  // Local runner-v2 is typed-only. An unsupported local plan is a real parity
  // failure, never an invitation to start a second shell owner. SSH/Docker
  // remain product-CLI launches because their transport is the external behavior.
  if (!isExternalWorkspace(context)) {
    return { ...bootstrap, fallbackAllowed: false };
  }

  let plan;
  try {
    plan = buildRunnerV2ExternalLaunchPlan(context);
  } catch (error) {
    return {
      support: "unsupported",
      reason: error instanceof Error ? error.message : "runner-v2 external launch planning failed",
      fallbackAllowed: false,
    };
  }
  const child = spawn(plan.command, plan.args, {
    cwd: plan.cwd,
    detached: plan.detached,
    stdio: ["ignore", context.logFd, context.logFd],
    env: plan.env,
  });

  child.unref();

  return {
    support: "supported",
    mode: plan.mode,
    child,
  };
}

function isExternalWorkspace(context: RunnerV2LaunchContext): boolean {
  return Boolean(context.env.WORKSPACE_TYPE && context.env.WORKSPACE_TYPE !== "local");
}

export function getRunnerV2TypedExecutorSupport(): RunnerV2TypedExecutorSupport {
  let contract;
  try {
    contract = loadRunnerV2Contract();
  } catch (error) {
    return {
      support: "unsupported",
      reason: error instanceof Error ? error.message : "runner-v2 contract load failed",
    };
  }

  if (contract.default_runner !== "typed") {
    return {
      support: "unsupported",
      reason: "typed executor requires the typed default-runner contract",
    };
  }

  return {
    support: "supported",
    mode: "typed-plan",
  };
}
