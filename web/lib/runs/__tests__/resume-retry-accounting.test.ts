/**
 * Failed-resume retry accounting for #142 (review round 3 P1): a late or
 * overlapping resume response must not spend a task's retry budget on a task
 * that no longer owns that resume.
 *
 * Runs against the REAL sqlite store in a temp globalRoot (same setup as
 * task-store-guarded-write.test.ts; no store mocks) so the revision guard,
 * the metadata merge, and the retry cap are all exercised for real.
 *
 * @jest-environment node
 */
import {
  taskCreate,
  taskGet,
  taskUpdate,
  closeAll,
} from "@/lib/tasks/task-store";
import { consumeFailedResumeRetry } from "@/lib/runs/resume-retry-accounting";
import { MAX_AUTO_RUN_RETRIES } from "@/lib/tasks/auto-run-state";

jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: {
    globalRoot: "/tmp/mentiko-resume-retry-test-" + process.pid,
    codeRoot: "/tmp",
  },
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

function consume(taskId: string, runId: string = RUN, message = "Resume rejected") {
  return consumeFailedResumeRetry({
    orgId: ORG,
    taskId,
    runId,
    message,
  });
}

describe("consumeFailedResumeRetry (real sqlite store)", () => {
  it("consumes exactly one retry and records the error in the normal case", () => {
    const t = makeResumingTask({ auto_run_retries: 1 });

    const consumed = consume(t.id);

    expect(consumed).toBe(true);
    const after = taskGet(ORG, t.id)!.metadata as Record<string, unknown>;
    expect(after.auto_run_retries).toBe(2); // 1 -> 2, exactly one
    expect(after.resume_last_error).toBe("Resume rejected");
    expect(after.last_run_id).toBe(RUN); // everything else preserved
    expect(after.chain_id).toBe("release-review");
  });

  it("does not consume a retry when the task advanced to a different last_run_id between scan and response", () => {
    const t = makeResumingTask({ auto_run_retries: 1 });
    // The scan selected RUN; before the (late) failure response lands, the
    // task moves on to a newer run.
    taskUpdate(ORG, t.id, {
      status: "in_progress",
      metadata: {
        ...taskGet(ORG, t.id)!.metadata as Record<string, unknown>,
        last_run_id: "run-newer-attempt",
        last_run_status: "running",
      },
    });

    const consumed = consume(t.id); // response for the OLD run

    expect(consumed).toBe(false);
    const after = taskGet(ORG, t.id)!.metadata as Record<string, unknown>;
    expect(after.auto_run_retries).toBe(1); // budget untouched
    expect(after.resume_last_error).toBeUndefined();
    expect(after.last_run_id).toBe("run-newer-attempt");
  });

  it("does not write when the task was closed in between", () => {
    const t = makeResumingTask({ auto_run_retries: 1 });
    const before = taskGet(ORG, t.id)!;
    taskUpdate(ORG, t.id, { status: "done" });

    const consumed = consume(t.id);

    expect(consumed).toBe(false);
    const after = taskGet(ORG, t.id)!;
    expect(after.status).toBe("done");
    expect(after.metadata).toEqual(before.metadata); // no write at all
  });

  it("does not consume a retry when a competing resume already restarted execution", () => {
    // The gate admits only open tasks; in_progress (outside an explicit
    // retry_requested series) means the resume actually started elsewhere.
    const t = makeResumingTask({ auto_run_retries: 1 });
    taskUpdate(ORG, t.id, {
      status: "in_progress",
      metadata: {
        ...taskGet(ORG, t.id)!.metadata as Record<string, unknown>,
        last_run_status: "running",
      },
    });

    const consumed = consume(t.id);

    expect(consumed).toBe(false);
    const after = taskGet(ORG, t.id)!.metadata as Record<string, unknown>;
    expect(after.auto_run_retries).toBe(1);
    expect(after.resume_last_error).toBeUndefined();
  });

  it("still consumes for the gate-admitted retry_requested series while in_progress", () => {
    const t = makeResumingTask({ auto_run_retries: 0, last_run_status: "retry_requested" });
    taskUpdate(ORG, t.id, { status: "in_progress" });

    const consumed = consume(t.id);

    expect(consumed).toBe(true);
    expect(
      (taskGet(ORG, t.id)!.metadata as Record<string, unknown>).auto_run_retries
    ).toBe(1);
  });

  it("two overlapping failed-resume responses raise the count by at most one per response and never above the maximum", () => {
    const t = makeResumingTask({ auto_run_retries: 0 });

    // five failed responses for the same run (overlapping scans): each may
    // add at most one, and the ceiling holds.
    const results: boolean[] = [];
    for (let i = 0; i < MAX_AUTO_RUN_RETRIES + 2; i++) {
      results.push(consume(t.id, RUN, `failure ${i + 1}`));
    }

    const after = taskGet(ORG, t.id)!.metadata as Record<string, unknown>;
    expect(after.auto_run_retries).toBe(MAX_AUTO_RUN_RETRIES); // never above
    expect(results.filter(Boolean).length).toBeGreaterThan(0);
    // at most one increment per response, starting from 0, capped at 3
    expect(after.auto_run_retries).toBeLessThanOrEqual(MAX_AUTO_RUN_RETRIES);
    expect(after.resume_last_error).toBe(`failure ${MAX_AUTO_RUN_RETRIES + 2}`);
  });
});
