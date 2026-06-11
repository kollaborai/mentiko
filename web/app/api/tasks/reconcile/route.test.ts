/**
 * @jest-environment node
 */

const mockCheckAuth = jest.fn();
jest.mock("@/lib/auth/api-auth", () => ({
  checkAuth: (...args: unknown[]) => mockCheckAuth(...args),
}));

const mockExistsSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockWriteFileSync = jest.fn();
jest.mock("fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}));

jest.mock("path", () => jest.requireActual("path"));

const mockTaskList = jest.fn();
const mockTaskUpdate = jest.fn();
const mockTaskClose = jest.fn();
jest.mock("@/lib/tasks/task-store", () => ({
  taskList: (...args: unknown[]) => mockTaskList(...args),
  taskUpdate: (...args: unknown[]) => mockTaskUpdate(...args),
  taskClose: (...args: unknown[]) => mockTaskClose(...args),
  validateTaskId: (id: string) => id,
}));

jest.mock("@/lib/workspaces/workspace-params", () => ({
  getWorkspaceId: jest.fn().mockReturnValue(undefined),
  hasWorkspaceParam: jest.fn().mockReturnValue(false),
}));

const mockGetLiveSessions = jest.fn();
jest.mock("@/lib/pty/pty-client", () => ({
  getLiveSessions: (...args: unknown[]) => mockGetLiveSessions(...args),
}));

const mockCreateNotification = jest.fn();
jest.mock("@/lib/notifications/notification-server", () => ({
  createNotification: (...args: unknown[]) => mockCreateNotification(...args),
}));

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: jest.fn().mockResolvedValue("default"),
  getOrgIdFromRequest: jest.fn().mockResolvedValue("default"),
}));

jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: {
    runsDir: "/tmp/mentiko-test/runs",
  },
}));

const mockWriteLog = jest.fn();
jest.mock("@/lib/system/system-logger", () => ({
  writeLog: (...args: unknown[]) => mockWriteLog(...args),
}));

import { GET } from "./route";

function makeRequest() {
  return new Request("http://localhost:3000/api/tasks/reconcile", {
    headers: {
      Authorization: "Bearer internal-secret",
      "x-namespace-id": "default",
      "x-org-id": "default",
    },
  });
}

