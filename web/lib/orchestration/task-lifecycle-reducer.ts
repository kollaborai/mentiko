// Pure task lifecycle reducer (Task 2).
//
// reduceTaskLifecycle(state, event) -> { state, effects }. It never reads
// storage, never mutates its input, and never performs side effects. The service
// adapter applies the returned effects. Every one of the 12 declared events has an
// explicit transition (C5: no dead states, no unhandled events).
//
// Contract: docs/orchestration/task-lifecycle-reducer-spec.md
// Corrections C1–C8: docs/superpowers/plans/2026-07-06-task-lifecycle-reducer.md

import type {
  TaskLifecycleEffect,
  TaskLifecycleEvent,
  TaskLifecycleState,
  TaskLifecycleTransition,
} from "./task-lifecycle-types";

/** No transition — echo the current state with no effects. */
function noop(state: TaskLifecycleState): TaskLifecycleTransition {
  return { state, effects: [] };
}

/** Immutable set-add: returns a new array with `value` appended if absent. */
function withValue(list: string[], value: string): string[] {
  return list.includes(value) ? list : [...list, value];
}

/**
 * Gate key for dedup. When reconcile computes a per-run terminal fingerprint we
 * key on it; when only the source run id is known (summary verdicts carry no
 * fingerprint) we key on the run id. Either way one live gate per source run.
 */
function gateKey(sourceRunId: string, fingerprint: string): string {
  return fingerprint || sourceRunId;
}

/**
 * Shared decision-gate creation (summary verdict `decision`, or `retry` once the
 * budget is exhausted). Records the gate key in `gatedFingerprints` in the SAME
 * transition that emits `create_decision_gate`; a later verdict/event carrying the
 * same source reuses the existing gate instead of creating a duplicate (C4).
 */
function createDecisionGate(
  state: TaskLifecycleState,
  sourceRunId: string,
  fingerprint: string,
): TaskLifecycleTransition {
  const key = gateKey(sourceRunId, fingerprint);
  // Reuse existing gate: already gated by fingerprint OR by source run id.
  if (state.gatedFingerprints.includes(key) || state.gatedFingerprints.includes(sourceRunId)) {
    return { state: { ...state, phase: "decision_blocked" }, effects: [] };
  }
  return {
    state: {
      ...state,
      phase: "decision_blocked",
      gatedFingerprints: withValue(state.gatedFingerprints, key),
    },
    effects: [{ type: "create_decision_gate", taskId: state.taskId, sourceRunId, fingerprint }],
  };
}

/** Effects for the common "decision cleared, resume the original task" path (C6). */
function resumeEffects(taskId: string): TaskLifecycleEffect[] {
  return [
    { type: "resume_original_task", taskId },
    { type: "scan_unblocked_auto_run_tasks" },
  ];
}

