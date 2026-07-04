import { planTerminalCompletion, shouldCompleteEmptyEmitsAgent } from "@/lib/runner-v2/terminal-plan";

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
});
