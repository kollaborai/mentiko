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
  /** Agents this detached process is responsible for starting. */
  agentIds?: string[];
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
      agentIds: [agentId],
      command: runnerCommand(context, [agentId]),
      env: {
        ...context.env,
        ...typedLaunchEnv(context),
        AGENT_FAN_GROUP_AGENT_ID: agentId,
        ...(decision.fanIn ? { AGENT_FAN_GROUP_ID: context.fanGroupId || decision.fanIn } : {}),
      },
      logPath: join(context.runDir, `fanout-${agentId}.log`),
      detached: true,
    }));
  }

  // always detached: the typed completion bridge exits as soon as launches
  // are fired, and a non-detached child dies with the completion PTY before
  // chain-runner can start the next agent.
  if (decision.agentIds.length > 1) {
    return [{
      kind: "parallel",
      agentIds: [...decision.agentIds],
      command: runnerCommand(context, decision.agentIds),
      env: { ...context.env, ...typedLaunchEnv(context) },
      detached: true,
    }];
  }

  return [{
    kind: "single",
    agentIds: [decision.agentIds[0]],
    command: runnerCommand(context, [decision.agentIds[0]]),
    env: { ...context.env, ...typedLaunchEnv(context) },
    detached: true,
  }];
}

function typedLaunchEnv(context: RoutedLaunchContext): Record<string, string> {
  return {
    MENTIKO_RUN_DIR: context.runDir,
    ...(context.workspacePath ? { MENTIKO_WORKSPACE_PATH: context.workspacePath } : {}),
    ...(context.taskId ? { MENTIKO_TASK_ID: context.taskId } : {}),
    ...(context.debug ? { MENTIKO_DEBUG: "1" } : {}),
    MENTIKO_RUNNER_V2: "1",
    MENTIKO_RUNNER_V2_COMPLETION: "1",
  };
}

function runnerCommand(context: RoutedLaunchContext, agentIds: string[]): string {
  const compiled = join(config.codeRoot, "lib", "runner-v2-launch-agent.js");
  const development = join(config.codeRoot, "web", "scripts", "runner-v2-launch-agent.cjs");
  const args = [shellEscape(context.chainPath), ...agentIds.map(shellEscape)].join(" ");
  return `if [ -f ${shellEscape(compiled)} ]; then node ${shellEscape(compiled)} ${args}; else node ${shellEscape(development)} ${args}; fi`;
}
