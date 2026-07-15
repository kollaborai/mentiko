/**
 * Platform Event Registry
 *
 * Canonical catalog of all events emitted by the mentiko platform.
 * Use this as the single source of truth when:
 *   - building plugins that subscribe to events
 *   - configuring event triggers (cross-chain routing)
 *   - setting up outbound webhooks
 *   - writing notification rules
 *
 * Naming convention: <domain>.<action>
 * e.g. chain.started, agent.completed, schedule.triggered
 */

export type PlatformEventDomain =
  | "chain"
  | "agent"
  | "run"
  | "quality_gate"
  | "schedule"
  | "webhook"
  | "task"
  | "system";

export type PlatformEventName =
  // chain lifecycle
  | "chain.started"
  | "chain.completed"
  | "chain.failed"
  | "chain.stopped"
  // agent lifecycle
  | "agent.started"
  | "agent.completed"
  | "agent.failed"
  | "agent.timed_out"
  // run lifecycle
  | "run.created"
  | "run.completed"
  | "run.stopped"
  | "quality_gate.failed"
  // scheduling
  | "schedule.triggered"
  | "schedule.missed"
  // webhooks
  | "webhook.received"
  | "webhook.sent"
  | "webhook.failed"
  // tasks
  | "task.created"
  | "task.updated"
  | "task.completed"
  // system
  | "system.error";

export interface PlatformEventPayloadField {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "string?";
  description: string;
}

export interface PlatformEventDefinition {
  name: PlatformEventName;
  domain: PlatformEventDomain;
  description: string;
  /** what produces this event */
  emitters: string[];
  /** what consumes this event */
  consumers: string[];
  /** shape of the event payload */
  payload: PlatformEventPayloadField[];
  /** example payload for documentation */
  example?: Record<string, unknown>;
}

