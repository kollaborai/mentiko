/**
 * @jest-environment node
 */

const mockTaskGet = jest.fn();
const mockListTaskAttempts = jest.fn();

jest.mock("@/lib/auth/api-auth", () => ({
  requirePermission: () => (handler: unknown) => handler,
}));

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: jest.fn().mockResolvedValue("default"),
  getOrgIdFromRequest: jest.fn().mockResolvedValue("default"),
}));

jest.mock("@/lib/tasks/task-store", () => ({
  taskGet: (...args: unknown[]) => mockTaskGet(...args),
  validateTaskId: (id: string) => id,
}));

jest.mock("@/lib/tasks/task-attempts", () => ({
  listTaskAttempts: (...args: unknown[]) => mockListTaskAttempts(...args),
}));

import { GET } from "./route";

describe("GET /api/tasks/[id]/attempts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTaskGet.mockReturnValue({
      id: "TASK-1",
      title: "Ship the task",
      metadata: { last_run_id: "run-exec" },
    });
    mockListTaskAttempts.mockReturnValue([
      {
        runId: "run-rec",
        kind: "recommendation",
        category: "system",
        status: "completed",
        source: "run_json",
        isSystem: true,
        isCurrent: false,
        isLatestForKind: true,
      },
      {
        runId: "run-exec",
        kind: "execution",
        category: "task_execution",
        status: "completed",
        source: "merged",
        isSystem: false,
        isCurrent: true,
        isLatestForKind: true,
      },
    ]);
  });

  it("returns a task-scoped attempts view model", async () => {
    const res = await GET(new Request("http://localhost/api/tasks/TASK-1/attempts") as never, {
      params: Promise.resolve({ id: "TASK-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockTaskGet).toHaveBeenCalledWith("default", "TASK-1", "default");
    expect(mockListTaskAttempts).toHaveBeenCalledWith({
      namespaceId: "default",
      orgId: "default",
      taskId: "TASK-1",
      metadata: { last_run_id: "run-exec" },
    });
    expect(body.data).toEqual({
      taskId: "TASK-1",
      currentExecutionRunId: "run-exec",
      attempts: [
        expect.objectContaining({ runId: "run-rec", kind: "recommendation" }),
        expect.objectContaining({ runId: "run-exec", kind: "execution", isCurrent: true }),
      ],
    });
  });
});
