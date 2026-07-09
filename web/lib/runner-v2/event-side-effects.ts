import { agentOwnsEvent } from "@/lib/runner-v2/completion";
import type { RunnerEventRecord } from "@/lib/runner-v2/events";

export interface EventSideEffectPlan {
  markProcessed: RunnerEventRecord;
  archiveOwned: RunnerEventRecord[];
}

export function planCompletionEventSideEffects(
  triggeredEvent: RunnerEventRecord,
  allEvents: RunnerEventRecord[],
  // Full chain agent-id set, used only to disambiguate a candidate identity
  // that exactly names a DIFFERENT declared agent from a legitimate
  // session-prefix owner match. Optional and additive: callers that cannot
  // supply it (e.g. executor.ts today) keep the shell-parity substring
  // behavior unguarded -- see eventIsOwnedBy.
  allAgentIds?: string[],
): EventSideEffectPlan {
  return {
    markProcessed: triggeredEvent,
    archiveOwned: allEvents.filter((event) => eventIsOwnedBy(triggeredEvent, event, allAgentIds)),
  };
}

export function eventIsOwnedBy(
  owner: RunnerEventRecord,
  candidate: RunnerEventRecord,
  allAgentIds?: string[],
): boolean {
  // run scoping: a populated, mismatched run id means a DIFFERENT run -> not ours.
  if (owner.runId && candidate.runId && owner.runId !== candidate.runId) {
    return false;
  }
  // owner identity mirrors lib/event-trigger.sh archive-run-events' src argument
  // (CURRENT_AGENT_ID). Without an owner identity we never claim an event.
  const src = owner.source;
  if (!src) {
    return false;
  }
  // Exact identity always wins -- covers the completing agent's own
  // diagnostic events (source=monitor/chain-runner-complete) via the
  // DISTINCT agent: field.
  if (agentOwnsEvent(candidate, { id: src })) {
    return true;
  }
  // Prefix/superstring match mirrors the shell's _event-belongs-to
  // (lib/event-trigger.sh L181-188, documented as intentional both-way
  // substring: a session-suffixed source like "researcher-7f3a" must still be
  // owned by bare agent id "researcher"). Guarded against the sibling
  // collision this creates ("api" wrongly owning "api-reviewer"'s event --
  // structurally identical to the legitimate session-suffix case): when the
  // full chain agent-id set is known, a candidate identity that EXACTLY names
  // a DIFFERENT declared agent is never claimed via substring. Callers that
  // cannot supply allAgentIds keep the shell-parity behavior unguarded.
  const rawSource = candidate.fields.source ?? "";
  const rawAgent = candidate.fields.agent ?? "";
  const normalizedSrc = normalizeId(src);
  for (const candidateId of [rawSource, rawAgent]) {
    if (!candidateId) continue;
    const normalizedCandidate = normalizeId(candidateId);
    const namesAnotherAgent = allAgentIds?.some((id) => {
      const normalizedId = normalizeId(id);
      return normalizedId !== "" && normalizedId === normalizedCandidate && normalizedId !== normalizedSrc;
    });
    if (namesAnotherAgent) continue;
    if (normalizedCandidate.includes(normalizedSrc) || normalizedSrc.includes(normalizedCandidate)) {
      return true;
    }
  }
  // last resort: neither source nor agent field readable. Match on filename
  // containment of the owner source (the file at least names this agent).
  if (!rawSource && !rawAgent && candidate.path) {
    const base = candidate.path.split("/").pop() ?? "";
    if (base.includes(src)) {
      return true;
    }
  }
  return false;
}

function normalizeId(value: string): string {
  return value.trim().toLowerCase();
}
