/**
 * @jest-environment node
 */

jest.mock("@/lib/auth/api-auth", () => ({
  requirePermission: jest.fn(() => (handler: unknown) => handler),
}));

jest.mock("node:fs", () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
}));

jest.mock("@/lib/auth/auth-bridge", () => ({
  getSessionUser: jest.fn().mockResolvedValue({ id: "user-1" }),
}));

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: jest.fn().mockResolvedValue("default"),
  getOrgIdFromRequest: jest.fn().mockResolvedValue("default"),
}));

jest.mock("@/lib/generation/generation-template-storage", () => ({
  getTemplate: jest.fn().mockReturnValue({ content: "{{TASK_DATA}}" }),
  DEFAULT_TASK_RUN_SUMMARY_TEMPLATE: "COMPLETION AUDIT {{RUN_ARTIFACTS}}",
}));

jest.mock("@/lib/system/template-resolver", () => ({
  resolveTemplate: jest.fn().mockReturnValue("summary prompt"),
}));

const mockCreateJob = jest.fn();
const mockListJobs = jest.fn();
jest.mock("@/lib/runs/job-store", () => ({
  createJob: (...args: unknown[]) => mockCreateJob(...args),
  listJobs: (...args: unknown[]) => mockListJobs(...args),
}));

jest.mock("@/lib/links/link-run-runtime", () => ({
  resolveLinkRunsDir: jest.fn().mockReturnValue("/tmp/mentiko-runs"),
}));

const mockStartGenerationChainRun = jest.fn();
jest.mock("@/lib/generation/generation-chain-dispatch", () => ({
  startGenerationChainRun: (...args: unknown[]) => mockStartGenerationChainRun(...args),
}));

const mockTaskGet = jest.fn();
const mockTaskUpdate = jest.fn();
jest.mock("@/lib/tasks/task-store", () => ({
  taskGet: (...args: unknown[]) => mockTaskGet(...args),
  taskUpdate: (...args: unknown[]) => mockTaskUpdate(...args),
  validateTaskId: jest.fn((id: string) => id),
}));

import { POST } from "./route";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolveTemplate } from "@/lib/system/template-resolver";

const mockExistsSync = existsSync as jest.Mock;
const mockReadFileSync = readFileSync as jest.Mock;
const mockReaddirSync = readdirSync as jest.Mock;
const mockStatSync = statSync as jest.Mock;
const mockResolveTemplate = resolveTemplate as jest.Mock;

function makeRequest() {
  return new Request("http://localhost:3000/api/tasks/TASK-1/outcome-summary", {
    method: "POST",
  });
}

