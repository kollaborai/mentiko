import { resolve } from "path";
import config from "@/lib/config";
import type { RunnerV2LaunchContext } from "@/lib/runner-v2/types";

const AGENT_CHAIN_BIN = resolve(config.binDir, "mentiko");

/**
 * Non-local workspaces still require the product CLI because it owns their
 * transport setup. This is a direct external-command plan, not a shell bridge:
 * local runner-v2 launch never reaches this module.
 */
export interface RunnerV2ExternalLaunchPlan {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  detached: true;
  mode: "external-cli";
}

export function buildRunnerV2ExternalLaunchPlan(context: RunnerV2LaunchContext): RunnerV2ExternalLaunchPlan {
  const args = ["run", context.chainPath];
  if (context.workspacePath) args.push("--workspace", context.workspacePath);
  if (context.taskId) args.push("--task", context.taskId);
  if (context.debug) args.push("--debug");
  return {
    command: AGENT_CHAIN_BIN,
    args,
    cwd: context.cwd,
    detached: true,
    mode: "external-cli",
    env: {
      ...context.env,
      MENTIKO_RUNNER_V2_ACTIVE: "1",
      MENTIKO_RUNNER_V2_MODE: "external-cli",
    },
  };
}
