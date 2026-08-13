// W1 item 4 — un-park tasks when the thing they were waiting for arrives.
//
// A task parked as `attention_required` with reason `catalog_unchanged` is
// waiting on exactly one event: a chain appearing that it could reuse. Polling
// for that would burn scans on a condition that changes only on chain
// creation, so the chain-save door calls this instead. No new service.

import { taskList, taskUpdate } from "@/lib/tasks/task-store";
import {
  FALLBACK_PARK_CATALOG_UNCHANGED,
  GENERATION_CATALOG_DIGEST_KEY,
  GENERATION_FALLBACK_STATE_KEY,
} from "@/lib/tasks/generation-exhaustion-fallback";

function metadataOf(task: { metadata?: unknown }): Record<string, unknown> {
  const raw = task.metadata;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* unreadable metadata is treated as absent */
    }
  }
  return {};
}

/**
 * Release tasks parked only because the catalog had nothing new.
 *
 * The release is narrow on purpose: it clears the park and asks the task to
 * take the EXISTING-ONLY question again (a new chain is exactly what makes
 * that question answerable). Generation stays exhausted — the rejection
 * fingerprints are left intact, so a repeat artifact still stops on sight.
 *
 * Tasks parked because a fallback ran and found nothing are NOT released here:
 * they already got their answer against a catalog that included real
 * candidates, so they wait for a human.
 */
export async function reconsiderAttentionRequiredTasks(
  namespaceId: string,
  orgId: string,
): Promise<{ released: string[] }> {
  const released: string[] = [];
  let candidates: ReturnType<typeof taskList>;
  try {
    candidates = taskList(orgId, undefined, undefined, namespaceId);
  } catch {
    return { released };
  }

  for (const task of candidates) {
    const metadata = metadataOf(task);
    if (metadata[GENERATION_FALLBACK_STATE_KEY] !== "attention_required") continue;
    if (metadata.generation_attention_reason !== FALLBACK_PARK_CATALOG_UNCHANGED) continue;

    try {
      taskUpdate(orgId, task.id, {
        metadata: {
          ...metadata,
          [GENERATION_FALLBACK_STATE_KEY]: undefined,
          [GENERATION_CATALOG_DIGEST_KEY]: undefined,
          generation_attention_reason: undefined,
          generation_attention_detail: undefined,
          generation_attention_at: undefined,
          generation_stop_reason: undefined,
          // Reuse is the only question a new chain can answer; generation for
          // this task is still spent.
          generation_existing_only: true,
          analysis_job_id: undefined,
          analysis_status: undefined,
          analysis_job_claimed_at: undefined,
        },
      }, namespaceId);
      released.push(task.id);
    } catch {
      /* a task that fails to release stays parked; manual recovery still works */
    }
  }

  return { released };
}