export const PLATFORM_EVENTS: PlatformEventDefinition[] = [
  // ── chain lifecycle ─────────────────────────────────────────────────
  {
    name: "chain.started",
    domain: "chain",
    description: "A chain execution has begun. Fired before the first agent starts.",
    emitters: ["chain-runner.sh", "chains/run API"],
    consumers: ["plugins", "outbound webhooks", "notifications", "metrics"],
    payload: [
      { name: "chainId", type: "string", description: "Chain identifier" },
      { name: "chainName", type: "string", description: "Human-readable chain name" },
      { name: "runId", type: "string", description: "Unique run identifier" },
      { name: "namespaceId", type: "string", description: "Namespace scope" },
      { name: "triggeredBy", type: "string?", description: "What triggered this run (manual, schedule, webhook, event)" },
    ],
    example: { chainId: "code-review", chainName: "Code Review Chain", runId: "run_abc123", namespaceId: "default" },
  },
  {
    name: "chain.completed",
    domain: "chain",
    description: "A chain finished successfully. All agents executed without error.",
    emitters: ["web/lib/runner-v2/completion-entrypoint.ts"],
    consumers: ["plugins", "outbound webhooks", "notifications", "metrics", "task sync"],
    payload: [
      { name: "chainId", type: "string", description: "Chain identifier" },
      { name: "chainName", type: "string", description: "Human-readable chain name" },
      { name: "runId", type: "string", description: "Unique run identifier" },
      { name: "namespaceId", type: "string", description: "Namespace scope" },
      { name: "durationMs", type: "number", description: "Total execution time in milliseconds" },
      { name: "agentCount", type: "number", description: "Number of agents that ran" },
    ],
    example: { chainId: "code-review", runId: "run_abc123", durationMs: 45000, agentCount: 3 },
  },
  {
    name: "chain.failed",
    domain: "chain",
    description: "A chain stopped due to an unrecoverable error.",
    emitters: ["web/lib/runner-v2/completion-entrypoint.ts", "typed watchdog worker"],
    consumers: ["plugins", "outbound webhooks", "notifications", "metrics", "PagerDuty"],
    payload: [
      { name: "chainId", type: "string", description: "Chain identifier" },
      { name: "runId", type: "string", description: "Unique run identifier" },
      { name: "namespaceId", type: "string", description: "Namespace scope" },
      { name: "failedAgentId", type: "string?", description: "Agent that caused the failure" },
      { name: "error", type: "string?", description: "Error message" },
    ],
    example: { chainId: "deploy-chain", runId: "run_xyz", failedAgentId: "tester", error: "test suite failed" },
  },
  {
    name: "chain.stopped",
    domain: "chain",
    description: "A chain was manually stopped or forcibly terminated.",
    emitters: ["web/lib/runner-v2/completion-entrypoint.ts", "runs API"],
    consumers: ["plugins", "outbound webhooks", "notifications"],
    payload: [
      { name: "chainId", type: "string", description: "Chain identifier" },
      { name: "runId", type: "string", description: "Unique run identifier" },
      { name: "stoppedBy", type: "string?", description: "Who or what stopped the chain" },
    ],
    example: { chainId: "long-analysis", runId: "run_abc", stoppedBy: "user" },
  },
  {
    name: "quality_gate.failed",
    domain: "quality_gate",
    description: "A run quality gate failed and produced a triage artifact opportunity.",
    emitters: ["web/lib/runner-v2/completion-entrypoint.ts"],
    consumers: ["event artifact mapper", "plugins", "outbound webhooks", "notifications"],
    payload: [
      { name: "runId", type: "string", description: "Run that failed the quality gate" },
      { name: "namespaceId", type: "string", description: "Namespace scope" },
      { name: "orgId", type: "string", description: "Org scope" },
      { name: "taskId", type: "string?", description: "Associated task, when known" },
      { name: "agentId", type: "string?", description: "Agent that produced the failed gate" },
      { name: "reason", type: "string", description: "Machine-readable gate failure reason" },
      { name: "artifactPath", type: "string?", description: "Quality-gate artifact path under the run artifacts dir" },
    ],
    example: {
      runId: "run_abc123",
      namespaceId: "default",
      orgId: "default",
      taskId: "FEAT-021",
      agentId: "validator",
      reason: "quality gate agent summary status is partial",
    },
  },

  // ── agent lifecycle ─────────────────────────────────────────────────
  {
    name: "agent.started",
    domain: "agent",
    description: "An agent has begun executing within a chain run.",
    emitters: ["launch-agent.sh", "chain-runner.sh"],
    consumers: ["plugins", "metrics", "run detail UI"],
    payload: [
      { name: "agentId", type: "string", description: "Agent identifier" },
      { name: "agentName", type: "string", description: "Human-readable agent name" },
      { name: "chainId", type: "string", description: "Parent chain identifier" },
      { name: "runId", type: "string", description: "Run identifier" },
      { name: "sessionName", type: "string?", description: "PTY session name" },
    ],
    example: { agentId: "reviewer", agentName: "Code Reviewer", chainId: "code-review", runId: "run_abc" },
  },
  {
    name: "agent.completed",
    domain: "agent",
    description: "An agent finished its task. May emit an event to trigger the next agent.",
    emitters: ["web/lib/runner-v2/completion-entrypoint.ts"],
    consumers: ["plugins", "metrics", "event triggers", "run detail UI"],
    payload: [
      { name: "agentId", type: "string", description: "Agent identifier" },
      { name: "chainId", type: "string", description: "Parent chain identifier" },
      { name: "runId", type: "string", description: "Run identifier" },
      { name: "emittedEvent", type: "string?", description: "Event name this agent emitted (for chaining)" },
      { name: "durationMs", type: "number", description: "Agent execution time in milliseconds" },
    ],
    example: { agentId: "reviewer", chainId: "code-review", runId: "run_abc", emittedEvent: "review-complete", durationMs: 12000 },
  },
  {
    name: "agent.failed",
    domain: "agent",
    description: "An agent terminated with an error or exceeded retry limits.",
    emitters: ["web/lib/runner-v2/completion-entrypoint.ts", "typed watchdog worker"],
    consumers: ["plugins", "notifications", "metrics"],
    payload: [
      { name: "agentId", type: "string", description: "Agent identifier" },
      { name: "chainId", type: "string", description: "Parent chain identifier" },
      { name: "runId", type: "string", description: "Run identifier" },
      { name: "error", type: "string?", description: "Failure reason" },
      { name: "retryCount", type: "number", description: "How many retries were attempted" },
    ],
    example: { agentId: "tester", chainId: "ci-chain", runId: "run_xyz", error: "exit code 1", retryCount: 2 },
  },
  {
    name: "agent.timed_out",
    domain: "agent",
    description: "An agent exceeded its configured timeout and was killed.",
    emitters: ["monitor-v2"],
    consumers: ["plugins", "notifications", "metrics"],
    payload: [
      { name: "agentId", type: "string", description: "Agent identifier" },
      { name: "chainId", type: "string", description: "Parent chain identifier" },
      { name: "runId", type: "string", description: "Run identifier" },
      { name: "timeoutMs", type: "number", description: "Configured timeout in milliseconds" },
    ],
    example: { agentId: "researcher", chainId: "research-chain", runId: "run_abc", timeoutMs: 300000 },
  },

  // ── run lifecycle ───────────────────────────────────────────────────
  {
    name: "run.created",
    domain: "run",
    description: "A new run record was created (before execution begins).",
    emitters: ["chains/run API"],
    consumers: ["run list UI", "activity feed"],
    payload: [
      { name: "runId", type: "string", description: "Unique run identifier" },
      { name: "chainId", type: "string", description: "Chain being run" },
      { name: "namespaceId", type: "string", description: "Namespace scope" },
    ],
    example: { runId: "run_abc123", chainId: "code-review", namespaceId: "default" },
  },
  {
    name: "run.completed",
    domain: "run",
    description: "A run record has been marked as completed in the database.",
    emitters: ["web/lib/runner-v2/completion-entrypoint.ts", "run-lib.sh"],
    consumers: ["run list UI", "task sync", "metrics"],
    payload: [
      { name: "runId", type: "string", description: "Unique run identifier" },
      { name: "chainId", type: "string", description: "Chain that ran" },
      { name: "status", type: "string", description: "Final status: completed | stopped | failed" },
      { name: "durationMs", type: "number", description: "Total wall-clock duration" },
    ],
    example: { runId: "run_abc123", chainId: "code-review", status: "completed", durationMs: 58000 },
  },
  {
    name: "run.stopped",
    domain: "run",
    description: "A run was explicitly stopped via the API or UI.",
    emitters: ["runs/[id] API"],
    consumers: ["chain-runner.sh (SIGTERM)", "run list UI"],
    payload: [
      { name: "runId", type: "string", description: "Unique run identifier" },
      { name: "stoppedBy", type: "string?", description: "User or system that stopped it" },
    ],
    example: { runId: "run_abc123", stoppedBy: "user@example.com" },
  },

  // ── scheduling ──────────────────────────────────────────────────────
  {
    name: "schedule.triggered",
    domain: "schedule",
    description: "A scheduled chain run was triggered by the scheduler daemon.",
    emitters: ["scheduler.sh"],
    consumers: ["chain-runner.sh", "activity feed", "metrics"],
    payload: [
      { name: "scheduleId", type: "string", description: "Schedule identifier" },
      { name: "chainId", type: "string", description: "Chain being triggered" },
      { name: "cron", type: "string", description: "Cron expression that matched" },
      { name: "runId", type: "string", description: "Created run identifier" },
    ],
    example: { scheduleId: "daily-report", chainId: "report-chain", cron: "0 9 * * *", runId: "run_sched_001" },
  },
  {
    name: "schedule.missed",
    domain: "schedule",
    description: "A scheduled trigger was missed (e.g., system was down during the trigger window).",
    emitters: ["scheduler.sh"],
    consumers: ["notifications", "metrics"],
    payload: [
      { name: "scheduleId", type: "string", description: "Schedule identifier" },
      { name: "missedAt", type: "string", description: "ISO timestamp of the missed trigger" },
    ],
    example: { scheduleId: "daily-report", missedAt: "2026-03-09T09:00:00Z" },
  },

  // ── webhooks ────────────────────────────────────────────────────────
  {
    name: "webhook.received",
    domain: "webhook",
    description: "An inbound webhook payload was received and validated.",
    emitters: ["webhooks/[id]/receive API"],
    consumers: ["chain-runner.sh (via event file)", "event triggers", "metrics"],
    payload: [
      { name: "webhookId", type: "string", description: "Subscription identifier" },
      { name: "source", type: "string", description: "Sender: github | gitlab | slack | custom" },
      { name: "eventType", type: "string", description: "Source event type (e.g. push, pull_request)" },
      { name: "chainId", type: "string?", description: "Chain this webhook triggers" },
    ],
    example: { webhookId: "wh_abc", source: "github", eventType: "pull_request", chainId: "pr-review" },
  },
  {
    name: "webhook.sent",
    domain: "webhook",
    description: "An outbound webhook was dispatched to an external endpoint.",
    emitters: ["webhook-sender.sh", "chain-runner.sh"],
    consumers: ["metrics", "webhook logs UI"],
    payload: [
      { name: "url", type: "string", description: "Target URL" },
      { name: "httpStatus", type: "number", description: "HTTP response status code" },
      { name: "chainId", type: "string?", description: "Source chain" },
      { name: "eventType", type: "string", description: "Event that triggered the send" },
    ],
    example: { url: "https://api.example.com/hook", httpStatus: 200, eventType: "chain.completed" },
  },
  {
    name: "webhook.failed",
    domain: "webhook",
    description: "An outbound webhook delivery failed (timeout, non-2xx response, or network error).",
    emitters: ["webhook-sender.sh"],
    consumers: ["notifications", "metrics", "webhook logs UI"],
    payload: [
      { name: "url", type: "string", description: "Target URL" },
      { name: "httpStatus", type: "number", description: "HTTP response status (0 if no response)" },
      { name: "error", type: "string?", description: "Error message" },
    ],
    example: { url: "https://api.example.com/hook", httpStatus: 0, error: "Connection refused" },
  },

  // ── tasks ───────────────────────────────────────────────────────────
  {
    name: "task.created",
    domain: "task",
    description: "A new task was created in the task store.",
    emitters: ["tasks API", "chain runner"],
    consumers: ["task list UI", "chain binding"],
    payload: [
      { name: "taskId", type: "string", description: "Task identifier" },
      { name: "title", type: "string", description: "Task title" },
      { name: "priority", type: "number", description: "Priority 0-4" },
    ],
    example: { taskId: "TASK-ABC", title: "Implement feature X", priority: 2 },
  },
  {
    name: "task.updated",
    domain: "task",
    description: "A task's status, assignee, or fields were changed.",
    emitters: ["tasks API", "chain runner"],
    consumers: ["task list UI"],
    payload: [
      { name: "taskId", type: "string", description: "Task identifier" },
      { name: "changes", type: "object", description: "Fields that changed" },
    ],
    example: { taskId: "TASK-ABC", changes: { status: "in_progress" } },
  },
  {
    name: "task.completed",
    domain: "task",
    description: "A task was marked as completed.",
    emitters: ["tasks API", "chain runner"],
    consumers: ["task list UI", "notifications"],
    payload: [
      { name: "taskId", type: "string", description: "Task identifier" },
      { name: "completedBy", type: "string?", description: "User or agent that completed it" },
    ],
    example: { taskId: "TASK-ABC", completedBy: "chain:code-review" },
  },

  // ── system ──────────────────────────────────────────────────────────
  {
    name: "system.error",
    domain: "system",
    description: "An unexpected system-level error occurred in the platform.",
    emitters: ["any platform component"],
    consumers: ["notifications", "metrics", "error logging"],
    payload: [
      { name: "component", type: "string", description: "Component that errored" },
      { name: "error", type: "string", description: "Error message" },
      { name: "context", type: "object", description: "Additional context" },
    ],
    example: { component: "typed watchdog worker", error: "Failed to read run.json", context: { runId: "run_abc" } },
  },
];

/** Get all events for a specific domain */
export function getEventsByDomain(domain: PlatformEventDomain): PlatformEventDefinition[] {
  return PLATFORM_EVENTS.filter((e) => e.domain === domain);
}

/** Get a single event definition by name */
export function getEventDefinition(name: PlatformEventName): PlatformEventDefinition | undefined {
  return PLATFORM_EVENTS.find((e) => e.name === name);
}

/** Get all unique domains in the registry */
export function getEventDomains(): PlatformEventDomain[] {
  return [...new Set(PLATFORM_EVENTS.map((e) => e.domain))];
}

/** Map old underscore event names (from chain-runner) to canonical dot names */
export const EVENT_NAME_ALIASES: Record<string, PlatformEventName> = {
  "chain-started": "chain.started",
  "chain-completed": "chain.completed",
  "chain-stopped": "chain.failed",
  "agent-started": "agent.started",
  "agent-completed": "agent.completed",
};
