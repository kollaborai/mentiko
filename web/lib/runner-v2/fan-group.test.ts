import { completeFanGroupMember, createFanGroupState, fanGroupConditionMet } from "@/lib/runner-v2/fan-group";

describe("runner-v2 fan group planner", () => {
  it("creates canonical JSON fan-group state", () => {
    expect(createFanGroupState({
      id: "draft-ready-20260626-1234",
      event: "draft-ready",
      fanOutAgents: ["a", "b"],
      fanInAgent: "merge",
      waitFor: "all",
      quorum: 0,
      onError: "recover",
      chainPath: "/chains/build.json",
      runId: "run-123",
    })).toEqual({
      id: "draft-ready-20260626-1234",
      status: "running",
      event: "draft-ready",
      fanOutAgents: ["a", "b"],
      fanInAgent: "merge",
      waitFor: "all",
      quorum: 0,
      onError: "recover",
      completed: 0,
      failed: 0,
      total: 2,
      chainPath: "/chains/build.json",
      runId: "run-123",
      members: {},
    });
  });

  it("waits for all members before claiming fan-in", () => {
    const group = createFanGroupState({
      id: "group-1",
      event: "draft-ready",
      fanOutAgents: ["a", "b"],
      fanInAgent: "merge",
      waitFor: "all",
      runId: "run-123",
    });

    const first = completeFanGroupMember({ group, agentId: "a", status: "complete" });
    expect(first).toMatchObject({
      claimed: false,
      group: { completed: 1, failed: 0, status: "running" },
    });

    const second = completeFanGroupMember({ group: first.group, agentId: "b", status: "complete" });
    expect(second).toMatchObject({
      claimed: true,
      group: { completed: 2, failed: 0, status: "complete" },
      claim: { fanInAgent: "merge", completed: 2, total: 2, failed: 0 },
      launch: {
        agentId: "merge",
        env: { MENTIKO_RUN_ID: "run-123", AGENT_FAN_GROUP_ID: "group-1" },
        reason: "fan-in-claim",
      },
    });
  });

  it("claims at most once after the group status is complete", () => {
    const group = {
      ...createFanGroupState({
        id: "group-1",
        event: "draft-ready",
        fanOutAgents: ["a", "b"],
        fanInAgent: "merge",
      }),
      status: "complete" as const,
      completed: 2,
    };

    expect(completeFanGroupMember({ group, agentId: "b" })).toMatchObject({
      claimed: false,
      group: { status: "complete" },
    });
  });

  it("supports any and quorum wait policies", () => {
    const any = createFanGroupState({
      id: "any-group",
      event: "done",
      fanOutAgents: ["a", "b"],
      fanInAgent: "merge",
      waitFor: "any",
    });
    expect(completeFanGroupMember({ group: any, agentId: "a" })).toMatchObject({
      claimed: true,
      claim: { fanInAgent: "merge", completed: 1 },
    });

    const quorum = createFanGroupState({
      id: "quorum-group",
      event: "done",
      fanOutAgents: ["a", "b", "c"],
      fanInAgent: "merge",
      waitFor: "quorum",
      quorum: 2,
    });
    const first = completeFanGroupMember({ group: quorum, agentId: "a" });
    expect(first.claimed).toBe(false);
    expect(completeFanGroupMember({ group: first.group, agentId: "b" })).toMatchObject({
      claimed: true,
      claim: { fanInAgent: "merge", completed: 2 },
    });
  });

  it("treats an unknown waitFor as \"all\" instead of hanging the fan-in", () => {
    const group = createFanGroupState({
      id: "typo-group",
      event: "done",
      fanOutAgents: ["a", "b"],
      fanInAgent: "merge",
      waitFor: "majority",
    });
    expect(group.waitFor).toBe("all");

    const first = completeFanGroupMember({ group, agentId: "a", status: "complete" });
    expect(first.claimed).toBe(false);

    const second = completeFanGroupMember({ group: first.group, agentId: "b", status: "complete" });
    expect(second).toMatchObject({
      claimed: true,
      claim: { fanInAgent: "merge", completed: 2, total: 2 },
      launch: { agentId: "merge" },
    });
  });

  it("guards fanGroupConditionMet directly against an unrecognized waitFor value", () => {
    const group = {
      id: "raw-group",
      status: "running" as const,
      event: "done",
      fanOutAgents: ["a", "b"],
      fanInAgent: "merge",
      waitFor: "majority",
      quorum: 0,
      completed: 1,
      failed: 1,
      total: 2,
    };

    expect(fanGroupConditionMet(group)).toBe(true);
  });

  it("routes to on_error when all wait completes with failures", () => {
    const group = createFanGroupState({
      id: "group-1",
      event: "draft-ready",
      fanOutAgents: ["a", "b"],
      fanInAgent: "merge",
      waitFor: "all",
      onError: "recover",
    });

    const first = completeFanGroupMember({ group, agentId: "a", status: "failed" });
    const second = completeFanGroupMember({ group: first.group, agentId: "b", status: "complete" });

    expect(second).toMatchObject({
      claimed: true,
      claim: { fanInAgent: "recover", completed: 1, failed: 1 },
      launch: { agentId: "recover" },
    });
  });
});
