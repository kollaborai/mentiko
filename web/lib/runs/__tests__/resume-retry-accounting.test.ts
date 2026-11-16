/**
 * Resume-attempt identity + failed-resume retry accounting for #142
 * (review round 4 P1): every scan stamps a fresh attempt id before sending
 * the resume, and a failure response charges budget only when its attempt id
 * is still the current one — so late, overlapping, or post-reset responses
 * cannot spend a task's retry budget.
 *
 * Runs against the REAL sqlite store in a temp globalRoot (same setup as
 * task-store-guarded-write.test.ts; no store mocks except where a test
 * explicitly spies taskMutateMetadata to force a store failure) so the
 * revision guard, the metadata merge, and the retry cap are all exercised
 * for real.
 *
 * @jest-environment node
 */
import {
  taskCreate,
  taskGet,
  taskUpdate,
  closeAll,
} from "@/lib/tasks/task-store";
import {
  consumeFailedResumeRetry,
  stampResumeAttempt,
  RESUME_ATTEMPT_ID_KEY,
  RESUME_ATTEMPT_RUN_KEY,
} from "@/lib/runs/resume-retry-accounting";
import { MAX_AUTO_RUN_RETRIES } from "@/lib/tasks/auto-run-state";

jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: {
    globalRoot: "/tmp/mentiko-resume-retry-test-" + process.pid,
    codeRoot: "/tmp",
  },
}));

// Real store, with taskMutateMetadata routed through a delegating jest.fn so
// tests can inject store failures for the accounting_failed cases; every
// other export (and the default behavior) is the real one.
const actualTaskStore = jest.requireActual("@/lib/tasks/task-store");
const mockTaskMutateMetadata = jest.fn(actualTaskStore.taskMutateMetadata);
jest.mock("@/lib/tasks/task-store", () => ({
  ...jest.requireActual("@/lib/tasks/task-store"),
  taskMutateMetadata: (...args: unknown[]) =>
    mockTaskMutateMetadata(...(args as Parameters<typeof actualTaskStore.taskMutateMetadata>)),
}));

afterAll(() => {
  closeAll();
});

const ORG = "retry-org";
const RUN = "run-1794775591879-b2676ce3";

function makeResumingTask(metadata: Record<string, unknown> = {}) {
  return taskCreate(ORG, {
    title: "resume accounting",
    metadata: {
      auto_run: true,
      chain_id: "release-review",
      last_run_id: RUN,
      last_run_status: "failed",
      auto_run_retries: 0,
      ...metadata,
    },
  });
}

function metaOf(taskId: string): Record<string, unknown> {
  return taskGet(ORG, taskId)!.metadata as Record<string, unknown>;
}

function stamp(taskId: string, runId: string = RUN) {
  return stampResumeAttempt({ orgId: ORG, taskId, runId });
}

function consume(
  taskId: string,
  attemptId: string,
  runId: string = RUN,
  message = "Resume rejected"
) {
  return consumeFailedResumeRetry({
    orgId: ORG,
    taskId,
    runId,
    attemptId,
    message,
  });
}

describe("stampResumeAttempt (real sqlite store)", () => {
  it("stamps a fresh attempt id tied to the run and reports ok", () => {
    const t = makeResumingTask();

    const s = stamp(t.id);

    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const after = metaOf(t.id);
    expect(after[RESUME_ATTEMPT_ID_KEY]).toBe(s.attemptId);
    expect(after[RESUME_ATTEMPT_RUN_KEY]).toBe(RUN);
    expect(after.auto_run_retries).toBe(0); // stamping spends nothing
  });

  it("stamps a NEW id per call, superseding the previous attempt", () => {
    const t = makeResumingTask();

    const first = stamp(t.id);
    const second = stamp(t.id);

    expect(first.ok && second.ok).toBe(true);
    expect(metaOf(t.id)[RESUME_ATTEMPT_ID_KEY]).toBe(
      second.ok ? second.attemptId : undefined
    );
  });

  it("refuses to stamp when the task advanced to a different run", () => {
    const t = makeResumingTask();
    taskUpdate(ORG, t.id, {
      metadata: {
        ...metaOf(t.id),
        last_run_id: "run-newer-attempt",
        last_run_status: "running",
      },
    });

    const s = stamp(t.id); // the scan's selection was the OLD run

    expect(s).toEqual({ ok: false, stale: true });
    expect(metaOf(t.id)[RESUME_ATTEMPT_ID_KEY]).toBeUndefined();
  });

  it("reports a store failure truthfully instead of stale", () => {
    const t = makeResumingTask();
    mockTaskMutateMetadata.mockReturnValueOnce({ ok: false });

    const s = stamp(t.id);

    expect(s).toEqual({
      ok: false,
      stale: false,
      error: "compare-and-set attempts exhausted or task vanished",
    });
  });
});

