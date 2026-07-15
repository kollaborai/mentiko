import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { findCompletionEvent } from "@/lib/runner-v2/completion";
import { readRunJson, type RunRecord } from "@/lib/runner-v2/run-state";
import type { AgentAttemptRecord } from "@/lib/runner-v2/agent-attempt";
import { decideNextRoute, type RoutingChain, type RoutingDecision } from "@/lib/runner-v2/routing";
import { parseRunnerEvent, type RunnerEventRecord } from "@/lib/runner-v2/events";
import { withRunJsonLock, writeRunJsonAtomic } from "@/lib/runs/run-json-lock";

export interface RecoverLateCompletionInput {
  runJsonPath: string;
  runId: string;
  chain: RoutingChain;
  events: Array<RunnerEventRecord | string>;
  now?: Date;
  testHooks?: {
    afterLockAcquired?: () => void;
    afterRunCommitted?: () => void;
    beforeEventProcessed?: (event: RunnerEventRecord, index: number) => void;
  };
}

export interface LateCompletionRecovery {
  deliveryId: string;
  agentId: string;
  event: RunnerEventRecord;
  route: RoutingDecision;
}

export interface RecoverLateCompletionResult {
  recovered: LateCompletionRecovery[];
  deliveries: LateCompletionRecovery[];
  run: RunRecord;
}

export interface ClaimLateCompletionDeliveryInput {
  runJsonPath: string;
  deliveryId: string;
  claimId: string;
  processId?: number;
  now?: Date;
  staleAfterMs?: number;
  deadClaimGraceMs?: number;
}

export interface AcknowledgeLateCompletionDeliveryInput {
  runJsonPath: string;
  deliveryId: string;
  claimId?: string;
  evidence: "plan-applied" | "downstream-state";
  now?: Date;
}

export interface ReleaseLateCompletionDeliveryInput {
  runJsonPath: string;
  deliveryId: string;
  claimId: string;
}

/**
 * Recover agents that were falsely terminalized `completion_failed /
 * retries_exhausted` while their valid completion event landed
 * `processed: false` shortly after the no-event retry budget exhausted (the
 * verified TASK-093 failure — the event arrived ~4.5 min after the exhaustion
 * verdict). This is the bash parity of `monitor-agent-died`'s "process gone but
 * completion event exists ... completing normally": before treating a
 * completion_failed / stopped run as final, adopt any unprocessed valid event
 * matching a completion_failed attempt, complete that agent, and return the
 * downstream route so the caller (reconcile / a runner-v2 sweep) can resume.
 *
 * Transaction boundary:
 *  1. acquire the shared run.json stale-break lock (strictly fail closed on
 *     timeout instead of using the lock helper's degraded/unlocked write path),
 *  2. re-read run + physical events under the lock,
 *  3. atomically write ONE run.json containing the completed attempt, agent/run
 *     state, and a durable PENDING route-delivery ledger entry,
 *  4. atomically mark the exact event `processed: true`.
 *
 * A crash before step 3 leaves the event unprocessed and fully recoverable. A
 * crash after step 3 is recognized by the ledger: the next stale-lock breaker
 * only converges the event to processed and returns the still-pending route;
 * it does not mutate recovery state again. A processed event never suppresses
 * its route: the ledger keeps returning that delivery until the reconcile caller
 * acknowledges successful plan application. Event matching always reuses
 * `findCompletionEvent` (processed / run_id / source / identity guards).
 */
