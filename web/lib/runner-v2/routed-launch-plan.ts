import { join } from "path";
import config from "@/lib/config";
import { shellEscape } from "@/lib/api/audit-exec";
import type { RoutingDecision } from "@/lib/runner-v2/routing";

export interface RoutedLaunchContext {
  chainPath: string;
  workspacePath?: string;
  taskId?: string;
  debug?: boolean;
  runDir: string;
  fanGroupId?: string;
  env?: Record<string, string | undefined>;
}

export interface RoutedLaunchPlan {
  kind: "single" | "parallel" | "fan-out";
  command: string;
  env: Record<string, string | undefined>;
  logPath?: string;
  detached: boolean;
}

export function buildRoutedLaunchPlans(decision: RoutingDecision, context: RoutedLaunchContext): RoutedLaunchPlan[] {
  if (decision.action !== "launch") {
    return [];
  }

  if (decision.fanIn || decision.waitFor || decision.quorum || decision.onError) {
    return decision.agentIds.map((agentId) => ({
      kind: "fan-out",
      command: runnerCommand(context, ["--start", agentId]),
      env: {
        ...context.env,
        AGENT_FAN_GROUP_AGENT_ID: agentId,
        ...(decision.fanIn ? { AGENT_FAN_GROUP_ID: context.fanGroupId || decision.fanIn } : {}),
      },
      logPath: join(context.runDir, `fanout-${agentId}.log`),
      detached: true,
    }));
  }

  if (decision.agentIds.length > 1) {
    return [{
      kind: "parallel",
      command: runnerCommand(context, ["--parallel", ...decision.agentIds]),
      env: { ...context.env },
      detached: false,
    }];
  }

  return [{
    kind: "single",
    command: runnerCommand(context, ["--start", decision.agentIds[0]]),
    env: { ...context.env },
    detached: false,
  }];
}

function runnerCommand(context: RoutedLaunchContext, tailArgs: string[]): string {
  const runner = join(config.codeRoot, "lib", "chain-runner.sh");
  const args = [
    shellEscape(runner),
    shellEscape(context.chainPath),
    ...(context.workspacePath ? ["--workspace", shellEscape(context.workspacePath)] : []),
    ...(context.taskId ? ["--task", shellEscape(context.taskId)] : []),
    ...(context.debug ? ["--debug"] : []),
    ...tailArgs.map((arg) => arg.startsWith("--") ? arg : shellEscape(arg)),
  ];
  return `bash ${args.join(" ")}`;
}
