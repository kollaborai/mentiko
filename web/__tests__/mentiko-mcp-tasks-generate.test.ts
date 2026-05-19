/**
 * TDD test: generate_tasks MCP endpoint correctly passes workspace_id
 * to BOTH the parent task and each subtask created via taskCreate.
 *
 * POST /api/mentiko-mcp/ops/tasks/generate
 *   body: { description, workspacePath }
 *   → parent taskCreate receives workspace_id: workspacePath
 *   → each subtask taskCreate receives workspace_id: workspacePath
 *
 * @jest-environment node
 */

import { POST } from "@/app/api/mentiko-mcp/ops/tasks/generate/route";

// ---- mocks ----------------------------------------------------------------

const mockTaskCreate = jest.fn();
const mockTaskAddDep = jest.fn();
jest.mock("@/lib/task-store", () => ({
  _getDb: jest.fn().mockReturnValue({
    transaction: (fn: () => unknown) => fn,
  }),
  taskCreate: (...args: unknown[]) => mockTaskCreate(...args),
  taskAddDep: (...args: unknown[]) => mockTaskAddDep(...args),
}));

const mockCreateJob = jest.fn();
const mockGetJob = jest.fn();
jest.mock("@/lib/job-store", () => ({
  createJob: (...args: unknown[]) => mockCreateJob(...args),
  getJob: (...args: unknown[]) => mockGetJob(...args),
}));

const mockSpawnChild = { unref: jest.fn() };
const mockSpawn = jest.fn().mockReturnValue(mockSpawnChild);
jest.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

jest.mock("@/lib/mentiko-mcp-ops-auth", () => ({
  requireOpsAuth: jest.fn().mockResolvedValue({
    namespaceId: "default",
    orgId: "default",
    userId: "user-1",
    sessionId: "session-1",
  }),
  requireOpsPermission: jest.fn().mockReturnValue(null),
}));

jest.mock("@/lib/schema-loader", () => ({
  getTaskSchema: jest.fn().mockReturnValue("{}"),
}));

jest.mock("@/lib/generation-template-storage", () => ({
  getTemplate: jest.fn().mockReturnValue({ content: "{{USER_PROMPT}}" }),
}));

jest.mock("@/lib/template-resolver", () => ({
  resolveTemplate: jest.fn().mockImplementation((tpl: string, vars: Record<string, string>) =>
    vars.USER_PROMPT ?? tpl,
  ),
}));

jest.mock("@/lib/child-env", () => ({
  buildChildEnv: jest.fn().mockImplementation((extra: object) => ({ ...process.env, ...extra })),
}));

jest.mock("@/lib/workspace-auth", () => ({
  resolveAuthorizedWorkspacePath: jest.fn((_namespaceId, _orgId, workspacePath) => workspacePath),
}));

jest.mock("@/lib/config", () => {
  const cfg = {
    codeRoot: "/opt/mentiko",
    globalRoot: "/root/.mentiko",
    projectRoot: "/root/.mentiko/namespaces/default",
    orgRoot: "/root/.mentiko/namespaces/default",
    namespaceRoot: "/root/.mentiko/namespaces/default",
  };
  return {
    __esModule: true,
    default: cfg,
    nsPath: jest.fn((namespaceId: string, ...parts: string[]) =>
      ["/root/.mentiko/namespaces", namespaceId, ...parts].join("/"),
    ),
    orgPath: jest.fn((namespaceId: string, orgId: string, ...parts: string[]) =>
      orgId === "default"
        ? ["/root/.mentiko/namespaces", namespaceId, ...parts].join("/")
        : ["/root/.mentiko/namespaces", namespaceId, "orgs", orgId, ...parts].join("/"),
    ),
  };
});

// ---- helpers ---------------------------------------------------------------

const JOB_ID = "job-abc";

function makeGeneratedTask(includeSubtasks = true) {
  return {
    title: "Implement feature X",
    description: "Build the thing",
    type: "feature",
    priority: 2,
    labels: ["backend"],
    subtasks: includeSubtasks
      ? [
          { title: "Sub 1", description: "first sub", type: "task", priority: 2, labels: [] },
          { title: "Sub 2", description: "second sub", type: "task", priority: 2, labels: [], depends_on: [0] },
        ]
      : undefined,
  };
}

function makeParentRecord(overrides = {}) {
  return { id: "TSK-1", title: "Implement feature X", issue_type: "epic", priority: 2, ...overrides };
}
function makeSubtaskRecord(idx: number) {
  return { id: `TSK-${idx + 2}`, title: `Sub ${idx + 1}`, issue_type: "task", priority: 2 };
}

