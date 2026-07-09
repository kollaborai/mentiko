import { spawn } from "child_process";
import { startRunnerV2Bootstrap } from "@/lib/runner-v2/bootstrap-executor";
import { loadRunnerV2Contract } from "@/lib/runner-v2/contracts";
import { buildRunnerV2LaunchPlan } from "@/lib/runner-v2/launch-plan";
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
  if (contract.default_runner !== "shell") {
    return {
      support: "unsupported",
      reason: "contract changed default runner before parity gate",
    };
  }

  const bootstrap = await startRunnerV2Bootstrap(context);
  if (bootstrap.support === "supported") return bootstrap;

  if (!bootstrap.fallbackAllowed) return bootstrap;

  let plan;
  try {
    plan = buildRunnerV2LaunchPlan(context);
  } catch (error) {
    return {
      support: "unsupported",
      reason: error instanceof Error ? error.message : "runner-v2 shell fallback planning failed",
    };
  }
  const child = spawn(plan.shell, plan.args, {
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

  if (contract.default_runner !== "shell") {
    return {
      support: "unsupported",
      reason: "typed executor cannot run after default runner contract drift",
    };
  }

  return {
    support: "supported",
    mode: "typed-plan",
  };
}