export function recoverLateCompletionEvents(input: RecoverLateCompletionInput): RecoverLateCompletionResult {
  let lockTimedOut = false;
  return withRunJsonLock(input.runJsonPath, () => {
    if (lockTimedOut) {
      return { recovered: [], deliveries: [], run: readRunJson(input.runJsonPath) };
    }

    input.testHooks?.afterLockAcquired?.();
    const current = readRunJson(input.runJsonPath);
    const events = readPhysicalEvents(input.events);
    const allAgentIds = input.chain.agents.map((candidate) => candidate.id);
    const runnerV2 = runnerV2State(current);

    // Materialize every unapplied delivery, including entries whose event was
    // already consumed by a process that crashed before executor application.
    const committed = materializeCommittedDeliveries({
      commits: runnerV2.lateCompletionRecoveries,
      events,
      chain: input.chain,
      allAgentIds,
      runId: input.runId,
      beforeEventProcessed: input.testHooks?.beforeEventProcessed,
    });

    const attempts = runnerV2.attempts.filter((attempt) => attempt.runId === input.runId);
    const stuckAgentIds = latestFailedAgentIds(attempts);
    const recovered: LateCompletionRecovery[] = [];
    const commits: LateCompletionRecoveryCommit[] = [];
    let next = current;

    for (const agentId of stuckAgentIds) {
      const agent = input.chain.agents.find((candidate) => candidate.id === agentId);
      if (!agent?.emits) continue;

      const match = findCompletionEvent({ agent, runId: input.runId, events, allAgentIds });
      if (!match.matched || !match.event?.path) continue;

      const route = decideNextRoute(input.chain, match.event.event);
      next = applyRecoveredAgent(next, agentId, match.event, input.now);
      const commit = commitFor(match.event, agentId, input.now);
      commits.push(commit);
      recovered.push({ deliveryId: commit.deliveryId, agentId, event: match.event, route });
    }

    if (recovered.length === 0) {
      return {
        recovered: committed.converged,
        deliveries: committed.deliveries,
        run: current,
      };
    }

    const hasDownstream = recovered.some((item) =>
      item.route.action === "launch"
      || (item.route.action === "wait" && item.route.pending === true));
    const at = (input.now || new Date()).toISOString();
    const targetStatus = hasDownstream ? "running" : "completed";
    const nextRunnerV2 = runnerV2State(next);
    next = {
      ...next,
      status: targetStatus,
      ...(targetStatus === "completed" && !next.completed ? { completed: at } : {}),
      runnerV2: {
        ...nextRunnerV2.raw,
        attempts: nextRunnerV2.attempts,
        lateCompletionRecoveries: [...nextRunnerV2.lateCompletionRecoveries, ...commits],
      },
    };

    // The entire run recovery becomes durable in one rename. There is no
    // partially-adopted attempt/agent/status state for a later process to infer.
    writeRunJsonAtomic(input.runJsonPath, next);
    input.testHooks?.afterRunCommitted?.();

    const finalized = recovered.map((item, index) => {
      input.testHooks?.beforeEventProcessed?.(item.event, index);
      return { ...item, event: markExactEventProcessed(item.event) };
    });
    return {
      recovered: [...committed.converged, ...finalized],
      deliveries: [...committed.deliveries, ...finalized],
      run: next,
    };
  }, () => {
    // withRunJsonLock normally degrades to an unlocked write on timeout. Late
    // recovery cannot: exclusivity is the invariant, so its callback becomes a
    // read-only no-op instead.
    lockTimedOut = true;
  });
}

/** Atomically claim one pending delivery. Concurrent reconcile processes can
 * observe the same outbox entry, but only one receives the right to apply it. */
export function claimLateCompletionDelivery(input: ClaimLateCompletionDeliveryInput): boolean {
  return withStrictRunLock(input.runJsonPath, false, () => {
    const current = readRunJson(input.runJsonPath);
    const state = runnerV2State(current);
    const index = state.lateCompletionRecoveries.findIndex((commit) => commit.deliveryId === input.deliveryId);
    if (index < 0) return false;

    const commit = state.lateCompletionRecoveries[index];
    if (commit.deliveryStatus === "applied") return false;
    if (commit.deliveryStatus === "applying") {
      if (commit.deliveryClaim?.id === input.claimId) return true;
      if (!claimIsRecoverable(commit, input.now, input.staleAfterMs, input.deadClaimGraceMs)) return false;
    }

    const now = input.now || new Date();
    const nextCommit: LateCompletionRecoveryCommit = {
      ...commit,
      deliveryStatus: "applying",
      deliveryClaim: {
        id: input.claimId,
        processId: input.processId ?? process.pid,
        claimedAt: now.toISOString(),
      },
    };
    writeRunJsonAtomic(input.runJsonPath, replaceCommit(current, state, index, nextCommit));
    return true;
  });
}

/** Persist successful application. `downstream-state` is the crash-recovery
 * acknowledgement: if the claimed process died after spawning but before this
 * write, an already-running/completed target proves the launch happened. */
