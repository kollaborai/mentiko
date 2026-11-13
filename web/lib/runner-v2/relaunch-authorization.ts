import type { AgentAttemptRecord } from "@/lib/runner-v2/agent-attempt";
import type {
  RelaunchAuthorizations,
  RunRecord,
  TypedRelaunchAuthorization,
} from "@/lib/runs/run-record";

/** The occurrence key used for retry/handler relaunches without a launch job. */
export const DIRECT_RELAUNCH_KEY = "direct";

export type AgentRelaunchAuthorizations = Record<string, TypedRelaunchAuthorization>;

export function relaunchOccurrenceKey(launchJobId?: string): string {
  return launchJobId ? `job:${launchJobId}` : DIRECT_RELAUNCH_KEY;
}

function isAuthorization(value: unknown): value is TypedRelaunchAuthorization {
  return Boolean(value)
    && typeof value === "object"
    && typeof (value as { authorizedAt?: unknown }).authorizedAt === "string";
}

/** Normalize one agent's current or pre-#25 authorization shape. */
export function agentRelaunchAuthorizations(
  run: Pick<RunRecord, "relaunchAuthorizations">,
  agentId: string,
): AgentRelaunchAuthorizations {
  const raw: unknown = run.relaunchAuthorizations?.[agentId];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  if (isAuthorization(raw)) {
    return { [relaunchOccurrenceKey(raw.launchJobId)]: raw };
  }

  const entries: AgentRelaunchAuthorizations = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isAuthorization(value)) entries[key] = value;
  }
  return entries;
}

function sameOccurrence(left: TypedRelaunchAuthorization, launchJobId?: string): boolean {
  return (left.launchJobId || undefined) === (launchJobId || undefined);
}

/** An authorization is consumed by the first matching attempt created after it. */
export function isRelaunchAuthorizationConsumed(
  authorization: TypedRelaunchAuthorization,
  agentId: string,
  attempts: readonly AgentAttemptRecord[],
): boolean {
  const authorizedAt = Date.parse(authorization.authorizedAt);
  if (!Number.isFinite(authorizedAt)) return true;
  return attempts.some((attempt) => {
    if (attempt.agentId !== agentId || !sameOccurrence(authorization, attempt.launchJobId)) return false;
    const createdAt = Date.parse(attempt.createdAt);
    return Number.isFinite(createdAt) && createdAt >= authorizedAt;
  });
}

/** Return whether this agent/occurrence has a still-live admission. */
export function relaunchAuthorizationAdmits(input: {
  run: Pick<RunRecord, "relaunchAuthorizations">;
  runId: string;
  agentId: string;
  launchJobId?: string;
  attempts: readonly AgentAttemptRecord[];
}): boolean {
  const entry = agentRelaunchAuthorizations(input.run, input.agentId)[relaunchOccurrenceKey(input.launchJobId)];
  if (!entry || !sameOccurrence(entry, input.launchJobId)) return false;
  const runAttempts = input.attempts.filter((attempt) => attempt.runId === input.runId);
  return !isRelaunchAuthorizationConsumed(entry, input.agentId, runAttempts);
}

/**
 * Add one occurrence authorization without dropping any other live occurrence
 * for the same agent. Already-consumed entries are removed opportunistically;
 * the attempt history remains the source of truth for consumption.
 */
export function withRelaunchAuthorization(input: {
  run: Pick<RunRecord, "relaunchAuthorizations">;
  runId: string;
  agentId: string;
  launchJobId?: string;
  authorizedAt: string;
  attempts: readonly AgentAttemptRecord[];
}): RelaunchAuthorizations {
  const runAttempts = input.attempts.filter((attempt) => attempt.runId === input.runId);
  const live: AgentRelaunchAuthorizations = {};
  for (const [key, entry] of Object.entries(agentRelaunchAuthorizations(input.run, input.agentId))) {
    if (!isRelaunchAuthorizationConsumed(entry, input.agentId, runAttempts)) live[key] = entry;
  }
  live[relaunchOccurrenceKey(input.launchJobId)] = {
    ...(input.launchJobId ? { launchJobId: input.launchJobId } : {}),
    authorizedAt: input.authorizedAt,
  };

  return {
    ...(input.run.relaunchAuthorizations || {}),
    [input.agentId]: live,
  };
}
