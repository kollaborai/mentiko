import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "fs";
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
  assertValidGroupId(groupId);
  return join(stateDir, "fan-groups", `${groupId}.json`);
}

function legacyFanGroupStatePath(stateDir: string, groupId: string): string {
  assertValidGroupId(groupId);
  return join(stateDir, "fan-groups", `${groupId}.state`);
}

export function writeFanGroup(stateDir: string, group: FanGroupState): void {
  assertNoLegacyFanGroupState(stateDir, group.id);
  assertFanGroupState(group, group.id);
  writeJsonAtomic(fanGroupPath(stateDir, group.id), group);
}

export function readFanGroup(stateDir: string, groupId: string): FanGroupState | null {
  assertNoLegacyFanGroupState(stateDir, groupId);
  const path = fanGroupPath(stateDir, groupId);
  if (!existsSync(path)) return null;
  return parseFanGroupJson(groupId, readFileSync(path, "utf8"));
}

/** Canonical fan-group inventory. Legacy text files are rejected, never parsed. */
export function listFanGroups(stateDir: string): FanGroupState[] {
  const dir = join(stateDir, "fan-groups");
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir);
  const legacy = files.find((file) => file.endsWith(".state"));
  if (legacy) {
    throw new Error(`unsupported legacy fan-group state: ${join(dir, legacy)}`);
  }
  return files
    .filter((file) => file.endsWith(".json"))
    .map((file) => readFanGroup(stateDir, file.slice(0, -".json".length)))
    .filter((group): group is FanGroupState => group !== null);
}

export function createFanGroup(stateDir: string, input: FanGroupCreateInput): FanGroupState {
  const group = createFanGroupState(input);
  writeFanGroup(stateDir, group);
  return group;
}

export function createFanGroupIfAbsent(stateDir: string, group: FanGroupState): FanGroupState {
  assertNoLegacyFanGroupState(stateDir, group.id);
  const path = fanGroupPath(stateDir, group.id);
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
    && existing.workspacePath === expected.workspacePath
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
  resolveLaunchWorkspace?: (plan: FanGroupCompletionPlan) => {
    workspacePath?: string;
    workspaceBaseCommit?: string;
  },
): FanGroupCompletionPlan | null {
  assertNoLegacyFanGroupState(stateDir, input.groupId);
  const path = fanGroupPath(stateDir, input.groupId);
  return withFanGroupLock(path, () => {
    const group = readFanGroup(stateDir, input.groupId);
    if (!group) return null;

    let plan = completeFanGroupMember({
      group,
      agentId: input.agentId,
      status: input.status,
    });
    // A fan-in claim is only committed after its launch is durably accepted.
    // If acceptance fails, leave both the claim and completing member replayable
    // under the still-active completion event.
    if (plan.launch && resolveLaunchWorkspace) {
      const workspace = resolveLaunchWorkspace(plan);
      plan = {
        ...plan,
        group: {
          ...plan.group,
          ...(workspace.workspacePath ? { workspacePath: workspace.workspacePath } : {}),
          ...(workspace.workspaceBaseCommit
            ? { workspaceBaseCommit: workspace.workspaceBaseCommit }
            : {}),
        },
        launch: {
          ...plan.launch,
          env: {
            ...plan.launch.env,
            MENTIKO_WORKSPACE_PATH: workspace.workspacePath,
            MENTIKO_WORKSPACE_BASE_COMMIT: workspace.workspaceBaseCommit,
          },
        },
      };
    }
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

function assertNoLegacyFanGroupState(stateDir: string, groupId: string): void {
  const legacyPath = legacyFanGroupStatePath(stateDir, groupId);
  if (existsSync(legacyPath)) {
    throw new Error(`unsupported legacy fan-group state: ${legacyPath}`);
  }
}

function parseFanGroupJson(groupId: string, body: string): FanGroupState {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new Error(`invalid fan-group JSON: ${groupId}`);
  }
  return assertFanGroupState(value, groupId);
}

function assertFanGroupState(value: unknown, expectedId: string): FanGroupState {
  if (!isRecord(value)
    || value.id !== expectedId
    || !isFanGroupStatus(value.status)
    || typeof value.event !== "string"
    || !Array.isArray(value.fanOutAgents)
    || !value.fanOutAgents.every(isNonEmptyString)
    || new Set(value.fanOutAgents).size !== value.fanOutAgents.length
    || !isWaitFor(value.waitFor)
    || !isNonNegativeInteger(value.quorum)
    || !isNonNegativeInteger(value.completed)
    || !isNonNegativeInteger(value.failed)
    || !isNonNegativeInteger(value.total)
    || value.total !== value.fanOutAgents.length
    || value.completed + value.failed > value.total
    || (value.fanInAgent !== undefined && !isNonEmptyString(value.fanInAgent))
    || (value.onError !== undefined && !isNonEmptyString(value.onError))
    || (value.chainPath !== undefined && !isNonEmptyString(value.chainPath))
    || (value.runId !== undefined && !isNonEmptyString(value.runId))
    || (value.workspacePath !== undefined && !isNonEmptyString(value.workspacePath))
    || (value.workspaceBaseCommit !== undefined && !isNonEmptyString(value.workspaceBaseCommit))
    || !isMembers(value.members, value.fanOutAgents, value.completed, value.failed)) {
    throw new Error(`invalid fan-group JSON: ${expectedId}`);
  }
  return value as unknown as FanGroupState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFanGroupStatus(value: unknown): value is FanGroupState["status"] {
  return value === "running" || value === "complete" || value === "triggered";
}

function isWaitFor(value: unknown): value is "all" | "any" | "quorum" {
  return value === "all" || value === "any" || value === "quorum";
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isMembers(
  value: unknown,
  fanOutAgents: string[],
  completed: number,
  failed: number,
): value is Record<string, "complete" | "failed"> {
  if (!isRecord(value)) return false;
  const members = Object.entries(value);
  return members.length === completed + failed
    && members.every(([agentId, status]) => fanOutAgents.includes(agentId) && (status === "complete" || status === "failed"))
    && members.filter(([, status]) => status === "complete").length === completed
    && members.filter(([, status]) => status === "failed").length === failed;
}

function assertValidGroupId(groupId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(groupId)) {
    throw new Error(`invalid fan-group id: ${groupId}`);
  }
}
