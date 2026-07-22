import {
  taskCreate,
  taskGet,
  taskList,
  taskUpdate,
  taskClaimMetadataKeyIfUnset,
  taskClose,
  taskAddDep,
  taskRemoveDep,
  taskGetAllDeps,
  taskDepsAllClosed,
  taskGetComments,
  taskAddComment,
  taskGetActivity,
  validateTaskId,
  isTerminalTaskStatus,
  closeAll,
  _getDb,
} from "../tasks/task-store";

jest.mock("../config", () => ({
  __esModule: true,
  default: {
    globalRoot: "/tmp/mentiko-test-" + process.pid,
    codeRoot: "/tmp",
  },
}));

afterAll(() => {
  closeAll();
});

describe("task-store", () => {
  // ---- ID generation ----

  describe("ID generation", () => {
    it("generates prefixed IDs by issue type", () => {
      expect(taskCreate("org1", { title: "e", issue_type: "epic" }).id).toBe("EPIC-001");
      expect(taskCreate("org1", { title: "f", issue_type: "feature" }).id).toBe("FEAT-001");
      expect(taskCreate("org1", { title: "t", issue_type: "task" }).id).toBe("TASK-001");
      expect(taskCreate("org1", { title: "b", issue_type: "bug" }).id).toBe("BUG-001");
      expect(taskCreate("org1", { title: "c", issue_type: "chore" }).id).toBe("CHOR-001");
    });

    it("auto-increments within same prefix", () => {
      const t1 = taskCreate("org1", { title: "t2" });
      const t2 = taskCreate("org1", { title: "t3" });
      expect(t1.id).toBe("TASK-002");
      expect(t2.id).toBe("TASK-003");
    });

    it("generates globally unique IDs across orgs", () => {
      const a = taskCreate("iso-a", { title: "a" });
      const b = taskCreate("iso-b", { title: "b" });
      expect(a.id).not.toBe(b.id);
    });

    it("defaults unknown issue_type to TASK prefix", () => {
      const t = taskCreate("org1", { title: "x", issue_type: "unknown" as string });
      expect(t.id).toMatch(/^TASK-/);
    });
  });

  // ---- CRUD ----

  describe("create + get", () => {
    it("creates with all fields and retrieves", () => {
      const t = taskCreate("crud", {
        title: "Full task",
        description: "desc",
        issue_type: "feature",
        priority: 1,
        assignee: "marco",
        labels: ["ui", "urgent"],
        metadata: { chain_id: "abc", auto_run: true },
        notes: "some notes",
        acceptance_criteria: "it works",
        design: "simple",
        estimated_minutes: 60,
        due_at: "2026-04-15T00:00:00Z",
        owner: "opus",
        created_by: "test",
        workspace_id: "/path/to/ws",
      });

      const fetched = taskGet("crud", t.id)!;
      expect(fetched).not.toBeNull();
      expect(fetched.title).toBe("Full task");
      expect(fetched.description).toBe("desc");
      expect(fetched.issue_type).toBe("feature");
      expect(fetched.priority).toBe(1);
      expect(fetched.assignee).toBe("marco");
      expect(fetched.labels).toEqual(["ui", "urgent"]);
      expect(fetched.metadata).toEqual({ chain_id: "abc", auto_run: true });
      expect(fetched.notes).toBe("some notes");
      expect(fetched.acceptance_criteria).toBe("it works");
      expect(fetched.design).toBe("simple");
      expect(fetched.estimated_minutes).toBe(60);
      expect(fetched.due_at).toBe("2026-04-15T00:00:00Z");
      expect(fetched.owner).toBe("opus");
      expect(fetched.created_by).toBe("test");
      expect(fetched.workspace_id).toBe("/path/to/ws");
      expect(fetched.status).toBe("open");
      expect(fetched.closed_at).toBeNull();
      expect(fetched.dependency_count).toBe(0);
      expect(fetched.dependent_count).toBe(0);
      expect(fetched.comment_count).toBe(0);
    });

    it("returns null for nonexistent task", () => {
      expect(taskGet("crud", "TASK-999")).toBeNull();
    });

    it("enforces org isolation on get", () => {
      const t = taskCreate("secret-org", { title: "hidden" });
      expect(taskGet("other-org", t.id)).toBeNull();
    });

    it("creates with defaults when minimal input", () => {
      const t = taskCreate("min", { title: "bare minimum" });
      expect(t.priority).toBe(2);
      expect(t.issue_type).toBe("task");
      expect(t.status).toBe("open");
      expect(t.labels).toEqual([]);
      expect(t.metadata).toEqual({});
    });

    it("handles parent_id", () => {
      const parent = taskCreate("parent-org", { title: "Epic", issue_type: "epic" });
      const child = taskCreate("parent-org", { title: "Child", parent_id: parent.id });
      const fetched = taskGet("parent-org", child.id)!;
      expect(fetched.parent_id).toBe(parent.id);
    });

    it("child inherits parent workspace_id when none is specified", () => {
      const parent = taskCreate("inherit-org", {
        title: "Epic",
        issue_type: "epic",
        workspace_id: "/ws/mentiko",
      });
      // child created with no explicit workspace -> inherits parent's
      const child = taskCreate("inherit-org", { title: "Child", parent_id: parent.id });
      expect(taskGet("inherit-org", child.id)!.workspace_id).toBe("/ws/mentiko");
    });

    it("child keeps an explicit workspace_id over the parent's", () => {
      const parent = taskCreate("inherit-org-2", {
        title: "Epic",
        workspace_id: "/ws/mentiko",
      });
      const child = taskCreate("inherit-org-2", {
        title: "Child",
        parent_id: parent.id,
        workspace_id: "/ws/other",
      });
      expect(taskGet("inherit-org-2", child.id)!.workspace_id).toBe("/ws/other");
    });

    it("child stays NULL when parent is also unscoped", () => {
      const parent = taskCreate("inherit-org-3", { title: "Epic" });
      const child = taskCreate("inherit-org-3", { title: "Child", parent_id: parent.id });
      expect(taskGet("inherit-org-3", child.id)!.workspace_id).toBeNull();
    });
  });

  // ---- startup repair sweep (workspace_id backfill from parent) ----

  describe("startup repair sweep", () => {
    it("backfills NULL workspace_id from a workspace-scoped parent on reconnect", () => {
      const NS = "repair-ns";
      const ORG = "repair-org";
      const parent = taskCreate(ORG, {
        title: "Scoped epic",
        issue_type: "epic",
        workspace_id: "/ws/repair",
      }, NS);
      // Simulate a legacy orphan: raw-insert a child with NULL workspace_id,
      // bypassing taskCreate's inheritance.
      const db = _getDb(NS);
      db.prepare(
        `INSERT INTO tasks (id, org_id, workspace_id, title, status, priority, issue_type, parent_id, labels, metadata, created_at, created_by, updated_at)
         VALUES ('ORPHAN-1', ?, NULL, 'legacy orphan', 'open', 2, 'task', ?, '[]', '{}', ?, 'legacy', ?)`,
      ).run(ORG, parent.id, new Date().toISOString(), new Date().toISOString());
      expect(taskGet(ORG, "ORPHAN-1", NS)!.workspace_id).toBeNull();

      // Closing + reopening the connection re-runs runMigrations, which fires
      // the invariant repair sweep.
      closeAll();
      const repaired = taskGet(ORG, "ORPHAN-1", NS);
      expect(repaired!.workspace_id).toBe("/ws/repair");
    });

    it("leaves genuinely-global tasks (no parent) NULL", () => {
      const NS = "repair-ns-2";
      const ORG = "repair-org-2";
      taskCreate(ORG, { title: "global task" }, NS); // no parent, no workspace
      closeAll();
      const tasks = taskList(ORG, { status: "all" }, undefined, NS);
      const global = tasks.find((t) => t.title === "global task");
      expect(global!.workspace_id).toBeNull();
    });

    it("repairs terminal timestamps and stale reopened timestamps on reconnect", () => {
      const NS = "repair-terminal-ns";
      const ORG = "repair-terminal-org";
      const terminal = taskCreate(ORG, { title: "legacy terminal" }, NS);
      const reopened = taskCreate(ORG, { title: "legacy reopened" }, NS);
      const db = _getDb(NS);
      db.prepare("UPDATE tasks SET status = 'complete', closed_at = NULL WHERE id = ?").run(terminal.id);
      db.prepare("UPDATE tasks SET status = 'open', closed_at = ? WHERE id = ?")
        .run("2026-01-01T00:00:00.000Z", reopened.id);

      closeAll();

      expect(taskGet(ORG, terminal.id, NS)!.closed_at).toBeTruthy();
      expect(taskGet(ORG, reopened.id, NS)!.closed_at).toBeNull();
    });
  });

  // ---- list ----

  describe("taskList", () => {
    const ORG = "list-org";

    beforeAll(() => {
      taskCreate(ORG, { title: "Open 1" });
      taskCreate(ORG, { title: "Open 2", issue_type: "bug" });
      const toClose = taskCreate(ORG, { title: "Closed one" });
      taskClose(ORG, toClose.id);
      for (const status of ["complete", "resolved", "done"]) {
        const terminal = taskCreate(ORG, { title: `${status} one` });
        taskUpdate(ORG, terminal.id, { status });
      }
      taskCreate(ORG, { title: "WS scoped", workspace_id: "/ws/alpha" });
      taskCreate("other-list-org", { title: "Wrong org" });
    });

    it("lists only this org and excludes every terminal status by default", () => {
      const tasks = taskList(ORG);
      expect(tasks.every((t) => t.org_id === ORG)).toBe(true);
      expect(tasks.every((t) => !isTerminalTaskStatus(t.status))).toBe(true);
    });

    it("includes every terminal status with status=all", () => {
      const all = taskList(ORG, { status: "all" });
      for (const status of ["closed", "complete", "resolved", "done"]) {
        expect(all.some((t) => t.status === status)).toBe(true);
      }
    });

    it("filters by status", () => {
      const closed = taskList(ORG, { status: "closed" });
      expect(closed.every((t) => t.status === "closed")).toBe(true);
      expect(closed.length).toBe(1);
    });

    it("filters by issue_type", () => {
      const bugs = taskList(ORG, { issue_type: "bug", status: "all" });
      expect(bugs.every((t) => t.issue_type === "bug")).toBe(true);
    });

    it("filters by workspace_id", () => {
      const ws = taskList(ORG, { status: "all" }, "/ws/alpha");
      expect(ws.length).toBe(1);
      expect(ws[0].workspace_id).toBe("/ws/alpha");
    });

    it("searches by title query", () => {
      const results = taskList(ORG, { query: "Closed" });
      // default excludes closed, so searching for "Closed" with default filter = 0
      expect(results.length).toBe(0);
      const all = taskList(ORG, { query: "Closed", status: "all" });
      expect(all.length).toBe(1);
    });

    it("includes dep/comment counts", () => {
      const tasks = taskList(ORG);
      for (const t of tasks) {
        expect(typeof t.dependency_count).toBe("number");
        expect(typeof t.dependent_count).toBe("number");
        expect(typeof t.comment_count).toBe("number");
      }
    });
  });

  // ---- update ----

  describe("taskUpdate", () => {
    it("updates basic fields", () => {
      const t = taskCreate("upd", { title: "Original", priority: 2 });
      taskUpdate("upd", t.id, { title: "Changed", priority: 0, assignee: "marco" });
      const fetched = taskGet("upd", t.id)!;
      expect(fetched.title).toBe("Changed");
      expect(fetched.priority).toBe(0);
      expect(fetched.assignee).toBe("marco");
    });

    it("sets closed_at when status=closed", () => {
      const t = taskCreate("upd", { title: "To close" });
      taskUpdate("upd", t.id, { status: "closed" });
      const fetched = taskGet("upd", t.id)!;
      expect(fetched.status).toBe("closed");
      expect(fetched.closed_at).toBeTruthy();
    });

    it("clears closed_at when a closed task is reopened", () => {
      const t = taskCreate("upd", { title: "To reopen" });
      taskUpdate("upd", t.id, { status: "closed" });
      expect(taskGet("upd", t.id)!.closed_at).toBeTruthy();

      taskUpdate("upd", t.id, { status: "open" });

      const fetched = taskGet("upd", t.id)!;
      expect(fetched.status).toBe("open");
      expect(fetched.closed_at).toBeNull();
    });

    // B4: `complete` is terminal alongside `closed` (auto-run admission and
    // the UI transform both treat it as done) -- taskUpdate previously only
    // special-cased `closed`, so a task patched to `complete` had no
    // closed_at at all.
    it("sets closed_at when status=complete", () => {
      const t = taskCreate("upd", { title: "To complete" });
      taskUpdate("upd", t.id, { status: "complete" });
      const fetched = taskGet("upd", t.id)!;
      expect(fetched.status).toBe("complete");
      expect(fetched.closed_at).toBeTruthy();
    });

    it.each(["resolved", "done"])("sets closed_at when status=%s", (status) => {
      const t = taskCreate("upd", { title: `To ${status}` });
      taskUpdate("upd", t.id, { status });
      const fetched = taskGet("upd", t.id)!;
      expect(fetched.status).toBe(status);
      expect(fetched.closed_at).toBeTruthy();
    });

    it("clears closed_at when a complete task is reopened", () => {
      const t = taskCreate("upd", { title: "To reopen from complete" });
      taskUpdate("upd", t.id, { status: "complete" });
      expect(taskGet("upd", t.id)!.closed_at).toBeTruthy();

      taskUpdate("upd", t.id, { status: "in_progress" });

      const fetched = taskGet("upd", t.id)!;
      expect(fetched.status).toBe("in_progress");
      expect(fetched.closed_at).toBeNull();
    });

    it("replaces metadata entirely", () => {
      const t = taskCreate("upd", { title: "Meta", metadata: { a: 1, b: 2 } });
      taskUpdate("upd", t.id, { metadata: { c: 3 } });
      const fetched = taskGet("upd", t.id)!;
      expect(fetched.metadata).toEqual({ c: 3 });
    });

    it("claims metadata atomically without overwriting sibling fields", () => {
      const t = taskCreate("upd", {
        title: "Claim",
        metadata: { auto_run_retries: 2, generation_last_error: "old", sibling: "keep" },
      });

      expect(taskClaimMetadataKeyIfUnset("upd", t.id, "generation_job_id", {
        generation_job_id: "claim-1",
        generation_status: "starting",
        generation_last_error: undefined,
      }, undefined, {
        metadataNumberLessThan: { key: "auto_run_retries", value: 3 },
      })).toBe(true);

      expect(taskGet("upd", t.id)!.metadata).toEqual({
        auto_run_retries: 2,
        generation_job_id: "claim-1",
        generation_status: "starting",
        sibling: "keep",
      });
    });

    it("rejects a generation claim once the retry ceiling is reached", () => {
      const t = taskCreate("upd", {
        title: "Claim ceiling",
        metadata: { auto_run_retries: 3 },
      });

      expect(taskClaimMetadataKeyIfUnset("upd", t.id, "generation_job_id", {
        generation_job_id: "claim-too-late",
      }, undefined, {
        metadataNumberLessThan: { key: "auto_run_retries", value: 3 },
      })).toBe(false);
      expect(taskGet("upd", t.id)!.metadata).toEqual({ auto_run_retries: 3 });
    });

    it("replaces labels entirely", () => {
      const t = taskCreate("upd", { title: "Labels", labels: ["x", "y"] });
      taskUpdate("upd", t.id, { labels: ["z"] });
      const fetched = taskGet("upd", t.id)!;
      expect(fetched.labels).toEqual(["z"]);
    });

    it("bumps updated_at", () => {
      const t = taskCreate("upd", { title: "Bump" });
      const before = t.updated_at;
      // tiny delay to ensure different timestamp
      taskUpdate("upd", t.id, { title: "Bumped" });
      const fetched = taskGet("upd", t.id)!;
      expect(fetched.updated_at >= before).toBe(true);
    });
  });

  // ---- close ----

  describe("taskClose", () => {
    it("sets status to closed and closed_at", () => {
      const t = taskCreate("close-org", { title: "To close" });
      taskClose("close-org", t.id);
      const fetched = taskGet("close-org", t.id)!;
      expect(fetched.status).toBe("closed");
      expect(fetched.closed_at).toBeTruthy();
    });
  });

  // ---- dependencies ----

  describe("dependencies", () => {
    const ORG = "dep-org";

    it("adds and retrieves deps", () => {
      const blocker = taskCreate(ORG, { title: "Blocker" });
      const blocked = taskCreate(ORG, { title: "Blocked" });
      taskAddDep(ORG, blocked.id, blocker.id);

      const fetched = taskGet(ORG, blocked.id)!;
      expect(fetched.dependencies!.length).toBe(1);
      expect(fetched.dependencies![0].depends_on_id).toBe(blocker.id);
      expect(fetched.dependency_count).toBe(1);

      const b = taskGet(ORG, blocker.id)!;
      expect(b.dependents!.length).toBe(1);
      expect(b.dependent_count).toBe(1);
    });

    it("removes deps", () => {
      const a = taskCreate(ORG, { title: "A" });
      const b = taskCreate(ORG, { title: "B" });
      taskAddDep(ORG, b.id, a.id);
      taskRemoveDep(ORG, b.id, a.id);
      expect(taskGet(ORG, b.id)!.dependencies!.length).toBe(0);
    });

    it("prevents cross-org dep creation", () => {
      const a = taskCreate("dep-x", { title: "X" });
      const b = taskCreate("dep-y", { title: "Y" });
      expect(() => taskAddDep("dep-x", a.id, b.id)).toThrow();
    });

    it("prevents cross-workspace dep creation when scoped", () => {
      const a = taskCreate(ORG, { title: "A", workspace_id: "/ws/a" });
      const b = taskCreate(ORG, { title: "B", workspace_id: "/ws/b" });
      expect(() => taskAddDep(ORG, a.id, b.id, undefined, "/ws/a")).toThrow();
    });

    it("taskDepsAllClosed recognizes every terminal dependency status", () => {
      const dep = taskCreate(ORG, { title: "Dep" });
      const task = taskCreate(ORG, { title: "Task" });
      taskAddDep(ORG, task.id, dep.id);
      expect(taskDepsAllClosed(ORG, task.id)).toBe(false);
      for (const status of ["closed", "complete", "resolved", "done"]) {
        taskUpdate(ORG, dep.id, { status });
        expect(taskDepsAllClosed(ORG, task.id)).toBe(true);
        taskUpdate(ORG, dep.id, { status: "open" });
        expect(taskDepsAllClosed(ORG, task.id)).toBe(false);
      }
    });

    it("taskDepsAllClosed returns true when no deps", () => {
      const t = taskCreate(ORG, { title: "No deps" });
      expect(taskDepsAllClosed(ORG, t.id)).toBe(true);
    });

    it("taskGetAllDeps returns all org deps", () => {
      const orgId = "alldeps";
      const a = taskCreate(orgId, { title: "A" });
      const b = taskCreate(orgId, { title: "B" });
      const c = taskCreate(orgId, { title: "C" });
      taskAddDep(orgId, b.id, a.id);
      taskAddDep(orgId, c.id, b.id);
      const allDeps = taskGetAllDeps(orgId);
      expect(allDeps.length).toBe(2);
    });

    it("ignores duplicate dep inserts", () => {
      const a = taskCreate(ORG, { title: "Dup A" });
      const b = taskCreate(ORG, { title: "Dup B" });
      taskAddDep(ORG, b.id, a.id);
      taskAddDep(ORG, b.id, a.id); // duplicate
      expect(taskGet(ORG, b.id)!.dependencies!.length).toBe(1);
    });

    it("expands dep fields (title, status, priority)", () => {
      const a = taskCreate(ORG, { title: "Expanded", issue_type: "bug", priority: 0 });
      const b = taskCreate(ORG, { title: "Has dep" });
      taskAddDep(ORG, b.id, a.id);
      const dep = taskGet(ORG, b.id)!.dependencies![0];
      expect(dep.title).toBe("Expanded");
      expect(dep.issue_type).toBe("bug");
      expect(dep.priority).toBe(0);
    });
  });

  // ---- comments ----

  describe("comments", () => {
    const ORG = "cmt-org";

    it("adds and retrieves comments", () => {
      const t = taskCreate(ORG, { title: "Commentable" });
      taskAddComment(ORG, t.id, "marco", "first");
      taskAddComment(ORG, t.id, "opus", "second");
      const comments = taskGetComments(ORG, t.id);
      expect(comments.length).toBe(2);
      expect(comments[0].text).toBe("first");
      expect(comments[0].author).toBe("marco");
      expect(comments[1].author).toBe("opus");
    });

    it("returns empty for wrong org", () => {
      const t = taskCreate(ORG, { title: "Private" });
      taskAddComment(ORG, t.id, "a", "secret");
      expect(taskGetComments("wrong-org", t.id)).toEqual([]);
    });

    it("throws when adding comment to nonexistent task", () => {
      expect(() => taskAddComment(ORG, "TASK-999", "a", "nope")).toThrow();
    });

    it("updates comment_count on get", () => {
      const t = taskCreate(ORG, { title: "Count" });
      taskAddComment(ORG, t.id, "a", "c1");
      taskAddComment(ORG, t.id, "a", "c2");
      taskAddComment(ORG, t.id, "a", "c3");
      expect(taskGet(ORG, t.id)!.comment_count).toBe(3);
    });
  });

  // ---- activity ----

  describe("taskGetActivity", () => {
    it("returns recently updated tasks", () => {
      const orgId = "act-org";
      taskCreate(orgId, { title: "Recent" });
      const since = Date.now() - 60000;
      const activity = taskGetActivity(orgId, since);
      expect(activity.length).toBeGreaterThanOrEqual(1);
    });

    it("filters by workspace_id", () => {
      const orgId = "act-ws";
      taskCreate(orgId, { title: "WS1", workspace_id: "/ws/1" });
      taskCreate(orgId, { title: "WS2", workspace_id: "/ws/2" });
      const since = Date.now() - 60000;
      const ws1 = taskGetActivity(orgId, since, "/ws/1");
      expect(ws1.length).toBe(1);
      expect(ws1[0].title).toBe("WS1");
    });

    it("returns empty for future since", () => {
      const orgId = "act-future";
      taskCreate(orgId, { title: "Past" });
      const activity = taskGetActivity(orgId, Date.now() + 60000);
      expect(activity.length).toBe(0);
    });
  });

  // ---- validation ----

  describe("validateTaskId", () => {
    it("accepts new format IDs", () => {
      expect(validateTaskId("TASK-001")).toBe("TASK-001");
      expect(validateTaskId("FEAT-042")).toBe("FEAT-042");
      expect(validateTaskId("BUG-1000")).toBe("BUG-1000");
      expect(validateTaskId("task-default-mpn51vyj-khcf")).toBe("task-default-mpn51vyj-khcf");
    });

    it("rejects injection attempts", () => {
      expect(() => validateTaskId("'; DROP TABLE tasks;--")).toThrow();
      expect(() => validateTaskId("task with spaces")).toThrow();
    });

    it("trims and truncates", () => {
      expect(validateTaskId("  TASK-001  ")).toBe("TASK-001");
    });
  });

  // ---- org isolation (comprehensive) ----

  describe("org isolation", () => {
    it("list only returns own org", () => {
      taskCreate("hr", { title: "HR task" });
      taskCreate("it", { title: "IT task" });
      const hr = taskList("hr", { status: "all" });
      const it2 = taskList("it", { status: "all" });
      expect(hr.every((t) => t.org_id === "hr")).toBe(true);
      expect(it2.every((t) => t.org_id === "it")).toBe(true);
    });

    it("update is org-scoped (no cross-org writes)", () => {
      const t = taskCreate("org-a", { title: "A task" });
      taskUpdate("org-b", t.id, { title: "Hijacked" });
      // should NOT have changed
      expect(taskGet("org-a", t.id)!.title).toBe("A task");
    });

    it("close is org-scoped", () => {
      const t = taskCreate("org-c", { title: "C task" });
      taskClose("org-d", t.id);
      expect(taskGet("org-c", t.id)!.status).toBe("open");
    });
  });

  // ---- stress / edge cases ----

  describe("stress", () => {
    it("handles 100 rapid creates", () => {
      const orgId = "stress";
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const t = taskCreate(orgId, { title: `Task ${i}` });
        ids.add(t.id);
      }
      expect(ids.size).toBe(100); // all unique
      const all = taskList(orgId, { status: "all" });
      expect(all.length).toBe(100);
    });

    it("handles empty string fields", () => {
      const t = taskCreate("edge", {
        title: "Empty fields",
        description: "",
        notes: "",
        assignee: "",
      });
      const fetched = taskGet("edge", t.id)!;
      expect(fetched.description).toBe("");
    });

    it("handles unicode titles", () => {
      const t = taskCreate("edge", { title: "Fix login bug" });
      expect(taskGet("edge", t.id)!.title).toBe("Fix login bug");
    });

    it("handles large metadata", () => {
      const bigMeta: Record<string, unknown> = {};
      for (let i = 0; i < 50; i++) {
        bigMeta[`key_${i}`] = `value_${i}_${"x".repeat(100)}`;
      }
      const t = taskCreate("edge", { title: "Big meta", metadata: bigMeta });
      const fetched = taskGet("edge", t.id)!;
      expect(Object.keys(fetched.metadata).length).toBe(50);
    });
  });
});
