import { calculateRetryDelayMs, planNoEventRetry } from "@/lib/runner-v2/retry-plan";

describe("runner-v2 retry planner", () => {
  it("plans same-agent retry before failing a missing event", () => {
    const plan = planNoEventRetry({
      runId: "run-123",
      chainId: "build-chain",
      chainName: "Build Chain",
      agentId: "writer",
      agentName: "Writer",
      currentAttempt: 0,
      retry: {
        max_retries: 2,
        strategy: "exponential",
        base_delay_ms: 1000,
        circuit_breaker: { threshold: 3, timeout: 120 },
      },
    });

    expect(plan).toMatchObject({
      action: "retry",
      nextAttempt: 1,
      maxRetries: 2,
      delayMs: 1000,
      delaySeconds: 1,
      strategy: "exponential",
      circuitBreaker: { threshold: 3, timeout: 120 },
      steps: [
        { type: "circuit-breaker", action: "record-failure", threshold: 3, timeout: 120 },
        { type: "retry-state", action: "set", agentId: "writer", attempt: 1 },
      ],
      launch: { agentId: "writer", reason: "missing-event" },
    });
  });

  it("plans exhausted retry side effects when the retry budget is spent", () => {
    const plan = planNoEventRetry({
      runId: "run-123",
      chainId: "build-chain",
      chainName: "Build Chain",
      chainPath: "/chains/build.json",
      taskId: "task-1",
      agentId: "writer",
      agentName: "Writer",
      currentAttempt: 2,
      retry: { max_retries: 2 },
    });

    expect(plan).toMatchObject({
      action: "exhausted",
      maxRetries: 2,
      currentAttempt: 2,
      onError: "stop",
      steps: [
        { type: "circuit-breaker", action: "record-failure", agentId: "writer" },
        { type: "retry-state", action: "clear", agentId: "writer" },
        { type: "run-status", status: "stopped" },
        { type: "task-status", status: "stopped", taskId: "task-1" },
        { type: "hook", event: "run-error", runId: "run-123" },
        { type: "notification", event: "agent-failed", agentId: "writer" },
        { type: "plugin", event: "chain-stopped", agentId: "writer" },
        { type: "notification", event: "chain-failed" },
        { type: "metadata-webhooks", event: "failed", chainId: "build-chain", chainPath: "/chains/build.json" },
      ],
    });
  });

  it("exhausts immediately when max_retries is zero or absent", () => {
    const plan = planNoEventRetry({
      runId: "run-123",
      chainName: "Build Chain",
      agentId: "writer",
      retry: { max_retries: 0 },
    });
    expect(plan).toMatchObject({
      action: "exhausted",
      maxRetries: 0,
    });
    expect(plan.steps.some((step) => step.type === "task-status")).toBe(false);
  });

  it("keeps one failure id stable on replay and separates a later completion occurrence", () => {
    const failureId = (occurrenceId: string) => {
      const plan = planNoEventRetry({
        runId: "run-123",
        chainName: "Build Chain",
        agentId: "writer",
        currentAttempt: 0,
        occurrenceId,
        retry: { max_retries: 1 },
      });
      for (const step of plan.steps) {
        if (step.type === "circuit-breaker") return step.failureId;
      }
      return undefined;
    };

    expect(failureId("completion-occurrence-a")).toBe("retry-failure:completion-occurrence-a:0");
    expect(failureId("completion-occurrence-a")).toBe("retry-failure:completion-occurrence-a:0");
    expect(failureId("completion-occurrence-b")).toBe("retry-failure:completion-occurrence-b:0");
  });

  it("models rollback as plan-only on exhausted on_error=rollback", () => {
    const plan = planNoEventRetry({
      runId: "run-123",
      chainName: "Build Chain",
      agentId: "writer",
      onError: "rollback",
      startSha: "abc123",
    });

    expect(plan).toMatchObject({ action: "exhausted", onError: "rollback" });
    expect(plan.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "circuit-breaker", action: "record-failure" }),
      expect.objectContaining({ type: "retry-state", action: "clear" }),
      expect.objectContaining({ type: "rollback", action: "plan-only", agentId: "writer", startSha: "abc123" }),
    ]));
  });

  it("calculates shell-compatible backoff strategies with a cap", () => {
    expect(calculateRetryDelayMs(3, "fixed", 1000)).toBe(1000);
    expect(calculateRetryDelayMs(3, "linear", 1000)).toBe(3000);
    expect(calculateRetryDelayMs(3, "exponential", 1000)).toBe(4000);
    expect(calculateRetryDelayMs(5, "exponential", 1000, 5000)).toBe(5000);
    expect(calculateRetryDelayMs(3, "unknown", 1000)).toBe(1000);
  });

  it("applies full jitter for exponential_with_jitter instead of a fixed exponential delay", () => {
    const attempt = 4;
    const base = 1000;
    const max = 20000;
    const exponentialResult = calculateRetryDelayMs(attempt, "exponential", base, max);
    const samples = Array.from(
      { length: 30 },
      () => calculateRetryDelayMs(attempt, "exponential_with_jitter", base, max),
    );

    for (const sample of samples) {
      expect(sample).toBeGreaterThanOrEqual(0);
      expect(sample).toBeLessThanOrEqual(exponentialResult);
    }
    // Not a no-op: across enough samples, jitter must produce at least one
    // value that differs from the plain exponential delay.
    expect(samples.some((sample) => sample !== exponentialResult)).toBe(true);
  });

  it("caps exponential_with_jitter at max_delay_ms like the plain exponential strategy", () => {
    const samples = Array.from(
      { length: 30 },
      () => calculateRetryDelayMs(5, "exponential_with_jitter", 1000, 5000),
    );
    for (const sample of samples) {
      expect(sample).toBeGreaterThanOrEqual(0);
      expect(sample).toBeLessThanOrEqual(5000);
    }
  });
});
