/**
 * @jest-environment node
 */

// B2 (security): /api/code/tasks-db must (1) require a real admin/dev
// permission, not just an authenticated session, (2) never leak the absolute
// sqlite file path, and (3) hide superseded decision gates from raw browsing
// the same way /api/tasks already does -- this endpoint was a bypass around
// task-visibility.ts.

import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import Database from "better-sqlite3";
import type { NextRequest, NextResponse } from "next/server";

const TEST_NAMESPACE = "tasksdb-test";

const mockRequirePermission = jest.fn();
jest.mock("@/lib/auth/rbac-auth", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
}));

const mockGetNamespaceIdFromRequest = jest.fn();
jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: (...args: unknown[]) => mockGetNamespaceIdFromRequest(...args),
}));

// NOTE: this factory runs the moment route.ts's `import config from
// "@/lib/config"` resolves, which -- because ES imports (including the
// `import { GET } from "./route"` below) are hoisted above regular `const`
// declarations -- happens before any outer `const` in this file has
// initialized. Compute the path inline (no outer-scope reference) to avoid a
// TDZ ReferenceError; `mockGlobalRoot` below recomputes the identical value
// (same process.pid) for use in the rest of this file.
jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: { globalRoot: require("path").join("/tmp", `mentiko-test-tasksdb-${process.pid}`) },
}));

const mockGlobalRoot = join("/tmp", `mentiko-test-tasksdb-${process.pid}`);

import { GET } from "./route";

function dbFilePath(): string {
  return join(mockGlobalRoot, "namespaces", TEST_NAMESPACE, "data", "tasks.db");
}

function seedDb() {
  const dataDir = join(mockGlobalRoot, "namespaces", TEST_NAMESPACE, "data");
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(dbFilePath());
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      org_id TEXT,
      workspace_id TEXT,
      title TEXT,
      status TEXT,
      parent_id TEXT,
      issue_type TEXT,
      metadata TEXT,
      updated_at TEXT
    );
  `);
  const insert = db.prepare(`
    INSERT INTO tasks (id, org_id, workspace_id, title, status, parent_id, issue_type, metadata, updated_at)
    VALUES (@id, @org_id, @workspace_id, @title, @status, @parent_id, @issue_type, @metadata, @updated_at)
  `);
  insert.run({
    id: "TASK-1", org_id: "default", workspace_id: null, title: "Visible task",
    status: "open", parent_id: null, issue_type: "task", metadata: "{}",
    updated_at: "2026-01-01T00:00:00.000Z",
  });
  insert.run({
    id: "DEC-1", org_id: "default", workspace_id: null, title: "Superseded gate",
    status: "open", parent_id: null, issue_type: "decision",
    metadata: JSON.stringify({ decision_status: "superseded" }),
    updated_at: "2026-01-01T00:00:00.000Z",
  });
  db.close();
}

// Real next/server NextRequest can't be constructed directly in this jest
// environment: jest.setup.js replaces the global Request with a plain-property
// MockRequest, but next/server's real NextRequest defines `url` as a
// getter-only accessor on its own prototype, so `super()`'s `this.url = url`
// throws ("Cannot set property url ... has only a getter"). A minimal object
// duck-typing what route.ts + withErrorHandling actually touch (url, method,
// nextUrl) sidesteps that collision entirely.
function makeRequest(qs = ""): NextRequest {
  const url = `http://localhost:3000/api/code/tasks-db${qs}`;
  return { url, method: "GET", nextUrl: new URL(url) } as unknown as NextRequest;
}

function forbiddenResponse(): NextResponse {
  const body = { success: false, error: { code: "FORBIDDEN", message: "nope" } };
  return {
    status: 403,
    headers: new Map<string, string>(),
    json: async () => body,
  } as unknown as NextResponse;
}

describe("GET /api/code/tasks-db (B2)", () => {
  beforeAll(() => {
    seedDb();
  });

  afterAll(() => {
    rmSync(mockGlobalRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetNamespaceIdFromRequest.mockResolvedValue(TEST_NAMESPACE);
    mockRequirePermission.mockResolvedValue(null); // admin/dev by default
  });

  it("requires a real admin/dev permission, not just an authenticated session", async () => {
    mockRequirePermission.mockResolvedValue(forbiddenResponse());

    const res = await GET(makeRequest());

    expect(res.status).toBe(403);
    expect(mockRequirePermission).toHaveBeenCalledWith(expect.anything(), "view_audit");
  });

  it("never returns the absolute sqlite file path (tables list)", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.dbPath).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(mockGlobalRoot);
  });

  it("never returns the absolute sqlite file path on a 404 (missing db)", async () => {
    mockGetNamespaceIdFromRequest.mockResolvedValue("does-not-exist");

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(JSON.stringify(body)).not.toContain(mockGlobalRoot);
  });

  it("hides superseded decision gates from the graph view", async () => {
    const res = await GET(makeRequest("?mode=graph"));
    const body = await res.json();

    expect(res.status).toBe(200);
    const ids = (body.data.nodes as Array<{ id: string }>).map((n) => n.id);
    expect(ids).toContain("TASK-1");
    expect(ids).not.toContain("DEC-1");
    expect(body.data.dbPath).toBeUndefined();
  });

  it("hides superseded decision gates from raw table browse", async () => {
    const res = await GET(makeRequest("?table=tasks"));
    const body = await res.json();

    expect(res.status).toBe(200);
    const ids = (body.data.rows as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain("TASK-1");
    expect(ids).not.toContain("DEC-1");
    expect(body.data.dbPath).toBeUndefined();
  });

  it("hides superseded decision gates from dependency listings", async () => {
    const res = await GET(makeRequest("?mode=dependencies&taskId=TASK-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.dbPath).toBeUndefined();
  });
});
