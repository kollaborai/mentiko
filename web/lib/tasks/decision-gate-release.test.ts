/**
 * W3 — a re-opened task gets re-admitted, and STAYS re-admitted
 * (stall-killer spec v2).
 *
 * Driven by TASK-003's exact parked metadata, captured live on 2026-08-10.
 * Its decision had resolved (lifecycle_phase "resuming") but the task sat
 * open-and-unadmittable indefinitely: the reconciler's provenance repair
 * re-applied the audited "decision" verdict on every pass and re-raised
 * last_run_decision_required, which the admission gate reads.
 *
 * The gates here are the producer's, not the admission gate's — the admission
 * gate was always correct.
 *
 * @jest-environment node
 */
/**
 * Admission falls back to a runs-directory scan when a task carries no scope.
 * Pointed at the real ~/.mentiko it reads whatever runs happen to exist, so the
 * verdict depends on what else ran that day. This suite owns an empty runs dir.
 */
jest.mock("@/lib/config", () => {
  const actual = jest.requireActual("@/lib/config");
  const fs = jest.requireActual("fs");
  const os = jest.requireActual("os");
  const path = jest.requireActual("path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "decision-gate-release-"));
  // The runs-dir scan resolves through nsPath(), not config.runsDir, so BOTH
  // have to point into the empty root or the real ~/.mentiko leaks back in.
  const nsPath = (namespaceId: string, ...segments: string[]) =>
    path.join(root, "namespaces", namespaceId || "default", ...segments);
  const runsDir = nsPath("default", "runs");
  fs.mkdirSync(runsDir, { recursive: true });
  // __esModule is non-enumerable, so the spread drops it and the default-import
  // interop re-wraps the whole namespace as `config`. It has to be restated.
  return { __esModule: true, ...actual, nsPath, default: { ...actual.default, runsDir } };
});

import { describe, it, expect } from "@jest/globals";
import { canAdmitAutoRun } from "@/lib/runs/auto-run";
import { hydrateLifecycleState } from "@/lib/orchestration/task-lifecycle-hydrate";
import {
  isDecisionGateReleased,
  releaseDecisionGateMetadata,
  DECISION_GATE_RELEASED_RUN_ID_KEY,
} from "@/lib/tasks/decision-gate-release";
import { TASK_RUN_SCOPE_METADATA_KEY } from "@/lib/tasks/task-run-locator";
import { TASK_003_PARKED_METADATA } from "@/lib/tasks/__fixtures__/task-003-parked-metadata";
import type { TaskRecord } from "@/lib/tasks/task-store-types";

const TASK_ID = "TASK-003";
const AUDITED_RUN_ID = "run-1786312693207-a97afcf7";



function taskWith(metadata: Record<string, unknown>): TaskRecord {
  return {
    id: TASK_ID,
    org_id: "default",
    title: "Validate BUG-002 regression tests still pass after revert",
    status: "open",
    issue_type: "task",
    priority: 2,
    metadata,
  } as unknown as TaskRecord;
}

/**
 * What the task store actually persists. taskUpdate does
 * `JSON.stringify(metadata)`, so keys reduced to `undefined` are DROPPED — and
 * that distinction is load-bearing here: resolveScopedTaskRun gates on
 * `TASK_RUN_SCOPE_METADATA_KEY in metadata`, and `in` is true for a key whose
 * value is undefined. Asserting on the unpersisted object would test a shape
 * that never reaches the database.
 */
function persist(metadata: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>;
}

/** One admission tick, with auto-run on at the workspace default. */
function admit(metadata: Record<string, unknown>) {
  return canAdmitAutoRun(taskWith(persist(metadata)), "default", "default", true);
}

/**
 * A reconcile/hydrate pass over the task: derive lifecycle state from the
 * persisted metadata and write back what that reduction produces, exactly as
 * the reconciler's lifecycle writer does.
 */
function hydratePass(metadata: Record<string, unknown>): Record<string, unknown> {
  const state = hydrateLifecycleState(TASK_ID, metadata);
  return {
    ...metadata,
    lifecycle_phase: state.phase,
    execution_retries: state.executionRetryCount,
    gated_run_fingerprints: state.gatedFingerprints,
    summarized_run_fingerprints: state.summarizedFingerprints,
    followup_task_ids: state.followUpTaskIds,
    decision_subtask_id: state.decisionTaskId,
    last_run_decision_required: state.phase === "followup_blocked" || state.phase === "decision_blocked",
  };
}

/** The reconciler's provenance-repair predicate for an audited "decision". */
function reconcilerWouldReapplyVerdict(metadata: Record<string, unknown>): boolean {
  if (
    metadata.last_audit_verdict === "decision" &&
    isDecisionGateReleased(metadata, metadata.completion_audit_run_id)
  ) {
    return false;
  }
  return (
    (metadata.last_audit_verdict === "close" || metadata.last_audit_verdict === "decision") &&
    metadata.completion_audit_apply_status === "applied" &&
    typeof metadata.completion_audit_run_id === "string"
  );
}

describe("the parked state, reproduced", () => {
  it("is blocked by the decision gate — the live symptom", () => {
    expect(admit(TASK_003_PARKED_METADATA)).toMatchObject({
      admit: false,
      action: "decision_required",
    });
  });

  it("had already resolved its decision — the state was self-contradictory", () => {
    expect(TASK_003_PARKED_METADATA.lifecycle_phase).toBe("resuming");
    expect(TASK_003_PARKED_METADATA.last_run_decision_required).toBe(true);
  });

  it("was selected by the repair loop that kept re-raising the gate", () => {
    expect(reconcilerWouldReapplyVerdict(TASK_003_PARKED_METADATA)).toBe(true);
  });
});

describe("releasing the gate", () => {
  const released = releaseDecisionGateMetadata(TASK_003_PARKED_METADATA, {
    taskId: TASK_ID,
    sourceRunId: AUDITED_RUN_ID,
  });

  it("admits the task on the very next tick", () => {
    expect(admit(released)).toMatchObject({ admit: true });
  });

  it("clears the scope and the run pointer TOGETHER — a partial clear is worse", () => {
    // scope present + last_run_id absent trips "task run scope is invalid",
    // so both must be gone from the PERSISTED record, not merely undefined.
    const stored = persist(released);
    expect(TASK_RUN_SCOPE_METADATA_KEY in stored).toBe(false);
    expect("last_run_id" in stored).toBe(false);
    expect(stored.last_run_decision_required).toBe(false);
  });

  it("records WHICH run's gate is spent", () => {
    expect(released[DECISION_GATE_RELEASED_RUN_ID_KEY]).toBe(AUDITED_RUN_ID);
    expect(isDecisionGateReleased(released, AUDITED_RUN_ID)).toBe(true);
  });

  it("leaves completion_audit_* untouched so audited closes stay terminal", () => {
    expect(released.completion_audit_run_id).toBe(TASK_003_PARKED_METADATA.completion_audit_run_id);
    expect(released.completion_audit_apply_status).toBe("applied");
    expect(released.last_audit_verdict).toBe("decision");
  });

  it("stops the repair loop from re-applying the verdict", () => {
    expect(reconcilerWouldReapplyVerdict(released)).toBe(false);
  });

  it("STAYS admitted through a hydrate/reconcile pass — the durability gate", () => {
    let metadata = released;
    for (let pass = 0; pass < 3; pass++) {
      metadata = persist(hydratePass(metadata));
      expect(admit(metadata)).toMatchObject({ admit: true });
      expect(reconcilerWouldReapplyVerdict(metadata)).toBe(false);
    }
  });
});

describe("the release stays narrow", () => {
  it("does not release a gate raised by a DIFFERENT, newer run", () => {
    const released = releaseDecisionGateMetadata(TASK_003_PARKED_METADATA, {
      taskId: TASK_ID,
      sourceRunId: AUDITED_RUN_ID,
    });
    // A genuinely new execution is audited and parks the task again.
    const reAudited = {
      ...released,
      last_audit_verdict: "decision",
      completion_audit_apply_status: "applied",
      completion_audit_run_id: "run-newer-9999",
      last_run_id: "run-newer-9999",
      last_run_status: "completed",
      last_run_decision_required: true,
    };
    expect(isDecisionGateReleased(reAudited, "run-newer-9999")).toBe(false);
    expect(reconcilerWouldReapplyVerdict(reAudited)).toBe(true);
    expect(admit(reAudited)).toMatchObject({ admit: false, action: "decision_required" });
  });

  it("treats a missing or non-string audited run id as not-released", () => {
    for (const value of [undefined, null, 42, ""]) {
      expect(isDecisionGateReleased({ [DECISION_GATE_RELEASED_RUN_ID_KEY]: "r1" }, value)).toBe(false);
    }
  });

  it("does not claim release when nothing was ever released", () => {
    expect(isDecisionGateReleased(TASK_003_PARKED_METADATA, AUDITED_RUN_ID)).toBe(false);
  });
});
