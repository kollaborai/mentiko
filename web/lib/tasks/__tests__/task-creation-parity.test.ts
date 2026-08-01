/**
 * @jest-environment node
 */
// Chain-contract Track C, C5: producer-parity tests. Drives the SAME case
// matrix through the real UI route handler (app/api/tasks/create POST) and
// the real MCP route handler (app/api/mentiko-mcp/ops/tasks POST), asserting
// both go through task-creation-service.ts and land on equivalent outcomes.
//
// The two producers keep their own wire vocabulary (title/type/parent vs.
// subject/issue_type/parentId -- Track C divergence #8) and their own
// envelope (issue vs. task, 201 vs. 200) on purpose; what must be equivalent
// is the DATA a caller gets back: status, priority, assignee, workspace
// scoping, effective auto-run policy, chain binding, and idempotent replay
// behavior.
//
// An in-memory fake task store backs both adapters so idempotency lookups,
// parent validation, and decision-task creation behave exactly like the real
// SQLite store (metadata.idempotency_key scan, taskGet-by-id) without
// touching sqlite -- see lib/tasks/task-store.ts for the real semantics this
// mirrors.

interface FakeTask {
  id: string;
  org_id: string;
  workspace_id: string | null;
  title: string;
  description: string;
  status: string;
  priority: number;
  issue_type: string;
  owner: string;
  assignee: string | null;
  parent_id: string | null;
  labels: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  created_by: string;
  updated_at: string;
  closed_at: string | null;
  acceptance_criteria: string | null;
  design: string | null;
  notes: string | null;
  estimated_minutes: number | null;
  due_at: string | null;
}

let store: Record<string, FakeTask> = {};
let nextIdNum = 100;
const NOW = "2026-07-31T00:00:00.000Z";

function resetStore() {
  store = {};
  nextIdNum = 100;
}

function fakeTaskCreate(orgId: string, input: Record<string, unknown>): FakeTask {
  const id = `TASK-${nextIdNum++}`;
  const record: FakeTask = {
    id,
    org_id: orgId,
    workspace_id: (input.workspace_id as string) ?? null,
    title: input.title as string,
    description: (input.description as string) ?? "",
    status: "open",
    priority: (input.priority as number) ?? 2,
    issue_type: (input.issue_type as string) ?? "task",
    owner: (input.owner as string) ?? "",
    assignee: (input.assignee as string) ?? null,
    parent_id: (input.parent_id as string) ?? null,
    labels: (input.labels as string[]) ?? [],
    metadata: (input.metadata as Record<string, unknown>) ?? {},
    created_at: NOW,
    created_by: (input.created_by as string) ?? "",
    updated_at: NOW,
    closed_at: null,
    acceptance_criteria: null,
    design: null,
    notes: null,
    estimated_minutes: null,
    due_at: null,
  };
  store[id] = record;
  return record;
}

function fakeTaskGet(_orgId: string, id: string): FakeTask | null {
  return store[id] ?? null;
}

function fakeTaskUpdate(_orgId: string, id: string, fields: Record<string, unknown>): void {
  const existing = store[id];
  if (!existing) return;
  store[id] = { ...existing, ...fields } as FakeTask;
}

function fakeGetDb() {
  return {
    prepare: () => ({
      get: (orgId: string, idemDigest: string) => {
        const found = Object.values(store).find(
          (t) => t.org_id === orgId && t.metadata?.idempotency_key === idemDigest,
        );
        return found ? { id: found.id } : undefined;
      },
    }),
  };
}

jest.mock("@/lib/tasks/task-store", () => ({
  taskCreate: (...args: [string, Record<string, unknown>]) => fakeTaskCreate(...args),
  taskGet: (...args: [string, string]) => fakeTaskGet(...args),
  taskUpdate: (...args: [string, string, Record<string, unknown>]) => fakeTaskUpdate(...args),
  _getDb: () => fakeGetDb(),
}));

// One fixture chain, "build-chain", exists; anything else does not.
jest.mock("@/lib/chains/chain-validation", () => ({
  validateChainId: (chainId: string) =>
    chainId === "build-chain"
      ? { valid: true, chainName: "Build Chain" }
      : { valid: false, error: `Chain "${chainId}" does not exist in namespace "default"` },
  buildChainMetadata: (chainId: string, chainName: string, autoRun: boolean) => ({
    chainBinding: { chain_id: chainId, chain_name: chainName, auto_run: autoRun },
  }),
}));

