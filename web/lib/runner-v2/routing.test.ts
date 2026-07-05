import { decideNextRoute, normalizeRouteEvent } from "@/lib/runner-v2/routing";

describe("runner-v2 routing decision", () => {
  it("uses branches before trigger lookup", () => {
    expect(decideNextRoute({
      branches: { done: "branch-target" },
      agents: [
        { id: "branch-target", triggers: [] },
        { id: "trigger-target", triggers: ["done"] },
      ],
    }, "done")).toEqual({
      action: "launch",
      agentIds: ["branch-target"],
      reason: "branch match",
    });
  });

  it("supports explicit stop branch", () => {
    expect(decideNextRoute({
      branches: { done: "stop" },
      agents: [],
    }, "done")).toEqual({
      action: "stop",
      reason: "explicit stop branch",
    });
  });

  it("supports array and fan_out branch targets", () => {
    const agents = [{ id: "a" }, { id: "b" }, { id: "c", status: "running" }];

    expect(decideNextRoute({ branches: { done: ["a", "b", "c"] }, agents }, "done")).toEqual({
      action: "launch",
      agentIds: ["a", "b"],
      reason: "branch fan-out",
    });

    expect(decideNextRoute({
      branches: { done: { fan_out: ["a", "b"], fan_in: "merge", wait_for: "all", quorum: 2, on_error: "recover" } },
      agents,
    }, "done")).toEqual({
      action: "launch",
      agentIds: ["a", "b"],
      reason: "branch fan-out",
      fanIn: "merge",
      waitFor: "all",
      quorum: 2,
      onError: "recover",
    });
  });

  it("falls back to trigger lookup when no branch exists", () => {
    expect(decideNextRoute({
      agents: [
        { id: "next-a", triggers: ["done"] },
        { id: "next-b", triggers: ["other"] },
      ],
    }, "done")).toEqual({
      action: "launch",
      agentIds: ["next-a"],
      reason: "trigger match",
    });
  });

  it("does not relaunch running or completed agents", () => {
    expect(decideNextRoute({
      agents: [
        { id: "next-a", triggers: ["done"], status: "running" },
        { id: "next-b", triggers: ["done"], status: "complete" },
      ],
    }, "done")).toEqual({
      action: "wait",
      reason: "targets already active or complete",
      pending: true,
    });
  });

  it("keeps no-downstream waits non-pending so completion can finalize the run", () => {
    expect(decideNextRoute({
      agents: [
        { id: "writer", emits: "done" },
      ],
    }, "done")).toEqual({
      action: "wait",
      reason: "no downstream target",
    });
  });

  it("normalizes route events for branch and trigger lookup", () => {
    expect(normalizeRouteEvent("Draft Ready Round 2")).toBe("draft-ready");
    expect(decideNextRoute({
      branches: { "draft-ready": "reviewer" },
      agents: [{ id: "reviewer" }],
    }, "Draft Ready Round 2")).toEqual({
      action: "launch",
      agentIds: ["reviewer"],
      reason: "branch match",
    });
    expect(decideNextRoute({
      agents: [{ id: "reviewer", triggers: ["draft-ready"] }],
    }, "Draft Ready Round 2")).toEqual({
      action: "launch",
      agentIds: ["reviewer"],
      reason: "trigger match",
    });
  });

  it("supports conditional branch objects", () => {
    expect(decideNextRoute({
      branches: {
        done: {
          conditions: [{ if: "done", then: "reviewer" }],
          default: "fallback",
        },
      },
      agents: [{ id: "reviewer" }, { id: "fallback" }],
    }, "done")).toEqual({
      action: "launch",
      agentIds: ["reviewer"],
      reason: "branch condition",
    });
  });

  it("waits for multi-trigger prerequisites when emitters are incomplete", () => {
    const chain = {
      agents: [
        { id: "researcher", emits: "research-ready", status: "complete" },
        { id: "writer", emits: "draft-ready", status: "running" },
        { id: "publisher", triggers: ["research-ready", "draft-ready"] },
      ],
    };

    expect(decideNextRoute(chain, "draft-ready")).toEqual({
      action: "wait",
      reason: "targets already active or complete",
      pending: true,
    });

    expect(decideNextRoute({
      agents: [
        { id: "researcher", emits: "research-ready", status: "complete" },
        { id: "writer", emits: "draft-ready", status: "complete" },
        { id: "publisher", triggers: ["research-ready", "draft-ready"] },
      ],
    }, "draft-ready")).toEqual({
      action: "launch",
      agentIds: ["publisher"],
      reason: "trigger match",
    });
  });
});
