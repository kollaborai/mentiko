import { planAgentCompletion, planTerminalCompletion, planTerminalFailure, shouldCompleteEmptyEmitsAgent } from "@/lib/runner-v2/terminal-plan";

describe("runner-v2 terminal completion plan", () => {
  it("plans run/task completion and chain-complete side effects for no downstream target", () => {
    const plan = planTerminalCompletion({
      runId: "run-1",
      chainName: "Build Chain",
      chainPath: "/chains/build/chain.json",
      taskId: "task-1",
      lastEvent: "done",
      lastAgentId: "writer",
      lastAgentName: "Writer",
      sessions: ["writer-run-1", "monitor-writer-run-1"],
      schedule: "0 * * * *",
      onComplete: "stop",
    });

    expect(plan.reason).toBe("no-downstream");
    expect(plan.steps).toEqual(expect.arrayContaining([
      { type: "run-status", status: "completed" },
      { type: "task-status", status: "completed", taskId: "task-1", runId: "run-1" },
      { type: "schedule-mark", status: "success", chainPath: "/chains/build/chain.json" },
      expect.objectContaining({ type: "webhook", event: "chain_complete" }),
      expect.objectContaining({ type: "event", event: "chain-complete", source: "Build Chain" }),
      expect.objectContaining({ type: "plugin", event: "chain-completed" }),
      expect.objectContaining({ type: "notification", event: "chain-completed" }),
      expect.objectContaining({ type: "hook", event: "run-completed" }),
      expect.objectContaining({ type: "metadata-webhooks", event: "completed" }),
      { type: "session-policy", policy: "stop", sessions: ["writer-run-1", "monitor-writer-run-1"] },
    ]));
  });

  it("keeps sessions when on_complete is keep", () => {
    const plan = planTerminalCompletion({
      runId: "run-1",
      chainName: "Build Chain",
      onComplete: "keep",
    }, "explicit-stop");

    expect(plan.steps).toContainEqual({ type: "session-policy", policy: "keep" });
  });

  it("plans legacy webhook when on_complete is webhook", () => {
    const plan = planTerminalCompletion({
      runId: "run-1",
      chainName: "Build Chain",
      lastEvent: "done",
      onComplete: "webhook",
      webhookUrl: "https://example.com/hook",
    });

    expect(plan.steps).toContainEqual({
      type: "legacy-webhook",
      url: "https://example.com/hook",
      payload: {
        chain: "Build Chain",
        status: "complete",
        last_event: "done",
      },
    });
  });

  it("plans next chain launch for chain on_complete policy", () => {
    const plan = planTerminalCompletion({
      runId: "run-1",
      chainName: "Build Chain",
      onComplete: "chain:deploy",
    });

    expect(plan.steps).toContainEqual({
      type: "next-chain",
      chainName: "deploy",
      parentRunId: "run-1",
    });
  });

  it("allows empty-emits last agent completion only when there is no downstream", () => {
    expect(shouldCompleteEmptyEmitsAgent("", false)).toBe(true);
    expect(shouldCompleteEmptyEmitsAgent(undefined, false)).toBe(true);
    expect(shouldCompleteEmptyEmitsAgent("", true)).toBe(false);
    expect(shouldCompleteEmptyEmitsAgent("done", false)).toBe(false);
  });

  it("plans failure side effects mirroring the shell no-event failure path", () => {
    const plan = planTerminalFailure({
      runId: "run-1",
      chainName: "Build Chain",
      chainPath: "/chains/build/chain.json",
      taskId: "task-1",
      agentId: "writer",
      reason: "no matching completion event",
    });

    expect(plan.reason).toBe("no-completion-event");
    expect(plan.steps).toEqual([
      { type: "task-status", status: "failed", taskId: "task-1", runId: "run-1" },
      { type: "circuit-breaker", action: "record-failure", chainName: "Build Chain", agentId: "writer", threshold: 5, timeout: 300 },
      { type: "notification", event: "agent-failed", chainName: "Build Chain", runId: "run-1", agentId: "writer", reason: "no matching completion event" },
      { type: "metadata-webhooks", event: "failed", chainPath: "/chains/build/chain.json", chainName: "Build Chain", runId: "run-1" },
    ]);
  });

  it("omits the circuit breaker step when the failing agent is unknown", () => {
    const plan = planTerminalFailure({ runId: "run-1", chainName: "Build Chain" });
    expect(plan.steps.map((step) => step.type)).toEqual(["task-status", "notification", "metadata-webhooks"]);
  });
});

describe("runner-v2 agent completion plan", () => {
  it("plans agent-completed plugin and notification steps", () => {
    const plan = planAgentCompletion({
      runId: "run-1",
      chainName: "Build Chain",
      agentId: "writer",
      agentName: "Writer",
      sessionName: "writer-run-1",
    });

    expect(plan.reason).toBe("agent-complete");
    expect(plan.steps).toEqual([
      { type: "plugin", event: "agent-completed", chainName: "Build Chain", runId: "run-1", agentId: "writer" },
      { type: "notification", event: "agent-completed", chainName: "Build Chain", runId: "run-1", agentId: "writer" },
    ]);
  });

  it("plans chain-config agent_complete webhooks only when enabled and subscribed", () => {
    const base = {
      runId: "run-1",
      chainName: "Build Chain",
      agentId: "writer",
      agentName: "Writer",
      sessionName: "writer-run-1",
    };

    const subscribed = planAgentCompletion({
      ...base,
      chainWebhooks: { enabled: true, urls: ["https://a.example/hook", "https://b.example/hook"], events: ["agent_complete", "chain_complete"] },
    });
    expect(subscribed.steps.filter((step) => step.type === "legacy-webhook")).toEqual([
      {
        type: "legacy-webhook",
        url: "https://a.example/hook",
        payload: { event: "agent_complete", chain: "Build Chain", agent_id: "writer", agent_name: "Writer", session: "writer-run-1" },
      },
      {
        type: "legacy-webhook",
        url: "https://b.example/hook",
        payload: { event: "agent_complete", chain: "Build Chain", agent_id: "writer", agent_name: "Writer", session: "writer-run-1" },
      },
    ]);

    // shell parity: empty subscription list means every event fires
    const allEvents = planAgentCompletion({
      ...base,
      chainWebhooks: { enabled: true, urls: ["https://a.example/hook"], events: [] },
    });
    expect(allEvents.steps.some((step) => step.type === "legacy-webhook")).toBe(true);

    const notSubscribed = planAgentCompletion({
      ...base,
      chainWebhooks: { enabled: true, urls: ["https://a.example/hook"], events: ["chain_complete"] },
    });
    expect(notSubscribed.steps.some((step) => step.type === "legacy-webhook")).toBe(false);

    const disabled = planAgentCompletion({
      ...base,
      chainWebhooks: { enabled: false, urls: ["https://a.example/hook"], events: ["agent_complete"] },
    });
    expect(disabled.steps.some((step) => step.type === "legacy-webhook")).toBe(false);
  });
});