describe("GET /api/tasks/reconcile", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckAuth.mockResolvedValue(true);
    mockGetLiveSessions.mockResolvedValue(new Set());
    mockExistsSync.mockReturnValue(true);
    mockTaskList.mockReturnValue([
      {
        id: "TASK-044",
        title: "Run recommended chain",
        status: "in_progress",
        metadata: {
          auto_run: true,
          last_run_id: "run-audit",
          last_run_status: "running",
          last_run_chain: "Chain Recommendation",
        },
      },
    ]);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-audit",
      taskId: "TASK-044",
      status: "completed",
      chainId: "chain-recommendation",
      metadata: {
        generationKind: "chain_recommendation",
      },
    }));
  });

  it("repairs audit run pollution instead of auto-closing the task", async () => {
    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      reconciled: 1,
      checked: 1,
      results: [
        expect.objectContaining({
          taskId: "TASK-044",
          runId: "run-audit",
          newStatus: "non_execution_ignored",
          reason: "non-execution run is not a task execution run",
        }),
      ],
    });
    expect(mockTaskClose).not.toHaveBeenCalled();
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-044",
      {
        metadata: expect.not.objectContaining({
          last_run_id: "run-audit",
          last_run_status: "running",
        }),
      },
      "default",
    );
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-044",
      {
        metadata: expect.objectContaining({
          auto_run: true,
          recommendation_run_id: "run-audit",
          recommendation_chain_id: "chain-recommendation",
        }),
      },
      "default",
    );
  });

  it("repairs decision run pollution instead of auto-closing the task", async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-decision",
      taskId: "TASK-044",
      status: "completed",
      chainId: "decision-research",
      metadata: {
        decisionId: "decision-1",
        decisionPhase: "research",
      },
    }));
    mockTaskList.mockReturnValue([
      {
        id: "TASK-044",
        title: "Run recommended chain",
        status: "in_progress",
        metadata: {
          auto_run: true,
          last_run_id: "run-decision",
          last_run_status: "running",
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      reconciled: 1,
      checked: 1,
      results: [
        expect.objectContaining({
          taskId: "TASK-044",
          runId: "run-decision",
          newStatus: "non_execution_ignored",
          reason: "non-execution run is not a task execution run",
        }),
      ],
    });
    expect(mockTaskClose).not.toHaveBeenCalled();
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-044",
      {
        metadata: {
          auto_run: true,
        },
      },
      "default",
    );
  });

  it("closes an auto-run task when a real execution run completes", async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-exec",
      taskId: "TASK-044",
      status: "completed",
      chainId: "release-review",
      metadata: {},
    }));
    mockTaskList.mockReturnValue([
      {
        id: "TASK-044",
        title: "Run recommended chain",
        status: "in_progress",
        metadata: {
          auto_run: true,
          last_run_id: "run-exec",
          last_run_status: "running",
          last_run_outcome: "complete",
          last_run_decision_required: false,
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      reconciled: 1,
      checked: 1,
      results: [
        expect.objectContaining({
          taskId: "TASK-044",
          runId: "run-exec",
          newStatus: "completed",
          reason: "run.json status is completed",
        }),
      ],
    });
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-044",
      {
        metadata: expect.objectContaining({
          auto_run: true,
          last_run_id: "run-exec",
          last_run_status: "completed",
        }),
      },
      "default",
    );
    expect(mockTaskClose).toHaveBeenCalledWith("default", "TASK-044", undefined, "default");
    expect(mockCreateNotification).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({
        type: "success",
        title: "Auto-run completed",
        metadata: {
          taskId: "TASK-044",
          runId: "run-exec",
        },
      }),
    );
  });

  it("does not close a completed auto-run task until completion proof metadata exists", async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-exec",
      taskId: "TASK-044",
      status: "completed",
      chainId: "release-review",
      metadata: {},
    }));
    mockTaskList.mockReturnValue([
      {
        id: "TASK-044",
        title: "Run recommended chain",
        status: "in_progress",
        metadata: {
          auto_run: true,
          last_run_id: "run-exec",
          last_run_status: "running",
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      reconciled: 1,
      checked: 1,
      results: [
        expect.objectContaining({
          taskId: "TASK-044",
          runId: "run-exec",
          newStatus: "completed",
        }),
      ],
    });
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-044",
      {
        metadata: expect.objectContaining({
          last_run_id: "run-exec",
          last_run_status: "completed",
        }),
      },
      "default",
    );
    expect(mockTaskClose).not.toHaveBeenCalled();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("closes an open auto-run task whose execution metadata already completed", async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-exec",
      taskId: "TASK-044",
      status: "completed",
      chainId: "release-review",
      metadata: {},
    }));
    mockTaskList.mockReturnValue([
      {
        id: "TASK-044",
        title: "Run recommended chain",
        status: "open",
        metadata: {
          auto_run: true,
          last_run_id: "run-exec",
          last_run_status: "completed",
          last_run_outcome: "complete",
          last_run_decision_required: false,
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      reconciled: 1,
      checked: 1,
      results: [
        expect.objectContaining({
          taskId: "TASK-044",
          runId: "run-exec",
          previousStatus: "completed",
          newStatus: "closed",
          reason: "completed auto-run task was still open",
        }),
      ],
    });
    expect(mockTaskClose).toHaveBeenCalledWith("default", "TASK-044", undefined, "default");
    expect(mockCreateNotification).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({
        type: "success",
        title: "Auto-run completed",
        metadata: {
          taskId: "TASK-044",
          runId: "run-exec",
        },
      }),
    );
  });

  it("does not close a completed analysis run while a generated chain is pending", async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-analysis",
      taskId: "TASK-044",
      status: "completed",
      chainId: "chain-recommendation",
      metadata: {},
    }));
    mockTaskList.mockReturnValue([
      {
        id: "TASK-044",
        title: "Generate then run the chain",
        status: "open",
        metadata: {
          auto_run: true,
          last_run_id: "run-analysis",
          last_run_status: "complete",
          last_run_outcome: "complete",
          last_run_decision_required: false,
          generation_job_id: "job-generation",
          generation_status: "complete",
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      reconciled: 0,
      results: [],
    });
    expect(mockTaskClose).not.toHaveBeenCalled();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("does not mark a young real run stopped before its first session launches", async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-exec",
      taskId: "TASK-044",
      status: "running",
      started: new Date(Date.now() - 3_000).toISOString(),
      chainId: "smoke-test-suite-generator",
      metadata: {},
      agents: [
        { id: "codebase-explorer", status: "pending" },
      ],
    }));
    mockTaskList.mockReturnValue([
      {
        id: "TASK-044",
        title: "Run recommended chain",
        status: "in_progress",
        metadata: {
          auto_run: true,
          last_run_id: "run-exec",
          last_run_status: "running",
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      reconciled: 0,
      checked: 1,
      results: [],
    });
    expect(mockTaskUpdate).not.toHaveBeenCalled();
    expect(mockTaskClose).not.toHaveBeenCalled();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("does not mark a real run stopped during the next-agent handoff window", async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-exec",
      taskId: "TASK-044",
      status: "running",
      started: new Date(Date.now() - 300_000).toISOString(),
      chainId: "smoke-test-suite-generator",
      metadata: {},
      agents: [
        {
          id: "codebase-explorer",
          status: "complete",
          session: "finished-session",
          completed: new Date(Date.now() - 3_000).toISOString(),
        },
        { id: "test-strategist", status: "pending" },
      ],
    }));
    mockTaskList.mockReturnValue([
      {
        id: "TASK-044",
        title: "Run recommended chain",
        status: "in_progress",
        metadata: {
          auto_run: true,
          last_run_id: "run-exec",
          last_run_status: "running",
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      reconciled: 0,
      checked: 1,
      results: [],
    });
    expect(mockTaskUpdate).not.toHaveBeenCalled();
    expect(mockTaskClose).not.toHaveBeenCalled();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("still marks an old orphaned real run stopped", async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-exec",
      taskId: "TASK-044",
      status: "running",
      started: new Date(Date.now() - 180_000).toISOString(),
      chainId: "smoke-test-suite-generator",
      metadata: {},
      agents: [
        { id: "codebase-explorer", status: "running", session: "missing-session" },
      ],
    }));
    mockTaskList.mockReturnValue([
      {
        id: "TASK-044",
        title: "Run recommended chain",
        status: "in_progress",
        metadata: {
          auto_run: true,
          last_run_id: "run-exec",
          last_run_status: "running",
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      reconciled: 1,
      checked: 1,
      results: [
        expect.objectContaining({
          taskId: "TASK-044",
          runId: "run-exec",
          newStatus: "stopped",
          reason: "no live sessions found",
        }),
      ],
    });
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-044",
      {
        metadata: expect.objectContaining({
          auto_run: true,
          last_run_id: "run-exec",
          last_run_status: "stopped",
        }),
      },
      "default",
    );
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-044",
      {
        status: "open",
        metadata: expect.objectContaining({
          auto_run: true,
          last_run_id: undefined,
          last_run_status: "stopped",
          auto_run_retries: 1,
        }),
      },
      "default",
    );
    expect(mockTaskClose).not.toHaveBeenCalled();
    expect(mockCreateNotification).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({
        type: "warning",
        title: "Auto-run failed",
        metadata: {
          taskId: "TASK-044",
          runId: "run-exec",
          status: "stopped",
        },
      }),
    );
  });
});
