/**
 * @jest-environment node
 */
// Unit tests for task-creation-service.ts (chain-contract Track C, C1-C4).
//
// This is where the deep business-logic assertions that used to live inline
// in app/api/tasks/create/route.test.ts (auto-run defaulting, chain metadata
// building) now live, since both producers delegate to this one service.
// Producer-vs-producer parity (C5, the 13-case matrix run through both HTTP
// adapters) lives in web/lib/tasks/__tests__/task-creation-parity.test.ts.

const mockTaskCreate = jest.fn();
const mockTaskGet = jest.fn();
const mockTaskUpdate = jest.fn();
const mockGetDb = jest.fn();
const mockResolveTaskAutoRunPolicy = jest.fn();
const mockValidateChainId = jest.fn();
const mockBuildChainMetadata = jest.fn();
const mockResolveAuthorizedWorkspacePath = jest.fn();
const mockCreateTaskDecision = jest.fn();

jest.mock("@/lib/tasks/task-store", () => ({
  taskCreate: (...args: unknown[]) => mockTaskCreate(...args),
  taskGet: (...args: unknown[]) => mockTaskGet(...args),
  taskUpdate: (...args: unknown[]) => mockTaskUpdate(...args),
  _getDb: (...args: unknown[]) => mockGetDb(...args),
}));
jest.mock("@/lib/tasks/task-auto-run-default", () => ({
  resolveTaskAutoRunPolicy: (...args: unknown[]) => mockResolveTaskAutoRunPolicy(...args),
}));
jest.mock("@/lib/chains/chain-validation", () => ({
  validateChainId: (...args: unknown[]) => mockValidateChainId(...args),
  buildChainMetadata: (...args: unknown[]) => mockBuildChainMetadata(...args),
}));
jest.mock("@/lib/auth/workspace-auth", () => ({
  resolveAuthorizedWorkspacePath: (...args: unknown[]) => mockResolveAuthorizedWorkspacePath(...args),
}));
jest.mock("@/lib/tasks/task-decision-link", () => ({
  createTaskDecision: (...args: unknown[]) => mockCreateTaskDecision(...args),
}));

import { createTask, type TaskCreationRequest } from "./task-creation-service";

function baseRequest(overrides: Partial<TaskCreationRequest> = {}): TaskCreationRequest {
  return {
    namespaceId: "default",
    orgId: "default",
    source: "ui",
    actorUserId: "user-1",
    title: "Do the thing",
    ...overrides,
  };
}

// A fake sqlite handle: .prepare(sql).get(...) returns whatever the current
// test queued via queueDbGet(). Queue drains in order; once empty, returns
// undefined (matches "no existing row").
let dbGetQueue: Array<{ id: string } | undefined> = [];
function queueDbGet(value: { id: string } | undefined) {
  dbGetQueue.push(value);
}

beforeEach(() => {
  jest.clearAllMocks();
  dbGetQueue = [];
  mockGetDb.mockReturnValue({
    prepare: () => ({
      get: () => (dbGetQueue.length > 0 ? dbGetQueue.shift() : undefined),
    }),
  });
  mockResolveAuthorizedWorkspacePath.mockImplementation(
    (_ns: string, _org: string, ref: string) => ref,
  );
  mockResolveTaskAutoRunPolicy.mockReturnValue({ enabled: false, source: "unscoped" });
  mockTaskCreate.mockImplementation((_orgId: string, input: Record<string, unknown>) => ({
    id: "TASK-100",
    org_id: "default",
    workspace_id: (input.workspace_id as string) ?? null,
    title: input.title,
    description: input.description ?? "",
    status: "open",
    priority: (input.priority as number) ?? 2,
    issue_type: (input.issue_type as string) ?? "task",
    owner: (input.owner as string) ?? "",
    assignee: (input.assignee as string) ?? null,
    parent_id: (input.parent_id as string) ?? null,
    labels: input.labels ?? [],
    metadata: input.metadata ?? {},
    acceptance_criteria: null,
    design: null,
    notes: null,
    estimated_minutes: null,
    due_at: null,
    created_at: "2026-07-31T00:00:00.000Z",
    created_by: (input.created_by as string) ?? "",
    updated_at: "2026-07-31T00:00:00.000Z",
    closed_at: null,
  }));
});

