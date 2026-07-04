export type OnCompletePolicy =
  | "stop"
  | "keep"
  | "archive"
  | "webhook"
  | `chain:${string}`;

export interface TerminalCompletionInput {
  runId: string;
  chainName: string;
  chainPath?: string;
  taskId?: string;
  lastEvent?: string;
  lastAgentId?: string;
  lastAgentName?: string;
  sessions?: string[];
  schedule?: string;
  onComplete?: OnCompletePolicy;
  webhookUrl?: string;
}

export type TerminalCompletionStep =
  | { type: "run-status"; status: "completed" }
  | { type: "task-status"; status: "completed"; taskId?: string; runId?: string }
  | { type: "schedule-mark"; status: "success"; chainPath?: string }
  | { type: "webhook"; event: "chain_complete"; chainPath?: string; lastEvent?: string; lastAgentId?: string; lastAgentName?: string }
  | { type: "event"; event: "chain-complete"; source: string; data: string }
  | { type: "plugin"; event: "chain-completed"; chainName: string; runId: string; agentId?: string }
  | { type: "notification"; event: "chain-completed"; chainName: string; runId: string; agentId?: string }
  | { type: "hook"; event: "run-completed"; runId: string; details: Record<string, string> }
  | { type: "metadata-webhooks"; event: "completed"; chainPath?: string; chainName: string; runId: string }
  | { type: "legacy-webhook"; url: string; payload: Record<string, string> }
  | { type: "session-policy"; policy: "stop"; sessions: string[] }
  | { type: "session-policy"; policy: "keep" | "archive" }
  | { type: "next-chain"; chainName: string; parentRunId: string };

export interface TerminalCompletionPlan {
  reason: "explicit-stop" | "no-downstream" | "empty-emits-last-agent";
  steps: TerminalCompletionStep[];
}

export function planTerminalCompletion(
  input: TerminalCompletionInput,
  reason: TerminalCompletionPlan["reason"] = "no-downstream",
): TerminalCompletionPlan {
  const onComplete = input.onComplete || "stop";
  const steps: TerminalCompletionStep[] = [
    { type: "run-status", status: "completed" },
    { type: "task-status", status: "completed", taskId: input.taskId, runId: input.runId },
  ];

  if (input.schedule) {
    steps.push({ type: "schedule-mark", status: "success", chainPath: input.chainPath });
  }

  steps.push(
    {
      type: "webhook",
      event: "chain_complete",
      chainPath: input.chainPath,
      lastEvent: input.lastEvent,
      lastAgentId: input.lastAgentId,
      lastAgentName: input.lastAgentName,
    },
    {
      type: "event",
      event: "chain-complete",
      source: input.chainName,
      data: `chain=${input.chainName} run_id=${input.runId} last_event=${input.lastEvent || ""}`,
    },
    {
      type: "plugin",
      event: "chain-completed",
      chainName: input.chainName,
      runId: input.runId,
      agentId: input.lastAgentId,
    },
    {
      type: "notification",
      event: "chain-completed",
      chainName: input.chainName,
      runId: input.runId,
      agentId: input.lastAgentId,
    },
    {
      type: "hook",
      event: "run-completed",
      runId: input.runId,
      details: {
        run_id: input.runId,
        last_agent: input.lastAgentId || "",
        last_agent_status: "complete",
        pending_agents: "none",
        task_id: input.taskId || "",
      },
    },
    {
      type: "metadata-webhooks",
      event: "completed",
      chainPath: input.chainPath,
      chainName: input.chainName,
      runId: input.runId,
    },
  );

  if (onComplete === "stop") {
    steps.push({ type: "session-policy", policy: "stop", sessions: input.sessions || [] });
  } else if (onComplete === "keep" || onComplete === "archive") {
    steps.push({ type: "session-policy", policy: onComplete });
  } else if (onComplete === "webhook" && input.webhookUrl) {
    steps.push({
      type: "legacy-webhook",
      url: input.webhookUrl,
      payload: {
        chain: input.chainName,
        status: "complete",
        last_event: input.lastEvent || "",
      },
    });
  } else if (onComplete.startsWith("chain:")) {
    steps.push({
      type: "next-chain",
      chainName: onComplete.slice("chain:".length),
      parentRunId: input.runId,
    });
  }

  return { reason, steps };
}

export interface TerminalFailureInput {
  runId: string;
  chainName: string;
  chainPath?: string;
  taskId?: string;
  agentId?: string;
  reason?: string;
}

export type TerminalFailureStep =
  | { type: "task-status"; status: "failed"; taskId?: string; runId?: string }
  | { type: "circuit-breaker"; action: "record-failure"; chainName: string; agentId: string; threshold: number; timeout: number }
  | { type: "notification"; event: "agent-failed"; chainName: string; runId: string; agentId?: string; reason?: string }
  | { type: "metadata-webhooks"; event: "failed"; chainPath?: string; chainName: string; runId: string };

export interface TerminalFailurePlan {
  reason: "no-completion-event";
  steps: TerminalFailureStep[];
}

/**
 * Failure counterpart of planTerminalCompletion for plain fail decisions
 * (agent completed without its declared event and no retry policy applies).
 * Mirrors the shell no-event failure path in chain-runner-complete.sh:
 * task propagation, circuit breaker, agent-failed notification, failed
 * webhooks. The shell fires no plugins on this path, so neither do we.
 */
export function planTerminalFailure(input: TerminalFailureInput): TerminalFailurePlan {
  const steps: TerminalFailureStep[] = [
    { type: "task-status", status: "failed", taskId: input.taskId, runId: input.runId },
  ];

  if (input.agentId) {
    steps.push({
      type: "circuit-breaker",
      action: "record-failure",
      chainName: input.chainName,
      agentId: input.agentId,
      threshold: 5,
      timeout: 300,
    });
  }

  steps.push(
    {
      type: "notification",
      event: "agent-failed",
      chainName: input.chainName,
      runId: input.runId,
      agentId: input.agentId,
      reason: input.reason,
    },
    {
      type: "metadata-webhooks",
      event: "failed",
      chainPath: input.chainPath,
      chainName: input.chainName,
      runId: input.runId,
    },
  );

  return { reason: "no-completion-event", steps };
}

export function shouldCompleteEmptyEmitsAgent(emits: string | undefined, hasDownstream: boolean): boolean {
  return !emits && !hasDownstream;
}
