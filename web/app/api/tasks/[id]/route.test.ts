/**
 * @jest-environment node
 *
 * Issue #142 round 2: a reset is a real generation fence. PATCH
 * /api/tasks/[id] computes resume_series ON THE SERVER under the run's
 * .resume-claim — a client snapshot value is ignored, and a live resume
 * holding the claim turns the reset into a visible retryable conflict.
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: {
    globalRoot: "/tmp/mentiko-task-patch-142-test",
  },
  nsPath: (nsId: string) => `/tmp/mentiko-task-patch-142-test/namespaces/${nsId}`,
  orgPath: (nsId: string, orgId: string, ...rest: string[]) =>
    `/tmp/mentiko-task-patch-142-test/namespaces/${nsId}/orgs/${orgId}${rest.length ? `/${rest.join("/")}` : ""}`,
}));

jest.mock("@/lib/auth/api-auth", () => ({
  requirePermission: () => (handler: unknown) => handler,
}));

jest.mock("@/lib/middleware", () => ({
  enforceGuestWrites: async () => undefined,
}));

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: async () => "default",
  getOrgIdFromRequest: async () => "default",
}));

jest.mock("@/lib/links/link-run-runtime", () => ({
  resolveLinkRunsDir: () => `/tmp/mentiko-task-patch-142-test/runs`,
}));

import { PATCH } from "./route";
import { closeAll, taskCreate, taskGet } from "@/lib/tasks/task-store";
import { acquireExclusiveFileClaim } from "@/lib/runner-v2/file-claim";

const TEST_ROOT = "/tmp/mentiko-task-patch-142-test";

function seedTask(metadata: Record<string, unknown>): string {
  return taskCreate("default", { title: "t", issue_type: "task", metadata }, "default").id;
}

function patchRequest(id: string, body: unknown): Request {
  return new Request(`http://localhost:3200/api/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function metadataOf(taskId: string): Record<string, unknown> {
  return taskGet("default", taskId, "default")!.metadata as Record<string, unknown>;
}

beforeEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(TEST_ROOT, { recursive: true });
  closeAll();
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  closeAll();
});

describe("PATCH /api/tasks/[id] resume-series reset fence", () => {
  it("increments resume_series on the SERVER: two resets from the same stale snapshot produce distinct series", async () => {
    const taskId = seedTask({ auto_run: true, last_run_id: "run-1", resume_series: 3, auto_run_retries: 2 });

    // Both requests carry the SAME stale client snapshot (series computed as
    // 4 from the pre-reset row); the server must ignore the value entirely.
    const staleBody = {
      metadata: JSON.stringify({
        auto_run: true,
        auto_run_retries: 0,
        resume_last_error: null,
        resume_series: 4,
      }),
    };
    const first = await PATCH(
      patchRequest(taskId, staleBody) as never,
      { params: Promise.resolve({ id: taskId }) } as never,
    );
    expect(first.status).toBe(200);
    expect(metadataOf(taskId).resume_series).toBe(4);

    const second = await PATCH(
      patchRequest(taskId, staleBody) as never,
      { params: Promise.resolve({ id: taskId }) } as never,
    );
    expect(second.status).toBe(200);
    expect(metadataOf(taskId).resume_series).toBe(5);
  });

  it("an explicit metadata clear still fences: the series survives and increments instead of resetting to 0", async () => {
    const taskId = seedTask({ auto_run: true, last_run_id: "run-1", resume_series: 7 });

    const res = await PATCH(
      patchRequest(taskId, { metadata: "{}" }) as never,
      { params: Promise.resolve({ id: taskId }) } as never,
    );
    expect(res.status).toBe(200);
    const metadata = metadataOf(taskId);
    expect(metadata.resume_series).toBe(8);
    expect(metadata.auto_run).toBeUndefined();
  });

  it("returns a visible retryable conflict when a resume holds the run's claim, and writes nothing", async () => {
    jest.setTimeout(20_000);
    const taskId = seedTask({ auto_run: true, last_run_id: "run-1", resume_series: 2 });
    // Hold the resume claim exactly as an in-flight resume route would.
    const release = acquireExclusiveFileClaim(
      join(TEST_ROOT, "runs", "run-1", ".resume-claim"),
      { pid: process.pid },
    );

    try {
      const res = await PATCH(
        patchRequest(taskId, { metadata: JSON.stringify({ resume_series: 3 }) }) as never,
        { params: Promise.resolve({ id: taskId }) } as never,
      );
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.message).toContain("retry the reset");
      // no optimistic success: the series did not move
      expect(metadataOf(taskId).resume_series).toBe(2);
    } finally {
      release();
    }
  });
});
