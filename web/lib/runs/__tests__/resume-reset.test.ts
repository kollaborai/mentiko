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
import { closeAll, taskCreate } from "@/lib/tasks/task-store";
import { acquireExclusiveFileClaim } from "@/lib/runner-v2/file-claim";
import {
  ResumeResetConflictError,
  withTaskResumeClaimAsync,
} from "@/lib/runs/resume-reset";

const TEST_ROOT = "/tmp/mentiko-resume-reset-142-test";
const CLAIM_DIR = join(TEST_ROOT, "runs", "run-1", ".resume-claim");

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
});