export function acknowledgeLateCompletionDelivery(
  input: AcknowledgeLateCompletionDeliveryInput,
): boolean {
  return withStrictRunLock(input.runJsonPath, false, () => {
    const current = readRunJson(input.runJsonPath);
    const state = runnerV2State(current);
    const index = state.lateCompletionRecoveries.findIndex((commit) => commit.deliveryId === input.deliveryId);
    if (index < 0) return false;

    const commit = state.lateCompletionRecoveries[index];
    if (commit.deliveryStatus === "applied") return true;
    if (
      input.evidence === "plan-applied"
      && (commit.deliveryStatus !== "applying" || commit.deliveryClaim?.id !== input.claimId)
    ) {
      return false;
    }

    const nextCommit: LateCompletionRecoveryCommit = {
      ...commit,
      deliveryStatus: "applied",
      appliedAt: (input.now || new Date()).toISOString(),
      deliveryClaim: undefined,
    };
    writeRunJsonAtomic(input.runJsonPath, replaceCommit(current, state, index, nextCommit));
    return true;
  });
}

/** Return a failed application to pending. Only the current claim owner can
 * release it, so an older request cannot reopen a newer process's delivery. */
export function releaseLateCompletionDelivery(input: ReleaseLateCompletionDeliveryInput): boolean {
  return withStrictRunLock(input.runJsonPath, false, () => {
    const current = readRunJson(input.runJsonPath);
    const state = runnerV2State(current);
    const index = state.lateCompletionRecoveries.findIndex((commit) => commit.deliveryId === input.deliveryId);
    if (index < 0) return false;

    const commit = state.lateCompletionRecoveries[index];
    if (commit.deliveryStatus !== "applying" || commit.deliveryClaim?.id !== input.claimId) return false;
    const nextCommit: LateCompletionRecoveryCommit = {
      ...commit,
      deliveryStatus: "pending",
      deliveryClaim: undefined,
    };
    writeRunJsonAtomic(input.runJsonPath, replaceCommit(current, state, index, nextCommit));
    return true;
  });
}

/**
 * Agents whose most recent attempt ended `completion_failed`. Attempts are
 * stored in append order, so the last entry per agent is authoritative — the
 * same latest-wins rule `findLatestAttempt` uses. An agent later recovered to
 * `completed` drops out here, which is what makes repeat passes no-ops.
 */
function latestFailedAgentIds(attempts: AgentAttemptRecord[]): string[] {
  const latestByAgent = new Map<string, AgentAttemptRecord>();
  for (const attempt of attempts) {
    latestByAgent.set(attempt.agentId, attempt);
  }
  return [...latestByAgent.entries()]
    .filter(([, attempt]) => attempt.phase === "completion_failed")
    .map(([agentId]) => agentId);
}

interface LateCompletionRecoveryCommit {
  deliveryId: string;
  deliveryStatus: "pending" | "applying" | "applied";
  deliveryClaim?: {
    id: string;
    processId: number;
    claimedAt: string;
  };
  appliedAt?: string;
  eventPath: string;
  eventName: string;
  eventSource: string;
  runId: string;
  agentId: string;
  committedAt: string;
}

interface RecoveryRunnerV2State {
  raw: Record<string, unknown>;
  attempts: AgentAttemptRecord[];
  lateCompletionRecoveries: LateCompletionRecoveryCommit[];
}

function runnerV2State(run: RunRecord): RecoveryRunnerV2State {
  const raw = run.runnerV2 && typeof run.runnerV2 === "object" && !Array.isArray(run.runnerV2)
    ? run.runnerV2 as Record<string, unknown>
    : {};
  return {
    raw,
    attempts: Array.isArray(raw.attempts) ? raw.attempts as AgentAttemptRecord[] : [],
    lateCompletionRecoveries: Array.isArray(raw.lateCompletionRecoveries)
      ? raw.lateCompletionRecoveries
        .map(normalizeCommit)
        .filter((commit): commit is LateCompletionRecoveryCommit => Boolean(commit))
      : [],
  };
}

function readPhysicalEvents(events: Array<RunnerEventRecord | string>): RunnerEventRecord[] {
  const seen = new Set<string>();
  const physical: RunnerEventRecord[] = [];
  for (const candidate of events) {
    if (typeof candidate === "string" || !candidate.path || seen.has(candidate.path)) continue;
    seen.add(candidate.path);
    try {
      physical.push({ ...parseRunnerEvent(readFileSync(candidate.path, "utf8")), path: candidate.path });
    } catch {
      // Gone/unreadable events cannot be durably claimed; fail closed.
    }
  }
  return physical;
}

