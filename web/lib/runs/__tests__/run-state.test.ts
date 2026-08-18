import { mergeAgentStates } from "../run-state";

describe("mergeAgentStates", () => {
  it("overlays blocked state from live agent state files", () => {
    const agents = [
      {
        id: "status-reporter",
        status: "running",
        session: "pty-mgr-sched-status-reporter-run-1778724644028",
      },
    ];

    const merged = mergeAgentStates(agents, {
      "status-reporter": {
        agent_id: "status-reporter",
        status: "blocked",
        session: "pty-mgr-sched-status-reporter-run-1778724644028",
      },
    }, "running");

    expect(merged[0].status).toBe("blocked");
  });

  it("does not let stale running state override blocked run.json status", () => {
    const agents = [
      {
        id: "status-reporter",
        status: "blocked",
        session: "pty-mgr-sched-status-reporter-run-1778724644028",
      },
    ];

    const merged = mergeAgentStates(agents, {
      "status-reporter": {
        agent_id: "status-reporter",
        status: "running",
        session: "pty-mgr-sched-status-reporter-run-1778724644028",
      },
    }, "running");

    expect(merged[0].status).toBe("blocked");
  });

  it("does not let stale running state override blocked agent status on a blocked run", () => {
    const agents = [
      {
        id: "status-reporter",
        status: "blocked",
        session: "pty-mgr-sched-status-reporter-run-1778724644028",
      },
    ];

    const merged = mergeAgentStates(agents, {
      "status-reporter": {
        agent_id: "status-reporter",
        status: "running",
        session: "pty-mgr-sched-status-reporter-run-1778724644028",
      },
    }, "blocked");

    expect(merged[0].status).toBe("blocked");
  });
});
