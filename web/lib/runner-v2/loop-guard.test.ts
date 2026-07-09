import { applyLoopGuardToRoute, routeAgentIds } from "@/lib/runner-v2/loop-guard";

describe("runner-v2 loop guard", () => {
  it("completes the run when the current agent/event pair was already visited", () => {
    expect(applyLoopGuardToRoute({
      currentAgentId: "writer",
      eventName: "draft-ready",
      nextAgentIds: ["reviewer"],
      chain: { agents: [] },
      visited: ["writer:draft-ready"],
    })).toEqual({
      action: "complete",
      reason: "visited-agent-event",
      visitKey: "writer:draft-ready",
      runStatus: "completed",
      taskStatus: "completed",
    });
  });

  it("records new visits without incrementing a normal forward route", () => {
    expect(applyLoopGuardToRoute({
      currentAgentId: "writer",
      eventName: "draft-ready",
      nextAgentIds: ["reviewer"],
      chain: { agents: [{ id: "writer", emits: "draft-ready" }] },
      currentRound: 1,
      maxRounds: 3,
    })).toEqual({
      action: "continue",
      visitKey: "writer:draft-ready",
      round: 1,
      recordVisit: true,
    });
  });

  it("increments round when the next route loops back to the same agent", () => {
    expect(applyLoopGuardToRoute({
      currentAgentId: "writer",
      eventName: "revise",
      nextAgentIds: ["writer"],
      chain: { agents: [{ id: "writer", emits: "revise" }] },
      currentRound: 1,
      maxRounds: 3,
    })).toMatchObject({
      action: "continue",
      round: 2,
    });
  });

  it("increments round when the current agent triggers on the emitted event", () => {
    expect(applyLoopGuardToRoute({
      currentAgentId: "writer",
      eventName: "revise",
      nextAgentIds: ["reviewer"],
      chain: { agents: [{ id: "writer", triggers: ["revise"] }] },
      currentRound: 1,
      maxRounds: 3,
    })).toMatchObject({
      action: "continue",
      round: 2,
    });
  });

  it("increments round for a round-suffixed cyclic event matched via normalized triggers", () => {
    expect(applyLoopGuardToRoute({
      currentAgentId: "writer",
      eventName: "x-round-2",
      nextAgentIds: ["reviewer"],
      chain: { agents: [{ id: "writer", triggers: ["x"] }] },
      currentRound: 1,
      maxRounds: 3,
    })).toMatchObject({
      action: "continue",
      round: 2,
    });
  });

  it("stops a round-suffixed loop at maxRounds instead of running unbounded", () => {
    expect(applyLoopGuardToRoute({
      currentAgentId: "writer",
      eventName: "x-round-2",
      nextAgentIds: ["reviewer"],
      chain: { agents: [{ id: "writer", triggers: ["x"] }] },
      currentRound: 3,
      maxRounds: 3,
    })).toEqual({
      action: "stop",
      reason: "max-rounds-exceeded",
      visitKey: "writer:x-round-2",
      round: 4,
      maxRounds: 3,
      runStatus: "stopped",
      taskStatus: "stopped",
    });
  });

  it("stops the run when max rounds are exceeded", () => {
    expect(applyLoopGuardToRoute({
      currentAgentId: "writer",
      eventName: "revise",
      nextAgentIds: ["writer"],
      chain: { agents: [{ id: "writer" }] },
      currentRound: 3,
      maxRounds: 3,
    })).toEqual({
      action: "stop",
      reason: "max-rounds-exceeded",
      visitKey: "writer:revise",
      round: 4,
      maxRounds: 3,
      runStatus: "stopped",
      taskStatus: "stopped",
    });
  });

  it("does not increment fan-out or parallel routes like the shell round file", () => {
    expect(applyLoopGuardToRoute({
      currentAgentId: "writer",
      eventName: "revise",
      nextAgentIds: ["writer", "reviewer"],
      routeKind: "parallel",
      chain: { agents: [{ id: "writer", triggers: ["revise"] }] },
      currentRound: 3,
      maxRounds: 3,
    })).toMatchObject({
      action: "continue",
      round: 3,
    });

    expect(applyLoopGuardToRoute({
      currentAgentId: "writer",
      eventName: "revise",
      nextAgentIds: ["writer", "reviewer"],
      routeKind: "fan-out",
      chain: { agents: [{ id: "writer", triggers: ["revise"] }] },
      currentRound: 3,
      maxRounds: 3,
    })).toMatchObject({
      action: "continue",
      round: 3,
    });
  });

  it("extracts launch agent ids from route decisions", () => {
    expect(routeAgentIds({ action: "launch", agentIds: ["a", "b"], reason: "branch fan-out" })).toEqual(["a", "b"]);
    expect(routeAgentIds({ action: "stop", reason: "explicit stop branch" })).toEqual([]);
  });
});