describe("task-creation-service: validation", () => {
  it("rejects an empty title", async () => {
    await expect(createTask(baseRequest({ title: "" }))).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });

  it("rejects a parentId that does not resolve to an existing task (C5: invalid parent)", async () => {
    mockTaskGet.mockReturnValue(null);
    await expect(createTask(baseRequest({ parentId: "TASK-999" }))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });

  it("accepts a parentId that resolves to an existing task", async () => {
    mockTaskGet.mockReturnValue({ id: "TASK-001" });
    const result = await createTask(baseRequest({ parentId: "TASK-001", title: "child" }));
    expect(result.outcome).toBe("created");
    expect(mockTaskCreate).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({ parent_id: "TASK-001" }),
      "default",
    );
  });

  it("clamps out-of-range priority to task-store's own default (C1: priority now validated for both producers)", async () => {
    await createTask(baseRequest({ priority: 99 }));
    expect(mockTaskCreate).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({ priority: undefined }),
      "default",
    );
  });

  it("preserves an in-range priority", async () => {
    await createTask(baseRequest({ priority: 1 }));
    expect(mockTaskCreate).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({ priority: 1 }),
      "default",
    );
  });
});

describe("task-creation-service: workspace authorization (closes divergence #7)", () => {
  it("does not call workspace authorization when no workspace was requested", async () => {
    await createTask(baseRequest());
    expect(mockResolveAuthorizedWorkspacePath).not.toHaveBeenCalled();
    expect(mockTaskCreate).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({ workspace_id: undefined }),
      "default",
    );
  });

  it("auth-resolves the workspace and passes the resolved path through", async () => {
    mockResolveAuthorizedWorkspacePath.mockReturnValue("/repo");
    await createTask(baseRequest({ workspaceRef: "/repo" }));
    expect(mockResolveAuthorizedWorkspacePath).toHaveBeenCalledWith("default", "default", "/repo", "user-1");
    expect(mockTaskCreate).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({ workspace_id: "/repo" }),
      "default",
    );
  });

  it("rejects an unauthorized/unknown workspace with 403 (C5: unauthorized namespace/workspace)", async () => {
    mockResolveAuthorizedWorkspacePath.mockReturnValue(undefined);
    await expect(createTask(baseRequest({ workspaceRef: "/not-mine" }))).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
    });
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });

  it("rejects a malformed workspace ref (UI's ?workspace= path-traversal guard) with 400", async () => {
    await expect(createTask(baseRequest({ malformedWorkspaceRef: true }))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Tasks not initialized in this workspace.",
    });
    expect(mockResolveAuthorizedWorkspacePath).not.toHaveBeenCalled();
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });
});

describe("task-creation-service: auto-run policy (C3)", () => {
  it("reports and stamps an explicit auto-run true (C5: explicit auto-run on)", async () => {
    mockResolveTaskAutoRunPolicy.mockReturnValue({ enabled: true, source: "explicit" });
    const result = await createTask(baseRequest({ chainAssignment: { autoRun: true } }));
    expect(mockResolveTaskAutoRunPolicy).toHaveBeenCalledWith({
      namespaceId: "default",
      orgId: "default",
      workspacePath: undefined,
      explicitAutoRun: true,
    });
    expect(result.effectiveAutoRun).toEqual({ enabled: true, source: "explicit" });
    expect(mockTaskCreate).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({ metadata: expect.objectContaining({ auto_run: true }) }),
      "default",
    );
  });

  it("reports and does not stamp an explicit auto-run false (C5: explicit auto-run off)", async () => {
    mockResolveTaskAutoRunPolicy.mockReturnValue({ enabled: false, source: "explicit" });
    const result = await createTask(baseRequest({ chainAssignment: { autoRun: false } }));
    expect(result.effectiveAutoRun).toEqual({ enabled: false, source: "explicit" });
    const callArgs = mockTaskCreate.mock.calls[0][1];
    expect(callArgs.metadata?.auto_run).toBeUndefined();
  });

  it("reports a workspace-override default (C5: inherited workspace default)", async () => {
    mockResolveAuthorizedWorkspacePath.mockReturnValue("/repo");
    mockResolveTaskAutoRunPolicy.mockReturnValue({ enabled: true, source: "workspace_override" });
    const result = await createTask(baseRequest({ workspaceRef: "/repo" }));
    expect(result.effectiveAutoRun.source).toBe("workspace_override");
    expect(mockTaskCreate).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({ metadata: expect.objectContaining({ auto_run: true, workspace_path: "/repo" }) }),
      "default",
    );
  });

  it("reports a system-default fallback (C5: inherited system default)", async () => {
    mockResolveAuthorizedWorkspacePath.mockReturnValue("/repo");
    mockResolveTaskAutoRunPolicy.mockReturnValue({ enabled: true, source: "system_default" });
    const result = await createTask(baseRequest({ workspaceRef: "/repo" }));
    expect(result.effectiveAutoRun.source).toBe("system_default");
  });

  it("reports unscoped when there is no resolvable workspace and no explicit intent", async () => {
    const result = await createTask(baseRequest());
    expect(result.effectiveAutoRun).toEqual({ enabled: false, source: "unscoped" });
    const callArgs = mockTaskCreate.mock.calls[0][1];
    expect(callArgs.metadata).toBeUndefined();
  });
});

