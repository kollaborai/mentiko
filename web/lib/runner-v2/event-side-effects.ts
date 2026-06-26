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
  if (owner.runId && candidate.runId && owner.runId !== candidate.runId) {
    return false;
  }
  if (!candidate.source) {
    return false;
  }
  return candidate.source === owner.source
    || candidate.source.includes(owner.source)
    || owner.source.includes(candidate.source);
}
