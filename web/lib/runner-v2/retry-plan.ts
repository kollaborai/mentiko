export type RetryStrategy = "fixed" | "linear" | "exponential" | "exponential_with_jitter" | string;

export interface RetryCircuitBreakerPolicy {
  threshold?: number;
  timeout?: number;
}

export interface RetryPolicy {
  max_retries?: number;
  strategy?: RetryStrategy;
  base_delay_ms?: number;
  max_delay_ms?: number;
  circuit_breaker?: RetryCircuitBreakerPolicy;
}

export interface RetryPlanInput {
  runId: string;
  chainName: string;
  chainPath?: string;
  workspacePath?: string;
  taskId?: string;
  agentId: string;
  agentName?: string;
  currentAttempt?: number;
  retry?: RetryPolicy;
  onError?: string;
  startSha?: string;
  debug?: boolean;
}

export type RetryExhaustedStep =
  | { type: "retry-state"; action: "clear"; agentId: string }
  | { type: "circuit-breaker"; action: "record-failure"; chainName: string; agentId: string; threshold: number; timeout: number }
  | { type: "rollback"; action: "plan-only"; agentId: string; startSha?: string }
  | { type: "run-status"; status: "stopped"; reason: string }
  | { type: "task-status"; status: "stopped"; taskId?: string }
  | { type: "hook"; event: "run-error"; runId: string; details: Record<string, string> }
  | { type: "notification"; event: "agent-failed" | "chain-failed"; chainName: string; runId: string; agentId?: string; reason: string }
  | { type: "plugin"; event: "chain-stopped"; chainName: string; runId: string; agentId: string }
  | { type: "metadata-webhooks"; event: "failed"; chainPath?: string; chainName: string; runId: string };

export type RetryNoEventPlan =
  | {
      action: "retry";
      nextAttempt: number;
      maxRetries: number;
      delayMs: number;
      delaySeconds: number;
      strategy: RetryStrategy;
      circuitBreaker: Required<RetryCircuitBreakerPolicy>;
      steps: Array<{ type: "circuit-breaker"; action: "record-failure"; chainName: string; agentId: string; threshold: number; timeout: number }>;
      launch: {
        agentId: string;
        reason: "missing-event";
      };
    }
  | {
      action: "exhausted";
      maxRetries: number;
      currentAttempt: number;
      circuitBreaker: Required<RetryCircuitBreakerPolicy>;
      onError: string;
      steps: RetryExhaustedStep[];
    };

export function planNoEventRetry(input: RetryPlanInput): RetryNoEventPlan {
  const policy = normalizeRetryPolicy(input.retry);
  const currentAttempt = normalizeNonNegativeInteger(input.currentAttempt, 0);
  const circuitBreaker = normalizeCircuitBreaker(policy.circuit_breaker);

  if (policy.max_retries > 0 && currentAttempt < policy.max_retries) {
    const nextAttempt = currentAttempt + 1;
    const delayMs = calculateRetryDelayMs(nextAttempt, policy.strategy, policy.base_delay_ms, policy.max_delay_ms);
    return {
      action: "retry",
      nextAttempt,
      maxRetries: policy.max_retries,
      delayMs,
      delaySeconds: Number((delayMs / 1000).toFixed(1)),
      strategy: policy.strategy,
      circuitBreaker,
      steps: [circuitFailureStep(input, circuitBreaker)],
      launch: {
        agentId: input.agentId,
        reason: "missing-event",
      },
    };
  }

  return {
    action: "exhausted",
    maxRetries: policy.max_retries,
    currentAttempt,
    circuitBreaker,
    onError: input.onError || "stop",
    steps: buildRetryExhaustedSteps(input),
  };
}

export function calculateRetryDelayMs(
  attempt: number,
  strategy: RetryStrategy = "exponential",
  baseDelayMs = 1000,
  maxDelayMs = baseDelayMs * 10,
): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const safeBase = Math.max(0, Math.floor(baseDelayMs));
  const safeMax = Math.max(0, Math.floor(maxDelayMs));
  let delayMs = safeBase;

  if (strategy === "linear") {
    delayMs = safeBase * safeAttempt;
  } else if (strategy === "exponential") {
    delayMs = safeBase * (2 ** (safeAttempt - 1));
  } else if (strategy === "exponential_with_jitter") {
    delayMs = safeBase * (2 ** (safeAttempt - 1));
  }

  return Math.min(delayMs, safeMax);
}

function normalizeRetryPolicy(policy?: RetryPolicy): Required<Omit<RetryPolicy, "circuit_breaker">> & { circuit_breaker: RetryCircuitBreakerPolicy } {
  const baseDelayMs = normalizeNonNegativeInteger(policy?.base_delay_ms, 1000);
  return {
    max_retries: normalizeNonNegativeInteger(policy?.max_retries, 0),
    strategy: policy?.strategy || "exponential",
    base_delay_ms: baseDelayMs,
    max_delay_ms: normalizeNonNegativeInteger(policy?.max_delay_ms, baseDelayMs * 10),
    circuit_breaker: policy?.circuit_breaker || {},
  };
}

function normalizeCircuitBreaker(policy?: RetryCircuitBreakerPolicy): Required<RetryCircuitBreakerPolicy> {
  return {
    threshold: normalizePositiveInteger(policy?.threshold, 5),
    timeout: normalizePositiveInteger(policy?.timeout, 300),
  };
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function buildRetryExhaustedSteps(input: RetryPlanInput): RetryExhaustedStep[] {
  const chainName = input.chainName || "unknown";
  const agentName = input.agentName || input.agentId;
  const reason = "agent error, retries exhausted";
  const steps: RetryExhaustedStep[] = [
    circuitFailureStep(input, normalizeCircuitBreaker(input.retry?.circuit_breaker)),
    { type: "retry-state", action: "clear", agentId: input.agentId },
  ];

  if ((input.onError || "stop") === "rollback") {
    steps.push({
      type: "rollback",
      action: "plan-only",
      agentId: input.agentId,
      startSha: input.startSha,
    });
  }

  steps.push(
    { type: "run-status", status: "stopped", reason },
    { type: "task-status", status: "stopped", taskId: input.taskId },
    {
      type: "hook",
      event: "run-error",
      runId: input.runId,
      details: {
        run_id: input.runId,
        last_agent: input.agentId,
        last_agent_status: "stopped",
        pending_agents: "none",
        task_id: input.taskId || "",
      },
    },
    {
      type: "notification",
      event: "agent-failed",
      chainName,
      runId: input.runId,
      agentId: input.agentId,
      reason: `Agent failed after exhausting retries: ${agentName}`,
    },
    {
      type: "plugin",
      event: "chain-stopped",
      chainName,
      runId: input.runId,
      agentId: input.agentId,
    },
    {
      type: "notification",
      event: "chain-failed",
      chainName,
      runId: input.runId,
      reason: "Chain stopped due to agent failure",
    },
    {
      type: "metadata-webhooks",
      event: "failed",
      chainPath: input.chainPath,
      chainName,
      runId: input.runId,
    },
  );

  return steps;
}

function circuitFailureStep(
  input: RetryPlanInput,
  circuitBreaker: Required<RetryCircuitBreakerPolicy>,
): Extract<RetryExhaustedStep, { type: "circuit-breaker" }> {
  return {
    type: "circuit-breaker",
    action: "record-failure",
    chainName: input.chainName || "unknown",
    agentId: input.agentId,
    threshold: circuitBreaker.threshold,
    timeout: circuitBreaker.timeout,
  };
}
