/**
 * @jest-environment node
 */

const mockCheckAuth = jest.fn();
jest.mock("@/lib/api-auth", () => ({
  checkAuth: (...args: unknown[]) => mockCheckAuth(...args),
}));

const mockExistsSync = jest.fn();
const mockReadFileSync = jest.fn();
jest.mock("fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

jest.mock("path", () => jest.requireActual("path"));

const mockTaskList = jest.fn();
const mockTaskUpdate = jest.fn();
const mockTaskClose = jest.fn();
jest.mock("@/lib/task-store", () => ({
  taskList: (...args: unknown[]) => mockTaskList(...args),
  taskUpdate: (...args: unknown[]) => mockTaskUpdate(...args),
  taskClose: (...args: unknown[]) => mockTaskClose(...args),
  validateTaskId: (id: string) => id,
}));

jest.mock("@/lib/workspace-params", () => ({
  getWorkspaceId: jest.fn().mockReturnValue(undefined),
  hasWorkspaceParam: jest.fn().mockReturnValue(false),
}));

const mockGetLiveSessions = jest.fn();
jest.mock("@/lib/pty-client", () => ({
  getLiveSessions: (...args: unknown[]) => mockGetLiveSessions(...args),
}));

const mockCreateNotification = jest.fn();
jest.mock("@/lib/notification-server", () => ({
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
jest.mock("@/lib/system-logger", () => ({
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
});
