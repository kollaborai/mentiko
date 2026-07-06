import type { RunnerEventRecord } from "@/lib/runner-v2/events";

export interface EventSideEffectPlan {
  markProcessed: RunnerEventRecord;
  archiveOwned: RunnerEventRecord[];
}

export function planCompletionEventSideEffects(
  triggeredEvent: RunnerEventRecord,
  allEvents: RunnerEventRecord[],
): EventSideEffectPlan {
  return {
    markProcessed: triggeredEvent,
    archiveOwned: allEvents.filter((event) => eventIsOwnedBy(triggeredEvent, event)),
  };
}

export function eventIsOwnedBy(owner: RunnerEventRecord, candidate: RunnerEventRecord): boolean {
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
  // Source/agent scoping, superstring both ways, checking BOTH the raw source AND
  // the raw agent field of the candidate — mirrors _event-belongs-to. Diagnostic
  // events carry source=<emitter> (chain-runner-complete/monitor) with the owning
  // agent in a DISTINCT agent: field, so the previous
  // source-only match left the completing agent's own diagnostics un-archived.
  const rawSource = candidate.fields.source ?? "";
  const rawAgent = candidate.fields.agent ?? "";
  for (const candidateId of [rawSource, rawAgent]) {
    if (!candidateId) continue;
    if (candidateId === src || candidateId.includes(src) || src.includes(candidateId)) {
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
