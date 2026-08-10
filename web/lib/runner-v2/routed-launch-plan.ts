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
  /** Agents this synchronous acceptance call is responsible for starting. */
  agentIds?: string[];
  command: string;
  /** Direct typed launcher invocation used for synchronous acceptance. */
  cli?: {
    compiledPath: string;
    developmentPath: string;
    args: string[];
  };
  env: Record<string, string | undefined>;
  logPath?: string;
}

export function buildRoutedLaunchPlans(decision: RoutingDecision, context: RoutedLaunchContext): RoutedLaunchPlan[] {
  if (decision.action !== "launch") {
    return [];
  }

  if (decision.fanIn || decision.waitFor || decision.quorum || decision.onError) {
    const invocation = runnerInvocation(context, decision.agentIds);
    return [{
      kind: "fan-out",
      agentIds: [...decision.agentIds],
      command: runnerCommand(invocation),
      cli: invocation,
      env: {
        ...context.env,
        ...typedLaunchEnv(context),
        ...(decision.fanIn ? { AGENT_FAN_GROUP_ID: context.fanGroupId || decision.fanIn } : {}),
      },
      logPath: join(context.runDir, "fanout.log"),
    }];
  }

  // The adapter waits for this CLI to exit and then verifies durable
  // run/session/attempt state before the completion trigger can be consumed.
  if (decision.agentIds.length > 1) {
    const invocation = runnerInvocation(context, decision.agentIds);
    return [{
      kind: "parallel",
      agentIds: [...decision.agentIds],
      command: runnerCommand(invocation),
      cli: invocation,
      env: { ...context.env, ...typedLaunchEnv(context) },
    }];
  }

  const invocation = runnerInvocation(context, [decision.agentIds[0]]);
  return [{
    kind: "single",
    agentIds: [decision.agentIds[0]],
    command: runnerCommand(invocation),
    cli: invocation,
    env: { ...context.env, ...typedLaunchEnv(context) },
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

function runnerInvocation(context: RoutedLaunchContext, agentIds: string[]): NonNullable<RoutedLaunchPlan["cli"]> {
  const compiled = join(config.codeRoot, "lib", "runner-v2-launch-agent.js");
  const development = join(config.codeRoot, "web", "scripts", "runner-v2-launch-agent.cjs");
  return {
    compiledPath: compiled,
    developmentPath: development,
    args: [context.chainPath, ...agentIds],
  };
}

function runnerCommand(invocation: NonNullable<RoutedLaunchPlan["cli"]>): string {
  const args = invocation.args.map(shellEscape).join(" ");
  return `if [ -f ${shellEscape(invocation.compiledPath)} ]; then node ${shellEscape(invocation.compiledPath)} ${args}; else node ${shellEscape(invocation.developmentPath)} ${args}; fi`;
}
