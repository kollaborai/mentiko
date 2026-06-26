import { existsSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { completeFanGroupMemberLocked, createFanGroup, fanGroupPath, readFanGroup } from "@/lib/runner-v2/fan-group-store";

function stateDir() {
  return mkdtempSync(join(tmpdir(), "runner-v2-fan-group-store-"));
}

describe("runner-v2 fan group store", () => {
  it("persists created fan-group state", () => {
    const dir = stateDir();
    const group = createFanGroup(dir, {
      id: "group-1",
      event: "draft-ready",
      fanOutAgents: ["a", "b"],
      fanInAgent: "merge",
      chainPath: "/chains/build.json",
      runId: "run-123",
    });

    expect(existsSync(fanGroupPath(dir, "group-1"))).toBe(true);
    expect(readFanGroup(dir, "group-1")).toEqual(group);
  });

  it("updates persisted counters and claims fan-in once", () => {
    const dir = stateDir();
    createFanGroup(dir, {
      id: "group-1",
      event: "draft-ready",
      fanOutAgents: ["a", "b"],
      fanInAgent: "merge",
      runId: "run-123",
    });

    const first = completeFanGroupMemberLocked(dir, {
      groupId: "group-1",
      agentId: "a",
      status: "complete",
    });
    expect(first).toMatchObject({
      claimed: false,
      group: { completed: 1, failed: 0, status: "running" },
    });

    const second = completeFanGroupMemberLocked(dir, {
      groupId: "group-1",
      agentId: "b",
      status: "complete",
    });
    expect(second).toMatchObject({
      claimed: true,
      launch: { agentId: "merge", env: { AGENT_FAN_GROUP_ID: "group-1" } },
      group: { completed: 2, failed: 0, status: "complete" },
    });

    const third = completeFanGroupMemberLocked(dir, {
      groupId: "group-1",
      agentId: "b",
      status: "complete",
    });
    expect(third).toMatchObject({
      claimed: false,
      group: { status: "complete" },
    });
    expect(readFanGroup(dir, "group-1")).toMatchObject({
      status: "complete",
      completed: 2,
      failed: 0,
    });
  });

  it("returns null for missing groups", () => {
    expect(completeFanGroupMemberLocked(stateDir(), {
      groupId: "missing",
      agentId: "a",
    })).toBeNull();
  });
});