// "/repo" resolves as the workspace whose (fake) system default is ON;
// "/repo-workspace-override" resolves as a workspace with its OWN override
// ON. Anything else is unauthorized -- mirrors resolveAuthorizedWorkspacePath
// scoping every other test file in this repo already uses.
jest.mock("@/lib/auth/workspace-auth", () => ({
  resolveAuthorizedWorkspacePath: (_ns: string, _org: string, ref: string) =>
    ref === "/repo" || ref === "/repo-workspace-override" ? ref : undefined,
}));

jest.mock("@/lib/tasks/task-auto-run-default", () => ({
  resolveTaskAutoRunPolicy: (input: { workspacePath?: string; explicitAutoRun?: boolean }) => {
    if (typeof input.explicitAutoRun === "boolean") {
      return { enabled: input.explicitAutoRun, source: "explicit" };
    }
    if (input.workspacePath === "/repo-workspace-override") {
      return { enabled: true, source: "workspace_override" };
    }
    if (input.workspacePath === "/repo") {
      return { enabled: true, source: "system_default" };
    }
    return { enabled: false, source: "unscoped" };
  },
}));

// createTaskDecision's own dedup/claim machinery is a separate, pre-existing
// system (task-decision-link.ts) that Track C does not touch -- fake just
// enough of its observable contract (creates a linked decision task) for the
// parity assertions to exercise the real routing decision in the service.
jest.mock("@/lib/tasks/task-decision-link", () => ({
  createTaskDecision: async (input: { namespaceId: string; orgId: string; prompt: string; parentTaskId?: string; workspacePath?: string }) => {
    const task = fakeTaskCreate(input.orgId, {
      title: input.prompt.split("\n")[0],
      issue_type: "decision",
      parent_id: input.parentTaskId,
      workspace_id: input.workspacePath,
      metadata: { decision_id: "dec-fixture-1" },
    });
    return { decision: { id: "dec-fixture-1" }, task };
  },
}));

// ---- UI producer auth/plumbing ----
jest.mock("@/lib/auth/api-auth", () => ({
  requirePermission: () => (handler: unknown) => handler,
}));
jest.mock("@/lib/middleware", () => ({
  enforceGuestWrites: async () => null,
}));
jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: async () => "default",
  getOrgIdFromRequest: async () => "default",
}));
jest.mock("@/lib/auth/auth-bridge", () => ({
  getSessionUser: async () => ({ id: "user-1", role: "owner", isAdmin: true, namespaceId: "default" }),
}));

// ---- MCP producer auth/plumbing ----
jest.mock("@/lib/ai-engine/mentiko-mcp-ops-auth", () => ({
  requireOpsAuth: async () => ({
    userId: "user-1",
    sessionId: "session-1",
    namespaceId: "default",
    orgId: "default",
    scopes: ["ops:*"],
  }),
  requireOpsPermission: () => null,
}));

import { POST as uiPost } from "@/app/api/tasks/create/route";
import { POST as mcpPost } from "@/app/api/mentiko-mcp/ops/tasks/route";