export function reduceTaskLifecycle(
  state: TaskLifecycleState,
  event: TaskLifecycleEvent,
): TaskLifecycleTransition {
  switch (event.type) {
    // -----------------------------------------------------------------------
    // Pre-execution phase tracking (admission stays external in v1 — no effects)
    // -----------------------------------------------------------------------
    case "analysis.completed": {
      if (event.requiresGeneration) {
        // Recommendation needs a generated chain first — stay analyzing.
        return { state: { ...state, phase: "analyzing" }, effects: [] };
      }
      return {
        state: {
          ...state,
          phase: "chain_ready",
          ...(event.recommendedChainId ? { chainId: event.recommendedChainId } : {}),
        },
        effects: [],
      };
    }

    case "chain.generated": {
      return { state: { ...state, phase: "chain_ready", chainId: event.chainId }, effects: [] };
    }

    // -----------------------------------------------------------------------
    // Execution started (series semantics + concurrency guard C7)
    // -----------------------------------------------------------------------
    case "execution.started": {
      // Concurrency guard: two admissions must not produce two live runs on one id.
      if (state.currentRunStatus === "running") {
        return noop(state);
      }
      // Preserve the retry counter for same-series retry/resume starts; reset only
      // when a genuinely new execution series begins. Resetting on a retry start
      // would erase the counter and the budget would never exhaust (C2/C5).
      const sameSeries = state.phase === "retrying" || state.phase === "resuming";
      return {
        state: {
          ...state,
          phase: "executing",
          currentRunId: event.runId,
          currentRunStatus: "running",
          chainId: event.chainId,
          executionRetryCount: sameSeries ? state.executionRetryCount : 0,
        },
        effects: [],
      };
    }

    // -----------------------------------------------------------------------
    // Execution success
    // -----------------------------------------------------------------------
    case "execution.completed": {
      // Dedup on the terminal fingerprint (reconcile re-polls the same run, C4).
      if (state.summarizedFingerprints.includes(event.fingerprint)) {
        return noop(state);
      }
      return {
        state: {
          ...state,
          phase: "summarizing",
          currentRunId: event.runId,
          currentRunStatus: "completed",
          summarizedFingerprints: withValue(state.summarizedFingerprints, event.fingerprint),
        },
        // Authoritative: the audit MUST use this source run + fingerprint, not
        // metadata.last_run_id.
        effects: [
          { type: "start_outcome_summary", taskId: state.taskId, sourceRunId: event.runId, fingerprint: event.fingerprint },
        ],
      };
    }

    // -----------------------------------------------------------------------
    // Execution failure (retry-before-summary, bounded, idempotent)
    // -----------------------------------------------------------------------
    case "execution.failed": {
      // Idempotent on the terminal fingerprint: a re-polled failed run does
      // nothing once already consumed (retried or summarized).
      if (state.summarizedFingerprints.includes(event.fingerprint)) {
        return noop(state);
      }

      // Non-retryable failures skip retries and summarize immediately.
      if (event.nonRetryable) {
        return {
          state: {
            ...state,
            phase: "summarizing",
            currentRunId: event.runId,
            currentRunStatus: "failed",
            lastError: event.reason,
            summarizedFingerprints: withValue(state.summarizedFingerprints, event.fingerprint),
          },
          effects: [
            { type: "start_outcome_summary", taskId: state.taskId, sourceRunId: event.runId, fingerprint: event.fingerprint },
          ],
        };
      }

      // Budget remaining -> retry (never start a summary while retries remain).
      if (state.executionRetryCount < state.retryBudget) {
        return {
          state: {
            ...state,
            phase: "retrying",
            currentRunId: event.runId,
            currentRunStatus: "failed",
            lastError: event.reason,
            executionRetryCount: state.executionRetryCount + 1,
            // Consume the fingerprint so a re-poll of this same failed run is a no-op.
            summarizedFingerprints: withValue(state.summarizedFingerprints, event.fingerprint),
          },
          effects: [
            { type: "retry_execution", taskId: state.taskId, previousRunId: event.runId, reason: event.reason },
          ],
        };
      }

      // Budget exhausted -> summarize the terminal failure.
      return {
        state: {
          ...state,
          phase: "summarizing",
          currentRunId: event.runId,
          currentRunStatus: "failed",
          lastError: event.reason,
          summarizedFingerprints: withValue(state.summarizedFingerprints, event.fingerprint),
        },
        effects: [
          { type: "start_outcome_summary", taskId: state.taskId, sourceRunId: event.runId, fingerprint: event.fingerprint },
        ],
      };
    }

    // -----------------------------------------------------------------------
    // Summary verdicts (shares executionRetryCount + retryBudget with failures)
    // -----------------------------------------------------------------------
    case "summary.completed": {
      if (event.verdict === "close") {
        return {
          state: { ...state, phase: "closing" },
          effects: [
            { type: "close_task", taskId: state.taskId },
            { type: "scan_unblocked_auto_run_tasks" },
          ],
        };
      }

      if (event.verdict === "retry") {
        // Bounded: increment before the budget check, else success->summary->retry
        // loops forever (nothing else advances the counter on the success path, C2).
        if (state.executionRetryCount < state.retryBudget) {
          return {
            state: { ...state, phase: "retrying", executionRetryCount: state.executionRetryCount + 1 },
            effects: [
              { type: "retry_execution", taskId: state.taskId, previousRunId: event.sourceRunId, reason: "summary requested retry" },
            ],
          };
        }
        // Exhausted -> hand off to a human decision gate instead of looping.
        return createDecisionGate(state, event.sourceRunId, "");
      }

      // verdict === "decision"
      return createDecisionGate(state, event.sourceRunId, "");
    }

    // -----------------------------------------------------------------------
    // Decision gate lifecycle
    // -----------------------------------------------------------------------
    case "decision.created": {
      // Idempotent backfill: if already pointing at this decision and blocked, no-op.
      if (state.decisionTaskId === event.decisionTaskId && state.blockedByTaskIds.includes(event.decisionTaskId)) {
        return noop(state);
      }
      const key = gateKey(event.sourceRunId, event.fingerprint);
      const gated =
        state.gatedFingerprints.includes(key) || state.gatedFingerprints.includes(event.sourceRunId)
          ? state.gatedFingerprints
          : withValue(state.gatedFingerprints, key);
      return {
        state: {
          ...state,
          phase: "decision_blocked",
          decisionTaskId: event.decisionTaskId,
          gatedFingerprints: gated,
          blockedByTaskIds: withValue(state.blockedByTaskIds, event.decisionTaskId),
        },
        effects: [{ type: "block_on_decision", taskId: state.taskId, decisionTaskId: event.decisionTaskId }],
      };
    }

    case "decision.resolved": {
      if (event.followUpTaskIds.length > 0) {
        return {
          state: {
            ...state,
            phase: "followup_blocked",
            decisionTaskId: undefined,
            followUpTaskIds: [...event.followUpTaskIds],
            // Replace the (now-resolved) decision blocker with follow-up blockers.
            blockedByTaskIds: [...event.followUpTaskIds],
          },
          effects: [
            { type: "create_followup_dependencies", taskId: state.taskId, followUpTaskIds: [...event.followUpTaskIds] },
          ],
        };
      }
      // Approve-and-continue: no follow-ups -> resume (C6).
      return {
        state: { ...state, phase: "resuming", decisionTaskId: undefined, blockedByTaskIds: [] },
        effects: resumeEffects(state.taskId),
      };
    }

    case "followups.completed": {
      return {
        state: {
          ...state,
          phase: "resuming",
          decisionTaskId: undefined,
          followUpTaskIds: [],
          blockedByTaskIds: [],
        },
        effects: resumeEffects(state.taskId),
      };
    }

    case "decision.deleted": {
      // Clear the decision pointer and any stale blocked-by references to it.
      const staleIds = [event.decisionTaskId, event.decisionId, state.decisionTaskId].filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      );
      const blockedByTaskIds = state.blockedByTaskIds.filter((id) => !staleIds.includes(id));
      const clearEffect: TaskLifecycleEffect = {
        type: "clear_decision_gate",
        taskId: state.taskId,
        ...(state.decisionTaskId || event.decisionTaskId
          ? { decisionTaskId: state.decisionTaskId ?? event.decisionTaskId }
          : {}),
      };

      // Live follow-up blockers keep the task blocked.
      if (state.followUpTaskIds.length > 0) {
        return {
          state: { ...state, decisionTaskId: undefined, gatedFingerprints: [], blockedByTaskIds },
          effects: [clearEffect],
        };
      }

      // No live blockers: resume when a run is live, otherwise return to idle.
      const resuming = state.currentRunStatus === "running";
      return {
        state: {
          ...state,
          phase: resuming ? "resuming" : "idle",
          decisionTaskId: undefined,
          gatedFingerprints: [],
          blockedByTaskIds,
        },
        effects: resuming
          ? [clearEffect, ...resumeEffects(state.taskId)]
          : [clearEffect, { type: "scan_unblocked_auto_run_tasks" }],
      };
    }

    // -----------------------------------------------------------------------
    // External close
    // -----------------------------------------------------------------------
    case "task.closed": {
      return { state: { ...state, phase: "closed" }, effects: [] };
    }

    default: {
      // Exhaustiveness: every declared event above is handled. If a new event is
      // added to the union without a case here, this line fails to compile.
      const _exhaustive: never = event;
      void _exhaustive;
      return noop(state);
    }
  }
}