function makeRequest(body: object) {
  return new Request("http://localhost/api/mentiko-mcp/ops/tasks/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---- tests -----------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();

  mockCreateJob.mockReturnValue({ id: JOB_ID, status: "pending" });

  // getJob: first call returns pending, second returns complete with result
  let callCount = 0;
  mockGetJob.mockImplementation(() => {
    callCount++;
    if (callCount === 1) return { id: JOB_ID, status: "pending" };
    return { id: JOB_ID, status: "complete", result: makeGeneratedTask() };
  });

  // taskCreate: first call = parent, subsequent calls = subtasks
  let createCount = 0;
  mockTaskCreate.mockImplementation(() => {
    createCount++;
    if (createCount === 1) return makeParentRecord();
    return makeSubtaskRecord(createCount - 2);
  });
});

describe("POST /api/mentiko-mcp/ops/tasks/generate", () => {
  describe("workspace_id propagation", () => {
    it("passes workspace_id to the parent task when workspacePath is provided", async () => {
      const res = await POST(makeRequest({
        description: "build something",
        workspacePath: "/test/workspace",
      }));
      expect(res.status).toBe(200);

      // first taskCreate call is the parent
      const firstCall = mockTaskCreate.mock.calls[0];
      // signature: taskCreate(orgId, input, namespaceId)
      const parentInput = firstCall[1];
      expect(parentInput.workspace_id).toBe("/test/workspace");
    });

    it("passes workspace_id to every subtask when workspacePath is provided", async () => {
      const res = await POST(makeRequest({
        description: "build something",
        workspacePath: "/test/workspace",
      }));
      expect(res.status).toBe(200);

      // calls after the first are subtasks
      const subtaskCalls = mockTaskCreate.mock.calls.slice(1);
      expect(subtaskCalls.length).toBe(2); // two subtasks in makeGeneratedTask()
      for (const call of subtaskCalls) {
        const input = call[1];
        expect(input.workspace_id).toBe("/test/workspace");
      }
    });

    it("sets workspace_id to undefined for parent when workspacePath is omitted", async () => {
      const res = await POST(makeRequest({ description: "build something" }));
      expect(res.status).toBe(200);

      const parentInput = mockTaskCreate.mock.calls[0][1];
      expect(parentInput.workspace_id).toBeUndefined();
    });

    it("sets workspace_id to undefined for subtasks when workspacePath is omitted", async () => {
      const res = await POST(makeRequest({ description: "build something" }));
      expect(res.status).toBe(200);

      const subtaskCalls = mockTaskCreate.mock.calls.slice(1);
      for (const call of subtaskCalls) {
        expect(call[1].workspace_id).toBeUndefined();
      }
    });
  });

  describe("response shape", () => {
    it("returns parentId and tasks array", async () => {
      const res = await POST(makeRequest({
        description: "build something",
        workspacePath: "/test/workspace",
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("parentId", "TSK-1");
      expect(Array.isArray(body.tasks)).toBe(true);
      expect(body.tasks.length).toBe(3); // parent + 2 subtasks
    });
  });

  describe("legacy field normalization", () => {
    it("uses design_notes as design when older job output returns that key", async () => {
      mockGetJob.mockReturnValue({
        id: JOB_ID,
        status: "complete",
        result: {
          ...makeGeneratedTask(false),
          design: undefined,
          design_notes: "Follow the task-store pattern.",
          acceptance_criteria: ["criteria one", "criteria two"],
        },
      });

      const res = await POST(makeRequest({ description: "build something" }));
      expect(res.status).toBe(200);

      const parentInput = mockTaskCreate.mock.calls[0][1];
      expect(parentInput.design).toBe("Follow the task-store pattern.");
      expect(parentInput.acceptance_criteria).toBe("criteria one\ncriteria two");
    });
  });

  describe("auto-run opt-in", () => {
    it("sets auto_run metadata on parent and subtasks when autoRun is true", async () => {
      const res = await POST(makeRequest({
        description: "build and execute something",
        workspacePath: "/test/workspace",
        autoRun: true,
      }));
      expect(res.status).toBe(200);

      for (const call of mockTaskCreate.mock.calls) {
        const taskInput = call[1];
        expect(taskInput.metadata).toMatchObject({
          created_by_session: "session-1",
          auto_run: true,
        });
      }
    });

    it("does not set auto_run metadata unless autoRun is true", async () => {
      const res = await POST(makeRequest({
        description: "build something",
        workspacePath: "/test/workspace",
      }));
      expect(res.status).toBe(200);

      for (const call of mockTaskCreate.mock.calls) {
        const taskInput = call[1];
        expect(taskInput.metadata).toEqual({
          created_by_session: "session-1",
        });
      }
    });
  });

  describe("validation", () => {
    it("returns 400 when description is missing", async () => {
      const res = await POST(makeRequest({}));
      expect(res.status).toBe(400);
    });

    it("returns 400 when description is blank", async () => {
      const res = await POST(makeRequest({ description: "   " }));
      expect(res.status).toBe(400);
    });
  });

  describe("job failure handling", () => {
    it("returns 500 when job fails", async () => {
      mockGetJob.mockReturnValue({ id: JOB_ID, status: "failed", error: "model error" });
      const res = await POST(makeRequest({ description: "build something" }));
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("model error");
    });
  });
});
