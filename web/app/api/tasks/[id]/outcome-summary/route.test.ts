/**
 * @jest-environment node
 */

jest.mock("@/lib/auth/api-auth", () => ({
  requirePermission: jest.fn(() => (handler: unknown) => handler),
}));

jest.mock("node:fs", () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn(),
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

function makeRequest() {
  return new Request("http://localhost:3000/api/tasks/TASK-1/outcome-summary", {
    method: "POST",
  });
}

describe("POST /api/tasks/[id]/outcome-summary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
          task_outcome_summary_error: "Session user required to start chain run",
        }),
      },
      "default",
    );
  });
});
