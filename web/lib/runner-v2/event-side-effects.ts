import { validateRunnerEventRecord, type RunnerEventRecord } from "@/lib/runner-v2/events";
import {
  captureRunnerEventAcceptedTrigger,
  eventIsStrictlyOwned,
  type RunnerEventAcceptedTrigger,
} from "@/lib/runner-v2/event-lifecycle";
import { dirname } from "node:path";

export interface EventSideEffectPlan {
  /**
   * The accepted completion event supplies strict run/source provenance.
   * triggeredPath is populated only when the same physical strict record is
   * present in the active completion event set.
   */
  markProcessed: RunnerEventRecord;
  triggeredPath?: string;
  /** Full chain identity set required for collision-safe ownership matching. */
  allAgentIds: string[];
  /** Canonical completing agent identity; trigger source remains provenance. */
  ownerAgentId?: string;
  ownerSessionName?: string;
  /** Exact active occurrence captured before any launch or effect runs. */
  acceptedTrigger?: RunnerEventAcceptedTrigger;
}

export function planCompletionEventSideEffects(
  triggeredEvent: RunnerEventRecord,
  allEvents: RunnerEventRecord[],
  // Full chain agent-id set forwarded to the canonical lifecycle so it can
  // reject prefix-sharing siblings during its live root scan.
  allAgentIds?: string[],
  owner?: { agentId?: string; sessionName?: string },
): EventSideEffectPlan {
  const triggeredPath = allEvents.some((event) => sameExplicitTriggeredEvent(triggeredEvent, event))
    ? triggeredEvent.path
    : undefined;
  const acceptedTrigger = triggeredPath
    ? captureRunnerEventAcceptedTrigger({
      eventsDir: dirname(triggeredPath),
      file: triggeredPath,
      expected: triggeredEvent,
    })
    : undefined;
  return {
    markProcessed: triggeredEvent,
    triggeredPath,
    allAgentIds: uniqueAgentIds(allAgentIds),
    ...(acceptedTrigger ? { acceptedTrigger } : {}),
    ...(owner?.agentId ? { ownerAgentId: owner.agentId } : {}),
    ...(owner?.sessionName ? { ownerSessionName: owner.sessionName } : {}),
  };
}

function uniqueAgentIds(agentIds: string[] | undefined): string[] {
  return Array.from(new Set((agentIds || []).map((id) => id.trim()).filter(Boolean)));
}

/** Read-only ownership query backed by the canonical lifecycle policy. */
export function eventIsOwnedBy(
  owner: RunnerEventRecord,
  candidate: RunnerEventRecord,
  allAgentIds?: string[],
): boolean {
  return eventIsStrictlyOwned(candidate, {
    runId: owner.runId,
    source: owner.source,
    allAgentIds,
  });
}

function sameExplicitTriggeredEvent(owner: RunnerEventRecord, candidate: RunnerEventRecord): boolean {
  return owner.path?.endsWith(".event") === true
    && candidate.path === owner.path
    && Boolean(owner.runId)
    && candidate.runId === owner.runId
    && validEvent(owner)
    && validEvent(candidate)
    && sameBodyFields(owner, candidate);
}

function sameBodyFields(left: RunnerEventRecord, right: RunnerEventRecord): boolean {
  return JSON.stringify(sortedFields(left.fields)) === JSON.stringify(sortedFields(right.fields));
}

function sortedFields(fields: Record<string, string>): Array<[string, string]> {
  return Object.entries(fields).sort(([left], [right]) => left.localeCompare(right));
}

function validEvent(event: RunnerEventRecord): boolean {
  return validateRunnerEventRecord(event).valid;
}