describe("POST /api/tasks/[id]/outcome-summary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReset();
    mockReaddirSync.mockReset();
    mockReaddirSync.mockReturnValue([]);
    mockStatSync.mockReset();
    mockResolveTemplate.mockReturnValue("summary prompt");
    mockListJobs.mockReturnValue([]);
    mockCreateJob.mockReturnValue({
      id: "job-summary",
      type: "task_run_summary",
    });
    mockTaskGet.mockReturnValue({
      id: "TASK-1",
      title: "Summarize me",
      status: "open",
      issue_type: "task",
      metadata: {
        last_run_id: "run-source",
      },
    });
  });

  it("marks summary metadata failed when the run cannot start", async () => {
    mockTaskGet.mockReturnValue({
      id: "TASK-1",
      title: "Summarize me",
      status: "open",
      issue_type: "task",
      metadata: {
        last_run_id: "run-source",
        auto_run_retries: 0,
        execution_retries: 2,
        task_outcome_summary: { audit: { verdict: "decision" } },
        task_outcome_summary_completed_at: "2026-07-06T20:00:00.000Z",
      },
    });
    mockExistsSync.mockImplementation((path: string) => path.includes("/tmp/mentiko-runs/run-source"));
    mockReadFileSync.mockImplementation((path: string) => {
      if (path.endsWith("run.json")) {
        return JSON.stringify({
          id: "run-source",
          taskId: "TASK-1",
          status: "stopped",
          chainId: "execution-chain",
          completed: "2026-07-06T20:00:00.000Z",
        });
      }
      return JSON.stringify({ ok: true });
    });
    mockStartGenerationChainRun.mockRejectedValue(new Error("Session user required to start chain run"));

    const res = await POST(makeRequest() as never, {
      params: Promise.resolve({ id: "TASK-1" }),
    });

    expect(res.status).toBe(500);
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-1",
      {
        metadata: expect.objectContaining({
          task_outcome_summary_job_id: "job-summary",
          task_outcome_summary_status: "failed",
          task_outcome_summary_source_run_id: "run-source",
          task_outcome_summary: undefined,
          task_outcome_summary_completed_at: undefined,
          task_outcome_summary_error: "Session user required to start chain run",
        }),
      },
      "default",
    );
  });

  it("rejects a failed execution summary while execution retries remain", async () => {
    mockTaskGet.mockReturnValue({
      id: "TASK-1",
      title: "Summarize me",
      status: "open",
      issue_type: "task",
      metadata: {
        last_run_id: "run-source",
        auto_run_retries: 99,
        execution_retries: 1,
      },
    });
    mockExistsSync.mockImplementation((path: string) => path.includes("/tmp/mentiko-runs/run-source"));
    mockReadFileSync.mockImplementation((path: string) => {
      if (path.endsWith("run.json")) {
        return JSON.stringify({
          id: "run-source",
          taskId: "TASK-1",
          status: "failed",
          chainId: "execution-chain",
          completed: "2026-07-06T20:00:00.000Z",
        });
      }
      return JSON.stringify({ ok: true });
    });

    const res = await POST(makeRequest() as never, {
      params: Promise.resolve({ id: "TASK-1" }),
    });

    expect(res.status).toBe(400);
    expect(mockCreateJob).not.toHaveBeenCalled();
    expect(mockStartGenerationChainRun).not.toHaveBeenCalled();
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  it("rejects an outcome summary while the execution run is still active", async () => {
    mockTaskGet.mockReturnValue({
      id: "TASK-1",
      title: "Summarize me",
      status: "in_progress",
      issue_type: "task",
      metadata: { last_run_id: "run-source", execution_retries: 0 },
    });
    mockExistsSync.mockImplementation((path: string) => path.includes("/tmp/mentiko-runs/run-source"));
    mockReadFileSync.mockImplementation((path: string) => {
      if (path.endsWith("run.json")) {
        return JSON.stringify({
          id: "run-source",
          taskId: "TASK-1",
          status: "running",
          chainId: "execution-chain",
        });
      }
      return JSON.stringify({ ok: true });
    });

    const res = await POST(makeRequest() as never, {
      params: Promise.resolve({ id: "TASK-1" }),
    });

    expect(res.status).toBe(400);
    expect(mockCreateJob).not.toHaveBeenCalled();
    expect(mockStartGenerationChainRun).not.toHaveBeenCalled();
  });

  it("starts a new audit when the same run has a different terminal fingerprint and includes disk artifacts", async () => {
    mockTaskGet.mockReturnValue({
      id: "TASK-1",
      title: "Summarize me",
      status: "open",
      issue_type: "task",
      metadata: {
        last_run_id: "run-source",
        task_outcome_summary_source_run_id: "run-source",
        task_outcome_summary_run_fingerprint: "running:no-terminal-time",
        task_outcome_summary: { audit: { verdict: "decision" } },
      },
    });
    mockExistsSync.mockImplementation((path: string) => path.includes("/tmp/mentiko-runs/run-source"));
    mockReadFileSync.mockImplementation((path: string) => {
      if (path.endsWith("run.json")) {
        return JSON.stringify({ status: "completed", completed: "2026-07-06T20:08:02.554Z", artifacts: [] });
      }
      return JSON.stringify({ ok: true });
    });
    mockReaddirSync.mockReturnValue([
      { name: "project-setup-complete.event", isDirectory: () => false, isFile: () => true },
    ]);
    mockStatSync.mockReturnValue({
      size: 42,
      mtime: new Date("2026-07-06T20:08:02.554Z"),
    });
    mockStartGenerationChainRun.mockResolvedValue({ runId: "run-summary", chainId: "summary-chain" });

    const res = await POST(makeRequest() as never, {
      params: Promise.resolve({ id: "TASK-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ status: "running", sourceRunId: "run-source" });
    expect(mockCreateJob).toHaveBeenCalledWith(
      "task_run_summary",
      expect.objectContaining({
        runFingerprint: "completed:2026-07-06T20:08:02.554Z",
      }),
      "TASK-1",
      undefined,
      "user-1",
      "default",
    );
    expect(mockResolveTemplate).toHaveBeenCalledWith(
      "COMPLETION AUDIT {{RUN_ARTIFACTS}}",
      expect.objectContaining({
        RUN_ARTIFACTS: expect.stringContaining("project-setup-complete.event"),
      }),
    );
    expect(mockTaskUpdate).toHaveBeenLastCalledWith(
      "default",
      "TASK-1",
      {
        metadata: expect.objectContaining({
          task_outcome_summary_job_id: "job-summary",
          task_outcome_summary_status: "running",
          task_outcome_summary_run_id: "run-summary",
          task_outcome_summary_source_run_id: "run-source",
          task_outcome_summary_run_fingerprint: "completed:2026-07-06T20:08:02.554Z",
          task_outcome_summary: undefined,
          task_outcome_summary_completed_at: undefined,
        }),
      },
      "default",
    );
  });

  it("records lifecycle metadata when an audit job is already running", async () => {
    mockTaskGet.mockReturnValue({
      id: "TASK-1",
      title: "Summarize me",
      status: "open",
      issue_type: "task",
      metadata: {
        last_run_id: "run-source",
      },
    });
    mockExistsSync.mockImplementation((path: string) => path.includes("/tmp/mentiko-runs/run-source"));
    mockReadFileSync.mockImplementation((path: string) => {
      if (path.endsWith("run.json")) {
        return JSON.stringify({
          id: "run-source",
          taskId: "TASK-1",
          status: "completed",
          chainId: "execution-chain",
          completed: "2026-07-06T20:08:02.554Z",
        });
      }
      return JSON.stringify({ ok: true });
    });
    mockListJobs.mockReturnValue([
      {
        id: "job-existing",
        type: "task_run_summary",
        runId: "run-summary",
        input: { sourceRunId: "run-source" },
      },
    ]);

    const res = await POST(makeRequest() as never, {
      params: Promise.resolve({ id: "TASK-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      status: "running",
      jobId: "job-existing",
      runId: "run-summary",
      sourceRunId: "run-source",
    });
    expect(mockCreateJob).not.toHaveBeenCalled();
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-1",
      {
        metadata: expect.objectContaining({
          lifecycle_phase: "summarizing",
          task_outcome_summary_job_id: "job-existing",
          task_outcome_summary_status: "running",
          task_outcome_summary_run_id: "run-summary",
          task_outcome_summary_source_run_id: "run-source",
          task_outcome_summary_run_fingerprint: "completed:2026-07-06T20:08:02.554Z",
          summarized_run_fingerprints: expect.arrayContaining([
            "run-source::completed:2026-07-06T20:08:02.554Z",
          ]),
        }),
      },
      "default",
    );
  });
});
