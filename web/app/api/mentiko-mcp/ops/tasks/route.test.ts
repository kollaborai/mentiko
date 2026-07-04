/**
 * UNIT TESTS: POST /api/mentiko-mcp/ops/tasks
 * Verifies that workspace_id is passed to taskCreate when workspacePath
 * is provided in the request body. This prevents MCP-created tasks from
 * being invisible in the /tasks UI (which filters by workspace_id).
 */

// mock next/server BEFORE importing route (jsdom has no Request global)
// NextResponse must be a class so that `ctx instanceof NextResponse` works in the route.
jest.mock("next/server", () => {
  class MockNextResponse {
    status: number;
    _body: unknown;
    constructor(body?: unknown, init?: { status?: number }) {
      this.status = init?.status ?? 200;
      this._body = body;
    }
    async json() { return this._body; }
    static json(body: unknown, init?: { status?: number }) {
      return new MockNextResponse(body, init);
    }
  }
  return { NextResponse: MockNextResponse };
});

// mock auth to always return a valid context
jest.mock("@/lib/ai-engine/mentiko-mcp-ops-auth", () => ({
  requireOpsAuth: jest.fn().mockResolvedValue({
    userId: "user-test",
    sessionId: "session-test",
    namespaceId: "default",
    orgId: "default",
  }),
  requireOpsPermission: jest.fn().mockReturnValue(null),
}));

// mock task-store so we can spy on taskCreate without hitting sqlite
jest.mock("@/lib/tasks/task-store", () => ({
  taskCreate: jest.fn().mockReturnValue({
    id: "task-created-1",
    title: "Test task",
    workspace_id: "/tmp/test-workspace",
    status: "open",
  }),
  taskList: jest.fn().mockReturnValue([]),
  taskClose: jest.fn(),
  taskUpdate: jest.fn(),
  taskGet: jest.fn().mockReturnValue({
    id: "DEC-1",
    issue_type: "decision",
    metadata: { decision_id: "dec-uuid-1" },
  }),
}));

// decision creation is delegated to this helper (same path as generate mode:decision)
jest.mock("@/lib/tasks/task-decision-link", () => ({
  createTaskDecision: jest.fn().mockResolvedValue({
    decision: { id: "dec-uuid-1", status: "intake" },
    task: { id: "DEC-1", issue_type: "decision" },
  }),
}));

jest.mock("@/lib/auth/workspace-auth", () => ({
  resolveAuthorizedWorkspacePath: jest.fn((_namespaceId, _orgId, workspacePath) => (
    workspacePath === "/workspace/path" || workspacePath === "/home/user/my-project"
      ? workspacePath
      : undefined
  )),
}));

import { POST } from "./route";
import { taskCreate, taskUpdate } from "@/lib/tasks/task-store";
import { createTaskDecision } from "@/lib/tasks/task-decision-link";
import { resolveAuthorizedWorkspacePath } from "@/lib/auth/workspace-auth";

function makeRequest(body: Record<string, unknown>): Request {
  return {
    url: "http://localhost:3000/api/mentiko-mcp/ops/tasks",
    headers: new Headers({
      "content-type": "application/json",
      authorization: "Bearer test-token",
    }),
    json: async () => body,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("POST /api/mentiko-mcp/ops/tasks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // reset mock return value
    (taskCreate as jest.Mock).mockReturnValue({
      id: "task-created-1",
      title: "Test task",
      workspace_id: null,
      status: "open",
    });
  });

  test("creates task WITHOUT workspace_id when workspacePath is not provided", async () => {
    const req = makeRequest({ subject: "do the thing" });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(taskCreate).toHaveBeenCalledTimes(1);

    const callArgs = (taskCreate as jest.Mock).mock.calls[0];
    // callArgs[1] is the task input object
    expect(callArgs[1]).not.toHaveProperty("workspace_id", expect.any(String));
  });

  test("passes workspace_id to taskCreate when workspacePath is provided", async () => {
    const req = makeRequest({
      subject: "do the thing",
      workspacePath: "/home/user/my-project",
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(taskCreate).toHaveBeenCalledTimes(1);

    const callArgs = (taskCreate as jest.Mock).mock.calls[0];
    // callArgs[0] = orgId, callArgs[1] = task input, callArgs[2] = namespaceId
    const taskInput = callArgs[1];
    expect(taskInput).toMatchObject({
      workspace_id: "/home/user/my-project",
    });
    expect(resolveAuthorizedWorkspacePath).toHaveBeenCalledWith(
      "default",
      "default",
      "/home/user/my-project",
      "user-test",
    );
  });

  test("rejects task creation when workspacePath is not authorized", async () => {
    const req = makeRequest({
      subject: "do the thing",
      workspacePath: "/private/project",
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
    expect(taskCreate).not.toHaveBeenCalled();
  });

  test("returns 400 when subject is missing", async () => {
    const req = makeRequest({ desc: "no subject here" });
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(taskCreate).not.toHaveBeenCalled();
  });

  test("passes desc and parentId through correctly", async () => {
    const req = makeRequest({
      subject: "parent task",
      desc: "detailed description",
      parentId: "parent-task-123",
      workspacePath: "/workspace/path",
    });
    await POST(req);

    const callArgs = (taskCreate as jest.Mock).mock.calls[0];
    expect(callArgs[1]).toMatchObject({
      title: "parent task",
      description: "detailed description",
      parent_id: "parent-task-123",
      workspace_id: "/workspace/path",
      created_by: "mentiko-mcp",
    });
  });

  // REGRESSION: issue_type:"decision" must build a REAL decision artifact via
  // createTaskDecision, not a hollow DEC-typed task via plain taskCreate. A
  // plain insert produces a "DEC" with no options/workflow/resolution flow.
  test("routes issue_type:decision through createTaskDecision, not plain taskCreate", async () => {
    const req = makeRequest({
      subject: "wire or remove foo",
      desc: "foo is never imported",
      issue_type: "decision",
      parentId: "EPIC-013",
      labels: ["dead-code"],
      priority: 2,
      workspacePath: "/home/user/my-project",
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    // the decision path must NOT fall through to the plain task insert
    expect(taskCreate).not.toHaveBeenCalled();
    expect(createTaskDecision).toHaveBeenCalledTimes(1);

    const arg = (createTaskDecision as jest.Mock).mock.calls[0][0];
    expect(arg).toMatchObject({
      namespaceId: "default",
      orgId: "default",
      source: "mcp-create-task",
      workspacePath: "/home/user/my-project",
      parentTaskId: "EPIC-013",
    });
    expect(arg.prompt).toContain("wire or remove foo");
    expect(arg.prompt).toContain("foo is never imported");

    // caller's task-level fields are applied to the linked decision task
    expect(taskUpdate).toHaveBeenCalledTimes(1);
    expect((taskUpdate as jest.Mock).mock.calls[0][2]).toMatchObject({
      title: "wire or remove foo",
      labels: ["dead-code"],
      priority: 2,
    });

    // response surfaces the decision link
    const body = await res.json();
    expect(body).toMatchObject({ routedTo: "decision", decisionId: "dec-uuid-1" });
  });
});
