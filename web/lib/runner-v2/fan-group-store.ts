import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { withExclusiveFileClaim } from "@/lib/runner-v2/file-claim";
import {
  completeFanGroupMember,
  createFanGroupState,
  type FanGroupCompletionInput,
  type FanGroupCompletionPlan,
  type FanGroupCreateInput,
  type FanGroupState,
} from "@/lib/runner-v2/fan-group";

export function fanGroupPath(stateDir: string, groupId: string): string {
  return join(stateDir, "fan-groups", `${groupId}.json`);
}

export function fanGroupStatePath(stateDir: string, groupId: string): string {
  return join(stateDir, "fan-groups", `${groupId}.state`);
}

export function writeFanGroup(stateDir: string, group: FanGroupState): void {
  if (existsSync(fanGroupStatePath(stateDir, group.id)) && !existsSync(fanGroupPath(stateDir, group.id))) {
    writeStateAtomic(fanGroupStatePath(stateDir, group.id), group);
    return;
  }
  writeJsonAtomic(fanGroupPath(stateDir, group.id), group);
}

export function readFanGroup(stateDir: string, groupId: string): FanGroupState | null {
  const path = fanGroupPath(stateDir, groupId);
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as FanGroupState;
  const statePath = fanGroupStatePath(stateDir, groupId);
  if (existsSync(statePath)) return parseStateFile(groupId, readFileSync(statePath, "utf8"));
  return null;
}

export function createFanGroup(stateDir: string, input: FanGroupCreateInput): FanGroupState {
  const group = createFanGroupState(input);
  writeFanGroup(stateDir, group);
  return group;
}

export function createFanGroupIfAbsent(stateDir: string, group: FanGroupState): FanGroupState {
  const path = existsSync(fanGroupStatePath(stateDir, group.id)) && !existsSync(fanGroupPath(stateDir, group.id))
    ? fanGroupStatePath(stateDir, group.id)
    : fanGroupPath(stateDir, group.id);
  return withFanGroupLock(path, () => {
    const existing = readFanGroup(stateDir, group.id);
    if (existing) {
      assertSameFanGroupDefinition(existing, group);
      return existing;
    }
    writeFanGroup(stateDir, group);
    return group;
  });
}

function assertSameFanGroupDefinition(existing: FanGroupState, expected: FanGroupState): void {
  const same = existing.event === expected.event
    && existing.runId === expected.runId
    && existing.fanInAgent === expected.fanInAgent
    && existing.waitFor === expected.waitFor
    && existing.quorum === expected.quorum
    && existing.onError === expected.onError
    // Replay routing may omit a child that already reached durable active or
    // terminal state. The original occurrence owns the full immutable member
    // set; a replay proposal may only be an ordered subset of that set.
    && expected.fanOutAgents.every((agentId) => existing.fanOutAgents.includes(agentId));
  if (!same) throw new Error(`fan-group occurrence collision for ${expected.id}`);
}

export function completeFanGroupMemberLocked(
  stateDir: string,
  input: Omit<FanGroupCompletionInput, "group"> & { groupId: string },
  acceptLaunch?: (plan: FanGroupCompletionPlan) => void,
): FanGroupCompletionPlan | null {
  const path = existsSync(fanGroupStatePath(stateDir, input.groupId)) && !existsSync(fanGroupPath(stateDir, input.groupId))
    ? fanGroupStatePath(stateDir, input.groupId)
    : fanGroupPath(stateDir, input.groupId);
  return withFanGroupLock(path, () => {
    const group = readFanGroup(stateDir, input.groupId);
    if (!group) return null;

    const plan = completeFanGroupMember({
      group,
      agentId: input.agentId,
      status: input.status,
    });
    // A fan-in claim is only committed after its launch is durably accepted.
    // If acceptance fails, leave both the claim and completing member replayable
    // under the still-active completion event.
    if (plan.launch) acceptLaunch?.(plan);
    writeFanGroup(stateDir, plan.group);
    return plan;
  });
}

function withFanGroupLock<T>(statePath: string, fn: () => T): T {
  const lockDir = `${statePath}.lock`;
  return withExclusiveFileClaim(lockDir, fn, { waitTimeoutMs: 5_000 });
}

function writeJsonAtomic(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, path);
}

function writeStateAtomic(path: string, group: FanGroupState): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  const lines = [
    `status: ${group.status}`,
    `started: ${new Date().toISOString()}`,
    `event: ${group.event}`,
    `fan_out_agents: ${group.fanOutAgents.join(" ")}`,
    `fan_in_agent: ${group.fanInAgent || ""}`,
    `wait_for: ${group.waitFor}`,
    `quorum: ${group.quorum || 0}`,
    `on_error: ${group.onError || ""}`,
    `completed: ${group.completed}`,
    `failed: ${group.failed}`,
    `total: ${group.total}`,
    ...(group.chainPath ? [`chain_file: ${group.chainPath}`] : []),
    ...(group.runId ? [`run_id: ${group.runId}`] : []),
    ...Object.entries(group.members || {}).map(([agent, status]) => `member_${agent}: ${status}`),
    "",
  ];
  writeFileSync(tmp, lines.join("\n"));
  renameSync(tmp, path);
}

function parseStateFile(groupId: string, body: string): FanGroupState {
  const fields: Record<string, string> = {};
  const members: Record<string, "complete" | "failed"> = {};
  for (const line of body.split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key.startsWith("member_") && (value === "complete" || value === "failed")) {
      members[key.slice("member_".length)] = value;
    } else {
      fields[key] = value;
    }
  }
  return {
    id: groupId,
    status: fields.status === "complete" || fields.status === "triggered" ? fields.status : "running",
    event: fields.event || "",
    fanOutAgents: (fields.fan_out_agents || "").split(/\s+/).filter(Boolean),
    fanInAgent: fields.fan_in_agent || undefined,
    waitFor: fields.wait_for || "all",
    quorum: Number.parseInt(fields.quorum || "0", 10) || 0,
    onError: fields.on_error || undefined,
    completed: Number.parseInt(fields.completed || "0", 10) || 0,
    failed: Number.parseInt(fields.failed || "0", 10) || 0,
    total: Number.parseInt(fields.total || "0", 10) || 0,
    chainPath: fields.chain_file,
    runId: fields.run_id,
    members,
  };
}