describe("consumeFailedResumeRetry (real sqlite store)", () => {
  it("charges exactly one retry for the normal single attempt and clears the stamp", () => {
    const t = makeResumingTask({ auto_run_retries: 1 });
    const s = stamp(t.id);
    if (!s.ok) throw new Error("stamp failed");

    const result = consume(t.id, s.attemptId);

    expect(result).toEqual({ outcome: "consumed" });
    const after = metaOf(t.id);
    expect(after.auto_run_retries).toBe(2); // 1 -> 2, exactly one
    expect(after.resume_last_error).toBe("Resume rejected");
    expect(after.last_run_id).toBe(RUN); // everything else preserved
    expect(after.chain_id).toBe("release-review");
    expect(after[RESUME_ATTEMPT_ID_KEY]).toBeUndefined(); // stamp retired
  });

  it("does not charge a failure response carrying an older attempt id after a newer attempt was stamped", () => {
    const t = makeResumingTask({ auto_run_retries: 0 });
    const older = stamp(t.id);
    const newer = stamp(t.id); // a newer scan re-attempted the resume
    if (!older.ok || !newer.ok) throw new Error("stamp failed");

    const result = consume(t.id, older.attemptId); // the OLD attempt's response lands late

    expect(result).toEqual({ outcome: "superseded" });
    const after = metaOf(t.id);
    expect(after.auto_run_retries).toBe(0); // budget untouched
    expect(after.resume_last_error).toBeUndefined();
    expect(after[RESUME_ATTEMPT_ID_KEY]).toBe(newer.attemptId); // fence intact
  });

  it("does not charge a failure response arriving after a retry reset cleared the stamp (Retry task shape)", () => {
    const t = makeResumingTask({ auto_run_retries: 2 });
    const s = stamp(t.id);
    if (!s.ok) throw new Error("stamp failed");

    // "Retry task": budget reset AND attempt identity retired while the
    // response was in flight (the page PATCHes both as nulls).
    taskUpdate(ORG, t.id, {
      metadata: {
        ...metaOf(t.id),
        auto_run_retries: 0,
        resume_last_error: null,
        [RESUME_ATTEMPT_ID_KEY]: null,
        [RESUME_ATTEMPT_RUN_KEY]: null,
      },
    });

    const result = consume(t.id, s.attemptId); // pre-reset response lands now

    expect(result).toEqual({ outcome: "superseded" });
    expect(metaOf(t.id).auto_run_retries).toBe(0); // fresh series intact
  });

  it("three overlapping stale responses cannot exhaust a fresh series", () => {
    const t = makeResumingTask({ auto_run_retries: 0 });
    const stale = stamp(t.id); // attempt 1 goes stale when the task is reset
    if (!stale.ok) throw new Error("stamp failed");
    taskUpdate(ORG, t.id, {
      metadata: {
        ...metaOf(t.id),
        auto_run_retries: 0,
        [RESUME_ATTEMPT_ID_KEY]: null,
        [RESUME_ATTEMPT_RUN_KEY]: null,
      },
    });

    const results = [
      consume(t.id, stale.attemptId, RUN, "stale 1"),
      consume(t.id, stale.attemptId, RUN, "stale 2"),
      consume(t.id, stale.attemptId, RUN, "stale 3"),
    ];

    expect(results.every((r) => r.outcome === "superseded")).toBe(true);
    const after = metaOf(t.id);
    expect(after.auto_run_retries).toBe(0); // series not exhausted
    expect(after.resume_last_error).toBeUndefined();
  });

  it("does not charge a duplicate delivery of the same attempt after it already charged", () => {
    const t = makeResumingTask({ auto_run_retries: 0 });
    const s = stamp(t.id);
    if (!s.ok) throw new Error("stamp failed");

    expect(consume(t.id, s.attemptId, RUN, "first delivery")).toEqual({ outcome: "consumed" });
    expect(consume(t.id, s.attemptId, RUN, "duplicate delivery")).toEqual({ outcome: "superseded" });
    expect(metaOf(t.id).auto_run_retries).toBe(1); // exactly one for the attempt
    expect(metaOf(t.id).resume_last_error).toBe("first delivery");
  });

  it("does not consume a retry when the task advanced to a different last_run_id between scan and response", () => {
    const t = makeResumingTask({ auto_run_retries: 1 });
    const s = stamp(t.id);
    if (!s.ok) throw new Error("stamp failed");
    taskUpdate(ORG, t.id, {
      status: "in_progress",
      metadata: {
        ...metaOf(t.id),
        last_run_id: "run-newer-attempt",
        last_run_status: "running",
      },
    });

    const result = consume(t.id, s.attemptId); // response for the OLD run

    expect(result).toEqual({ outcome: "superseded" });
    const after = metaOf(t.id);
    expect(after.auto_run_retries).toBe(1); // budget untouched
    expect(after.resume_last_error).toBeUndefined();
    expect(after.last_run_id).toBe("run-newer-attempt");
  });

  it("does not write when the task was closed in between", () => {
    const t = makeResumingTask({ auto_run_retries: 1 });
    const s = stamp(t.id);
    if (!s.ok) throw new Error("stamp failed");
    const before = taskGet(ORG, t.id)!;
    taskUpdate(ORG, t.id, { status: "done" });

    const result = consume(t.id, s.attemptId);

    expect(result).toEqual({ outcome: "superseded" });
    const after = taskGet(ORG, t.id)!;
    expect(after.status).toBe("done");
    expect(after.metadata).toEqual(before.metadata); // no write at all
  });

  it("does not consume a retry when a competing resume already restarted execution", () => {
    const t = makeResumingTask({ auto_run_retries: 1 });
    const s = stamp(t.id);
    if (!s.ok) throw new Error("stamp failed");
    taskUpdate(ORG, t.id, {
      status: "in_progress",
      metadata: {
        ...metaOf(t.id),
        last_run_status: "running",
      },
    });

    const result = consume(t.id, s.attemptId);

    expect(result).toEqual({ outcome: "superseded" });
    const after = metaOf(t.id);
    expect(after.auto_run_retries).toBe(1);
    expect(after.resume_last_error).toBeUndefined();
  });

  it("still consumes for the gate-admitted retry_requested series while in_progress", () => {
    const t = makeResumingTask({ auto_run_retries: 0, last_run_status: "retry_requested" });
    taskUpdate(ORG, t.id, { status: "in_progress" });
    const s = stamp(t.id);
    if (!s.ok) throw new Error("stamp failed");

    const result = consume(t.id, s.attemptId);

    expect(result).toEqual({ outcome: "consumed" });
    expect(metaOf(t.id).auto_run_retries).toBe(1);
  });

  it("two overlapping failed-resume responses raise the count by at most one per CURRENT attempt and never above the maximum", () => {
    const t = makeResumingTask({ auto_run_retries: 0 });

    // each scan stamps its own attempt; only the response matching the
    // current attempt may charge, and the cap holds.
    let lastOutcome: string = "";
    for (let i = 0; i < MAX_AUTO_RUN_RETRIES + 2; i++) {
      const s = stamp(t.id);
      if (!s.ok) throw new Error("stamp failed");
      const r = consume(t.id, s.attemptId, RUN, `failure ${i + 1}`);
      lastOutcome = r.outcome;
    }

    const after = metaOf(t.id);
    expect(after.auto_run_retries).toBe(MAX_AUTO_RUN_RETRIES); // never above
    expect(lastOutcome).toBe("consumed"); // clamped writes still report consumed
    expect(after.resume_last_error).toBe(`failure ${MAX_AUTO_RUN_RETRIES + 2}`);
  });

  it("reports accounting_failed (not superseded) when the store throws", () => {
    const t = makeResumingTask({ auto_run_retries: 0 });
    const s = stamp(t.id);
    if (!s.ok) throw new Error("stamp failed");
    mockTaskMutateMetadata.mockImplementationOnce(() => {
      throw new Error("sqlite: disk I/O error");
    });

    const result = consume(t.id, s.attemptId);

    expect(result).toEqual({
      outcome: "accounting_failed",
      error: "sqlite: disk I/O error",
    });
    expect(metaOf(t.id).auto_run_retries).toBe(0); // nothing charged
  });

  it("reports accounting_failed (not superseded) when every compare-and-set attempt loses the race", () => {
    const t = makeResumingTask({ auto_run_retries: 0 });
    const s = stamp(t.id);
    if (!s.ok) throw new Error("stamp failed");
    mockTaskMutateMetadata.mockReturnValueOnce({ ok: false });

    const result = consume(t.id, s.attemptId);

    expect(result).toEqual({
      outcome: "accounting_failed",
      error: "compare-and-set attempts exhausted or task vanished",
    });
  });
});