function materializeCommittedDeliveries(input: {
  commits: LateCompletionRecoveryCommit[];
  events: RunnerEventRecord[];
  chain: RoutingChain;
  allAgentIds: string[];
  runId: string;
  beforeEventProcessed?: (event: RunnerEventRecord, index: number) => void;
}): { deliveries: LateCompletionRecovery[]; converged: LateCompletionRecovery[] } {
  const deliveries: LateCompletionRecovery[] = [];
  const converged: LateCompletionRecovery[] = [];
  for (const commit of input.commits) {
    if (commit.runId !== input.runId || commit.deliveryStatus === "applied") continue;
    const event = input.events.find((candidate) => (
      candidate.path === commit.eventPath
      && candidate.event === commit.eventName
      && candidate.source === commit.eventSource
      && candidate.runId === commit.runId
    ));
    if (!event) continue;

    const agent = input.chain.agents.find((candidate) => candidate.id === commit.agentId);
    if (!agent?.emits) continue;
    const identityCandidate = event.processed
      ? { ...event, processed: false, fields: { ...event.fields, processed: "false" } }
      : event;
    const match = findCompletionEvent({
      agent,
      runId: input.runId,
      events: [identityCandidate],
      allAgentIds: input.allAgentIds,
    });
    if (!match.matched || !match.event) continue;

    if (!event.processed) input.beforeEventProcessed?.(event, deliveries.length);
    const delivery = {
      deliveryId: commit.deliveryId,
      agentId: commit.agentId,
      event: event.processed ? event : markExactEventProcessed(match.event),
      route: decideNextRoute(input.chain, match.event.event),
    };
    deliveries.push(delivery);
    if (!event.processed) converged.push(delivery);
  }
  return { deliveries, converged };
}

function applyRecoveredAgent(
  run: RunRecord,
  agentId: string,
  event: RunnerEventRecord,
  now?: Date,
): RunRecord {
  const state = runnerV2State(run);
  const previous = [...state.attempts]
    .reverse()
    .find((attempt) => attempt.runId === event.runId && attempt.agentId === agentId);
  if (!previous || previous.phase !== "completion_failed") return run;

  const at = (now || new Date()).toISOString();
  const sequence = state.attempts
    .filter((attempt) => attempt.runId === event.runId && attempt.agentId === agentId)
    .length + 1;
  const adoptionDetail = `adopted at completion: previous attempt ${previous.id} ended ${previous.phase}${previous.terminalReason ? ` (${previous.terminalReason})` : ""} but new completion evidence arrived for the same agent`;
  const terminalDetail = `late completion event ${event.event} recovered after premature exhaustion`;
  const attempt: AgentAttemptRecord = {
    id: `${event.runId}:${agentId}:${sequence}`,
    runId: event.runId,
    agentId,
    phase: "completed",
    desiredPhase: "completed",
    observedPhase: "completed",
    terminalReason: "completed_from_event",
    terminalDetail,
    instructionLedger: [],
    recoveryDecisionCount: 0,
    createdAt: at,
    updatedAt: at,
    transitions: [
      { from: "created", to: "instructions_submitted", at, detail: adoptionDetail },
      {
        from: "instructions_submitted",
        to: "completed",
        at,
        reason: "completed_from_event",
        detail: terminalDetail,
      },
    ],
    origin: "routed-completion-adoption",
  };

  return {
    ...run,
    agents: (run.agents || []).map((agent) => agent.id === agentId
      ? { ...agent, status: "complete", completed: agent.completed || at }
      : agent),
    runnerV2: {
      ...state.raw,
      attempts: [...state.attempts, attempt],
      lateCompletionRecoveries: state.lateCompletionRecoveries,
    },
  };
}

function commitFor(event: RunnerEventRecord, agentId: string, now?: Date): LateCompletionRecoveryCommit {
  return {
    deliveryId: deliveryIdFor(event.runId, agentId, event.path!, event.event, event.source),
    deliveryStatus: "pending",
    eventPath: event.path!,
    eventName: event.event,
    eventSource: event.source,
    runId: event.runId,
    agentId,
    committedAt: (now || new Date()).toISOString(),
  };
}

