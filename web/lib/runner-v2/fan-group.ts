export type FanGroupWaitFor = "all" | "any" | "quorum" | string;
export type FanGroupStatus = "running" | "complete" | "triggered";
export type FanMemberStatus = "complete" | "failed";

export interface FanGroupState {
  id: string;
  status: FanGroupStatus;
  event: string;
  fanOutAgents: string[];
  fanInAgent?: string;
  waitFor: FanGroupWaitFor;
  quorum: number;
  onError?: string;
  completed: number;
  failed: number;
  total: number;
  chainPath?: string;
  runId?: string;
  members?: Record<string, FanMemberStatus>;
}

export interface FanGroupCreateInput {
  id: string;
  event: string;
  fanOutAgents: string[];
  fanInAgent?: string;
  waitFor?: FanGroupWaitFor;
  quorum?: number;
  onError?: string;
  chainPath?: string;
  runId?: string;
}

export interface FanGroupCompletionInput {
  group: FanGroupState;
  agentId: string;
  status?: FanMemberStatus;
}

export interface FanGroupClaim {
  fanInAgent: string;
  completed: number;
  total: number;
  failed: number;
  chainPath?: string;
}

export interface FanGroupCompletionPlan {
  group: FanGroupState;
  claimed: boolean;
  claim?: FanGroupClaim;
  launch?: {
    agentId: string;
    env: Record<string, string | undefined>;
    reason: "fan-in-claim";
  };
}

export function createFanGroupState(input: FanGroupCreateInput): FanGroupState {
  return {
    id: input.id,
    status: "running",
    event: input.event,
    fanOutAgents: input.fanOutAgents,
    fanInAgent: input.fanInAgent,
    waitFor: input.waitFor || "all",
    quorum: normalizeNonNegativeInteger(input.quorum, 0),
    onError: input.onError,
    completed: 0,
    failed: 0,
    total: input.fanOutAgents.length,
    chainPath: input.chainPath,
    runId: input.runId,
  };
}

export function completeFanGroupMember(input: FanGroupCompletionInput): FanGroupCompletionPlan {
  if (input.group.status === "complete" || input.group.status === "triggered") {
    return { group: input.group, claimed: false };
  }

  const status = input.status || "complete";
  if (!input.group.fanOutAgents.includes(input.agentId)) {
    return { group: input.group, claimed: false };
  }
  if (input.group.members?.[input.agentId]) {
    return { group: input.group, claimed: false };
  }
  const nextGroup: FanGroupState = {
    ...input.group,
    members: {
      ...(input.group.members || {}),
      [input.agentId]: status,
    },
    completed: input.group.completed + (status === "complete" ? 1 : 0),
    failed: input.group.failed + (status === "failed" ? 1 : 0),
  };

  const claim = claimFanGroup(nextGroup);
  if (!claim) {
    return { group: nextGroup, claimed: false };
  }

  return {
    group: { ...nextGroup, status: "complete" },
    claimed: true,
    claim,
    launch: {
      agentId: claim.fanInAgent,
      env: {
        MENTIKO_RUN_ID: input.group.runId,
        AGENT_FAN_GROUP_ID: input.group.id,
      },
      reason: "fan-in-claim",
    },
  };
}

export function claimFanGroup(group: FanGroupState): FanGroupClaim | null {
  if (group.status === "complete" || group.status === "triggered") {
    return null;
  }
  if (!group.fanInAgent) {
    return null;
  }
  if (!fanGroupConditionMet(group)) {
    return null;
  }

  return {
    fanInAgent: group.failed > 0 && group.onError ? group.onError : group.fanInAgent,
    completed: group.completed,
    total: group.total,
    failed: group.failed,
    chainPath: group.chainPath,
  };
}

export function fanGroupConditionMet(group: FanGroupState): boolean {
  if (group.waitFor === "all") {
    return group.completed + group.failed >= group.total;
  }
  if (group.waitFor === "any") {
    return group.completed >= 1;
  }
  if (group.waitFor === "quorum") {
    return group.completed >= group.quorum;
  }
  return false;
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}
