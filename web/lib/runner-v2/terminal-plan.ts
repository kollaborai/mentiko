export type OnCompletePolicy =
  | "stop"
  | "keep"
  | "archive"
  | "webhook"
  | `chain:${string}`;

export interface TerminalCompletionInput {
  runId: string;
  chainId?: string;
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
  // C2: a terminal plan step carries the evidence for its own write, so the
  // adapter never has to terminalize a run with an unexplained status.
  | { type: "run-status"; status: "completed"; reason: string }
  | { type: "task-status"; status: "completed"; taskId?: string; runId?: string }
  | { type: "schedule-mark"; status: "success"; chainPath?: string }
  | { type: "webhook"; event: "chain_complete"; chainId?: string; chainPath?: string; lastEvent?: string; lastAgentId?: string; lastAgentName?: string }
  | { type: "event"; event: "chain-complete"; source: string; data: string }
  | { type: "plugin"; event: "chain-completed"; chainName: string; runId: string; agentId?: string }
  | { type: "notification"; event: "chain-completed"; chainName: string; runId: string; agentId?: string }
  | { type: "hook"; event: "run-completed"; runId: string; details: Record<string, string> }
  | { type: "metadata-webhooks"; event: "completed"; chainId?: string; chainPath?: string; chainName: string; runId: string }
  | { type: "legacy-webhook"; url: string; payload: Record<string, string> }
  | { type: "session-policy"; policy: "stop"; sessions: string[] }
  | { type: "session-policy"; policy: "keep" | "archive" }
  | { type: "next-chain"; chainName: string; parentRunId: string };

export interface TerminalCompletionPlan {
  reason: "explicit-stop" | "no-downstream" | "empty-emits-last-agent";
  steps: TerminalCompletionStep[];
}

/** Human-readable evidence for each way a chain reaches successful completion. */
const TERMINAL_COMPLETION_REASONS: Record<TerminalCompletionPlan["reason"], string> = {
  "explicit-stop": "chain completed: on_complete policy reached its terminal stop",
  "no-downstream": "chain completed: last emitted event had no downstream agent",
  "empty-emits-last-agent": "chain completed: final agent declares no further event",
};

export function planTerminalCompletion(
  input: TerminalCompletionInput,
  reason: TerminalCompletionPlan["reason"] = "no-downstream",
): TerminalCompletionPlan {
  const onComplete = input.onComplete || "stop";
  const steps: TerminalCompletionStep[] = [
    { type: "run-status", status: "completed", reason: TERMINAL_COMPLETION_REASONS[reason] },
  ];
  if (input.taskId) {
    steps.push({ type: "task-status", status: "completed", taskId: input.taskId, runId: input.runId });
  }

  if (input.schedule) {
    steps.push({ type: "schedule-mark", status: "success", chainPath: input.chainPath });
  }

  steps.push(
    {
      type: "webhook",
      event: "chain_complete",
      chainId: input.chainId,
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
      chainId: input.chainId,
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
  chainId?: string;
  chainName: string;
  chainPath?: string;
  taskId?: string;
  agentId?: string;
  reason?: string;
  occurrenceId?: string;
}

export type TerminalFailureStep =
  | { type: "task-status"; status: "failed"; taskId?: string; runId?: string }
  | { type: "circuit-breaker"; action: "record-failure"; chainName: string; agentId: string; threshold: number; timeout: number; failureId: string }
  | { type: "notification"; event: "agent-failed"; chainName: string; runId: string; agentId?: string; reason?: string }
  | { type: "metadata-webhooks"; event: "failed"; chainId?: string; chainPath?: string; chainName: string; runId: string };

export interface TerminalFailurePlan {
  reason: "no-completion-event";
  steps: TerminalFailureStep[];
}

/**
 * Failure counterpart of planTerminalCompletion for plain fail decisions
 * (agent completed without its declared event and no retry policy applies).
 * Preserves the retired shell completion path's no-event failure invariant:
 * task propagation, circuit breaker, agent-failed notification, failed
 * webhooks. The shell fires no plugins on this path, so neither do we.
 */
export function planTerminalFailure(input: TerminalFailureInput): TerminalFailurePlan {
  const steps: TerminalFailureStep[] = [];
  if (input.taskId) {
    steps.push({ type: "task-status", status: "failed", taskId: input.taskId, runId: input.runId });
  }

  if (input.agentId) {
    steps.push({
      type: "circuit-breaker",
      action: "record-failure",
      chainName: input.chainName,
      agentId: input.agentId,
      threshold: 5,
      timeout: 300,
      failureId: `terminal-failure:${input.runId}:${input.agentId}:${input.occurrenceId || "no-completion-event"}`,
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
      chainId: input.chainId,
      chainPath: input.chainPath,
      chainName: input.chainName,
      runId: input.runId,
    },
  );

  return { reason: "no-completion-event", steps };
}

export interface AgentCompletionInput {
  runId: string;
  chainName: string;
  agentId: string;
  /** Stable for one completion handoff; distinct for later loop/attempt visits. */
  occurrenceId?: string;
  agentName?: string;
  sessionName?: string;
  // chain config.webhooks (v1 send-webhook source): direct-URL webhooks with a
  // per-event subscription list. Only queued when enabled + subscribed, exactly
  // like lib/webhook-sender.sh send-webhook.
  chainWebhooks?: {
    enabled?: boolean;
    urls?: string[];
    events?: string[];
  };
}

export type AgentCompletionStep =
  | { type: "plugin"; event: "agent-completed"; chainName: string; runId: string; agentId: string; occurrenceId?: string }
  | { type: "notification"; event: "agent-completed"; chainName: string; runId: string; agentId: string; occurrenceId?: string }
  | { type: "legacy-webhook"; url: string; payload: Record<string, string>; occurrenceId?: string };

export interface AgentCompletionPlan {
  reason: "agent-complete";
  steps: AgentCompletionStep[];
}

/**
 * Per-agent completion side effects mirroring the top of
 * the predecessor shell completion handler (agent_complete webhook, agent-completed plugins,
 * agent-completed notification). Unlike the shell — which fires these before
 * the completion verdict, even for agents that then fail — the typed runner
 * only plans them for completions that actually mark the agent complete.
 */
export function planAgentCompletion(input: AgentCompletionInput): AgentCompletionPlan {
  const steps: AgentCompletionStep[] = [
    {
      type: "plugin",
      event: "agent-completed",
      chainName: input.chainName,
      runId: input.runId,
      agentId: input.agentId,
      ...(input.occurrenceId ? { occurrenceId: input.occurrenceId } : {}),
    },
    {
      type: "notification",
      event: "agent-completed",
      chainName: input.chainName,
      runId: input.runId,
      agentId: input.agentId,
      ...(input.occurrenceId ? { occurrenceId: input.occurrenceId } : {}),
    },
  ];

  if (chainWebhookSubscribed(input.chainWebhooks, "agent_complete")) {
    for (const url of input.chainWebhooks?.urls || []) {
      if (!url) continue;
      steps.push({
        type: "legacy-webhook",
        url,
        ...(input.occurrenceId ? { occurrenceId: input.occurrenceId } : {}),
        payload: {
          event: "agent_complete",
          chain: input.chainName,
          agent_id: input.agentId,
          agent_name: input.agentName || input.agentId,
          session: input.sessionName || "",
        },
      });
    }
  }

  return { reason: "agent-complete", steps };
}

function chainWebhookSubscribed(
  webhooks: AgentCompletionInput["chainWebhooks"],
  event: string,
): boolean {
  if (!webhooks?.enabled) return false;
  if (!Array.isArray(webhooks.urls) || webhooks.urls.length === 0) return false;
  // shell parity: an absent/empty subscription list means every event fires.
  if (!Array.isArray(webhooks.events) || webhooks.events.length === 0) return true;
  return webhooks.events.includes(event);
}

export function shouldCompleteEmptyEmitsAgent(emits: string | undefined, hasDownstream: boolean): boolean {
  return !emits && !hasDownstream;
}
