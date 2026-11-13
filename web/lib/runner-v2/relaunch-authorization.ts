import type { AgentAttemptRecord } from "@/lib/runner-v2/agent-attempt";
import type { RunRecord, TypedRelaunchAuthorization } from "@/lib/runs/run-record";

/**
 * Occurrence-scoped relaunch authorizations (#25).
 *
 * run.relaunchAuthorizations is keyed by agent id, then by occurrence key:
 * `job:<launchJobId>` for a routed revisit and `direct` for a retry/handler
 * relaunch with no launch job. A retry and a routed revisit of the SAME agent
 * therefore keep separate entries instead of overwriting each other, and two
 * routed jobs for one agent each keep their own entry.
 *
 * Consumption is derived from attempt history, not from a second write: an
 * entry is consumed once an attempt of that agent with the same launch job
 * (or with no launch job, for `direct`) was created at or after the entry's
 * authorizedAt. The attempt record is the consumption receipt, so a crash
 * between authorization and bootstrap leaves the entry live, and one
 * occurrence's attempt never consumes another occurrence's entry.
 *
 * Legacy shape (one `{ launchJobId?, authorizedAt }` object per agent, written
 * before #25) is read as a single entry so authorizations persisted across an
 * upgrade still admit their pending bootstrap.
 */
export type AgentRelaunchAuthorizations = Record<string, TypedRelaunchAuthorization>;

export const DIRECT_RELAUNCH_KEY = "direct";

export function relaunchOccurrenceKey(launchJobId?: string): string {
  return launchJobId ? `job:${launchJobId}` : DIRECT_RELAUNCH_KEY;
}

function isAuthorization(value: unknown): value is TypedRelaunchAuthorization {
  return Boolean(value)
    && typeof value === "object"
    && typeof (value as { authorizedAt?: unknown }).authorizedAt === "string";
}

/** Normalized occurrence entries for one agent (legacy single entries included). */
export function agentRelaunchAuthorizations(
  run: Pick<RunRecord, "relaunchAuthorizations">,
  agentId: string,
): AgentRelaunchAuthorizations {
  const raw: unknown = run.relaunchAuthorizations?.[agentId];
  if (!raw || typeof raw !== "object") return {};
  if (isAuthorization(raw)) {
    const legacy = raw as TypedRelaunchAuthorization;
    return { [relaunchOccurrenceKey(legacy.launchJobId)]: legacy };
  }
  const entries: AgentRelaunchAuthorizations = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isAuthorization(value)) entries[key] = value;
  }
  return entries;
}

export function isRelaunchAuthorizationConsumed(
  authorization: TypedRelaunchAuthorization,
  agentId: string,
  attempts: readonly AgentAttemptRecord[],
): boolean {
  const authorizedAt = Date.parse(authorization.authorizedAt);
  if (!Number.isFinite(authorizedAt)) return true; // unreadable entries never admit
  return attempts.some((attempt) => {
    if (attempt.agentId !== agentId) return false;
    if ((attempt.launchJobId || undefined) !== (authorization.launchJobId || undefined)) return false;
    const createdAt = Date.parse(attempt.createdAt);
    return Number.isFinite(createdAt) && createdAt >= authorizedAt;
  });
}

/** True when a live (unconsumed) entry for this agent and launch job exists. */
export function relaunchAuthorizationAdmits(input: {
  run: Pick<RunRecord, "relaunchAuthorizations">;
  runId: string;
  agentId: string;
  launchJobId?: string;
  attempts: readonly AgentAttemptRecord[];
}): boolean {
  const entry = agentRelaunchAuthorizations(input.run, input.agentId)[relaunchOccurrenceKey(input.launchJobId)];
  if (!entry || (entry.launchJobId || undefined) !== (input.launchJobId || undefined)) return false;
  const attempts = input.attempts.filter((attempt) => attempt.runId === input.runId);
  return !isRelaunchAuthorizationConsumed(entry, input.agentId, attempts);
}

/**
 * Add one occurrence entry for an agent, keeping every other live entry for
 * that agent and dropping only entries already consumed by an attempt.
 */
export function withRelaunchAuthorization(input: {
  run: Pick<RunRecord, "relaunchAuthorizations">;
  runId: string;
  agentId: string;
  launchJobId?: string;
  authorizedAt: string;
  attempts: readonly AgentAttemptRecord[];
}): Record<string, AgentRelaunchAuthorizations> {
  const attempts = input.attempts.filter((attempt) => attempt.runId === input.runId);
  const live: AgentRelaunchAuthorizations = {};
  for (const [key, entry] of Object.entries(agentRelaunchAuthorizations(input.run, input.agentId))) {
    if (!isRelaunchAuthorizationConsumed(entry, input.agentId, attempts)) live[key] = entry;
  }
  live[relaunchOccurrenceKey(input.launchJobId)] = {
    ...(input.launchJobId ? { launchJobId: input.launchJobId } : {}),
    authorizedAt: input.authorizedAt,
  };
  const all = { ...(input.run.relaunchAuthorizations || {}) } as Record<string, unknown>;
  all[input.agentId] = live;
  return all as Record<string, AgentRelaunchAuthorizations>;
}
