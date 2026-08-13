import { join } from "node:path";
import {
  readRunnerV2AttemptState,
  recordAgentAttemptQueueOrder,
  transitionAgentAttempt,
  type AgentAttemptRecord,
} from "@/lib/runner-v2/agent-attempt";
import { withExclusiveFileClaim } from "@/lib/runner-v2/file-claim";
import { routedLaunchJobLeaseOwned } from "@/lib/runner-v2/launch-job";
import { discoverScopedRunJsonPaths, projectRunsRootFor } from "@/lib/runner-v2/run-scope";
import { readRunJson } from "@/lib/runner-v2/run-state";

export type TypedAgentCapacityDecision =
  | { status: "admitted"; active: number; cap: number }
  | { status: "queued"; active: number; cap: number; position: number }
  | { status: "cancelled"; reason: string }
  | { status: "ownership_lost"; reason: string }
  | { status: "invalid"; reason: string };

export type TypedAgentCapacityWaitResult =
  | Extract<TypedAgentCapacityDecision, { status: "admitted" | "invalid" | "cancelled" | "ownership_lost" }>
  | { status: "timeout"; active: number; cap: number; waitedMs: number };

interface QueuedAttempt {
  runJsonPath: string;
  runId: string;
  attempt: AgentAttemptRecord;
}

interface CapacityScan {
  active: number;
  queued: QueuedAttempt[];
  maxQueueSequence: number;
}

function capacityScopeRoot(runJsonPath: string, scopeRoot?: string): string {
  return scopeRoot || projectRunsRootFor(runJsonPath);
}

function capacityClaimPath(runJsonPath: string, scopeRoot?: string): string {
  const root = capacityScopeRoot(runJsonPath, scopeRoot);
  return scopeRoot
    ? join(root, "state", ".agent-cap.lock")
    : join(root, ".agent-cap.lock");
}

function capacitySlotHeld(attempt: AgentAttemptRecord): boolean {
  return Boolean(attempt.capacitySlotAcquiredAt) && !attempt.capacitySlotReleasedAt;
}

function scanCapacity(scopeRoot: string, explicitRunJsonPath?: string): CapacityScan {
  let active = 0;
  const queued: QueuedAttempt[] = [];
  let maxQueueSequence = 0;
  for (const runJsonPath of discoverScopedRunJsonPaths(scopeRoot, explicitRunJsonPath)) {
    const run = readRunJson(runJsonPath);
    const attempts = readRunnerV2AttemptState(runJsonPath).attempts;
    const capacityAgentIds = new Set<string>();
    for (const attempt of attempts) {
      if (capacitySlotHeld(attempt)) {
        active += 1;
        capacityAgentIds.add(attempt.agentId);
      }
      if (attempt.phase === "queued") {
        queued.push({ runJsonPath, runId: run.id, attempt });
      }
      if (Number.isSafeInteger(attempt.queueSequence)) {
        maxQueueSequence = Math.max(maxQueueSequence, attempt.queueSequence || 0);
      }
    }
    // Count pre-queue/legacy runners too. A typed attempt with an acquired slot
    // owns the count for its agent, preventing one PTY from being charged twice.
    for (const agent of run.agents || []) {
      if (agent.status === "running" && !capacityAgentIds.has(agent.id)) active += 1;
    }
  }

  queued.sort((left, right) =>
    (left.attempt.queueSequence ?? Number.MAX_SAFE_INTEGER)
      - (right.attempt.queueSequence ?? Number.MAX_SAFE_INTEGER)
    || (left.attempt.queueEnteredAt || left.attempt.createdAt)
      .localeCompare(right.attempt.queueEnteredAt || right.attempt.createdAt)
    || left.runId.localeCompare(right.runId)
    || left.attempt.id.localeCompare(right.attempt.id));
  return { active, queued, maxQueueSequence };
}

export function enqueueAgentAttempt(input: {
  runJsonPath: string;
  attemptId: string;
  scopeRoot?: string;
  now?: Date;
}): AgentAttemptRecord {
  return withExclusiveFileClaim(capacityClaimPath(input.runJsonPath, input.scopeRoot), () => {
    const current = readRunnerV2AttemptState(input.runJsonPath).attempts
      .find((attempt) => attempt.id === input.attemptId);
    if (!current) throw new Error(`AgentAttempt not found: ${input.attemptId}`);
    if (current.phase === "queued" && current.queueSequence) return current;
    if (current.phase !== "created") {
      throw new Error(`AgentAttempt ${input.attemptId} cannot enter the queue from ${current.phase}`);
    }
    const scan = scanCapacity(capacityScopeRoot(input.runJsonPath, input.scopeRoot), input.runJsonPath);
    const queued = transitionAgentAttempt({
      runJsonPath: input.runJsonPath,
      attemptId: input.attemptId,
      to: "queued",
      now: input.now,
    });
    return recordAgentAttemptQueueOrder({
      runJsonPath: input.runJsonPath,
      attemptId: queued.id,
      queueSequence: scan.maxQueueSequence + 1,
      now: input.now,
    });
  }, {
    freshMs: 60_000,
    waitTimeoutMs: 5_000,
    retryDelayMs: 50,
  });
}

