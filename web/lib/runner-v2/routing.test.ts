import { decideNextRoute, normalizeRouteEvent, hasCompletedTrigger } from "@/lib/runner-v2/routing";

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

  it("normalizes a self-referential fan-in into one ordinary launch", () => {
    expect(decideNextRoute({
      branches: { done: { fan_out: ["verifier"], fan_in: "verifier", wait_for: "all" } },
      agents: [{ id: "verifier" }],
    }, "done")).toEqual({
      action: "launch",
      agentIds: ["verifier"],
      reason: "branch fan-out",
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

  it("relaunches a completed loop target only for an event newer than its latest attempt", () => {
    const chain = {
      agents: [{
        id: "writer",
        triggers: ["revision-ready"],
        status: "complete",
        lastAttemptCreatedAt: "2026-07-15T12:00:00.000Z",
      }],
    };

    expect(decideNextRoute(chain, "revision-ready", "2026-07-15T12:01:00.000Z")).toMatchObject({
      action: "launch",
      agentIds: ["writer"],
    });
    expect(decideNextRoute(chain, "revision-ready", "2026-07-15T11:59:00.000Z")).toMatchObject({
      action: "wait",
      pending: true,
    });
  });

  it("does not hang forever when a branch target names an agent id that doesn't exist", () => {
    expect(decideNextRoute({
      branches: { done: "ghost-agent" },
      agents: [{ id: "writer" }],
    }, "done")).toEqual({
      action: "wait",
      reason: "targets reference unknown agents",
      pending: false,
    });
  });

  it("keeps pending=true when a known target is still running, even alongside an unknown target", () => {
    expect(decideNextRoute({
      branches: { done: ["reviewer", "ghost-agent"] },
      agents: [{ id: "reviewer", status: "running" }],
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

  it("hasCompletedTrigger identifies the resume frontier, not array order", () => {
    // Regression: run-1783832264355-7d9c3cce diamond mid-run. Resume must restart
    // fix-verifier (its trigger dead-source-removed was produced by a completed
    // emitter), never source-repointer (trigger never produced) even though it
    // comes first in array order. Caller hydrates status from run.json.
    const agents = [
      { id: "dead-source-remover", triggers: ["claude-todos-confirmed-redundant"], emits: "dead-source-removed", status: "complete" },
      { id: "source-repointer", triggers: ["claude-todos-real-path-found"], emits: "source-repointed", status: "pending" },
      { id: "fix-verifier", triggers: ["dead-source-removed", "source-repointed"], emits: "todo-source-fix-verified", status: "pending" },
    ];
    expect(hasCompletedTrigger(agents[1], agents)).toBe(false); // source-repointer
    expect(hasCompletedTrigger(agents[2], agents)).toBe(true);  // fix-verifier
  });

  // Known gap: an OR-merge of mutually-exclusive branches (the diamond above)
  // still deadlocks in decideNextRoute because the live call site passes a
  // status-less chain and no fired-event set. Fixing it needs run status + the
  // actually-fired events threaded into routing (completion-runner/recovery/
  // reconcile). Enable this once that lands.
  it.todo("launches an OR-merge diamond once run status + fired events are threaded into routing");

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