describe("task-creation-service: chain binding (C5: chain binding metadata)", () => {
  it("validates and stamps chain binding metadata, returning chainBinding in the result", async () => {
    mockValidateChainId.mockReturnValue({ valid: true, chainName: "Build Chain" });
    mockBuildChainMetadata.mockReturnValue({
      chainBinding: { chain_id: "build-chain", chain_name: "Build Chain", auto_run: true },
    });
    mockResolveTaskAutoRunPolicy.mockReturnValue({ enabled: true, source: "explicit" });

    const result = await createTask(
      baseRequest({ chainAssignment: { chainId: "build-chain", autoRun: true } }),
    );

    expect(mockValidateChainId).toHaveBeenCalledWith("build-chain", "default", "default");
    expect(mockBuildChainMetadata).toHaveBeenCalledWith("build-chain", "Build Chain", true);
    expect(result.chainBinding).toEqual({ chainId: "build-chain", chainName: "Build Chain" });
    expect(mockTaskCreate).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({
        metadata: expect.objectContaining({
          chainBinding: { chain_id: "build-chain", chain_name: "Build Chain", auto_run: true },
        }),
      }),
      "default",
    );
  });

  it("rejects an invalid chain id with the validator's own message", async () => {
    mockValidateChainId.mockReturnValue({ valid: false, error: 'Chain "nope" does not exist in namespace "default"' });
    await expect(
      createTask(baseRequest({ chainAssignment: { chainId: "nope" } })),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: 'Chain "nope" does not exist in namespace "default"',
    });
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });
});

describe("task-creation-service: decision routing (C1/C5: decision task routing)", () => {
  it("routes issue_type:decision through createTaskDecision, never taskCreate", async () => {
    mockCreateTaskDecision.mockResolvedValue({
      decision: { id: "dec-1" },
      task: { id: "DEC-1", issue_type: "decision" },
    });
    mockTaskGet.mockReturnValue({ id: "DEC-1", issue_type: "decision", metadata: { decision_id: "dec-1" } });

    const result = await createTask(
      baseRequest({
        source: "mcp",
        issueType: "decision",
        title: "wire or remove foo",
        description: "foo is never imported",
        parentId: "EPIC-013",
        priority: 2,
        labels: ["dead-code"],
      }),
    );

    expect(mockTaskCreate).not.toHaveBeenCalled();
    expect(mockCreateTaskDecision).toHaveBeenCalledTimes(1);
    expect(mockCreateTaskDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        namespaceId: "default",
        orgId: "default",
        source: "mcp-create-task",
        parentTaskId: "EPIC-013",
      }),
    );
    expect(mockCreateTaskDecision.mock.calls[0][0].prompt).toContain("wire or remove foo");
    expect(mockCreateTaskDecision.mock.calls[0][0].prompt).toContain("foo is never imported");

    expect(mockTaskUpdate).toHaveBeenCalledTimes(1);
    expect(mockTaskUpdate.mock.calls[0][2]).toMatchObject({
      title: "wire or remove foo",
      labels: ["dead-code"],
      priority: 2,
    });

    expect(result.decision).toEqual({ decisionId: "dec-1", routedTo: "decision" });
    expect(result.chainBinding).toBeNull();
    expect(result.effectiveAutoRun).toEqual({ enabled: false, source: "unscoped" });
  });

  it("uses the ui-create-task decision source for the UI producer", async () => {
    mockCreateTaskDecision.mockResolvedValue({ decision: { id: "dec-2" }, task: { id: "DEC-2" } });
    mockTaskGet.mockReturnValue({ id: "DEC-2" });
    await createTask(baseRequest({ source: "ui", issueType: "decision", title: "should we do X" }));
    expect(mockCreateTaskDecision).toHaveBeenCalledWith(
      expect.objectContaining({ source: "ui-create-task" }),
    );
  });

  it("applies only title (no spurious optional fields) when nothing else was supplied", async () => {
    mockCreateTaskDecision.mockResolvedValue({ decision: { id: "dec-3" }, task: { id: "DEC-3" } });
    mockTaskGet.mockReturnValue({ id: "DEC-3" });
    await createTask(baseRequest({ issueType: "decision", title: "bare decision" }));
    // title is always present (it's the required field), but the allowlist
    // must not manufacture priority/labels/assignee/etc. that were never given.
    expect(mockTaskUpdate).toHaveBeenCalledTimes(1);
    expect(mockTaskUpdate.mock.calls[0][2]).toEqual({ title: "bare decision" });
  });
});

