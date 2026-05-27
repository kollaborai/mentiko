/**
 * @jest-environment node
 */

export {};

const mockGetNamespaceIdFromRequest = jest.fn().mockResolvedValue("default");
const mockGetOrgIdFromRequest = jest.fn().mockResolvedValue("default");
jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: (...args: unknown[]) => mockGetNamespaceIdFromRequest(...args),
  getOrgIdFromRequest: (...args: unknown[]) => mockGetOrgIdFromRequest(...args),
}));

const mockHasInternalAuth = jest.fn().mockReturnValue(true);
jest.mock("@/lib/internal-api-auth", () => ({
  hasInternalAuth: (...args: unknown[]) => mockHasInternalAuth(...args),
}));

jest.mock("@/lib/api-response", () => ({
  withErrorHandling: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  apiSuccess: (data: unknown) => ({ status: 200, json: async () => data }),
}));

jest.mock("@/lib/api-errors", () => ({
  Unauthorized: class Unauthorized extends Error {},
  NotFound: class NotFound extends Error {
    constructor(entity: string, id: string) {
      super(`${entity} ${id} not found`);
    }
  },
}));

const mockGetJob = jest.fn();
const mockUpdateJob = jest.fn();
jest.mock("@/lib/job-store", () => ({
  getJob: (...args: unknown[]) => mockGetJob(...args),
  updateJob: (...args: unknown[]) => mockUpdateJob(...args),
}));

const mockTaskCreate = jest.fn();
const mockTaskAddDep = jest.fn();
const mockTaskGet = jest.fn();
const mockTaskUpdate = jest.fn();
const mockTaskDb = {
  transaction: (fn: () => unknown) => fn,
  prepare: jest.fn().mockReturnValue({
    all: jest.fn().mockReturnValue([]),
  }),
};
jest.mock("@/lib/task-store", () => ({
  _getDb: jest.fn().mockReturnValue(mockTaskDb),
  taskCreate: (...args: unknown[]) => mockTaskCreate(...args),
  taskAddDep: (...args: unknown[]) => mockTaskAddDep(...args),
  taskGet: (...args: unknown[]) => mockTaskGet(...args),
  taskUpdate: (...args: unknown[]) => mockTaskUpdate(...args),
}));

jest.mock("@/lib/decision-storage", () => ({
  getDecision: jest.fn(),
  updateDecision: jest.fn(),
}));

jest.mock("@/lib/chain-postprocessor", () => ({
  postProcessChain: jest.fn(),
}));

jest.mock("@/lib/internal-web-origin", () => ({
  internalApiUrl: (path: string) => `http://localhost:3000${path}`,
}));

jest.mock("@/lib/decision-run-results", () => ({
  applyDecisionRunResult: jest.fn(),
}));

function makeRequest(body: Record<string, unknown>) {
  return {
    json: async () => body,
    headers: new Headers({ authorization: "Bearer test" }),
    url: "http://localhost:3000/api/jobs/job-task/complete",
    method: "POST",
  } as never;
}

function generatedTask() {
  return {
    title: "Expand E2E test coverage for critical user workflows",
    description: "Add coverage for the main flows.",
    type: "epic",
    priority: 2,
    labels: ["testing", "e2e"],
    subtasks: [
      {
        title: "Add login flow coverage",
        description: "Cover login success and failure.",
        type: "task",
        priority: 1,
      },
      {
        title: "Add task generation flow coverage",
        description: "Cover task generation through import.",
        type: "task",
        priority: 1,
        depends_on: [0],
      },
    ],
  };
}

describe("POST /api/jobs/[id]/complete", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    let currentJob = {
      id: "job-task",
      type: "task",
      status: "running",
      input: {
        workspacePath: "/repo/mentiko",
        taskGenerationMetadata: {
          created_by_session: "session-1",
        },
      },
      runId: "run-task",
      chainId: "task-generation",
      createdAt: "2026-05-26T00:00:00.000Z",
    };

    mockGetJob.mockImplementation(() => currentJob);
    mockUpdateJob.mockImplementation((_id, updates) => {
      currentJob = { ...currentJob, ...updates };
    });
    mockTaskGet.mockImplementation((_orgId, taskId) => ({
      id: taskId,
      metadata: {},
    }));

    let createCount = 0;
    mockTaskCreate.mockImplementation((_orgId, input) => {
      createCount += 1;
      return {
        id: createCount === 1 ? "EPIC-001" : `TASK-00${createCount - 1}`,
        title: input.title,
        issue_type: input.issue_type,
        priority: input.priority,
      };
    });
  });

  test("creates the generated task tree when a task generation job completes", async () => {
    const { POST } = await import("./route");

    const response = await POST(makeRequest({
      status: "complete",
      result: generatedTask(),
      runId: "run-task",
      chainId: "task-generation",
      generationKind: "task",
    }), { params: Promise.resolve({ id: "job-task" }) });

    expect(response.status).toBe(200);
    expect(mockTaskCreate).toHaveBeenCalledTimes(3);
    expect(mockTaskCreate.mock.calls[0][1]).toEqual(expect.objectContaining({
      title: "Expand E2E test coverage for critical user workflows",
      issue_type: "epic",
      workspace_id: "/repo/mentiko",
      metadata: expect.objectContaining({
        task_generation_job_id: "job-task",
        task_generation_run_id: "run-task",
        created_by_session: "session-1",
        workspace_path: "/repo/mentiko",
      }),
    }));
    expect(mockTaskCreate.mock.calls[0][1].metadata).not.toHaveProperty("generation_job_id");
    expect(mockTaskCreate.mock.calls[0][1].metadata).not.toHaveProperty("generation_status");
    expect(mockTaskCreate.mock.calls[1][1]).toEqual(expect.objectContaining({
      title: "Add login flow coverage",
      parent_id: "EPIC-001",
      workspace_id: "/repo/mentiko",
    }));
    expect(mockTaskCreate.mock.calls[2][1]).toEqual(expect.objectContaining({
      title: "Add task generation flow coverage",
      parent_id: "EPIC-001",
      workspace_id: "/repo/mentiko",
    }));
    expect(mockTaskAddDep).toHaveBeenCalledWith("default", "TASK-002", "TASK-001", "default", "/repo/mentiko");
    expect(mockUpdateJob).toHaveBeenCalledWith("job-task", expect.objectContaining({
      taskId: "EPIC-001",
      result: expect.objectContaining({
        createdTaskIds: ["EPIC-001", "TASK-001", "TASK-002"],
      }),
    }), "default");
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });
});