function uiRequest(body: Record<string, unknown>, workspace?: string): Request {
  const qs = workspace ? `?workspace=${encodeURIComponent(workspace)}` : "";
  return new Request(`http://localhost:3000/api/tasks/create${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mcpRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost:3000/api/mentiko-mcp/ops/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json", authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}

async function runUi(body: Record<string, unknown>, workspace?: string) {
  const res = await uiPost(uiRequest(body, workspace) as Parameters<typeof uiPost>[0]);
  const json = await res.json();
  return { status: res.status, task: json.data?.issue, creation: json.data?.creation, raw: json };
}

// MCP's error responses are a plain-text body (new NextResponse(message,
// {status})), matching its convention from before Track C -- only the
// success path is JSON. Parse defensively so the parity cases that assert a
// 4xx status don't need to know which shape the body is in.
// Only the fields these parity assertions actually read. Typed rather than
// left as `unknown` so a shape change in either producer fails at compile
// time instead of silently passing an `unknown` through the expectations.
interface ParityTask {
  id: string;
  parent_id?: string;
  assignee?: string;
  status?: string;
  issue_type?: string;
  metadata?: Record<string, unknown>;
}
interface ParityCreation {
  outcome: string;
  effectiveAutoRun: { enabled: boolean; source: string };
  chainBinding: { chainId: string; chainName?: string } | null;
  decision?: { decisionId: string; routedTo: string };
}
interface ParityBody {
  task?: ParityTask;
  creation?: ParityCreation;
  // MCP keeps these top-level for back-compat with its existing consumers.
  decisionId?: string;
  routedTo?: string;
}

async function runMcp(body: Record<string, unknown>) {
  const res = await mcpPost(mcpRequest(body));
  let json: ParityBody = {};
  try {
    json = (await res.json()) as ParityBody;
  } catch {
    json = {};
  }
  return {
    status: res.status,
    // Success-path shape. MCP's 4xx bodies are plain text, and those cases
    // assert only on `status`, so typing these as present keeps every
    // success assertion readable without a `!` on each field access.
    task: json.task as ParityTask,
    creation: json.creation as ParityCreation,
    raw: json,
  };
}

beforeEach(() => {
  resetStore();
});

describe("C5 producer parity: explicit auto-run on", () => {
  it("UI and MCP both report effectiveAutoRun explicit/true and stamp metadata.auto_run", async () => {
    const ui = await runUi({ title: "t", type: "task", chainAssignment: { autoRun: true } });
    const mcp = await runMcp({ subject: "t", autoRun: true });

    for (const r of [ui, mcp]) {
      expect(r.creation.effectiveAutoRun).toEqual({ enabled: true, source: "explicit" });
      expect(r.task.metadata.auto_run).toBe(true);
    }
  });
});

describe("C5 producer parity: explicit auto-run off (overrides a true workspace default)", () => {
  it("UI and MCP both report explicit/false and do not stamp auto_run, even under a default-ON workspace", async () => {
    const ui = await runUi(
      { title: "t", type: "task", chainAssignment: { autoRun: false } },
      "/repo-workspace-override",
    );
    const mcp = await runMcp({ subject: "t", autoRun: false, workspacePath: "/repo-workspace-override" });

    for (const r of [ui, mcp]) {
      expect(r.creation.effectiveAutoRun).toEqual({ enabled: false, source: "explicit" });
      expect(r.task.metadata.auto_run).toBeUndefined();
    }
  });
});

describe("C5 producer parity: inherited workspace default", () => {
  it("UI and MCP both resolve the workspace override without an explicit flag", async () => {
    const ui = await runUi({ title: "t", type: "task" }, "/repo-workspace-override");
    const mcp = await runMcp({ subject: "t", workspacePath: "/repo-workspace-override" });

    for (const r of [ui, mcp]) {
      expect(r.creation.effectiveAutoRun).toEqual({ enabled: true, source: "workspace_override" });
    }
  });
});

describe("C5 producer parity: inherited system default", () => {
  it("UI and MCP both fall through workspace inherit to the system default", async () => {
    const ui = await runUi({ title: "t", type: "task" }, "/repo");
    const mcp = await runMcp({ subject: "t", workspacePath: "/repo" });

    for (const r of [ui, mcp]) {
      expect(r.creation.effectiveAutoRun).toEqual({ enabled: true, source: "system_default" });
    }
  });
});

describe("C5 producer parity: child task with parent", () => {
  it("UI and MCP both link a new task under an existing parent", async () => {
    const parent = fakeTaskCreate("default", { title: "parent" });
    const ui = await runUi({ title: "child-ui", type: "task", parent: parent.id });
    const mcp = await runMcp({ subject: "child-mcp", parentId: parent.id });

    expect(ui.task.parent_id).toBe(parent.id);
    expect(mcp.task.parent_id).toBe(parent.id);
  });
});

describe("C5 producer parity: invalid parent", () => {
  it("UI and MCP both reject a parent id that does not exist", async () => {
    const ui = await runUi({ title: "child", type: "task", parent: "TASK-DOES-NOT-EXIST" });
    const mcp = await runMcp({ subject: "child", parentId: "TASK-DOES-NOT-EXIST" });

    expect(ui.status).toBe(404);
    expect(mcp.status).toBe(404);
  });
});

describe("C5 producer parity: decision task routing", () => {
  it("UI and MCP both route issue_type/type decision through createTaskDecision, not a plain task", async () => {
    const ui = await runUi({ title: "should we do X", description: "context", type: "decision" });
    const mcp = await runMcp({ subject: "should we do Y", desc: "context", issue_type: "decision" });

    expect(ui.creation.decision).toEqual({ decisionId: "dec-fixture-1", routedTo: "decision" });
    expect(ui.task.issue_type).toBe("decision");
    expect(mcp.creation.decision).toEqual({ decisionId: "dec-fixture-1", routedTo: "decision" });
    expect(mcp.raw.routedTo).toBe("decision"); // MCP back-compat top-level field
    expect(mcp.task.issue_type).toBe("decision");
  });
});

describe("C5 producer parity: same idempotency key replay", () => {
  it("UI: replaying the same explicit key returns the existing task, not a duplicate", async () => {
    const first = await runUi({ title: "dup", type: "task", idempotencyKey: "ui-key-1" });
    const second = await runUi({ title: "dup", type: "task", idempotencyKey: "ui-key-1" });
    expect(first.status).toBe(201);
    expect(first.creation.outcome).toBe("created");
    expect(second.status).toBe(200);
    expect(second.creation.outcome).toBe("existing");
    expect(second.task.id).toBe(first.task.id);
  });

  it("MCP: replaying the same explicit key returns the existing task, not a duplicate", async () => {
    const first = await runMcp({ subject: "dup", idempotencyKey: "mcp-key-1" });
    const second = await runMcp({ subject: "dup", idempotencyKey: "mcp-key-1" });
    expect(first.creation.outcome).toBe("created");
    expect(second.creation.outcome).toBe("existing");
    expect(second.task.id).toBe(first.task.id);
  });
});

describe("C5 producer parity: same logical key from a different source run", () => {
  // "source run" is a chain-execution concept with no UI equivalent (a human
  // clicking "create" has no run id) -- exercised on MCP via agentContext,
  // and on UI via the general principle it specializes: a DIFFERENT key
  // never replays, it always creates a new task.
  it("MCP: same logicalKey + different sourceRunId derives a different key and creates a new task", async () => {
    const parent = fakeTaskCreate("default", { title: "parent" });
    const first = await runMcp({
      subject: "child A", parentId: parent.id,
      logicalKey: "smoke-test-child", sourceRunId: "run-1", creatingAgent: "agent-3",
    });
    const second = await runMcp({
      subject: "child B", parentId: parent.id,
      logicalKey: "smoke-test-child", sourceRunId: "run-2", creatingAgent: "agent-3",
    });
    expect(first.creation.outcome).toBe("created");
    expect(second.creation.outcome).toBe("created");
    expect(second.task.id).not.toBe(first.task.id);
  });

  it("UI: a different explicit idempotency key likewise creates a new task rather than replaying", async () => {
    const first = await runUi({ title: "dup", type: "task", idempotencyKey: "ui-key-a" });
    const second = await runUi({ title: "dup", type: "task", idempotencyKey: "ui-key-b" });
    expect(first.creation.outcome).toBe("created");
    expect(second.creation.outcome).toBe("created");
    expect(second.task.id).not.toBe(first.task.id);
  });
});

describe("C5 producer parity: user assignee", () => {
  it("UI and MCP both persist a plain human assignee identically", async () => {
    const ui = await runUi({ title: "t", type: "task", assignee: "marco" });
    const mcp = await runMcp({ subject: "t", assignee: "marco" });
    expect(ui.task.assignee).toBe("marco");
    expect(mcp.task.assignee).toBe("marco");
  });
});

describe("C5 producer parity: chain binding metadata", () => {
  it("UI and MCP both stamp equivalent chain-binding metadata and report it in creation.chainBinding", async () => {
    const ui = await runUi({ title: "t", type: "task", chainAssignment: { chainId: "build-chain" } });
    const mcp = await runMcp({ subject: "t", chainId: "build-chain" });

    for (const r of [ui, mcp]) {
      expect(r.creation.chainBinding).toEqual({ chainId: "build-chain", chainName: "Build Chain" });
      expect(r.task.metadata.chainBinding).toEqual({
        chain_id: "build-chain",
        chain_name: "Build Chain",
        auto_run: expect.any(Boolean),
      });
    }
  });
});

describe("C5 producer parity: unauthorized namespace/workspace", () => {
  it("UI and MCP both reject a workspace the caller is not authorized for", async () => {
    const ui = await runUi({ title: "t", type: "task" }, "/someone-elses-repo");
    const mcp = await runMcp({ subject: "t", workspacePath: "/someone-elses-repo" });
    expect(ui.status).toBe(403);
    expect(mcp.status).toBe(403);
  });
});

describe("C5 producer parity: complete response shape", () => {
  it("UI and MCP both return id/status/assignee on the task plus outcome/effectiveAutoRun/chainBinding on creation", async () => {
    const ui = await runUi({ title: "t", type: "task", assignee: "marco" });
    const mcp = await runMcp({ subject: "t", assignee: "marco" });

    for (const r of [ui, mcp]) {
      expect(typeof r.task.id).toBe("string");
      expect(r.task.status).toBe("open");
      expect(r.task.assignee).toBe("marco");
      expect(r.creation.outcome).toBe("created");
      expect(r.creation.effectiveAutoRun).toEqual({ enabled: expect.any(Boolean), source: expect.any(String) });
      expect(r.creation).toHaveProperty("chainBinding");
    }
  });
});
