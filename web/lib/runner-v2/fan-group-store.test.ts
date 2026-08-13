import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "fs";
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
      workspacePath: "/workspace/repo",
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

    let acceptedBase: string | undefined;
    const second = completeFanGroupMemberLocked(dir, {
      groupId: "group-1",
      agentId: "b",
      status: "complete",
    }, (plan) => {
      acceptedBase = plan.launch?.env.MENTIKO_WORKSPACE_BASE_COMMIT;
    }, () => ({
      workspacePath: "/workspace/repo",
      workspaceBaseCommit: "0123456789abcdef",
    }));
    expect(second).toMatchObject({
      claimed: true,
      launch: {
        agentId: "merge",
        env: {
          AGENT_FAN_GROUP_ID: "group-1",
          MENTIKO_WORKSPACE_PATH: "/workspace/repo",
          MENTIKO_WORKSPACE_BASE_COMMIT: "0123456789abcdef",
        },
      },
      group: {
        completed: 2,
        failed: 0,
        status: "complete",
        workspacePath: "/workspace/repo",
        workspaceBaseCommit: "0123456789abcdef",
      },
    });
    expect(acceptedBase).toBe("0123456789abcdef");

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
      workspacePath: "/workspace/repo",
      workspaceBaseCommit: "0123456789abcdef",
    });
  });

  it("returns null for missing groups", () => {
    expect(completeFanGroupMemberLocked(stateDir(), {
      groupId: "missing",
      agentId: "a",
    })).toBeNull();
  });

  it("rejects legacy text state instead of parsing or overwriting it", () => {
    const dir = stateDir();
    const legacyDir = join(dir, "fan-groups");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "group-legacy.state"), "status: running\n");

    expect(() => readFanGroup(dir, "group-legacy")).toThrow(/unsupported legacy fan-group state/);
    expect(() => createFanGroup(dir, {
      id: "group-legacy",
      event: "draft-ready",
      fanOutAgents: ["a"],
    })).toThrow(/unsupported legacy fan-group state/);
  });

  it("rejects malformed canonical JSON instead of coercing it", () => {
    const dir = stateDir();
    const groupsDir = join(dir, "fan-groups");
    mkdirSync(groupsDir, { recursive: true });
    writeFileSync(join(groupsDir, "group-invalid.json"), JSON.stringify({ id: "group-invalid", status: "running" }));

    expect(() => readFanGroup(dir, "group-invalid")).toThrow(/invalid fan-group JSON/);
  });

  it("retires a crashed owner claim and lets replay commit the member", () => {
    const dir = stateDir();
    createFanGroup(dir, {
      id: "group-crash",
      event: "draft-ready",
      fanOutAgents: ["a"],
      fanInAgent: "merge",
      runId: "run-123",
    });
    const claimDir = `${fanGroupPath(dir, "group-crash")}.lock`;
    mkdirSync(claimDir);
    writeFileSync(join(claimDir, "owner.json"), `${JSON.stringify({ pid: 2_147_483_647, token: "crashed-owner" })}\n`);

    let accepted = false;
    const replay = completeFanGroupMemberLocked(dir, {
      groupId: "group-crash",
      agentId: "a",
      status: "complete",
    }, () => {
      accepted = true;
    });

    expect(accepted).toBe(true);
    expect(replay).toMatchObject({ claimed: true, group: { status: "complete", completed: 1 } });
    expect(readFanGroup(dir, "group-crash")).toMatchObject({
      status: "complete",
      members: { a: "complete" },
    });
    expect(existsSync(claimDir)).toBe(false);
  });
});
