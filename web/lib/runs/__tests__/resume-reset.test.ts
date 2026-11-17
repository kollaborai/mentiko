/**
 * @jest-environment node
 *
 * Issue #142 round 3: the reset fence's claim helpers. The async claim never
 * falls back to an unserialized write, waits without holding the task, and a
 * busy claim past its budget is a visible retryable conflict.
 */

jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: { globalRoot: "/tmp/mentiko-resume-reset-142-test" },
  nsPath: (nsId: string) => `/tmp/mentiko-resume-reset-142-test/namespaces/${nsId}`,
  orgPath: (nsId: string, orgId: string, ...rest: string[]) =>
    `/tmp/mentiko-resume-reset-142-test/namespaces/${nsId}/orgs/${orgId}${rest.length ? `/${rest.join("/")}` : ""}`,
}));

jest.mock("@/lib/links/link-run-runtime", () => ({
  resolveLinkRunsDir: () => `/tmp/mentiko-resume-reset-142-test/runs`,
}));

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { closeAll, taskCreate, taskMutateMetadata } from "@/lib/tasks/task-store";
import { acquireExclusiveFileClaim } from "@/lib/runner-v2/file-claim";
import {
  ResumeResetConflictError,
  withTaskResumeClaimAsync,
} from "@/lib/runs/resume-reset";

const TEST_ROOT = "/tmp/mentiko-resume-reset-142-test";
const CLAIM_DIR = join(TEST_ROOT, "runs", "run-1", ".resume-claim");
const claimDirFor = (runId: string) => join(TEST_ROOT, "runs", runId, ".resume-claim");

function repointTask(taskId: string, runId: string): void {
  taskMutateMetadata("default", taskId, (metadata) => ({ ...metadata, last_run_id: runId }));
}

function seedTaskPointingAtRun1(): string {
  return taskCreate("default", {
    title: "t",
    issue_type: "task",
    metadata: { last_run_id: "run-1", resume_series: 2 },
  }, "default").id;
}

beforeEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(join(TEST_ROOT, "runs"), { recursive: true });
  closeAll();
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  closeAll();
});

describe("withTaskResumeClaimAsync", () => {
  it("runs the guarded write while HOLDING the claim", async () => {
    const taskId = seedTaskPointingAtRun1();
    let heldDuringWrite = false;
    await withTaskResumeClaimAsync({ orgId: "default", taskId }, () => {
      heldDuringWrite = existsSync(CLAIM_DIR);
      return 42;
    });
    expect(heldDuringWrite).toBe(true);
    expect(existsSync(CLAIM_DIR)).toBe(false);
  });

  it("a busy claim past its budget is a visible conflict and fn NEVER runs (no unserialized fallback)", async () => {
    const taskId = seedTaskPointingAtRun1();
    const release = acquireExclusiveFileClaim(CLAIM_DIR, { pid: process.pid });
    let ran = false;
    try {
      await expect(withTaskResumeClaimAsync(
        { orgId: "default", taskId },
        () => { ran = true; return 1; },
        { waitTimeoutMs: 80, retryDelayMs: 20 },
      )).rejects.toBeInstanceOf(ResumeResetConflictError);
    } finally {
      release();
    }
    expect(ran).toBe(false);
  });

  it("waits asynchronously for a live claim and proceeds once it is released", async () => {
    const taskId = seedTaskPointingAtRun1();
    const release = acquireExclusiveFileClaim(CLAIM_DIR, { pid: process.pid });
    const attempt = withTaskResumeClaimAsync(
      { orgId: "default", taskId },
      () => "landed",
      { waitTimeoutMs: 2_000, retryDelayMs: 10 },
    );
    // release shortly after: the async wait must cover it, not 409
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    await expect(attempt).resolves.toBe("landed");
  });

  it("a task with no current run runs directly, without touching any claim", async () => {
    const taskId = taskCreate("default", { title: "t", issue_type: "task", metadata: {} }, "default").id;
    await expect(withTaskResumeClaimAsync({ orgId: "default", taskId }, () => "ok")).resolves.toBe("ok");
    expect(existsSync(TEST_ROOT)).toBe(true); // untouched beyond the seeded root
  });

  it("a task re-pointed while the caller waits: fn runs holding the CURRENT run's claim (#142 round 5)", async () => {
    const taskId = seedTaskPointingAtRun1();
    const release = acquireExclusiveFileClaim(CLAIM_DIR, { pid: process.pid });
    let claimStateDuringFn: string[] = [];
    const attempt = withTaskResumeClaimAsync(
      { orgId: "default", taskId },
      () => {
        claimStateDuringFn = [
          existsSync(CLAIM_DIR) ? "run-1" : "absent",
          existsSync(claimDirFor("run-2")) ? "run-2" : "absent",
        ];
        return "landed";
      },
      { waitTimeoutMs: 5_000, retryDelayMs: 10 },
    );
    // while the caller waits on run-1's claim, another replacement repoints
    // the task at run-2 and lets run-1's claim go
    await new Promise((resolve) => setTimeout(resolve, 60));
    repointTask(taskId, "run-2");
    release();
    await expect(attempt).resolves.toBe("landed");
    // fn ran holding run-2's claim, not the stale run-1 claim
    expect(claimStateDuringFn).toEqual(["absent", "run-2"]);
    expect(existsSync(claimDirFor("run-2"))).toBe(false);
  });

  it("three pointer changes in a row: a visible conflict and fn NEVER runs (#142 round 5)", async () => {
    const taskId = seedTaskPointingAtRun1();
    // hold every claim the caller will hop through, so each pointer change
    // is observed while it waits for the NEXT run's claim
    const releases = ["run-1", "run-2", "run-3"].map((runId) =>
      acquireExclusiveFileClaim(claimDirFor(runId), { pid: process.pid }));
    let ran = false;
    const attempt = withTaskResumeClaimAsync(
      { orgId: "default", taskId },
      () => { ran = true; return 1; },
      { waitTimeoutMs: 10_000, retryDelayMs: 10 },
    );
    // the rejection lands while the steps below are awaited; keep it handled
    attempt.catch(() => {});
    const step = (to: string, release: () => void) => new Promise<void>((resolve) => {
      repointTask(taskId, to);
      release();
      setTimeout(resolve, 120);
    });
    await step("run-2", releases[0]);
    await step("run-3", releases[1]);
    await step("run-4", releases[2]);
    await expect(attempt).rejects.toBeInstanceOf(ResumeResetConflictError);
    expect(ran).toBe(false);
  });
});
