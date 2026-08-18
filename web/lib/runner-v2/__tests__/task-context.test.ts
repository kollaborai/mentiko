import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildTaskContext,
  loadTaskContext,
  normalizeTaskComments,
  normalizeTaskRecord,
  parseRawTaskJson,
  taskContextEnvironment,
  validateRawTaskEnvelope,
  writeTaskContextEnv,
} from "../task-context";

function response(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as Response;
}

describe("typed task context contract", () => {
  it("keeps raw JSON parsing and normalized record validation separate", () => {
    expect(parseRawTaskJson('{"data":{"issue":{"id":"TASK-1"}}}')).toEqual({
      data: { issue: { id: "TASK-1" } },
    });
    expect(() => parseRawTaskJson("not-json")).toThrow("invalid JSON");
    expect(() => validateRawTaskEnvelope({ data: { issue: [] } })).toThrow("missing data.issue");
    expect(normalizeTaskRecord({ id: "TASK-1", title: 42, priority: 2 })).toMatchObject({
      id: "TASK-1",
      title: "42",
      priority: "2",
      description: "",
    });
    expect(() => normalizeTaskRecord({ title: "missing id" })).toThrow("data.issue.id is required");
  });

  it("loads the task and optional comments through one typed HTTP owner", async () => {
    const requests: Array<{ url: string; headers: Headers }> = [];
    const result = await loadTaskContext(
      {
        taskId: "TASK/1",
        apiBase: "http://localhost:3200",
        authToken: "secret",
        namespaceId: "tenant",
        orgId: "org",
      },
      {
        fetch: async (url, init) => {
          requests.push({ url, headers: new Headers(init?.headers) });
          if (url.endsWith("/comments")) {
            return response(JSON.stringify({ data: { comments: [{ created_at: "now", author: "Marco", text: "Use 'typed'\nnow" }] } }));
          }
          return response(JSON.stringify({ data: { issue: {
            id: "TASK/1",
            title: "Normalize task context",
            description: "Keep the shell dumb.",
            issue_type: "task",
            priority: 1,
            acceptance_criteria: "No jq",
            design: "Typed owner",
            notes: null,
          } } }));
        },
      },
    );

    expect(requests.map((request) => request.url)).toEqual([
      "http://localhost:3200/api/tasks/TASK%2F1",
      "http://localhost:3200/api/tasks/TASK%2F1/comments",
    ]);
    expect(requests[0].headers.get("authorization")).toBe("Bearer secret");
    expect(requests[0].headers.get("x-namespace-id")).toBe("tenant");
    expect(result.context).toContain("ACCEPTANCE CRITERIA:\nNo jq");
    expect(result.context).toContain("[now Marco] Use 'typed'\nnow");
  });

  it("keeps a task usable when comments are unavailable, but rejects malformed task JSON", async () => {
    const result = await loadTaskContext(
      { taskId: "TASK-2", apiBase: "http://localhost:3200", namespaceId: "default", orgId: "default" },
      {
        fetch: async (url) => url.endsWith("/comments")
          ? response("not found", 404)
          : response(JSON.stringify({ data: { issue: { id: "TASK-2", title: "No comments" } } })),
      },
    );
    expect(result.comments).toEqual([]);
    expect(result.context).not.toContain("COMMENTS:");

    await expect(loadTaskContext(
      { taskId: "TASK-3", apiBase: "http://localhost:3200", namespaceId: "default", orgId: "default" },
      { fetch: async () => response("[]") },
    )).rejects.toThrow("JSON object");
  });

  it("writes all normalized fields as an atomic shell-safe 0600 handoff", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-task-context-"));
    const target = join(root, "context.env");
    const result = {
      task: normalizeTaskRecord({ id: "TASK-4", title: "A 'quoted' title", description: "line 1\nline 2" }),
      comments: normalizeTaskComments([{ created_at: "today", author: "Marco", text: "comment" }]),
      context: buildTaskContext(
        normalizeTaskRecord({ id: "TASK-4", title: "A 'quoted' title", description: "line 1\nline 2" }),
        normalizeTaskComments([{ created_at: "today", author: "Marco", text: "comment" }]),
      ),
    };
    writeTaskContextEnv(target, result);
    const body = readFileSync(target, "utf8");
    expect(body).toContain("export TASK_TITLE='A '\"'\"'quoted'\"'\"' title'");
    expect(body).toContain("export TASK_CONTEXT='");
    expect(statSync(target).mode & 0o777).toBe(0o600);

    writeFileSync(target, body, { mode: 0o644 });
    writeTaskContextEnv(target, result);
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  it("makes launch identity authoritative over stale task design literals", () => {
    const task = normalizeTaskRecord({
      id: "CHOR-001",
      title: "Record current runtime proof",
      description: "Document the execution facts.",
      design: "A prior example mentioned TASK-024 and an older run.",
    });
    const result = {
      task,
      comments: [],
      context: buildTaskContext(task, []),
    };

    const env = taskContextEnvironment(result, {
      sourceRunId: "run-live",
      chainId: "chain-live",
    });

    expect(env.TASK_CONTEXT).toContain("RUNTIME IDENTITY (AUTHORITATIVE FOR THIS LAUNCH — COPY THESE VALUES EXACTLY):");
    expect(env.TASK_CONTEXT).toContain("CURRENT TASK ID: CHOR-001");
    expect(env.TASK_CONTEXT).toContain("CURRENT RUN ID: run-live");
    expect(env.TASK_CONTEXT).toContain("Never copy task/run/workspace/base-commit values from DESCRIPTION, ACCEPTANCE CRITERIA, DESIGN NOTES, NOTES, or examples; those may be historical or proposed.");
    expect(env.TASK_CONTEXT.indexOf("CURRENT TASK ID: CHOR-001")).toBeLessThan(env.TASK_CONTEXT.indexOf("TASK ID: CHOR-001"));
    expect(JSON.parse(env.TASK_CONTEXT_JSON)).toMatchObject({
      runtime_identity: {
        authoritative: true,
        task_id: "CHOR-001",
        source_run_id: "run-live",
        chain_id: "chain-live",
      },
    });
  });
});