export function admitQueuedAgentAttempt(input: {
  runJsonPath: string;
  runId: string;
  attemptId: string;
  cap: number;
  scopeRoot?: string;
  launchJobId?: string;
  launchOwnerId?: string;
  now?: Date;
}): TypedAgentCapacityDecision {
  if (!Number.isSafeInteger(input.cap) || input.cap < 0) {
    return { status: "invalid", reason: "active agent cap must be a non-negative safe integer" };
  }
  const scopeRoot = capacityScopeRoot(input.runJsonPath, input.scopeRoot);
  return withExclusiveFileClaim(capacityClaimPath(input.runJsonPath, input.scopeRoot), () => {
    let scan: CapacityScan;
    try {
      scan = scanCapacity(scopeRoot, input.runJsonPath);
    } catch (error) {
      return {
        status: "invalid",
        reason: error instanceof Error
          ? `agent capacity scan failed: ${error.message}`
          : "agent capacity scan failed",
      };
    }
    const currentRun = readRunJson(input.runJsonPath);
    if (currentRun.status !== "pending" && currentRun.status !== "running") {
      transitionAgentAttempt({
        runJsonPath: input.runJsonPath,
        attemptId: input.attemptId,
        to: "released",
        reason: "released",
        detail: `run ${currentRun.id} is no longer launchable (${currentRun.status})`,
        now: input.now,
      });
      return {
        status: "cancelled",
        reason: `run ${currentRun.id} is no longer launchable (${currentRun.status})`,
      };
    }
    if (input.launchJobId || input.launchOwnerId) {
      if (!input.launchJobId || !input.launchOwnerId || !routedLaunchJobLeaseOwned({
        runJsonPath: input.runJsonPath,
        jobId: input.launchJobId,
        ownerId: input.launchOwnerId,
        now: input.now,
      })) {
        return {
          status: "ownership_lost",
          reason: `routed launch job lease is not owned for ${input.attemptId}`,
        };
      }
    }

    const target = scan.queued.find((candidate) =>
      candidate.runId === input.runId && candidate.attempt.id === input.attemptId);
    if (!target) {
      const current = readRunnerV2AttemptState(input.runJsonPath).attempts
        .find((attempt) => attempt.id === input.attemptId);
      if (current?.phase === "lease_acquired" && capacitySlotHeld(current)) {
        return { status: "admitted", active: scan.active, cap: input.cap };
      }
      return { status: "invalid", reason: `queued AgentAttempt not found: ${input.attemptId}` };
    }

    const position = scan.queued.indexOf(target) + 1;
    if (input.cap > 0 && (scan.active >= input.cap || position !== 1)) {
      return { status: "queued", active: scan.active, cap: input.cap, position };
    }
    transitionAgentAttempt({
      runJsonPath: input.runJsonPath,
      attemptId: input.attemptId,
      to: "lease_acquired",
      now: input.now,
    });
    return { status: "admitted", active: scan.active + 1, cap: input.cap };
  }, {
    freshMs: 60_000,
    waitTimeoutMs: 5_000,
    retryDelayMs: 50,
  });
}

export async function waitForTypedAgentCapacity(input: {
  runJsonPath: string;
  runId: string;
  attemptId: string;
  cap: number;
  scopeRoot?: string;
  launchJobId?: string;
  launchOwnerId?: string;
  maxWaitMs: number;
  pollMs: number;
  pollMaxMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<TypedAgentCapacityWaitResult> {
  const now = input.now || (() => Date.now());
  const sleep = input.sleep || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const started = now();
  let pollMs = Math.max(1, input.pollMs);
  while (true) {
    const decision = admitQueuedAgentAttempt({
      runJsonPath: input.runJsonPath,
      runId: input.runId,
      attemptId: input.attemptId,
      cap: input.cap,
      scopeRoot: input.scopeRoot,
      launchJobId: input.launchJobId,
      launchOwnerId: input.launchOwnerId,
      now: new Date(now()),
    });
    if (decision.status !== "queued") return decision;
    const waitedMs = now() - started;
    if (waitedMs >= input.maxWaitMs) {
      return {
        status: "timeout",
        active: decision.active,
        cap: decision.cap,
        waitedMs,
      };
    }
    await sleep(pollMs);
    pollMs = Math.min(pollMs * 2, Math.max(1, input.pollMaxMs));
  }
}
