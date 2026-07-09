/**
 * @jest-environment node
 */

// B3: /api/tasks main list must hide superseded decision gates exactly like
// detail ([id]/route.ts), deps ([id]/deps/route.ts), and graph (graph/route.ts)
// already do via filterVisibleTaskRecords() -- otherwise a superseded gate
// shows in the list, then 404s when clicked through to the detail route.

const mockTaskList = jest.fn();
const mockGetWorkspaceId = jest.fn();
const mockHasWorkspaceParam = jest.fn();
const mockGetNamespaceIdFromRequest = jest.fn();
const mockGetOrgIdFromRequest = jest.fn();

jest.mock("@/lib/auth/api-auth", () => ({
  requirePermission: () => (handler: unknown) => handler,
}));
jest.mock("@/lib/tasks/task-store", () => ({
  taskList: (...args: unknown[]) => mockTaskList(...args),
}));
jest.mock("@/lib/workspaces/workspace-params", () => ({
  getWorkspaceId: (...args: unknown[]) => mockGetWorkspaceId(...args),
  hasWorkspaceParam: (...args: unknown[]) => mockHasWorkspaceParam(...args),
}));
jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: (...args: unknown[]) => mockGetNamespaceIdFromRequest(...args),
  getOrgIdFromRequest: (...args: unknown[]) => mockGetOrgIdFromRequest(...args),
}));

import { GET } from "./route";

function makeRequest(qs = ""): Parameters<typeof GET>[0] {
  return new Request(`http://localhost:3000/api/tasks${qs}`) as never;
}

describe("GET /api/tasks visibility (B3)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetNamespaceIdFromRequest.mockResolvedValue("default");
    mockGetOrgIdFromRequest.mockResolvedValue("default");
    mockGetWorkspaceId.mockReturnValue(undefined);
    mockHasWorkspaceParam.mockReturnValue(false);
  });

  it("hides a superseded decision gate from the main list, matching detail/deps/graph", async () => {
    mockTaskList.mockReturnValue([
      { id: "TASK-1", title: "Visible task", status: "open", issue_type: "task", metadata: {} },
      {
        id: "DEC-1",
        title: "Superseded decision gate",
        status: "open",
        issue_type: "decision",
        metadata: { decision_status: "superseded" },
      },
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    const ids = body.data.issues.map((issue: { id: string }) => issue.id);
    expect(ids).toContain("TASK-1");
    expect(ids).not.toContain("DEC-1");
  });

  it("hides a decision gate superseded via a sibling's superseded_decision_subtask_ids list", async () => {
    mockTaskList.mockReturnValue([
      {
        id: "DEC-2",
        title: "Newer gate",
        status: "open",
        issue_type: "decision",
        metadata: { superseded_decision_subtask_ids: ["DEC-1"] },
      },
      {
        id: "DEC-1",
        title: "Older superseded gate",
        status: "open",
        issue_type: "decision",
        metadata: {},
      },
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    const ids = body.data.issues.map((issue: { id: string }) => issue.id);
    expect(ids).toContain("DEC-2");
    expect(ids).not.toContain("DEC-1");
  });

  it("returns all tasks unfiltered when none are superseded decision gates", async () => {
    mockTaskList.mockReturnValue([
      { id: "TASK-1", title: "A", status: "open", issue_type: "task", metadata: {} },
      { id: "TASK-2", title: "B", status: "closed", issue_type: "task", metadata: {} },
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.data.issues.map((issue: { id: string }) => issue.id)).toEqual(["TASK-1", "TASK-2"]);
  });

  it("passes filters through to taskList and still filters the result", async () => {
    mockGetWorkspaceId.mockReturnValue("/repo");
    mockHasWorkspaceParam.mockReturnValue(true);
    mockTaskList.mockReturnValue([
      { id: "TASK-1", title: "A", status: "open", issue_type: "task", metadata: {} },
    ]);

    const res = await GET(makeRequest("?status=open&type=task&assignee=marco&q=foo"));
    await res.json();

    expect(mockTaskList).toHaveBeenCalledWith(
      "default",
      { status: "open", issue_type: "task", assignee: "marco", query: "foo" },
      "/repo",
      "default",
    );
  });

  it("short-circuits to an empty list when a workspace was requested but has no tasks", async () => {
    mockGetWorkspaceId.mockReturnValue(undefined);
    mockHasWorkspaceParam.mockReturnValue(true);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.data.issues).toEqual([]);
    expect(mockTaskList).not.toHaveBeenCalled();
  });
});