describe("task-creation-service: idempotency (C2)", () => {
  it("stamps a digest for an explicit idempotency key and reports outcome created", async () => {
    queueDbGet(undefined); // no existing row
    const result = await createTask(baseRequest({ idempotencyKey: "my-key" }));
    expect(result.outcome).toBe("created");
    const callArgs = mockTaskCreate.mock.calls[0][1];
    expect(typeof callArgs.metadata.idempotency_key).toBe("string");
    expect(callArgs.metadata.idempotency_key.length).toBeGreaterThan(0);
  });

  it("replays the same explicit idempotency key without creating a duplicate (C5: same idempotency key replay)", async () => {
    queueDbGet(undefined);
    const first = await createTask(baseRequest({ idempotencyKey: "replay-key", title: "first" }));
    expect(mockTaskCreate).toHaveBeenCalledTimes(1);

    queueDbGet({ id: first.task.id });
    mockTaskGet.mockReturnValue({ ...first.task });

    const second = await createTask(baseRequest({ idempotencyKey: "replay-key", title: "first" }));
    expect(mockTaskCreate).toHaveBeenCalledTimes(1); // still 1 -- no second insert
    expect(second.outcome).toBe("existing");
    expect(second.task.id).toBe(first.task.id);
  });

  it("derives a stable key for an agent-created child from namespace+parent+run+agent+logicalKey", async () => {
    mockTaskGet.mockReturnValue({ id: "TASK-001" }); // parent lookup
    queueDbGet(undefined);
    await createTask(
      baseRequest({
        source: "mcp",
        parentId: "TASK-001",
        agentContext: { sourceRunId: "run-1", creatingAgent: "agent-a", logicalKey: "smoke-test-child" },
      }),
    );
    const callArgs = mockTaskCreate.mock.calls[0][1];
    expect(typeof callArgs.metadata.idempotency_key).toBe("string");
  });

  it("the same logicalKey from a different sourceRunId derives a DIFFERENT key (C5: different source run -> new task)", async () => {
    mockTaskGet.mockReturnValue({ id: "TASK-001" });
    queueDbGet(undefined);
    await createTask(
      baseRequest({
        parentId: "TASK-001",
        agentContext: { sourceRunId: "run-1", creatingAgent: "agent-a", logicalKey: "smoke-test-child" },
      }),
    );
    const firstDigest = mockTaskCreate.mock.calls[0][1].metadata.idempotency_key;

    queueDbGet(undefined); // different digest -> lookup for the new digest also misses
    await createTask(
      baseRequest({
        parentId: "TASK-001",
        agentContext: { sourceRunId: "run-2", creatingAgent: "agent-a", logicalKey: "smoke-test-child" },
      }),
    );
    const secondDigest = mockTaskCreate.mock.calls[1][1].metadata.idempotency_key;

    expect(firstDigest).not.toBe(secondDigest);
    expect(mockTaskCreate).toHaveBeenCalledTimes(2);
  });

  it("does not derive a key (always creates) when agentContext is incomplete", async () => {
    mockTaskGet.mockReturnValue({ id: "TASK-001" });
    await createTask(baseRequest({ parentId: "TASK-001", agentContext: { sourceRunId: "run-1" } }));
    const callArgs = mockTaskCreate.mock.calls[0][1];
    expect(callArgs.metadata).toBeUndefined();
  });

  it("recovers from a lost race: taskCreate throws, re-lookup finds the concurrent winner", async () => {
    queueDbGet(undefined); // initial lookup: no existing row
    mockTaskCreate.mockImplementationOnce(() => {
      throw new Error("UNIQUE constraint failed: tasks.idx_tasks_idempotency_key");
    });
    queueDbGet({ id: "TASK-200" }); // post-failure re-lookup: the concurrent winner
    mockTaskGet.mockReturnValue({ id: "TASK-200", title: "winner" });

    const result = await createTask(baseRequest({ idempotencyKey: "race-key" }));
    expect(result.outcome).toBe("existing");
    expect(result.task.id).toBe("TASK-200");
  });

  it("re-throws when taskCreate fails and no concurrent winner is found", async () => {
    queueDbGet(undefined);
    mockTaskCreate.mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    queueDbGet(undefined); // re-lookup also misses
    await expect(createTask(baseRequest({ idempotencyKey: "race-key-2" }))).rejects.toThrow("disk full");
  });
});

describe("task-creation-service: complete response shape (C5: complete response shape)", () => {
  it("includes id/parent/status/assignee on task plus outcome/effectiveAutoRun/chainBinding", async () => {
    mockTaskGet.mockReturnValue({ id: "TASK-001" });
    const result = await createTask(
      baseRequest({ parentId: "TASK-001", assignee: "marco", title: "user assignee case" }),
    );
    expect(result.task).toMatchObject({ id: "TASK-100", parent_id: "TASK-001", status: "open", assignee: "marco" });
    expect(result).toEqual(
      expect.objectContaining({
        outcome: "created",
        effectiveAutoRun: expect.objectContaining({ enabled: expect.any(Boolean), source: expect.any(String) }),
        chainBinding: null,
      }),
    );
  });
});
