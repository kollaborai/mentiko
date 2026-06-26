import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
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

export function writeFanGroup(stateDir: string, group: FanGroupState): void {
  writeJsonAtomic(fanGroupPath(stateDir, group.id), group);
}

export function readFanGroup(stateDir: string, groupId: string): FanGroupState | null {
  const path = fanGroupPath(stateDir, groupId);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as FanGroupState;
}

export function createFanGroup(stateDir: string, input: FanGroupCreateInput): FanGroupState {
  const group = createFanGroupState(input);
  writeFanGroup(stateDir, group);
  return group;
}

export function completeFanGroupMemberLocked(
  stateDir: string,
  input: Omit<FanGroupCompletionInput, "group"> & { groupId: string },
): FanGroupCompletionPlan | null {
  const path = fanGroupPath(stateDir, input.groupId);
  return withFanGroupLock(path, () => {
    const group = readFanGroup(stateDir, input.groupId);
    if (!group) return null;

    const plan = completeFanGroupMember({
      group,
      agentId: input.agentId,
      status: input.status,
    });
    writeFanGroup(stateDir, plan.group);
    return plan;
  });
}

function withFanGroupLock<T>(statePath: string, fn: () => T): T {
  const lockDir = `${statePath}.lock`;
  mkdirSync(dirname(statePath), { recursive: true });
  mkdirSync(lockDir);
  try {
    writeFileSync(join(lockDir, "pid"), String(process.pid));
    return fn();
  } finally {
    try { rmSync(join(lockDir, "pid"), { force: true }); } catch { /* ignore */ }
    try { rmSync(lockDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function writeJsonAtomic(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, path);
}