function normalizeCommit(value: unknown): LateCompletionRecoveryCommit | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.eventPath !== "string"
    || typeof raw.eventName !== "string"
    || typeof raw.eventSource !== "string"
    || typeof raw.runId !== "string"
    || typeof raw.agentId !== "string"
    || typeof raw.committedAt !== "string"
  ) return undefined;

  const status = raw.deliveryStatus === "applying" || raw.deliveryStatus === "applied"
    ? raw.deliveryStatus
    : "pending";
  const claim = raw.deliveryClaim && typeof raw.deliveryClaim === "object" && !Array.isArray(raw.deliveryClaim)
    ? raw.deliveryClaim as Record<string, unknown>
    : undefined;
  const deliveryClaim = claim
    && typeof claim.id === "string"
    && typeof claim.processId === "number"
    && typeof claim.claimedAt === "string"
    ? { id: claim.id, processId: claim.processId, claimedAt: claim.claimedAt }
    : undefined;
  return {
    deliveryId: typeof raw.deliveryId === "string"
      ? raw.deliveryId
      : deliveryIdFor(raw.runId, raw.agentId, raw.eventPath, raw.eventName, raw.eventSource),
    deliveryStatus: status,
    ...(deliveryClaim ? { deliveryClaim } : {}),
    ...(typeof raw.appliedAt === "string" ? { appliedAt: raw.appliedAt } : {}),
    eventPath: raw.eventPath,
    eventName: raw.eventName,
    eventSource: raw.eventSource,
    runId: raw.runId,
    agentId: raw.agentId,
    committedAt: raw.committedAt,
  };
}

function deliveryIdFor(runId: string, agentId: string, eventPath: string, eventName: string, eventSource: string): string {
  const digest = createHash("sha256")
    .update([runId, agentId, eventPath, eventName, eventSource].join("\0"))
    .digest("hex")
    .slice(0, 20);
  return `late-${digest}`;
}

function replaceCommit(
  run: RunRecord,
  state: RecoveryRunnerV2State,
  index: number,
  commit: LateCompletionRecoveryCommit,
): RunRecord {
  const commits = [...state.lateCompletionRecoveries];
  commits[index] = commit;
  return {
    ...run,
    runnerV2: {
      ...state.raw,
      attempts: state.attempts,
      lateCompletionRecoveries: commits,
    },
  };
}

function claimIsRecoverable(
  commit: LateCompletionRecoveryCommit,
  now?: Date,
  staleAfterMs = 2 * 60_000,
  deadClaimGraceMs = 5_000,
): boolean {
  const claim = commit.deliveryClaim;
  if (!claim) return true;
  const claimedAt = Date.parse(claim.claimedAt);
  if (!Number.isFinite(claimedAt)) return true;
  const ageMs = (now || new Date()).getTime() - claimedAt;
  if (!processIsAlive(claim.processId)) return ageMs >= deadClaimGraceMs;
  return ageMs >= staleAfterMs;
}

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function withStrictRunLock<T>(runJsonPath: string, fallback: T, fn: () => T): T {
  let lockTimedOut = false;
  return withRunJsonLock(runJsonPath, () => lockTimedOut ? fallback : fn(), () => {
    lockTimedOut = true;
  });
}

function markExactEventProcessed(event: RunnerEventRecord): RunnerEventRecord {
  if (!event.path) throw new Error("late completion event has no durable path");
  const original = readFileSync(event.path, "utf8");

  const current = parseRunnerEvent(original);
  if (
    current.event !== event.event
    || current.source !== event.source
    || current.runId !== event.runId
  ) {
    throw new Error(`late completion event changed before processing: ${event.path}`);
  }

  if (!current.processed) {
    const consumed = original.match(/^processed:\s*.*$/m)
      ? original.replace(/^processed:\s*.*$/m, "processed: true")
      : `${original.replace(/\n?$/, "\n")}processed: true\n`;
    writeAtomically(event.path, consumed);
  }
  return {
    ...current,
    processed: true,
    fields: { ...current.fields, processed: "true" },
    path: event.path,
  };
}

function writeAtomically(path: string, content: string): void {
  const temporary = `${path}.recovery-${process.pid}-${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, content);
    renameSync(temporary, path);
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      // rename succeeds by removing the temporary path; cleanup is best-effort.
    }
  }
}
