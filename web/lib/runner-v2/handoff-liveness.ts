export interface PendingHandoff {
  pid: number;
  targetAgentIds: string[];
  startedAt: string;
}

type ProcessAlive = (pid: number) => boolean;
const MAX_PENDING_HANDOFF_AGE_MS = 10 * 60 * 1000;

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function pendingHandoffs(run: Record<string, unknown>): PendingHandoff[] {
  const runnerV2 = objectValue(run.runnerV2);
  if (!Array.isArray(runnerV2?.pendingHandoffs)) return [];
  return runnerV2.pendingHandoffs.flatMap((value) => {
    const item = objectValue(value);
    const targetAgentIds = Array.isArray(item?.targetAgentIds)
      ? item.targetAgentIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    return Number.isInteger(item?.pid) && Number(item?.pid) > 0 && targetAgentIds.length > 0
      ? [{
          pid: Number(item?.pid),
          targetAgentIds,
          startedAt: typeof item?.startedAt === "string" ? item.startedAt : "",
        }]
      : [];
  });
}

export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function hasLivePendingHandoff(
  run: Record<string, unknown>,
  isAlive: ProcessAlive = processIsAlive,
  now = Date.now(),
): boolean {
  const agents = Array.isArray(run.agents) ? run.agents : [];
  const statusByAgent = new Map<string, string>();
  for (const value of agents) {
    const agent = objectValue(value);
    if (typeof agent?.id === "string" && typeof agent.status === "string") {
      statusByAgent.set(agent.id, agent.status);
    }
  }

  return pendingHandoffs(run).some((handoff) => {
    const startedAt = new Date(handoff.startedAt).getTime();
    if (!Number.isFinite(startedAt) || now - startedAt > MAX_PENDING_HANDOFF_AGE_MS) return false;
    const stillWaiting = handoff.targetAgentIds.some((agentId) => {
      const status = statusByAgent.get(agentId);
      return status === undefined || ["pending", "cancelled", "stopped"].includes(status);
    });
    return stillWaiting && isAlive(handoff.pid);
  });
}

export function clearPendingHandoffAgent(
  runnerV2Value: unknown,
  agentId: string,
): Record<string, unknown> | undefined {
  const runnerV2 = objectValue(runnerV2Value);
  if (!runnerV2) return undefined;
  const remaining = pendingHandoffs({ runnerV2 }).flatMap((handoff) => {
    const targetAgentIds = handoff.targetAgentIds.filter((id) => id !== agentId);
    return targetAgentIds.length > 0 ? [{ ...handoff, targetAgentIds }] : [];
  });
  return { ...runnerV2, pendingHandoffs: remaining };
}
