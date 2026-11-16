/**
 * Guarded task writes for issue #141 (rule 5: one writer per record).
 *
 * Runs against the REAL sqlite store in a temp globalRoot (same pattern as
 * task-store.test.ts; no store mocks). Covers:
 *  - a stale write is rejected and leaves the newer data intact
 *  - two interleaved read-modify-write sequences both land their own keys
 *    through taskMutateMetadata
 *  - mutate returning null writes nothing
 *  - maxAttempts exhaustion returns ok:false without throwing
 *  - the guard is NOT fooled by equal updated_at strings (revision column)
 *  - the tasks_revision_bump trigger covers indirect writers (raw SQL /
 *    old-binary writes, ON DELETE SET NULL children, startup repairs)
 *  - an explicit application bump lands exactly one higher, never two
 *  - taskMutateMetadata: bounded/clamped maxAttempts, guard-covered mutate
 *    view, written-values return (no post-write re-read)
 *  - existing taskUpdate behavior is unchanged
 *
 * @jest-environment node
 */
import {
  taskCreate,
  taskGet,
  taskUpdate,
  taskUpdateIfUnchanged,
  taskMutateMetadata,
  taskClose,
  taskDelete,
  taskAddDep,
  taskAddComment,
  closeAll,
  _getDb,
} from "../tasks/task-store";

jest.mock("../config", () => ({
  __esModule: true,
  default: {
    globalRoot: "/tmp/mentiko-guarded-test-" + process.pid,
    codeRoot: "/tmp",
  },
}));

afterAll(() => {
  closeAll();
});

const ORG = "guard-org";

function makeTask(metadata: Record<string, unknown> = {}) {
  return taskCreate(ORG, { title: "guarded", metadata });
}

describe("taskUpdateIfUnchanged", () => {
  it("applies the write when the revision matches", () => {
    const t = makeTask();
    const ok = taskUpdateIfUnchanged(ORG, t.id, t.revision!, { priority: 1 });
    expect(ok).toBe(true);
    expect(taskGet(ORG, t.id)!.priority).toBe(1);
  });

  it("rejects a stale write and leaves the newer data intact", () => {
    const t = makeTask({ owner_state: "new" });
    const staleRevision = t.revision!;
    // another writer moves the task on between our read and our write
    taskUpdate(ORG, t.id, { metadata: { owner_state: "newer" } });

    const ok = taskUpdateIfUnchanged(
      ORG,
      t.id,
      staleRevision,
      { metadata: { owner_state: "stale-sweep" } }
    );
    expect(ok).toBe(false);
    expect(taskGet(ORG, t.id)!.metadata).toEqual({ owner_state: "newer" });
  });

  it("returns false when the task does not exist", () => {
    expect(taskUpdateIfUnchanged(ORG, "TASK-999", 0, { priority: 1 })).toBe(false);
  });

  it("is not fooled when a racing write leaves updated_at identical", () => {
    const t = makeTask();
    const staleRevision = t.revision!;
    // writer B lands a real write, then we force its updated_at back to the
    // exact string writer A read -- the deterministic version of two writes
    // inside one millisecond (now() is ms-precision ISO).
    taskUpdate(ORG, t.id, { metadata: { raced: true } });
    _getDb().prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(
      t.updated_at,
      t.id
    );

    const after = taskGet(ORG, t.id)!;
    expect(after.updated_at).toBe(t.updated_at); // timestamps equal...
    // ...but revision moved: +1 from taskUpdate, +1 from the raw pin UPDATE
    // (every tasks-row UPDATE bumps through the trigger, pin included).
    expect(after.revision).toBe(t.revision! + 2);

    const ok = taskUpdateIfUnchanged(
      ORG,
      t.id,
      staleRevision,
      { metadata: { stale: true } }
    );
    expect(ok).toBe(false); // a timestamp guard would have let this through
    expect(taskGet(ORG, t.id)!.metadata).toEqual({ raced: true });
  });

  it("every tasks-row writer bumps revision (tight loop, same ms)", () => {
    const t = makeTask();
    let revision = t.revision!;
    for (let i = 0; i < 50; i++) {
      if (i % 3 === 0) taskUpdate(ORG, t.id, { priority: (i % 5) as 0 });
      else if (i % 3 === 1) taskClose(ORG, t.id);
      else taskUpdate(ORG, t.id, { status: "open" });
      const next = taskGet(ORG, t.id)!.revision!;
      expect(next).toBe(revision + 1); // strictly monotonic even within one ms
      revision = next;
    }
  });
});

describe("taskMutateMetadata", () => {
  it("lands a metadata change and returns the updated task", () => {
    const t = makeTask({ chain_id: "c1" });
    const res = taskMutateMetadata(ORG, t.id, (m) => ({ ...m, run_state: "summarizing" }));
    expect(res.ok).toBe(true);
    expect(res.task!.metadata).toEqual({ chain_id: "c1", run_state: "summarizing" });
    expect(res.task!.revision).toBe(t.revision! + 1);
  });

  it("two interleaved read-modify-write sequences both land their own keys", () => {
    const t = makeTask();
    // sequence A reads, then loses the race to B inside its own mutate call
    // (the injected taskUpdate is the racing writer; the loop must retry),
    // then retries and merges onto B's now-current metadata.
    let aCalls = 0;
    const resA = taskMutateMetadata(ORG, t.id, (m) => {
      aCalls++;
      if (aCalls === 1) {
        // simulate writer B landing between A's read and A's write
        taskUpdate(ORG, t.id, { metadata: { ...m, b_key: "from-b" } });
      }
      return { ...m, a_key: "from-a" };
    });
    expect(resA.ok).toBe(true);
    expect(aCalls).toBe(2); // lost once, retried once
    expect(resA.task!.metadata).toEqual({ a_key: "from-a", b_key: "from-b" });

    // a later independent mutate also lands on top
    const resB = taskMutateMetadata(ORG, t.id, (m) => ({ ...m, c_key: "from-c" }));
    expect(resB.ok).toBe(true);
    expect(resB.task!.metadata).toEqual({
      a_key: "from-a",
      b_key: "from-b",
      c_key: "from-c",
    });
  });

  it("mutate returning null writes nothing", () => {
    const t = makeTask({ keep: "me" });
    const res = taskMutateMetadata(ORG, t.id, () => null);
    expect(res.ok).toBe(true);
    const after = taskGet(ORG, t.id)!;
    expect(after.metadata).toEqual({ keep: "me" });
    expect(after.revision).toBe(t.revision!); // no write, no bump
    expect(after.updated_at).toBe(t.updated_at);
  });

  it("maxAttempts exhaustion returns ok:false without throwing", () => {
    const t = makeTask();
    let calls = 0;
    const res = taskMutateMetadata(
      ORG,
      t.id,
      (m) => {
        calls++;
        // a writer that always wins the race back: every attempt is stale
        taskUpdate(ORG, t.id, { metadata: { ...m, winner: calls } });
        return { ...m, loser: calls };
      },
      undefined,
      { maxAttempts: 2 }
    );
    expect(res.ok).toBe(false);
    expect(calls).toBe(2);
    expect(taskGet(ORG, t.id)!.metadata).toEqual({ winner: 2 });
  });

  it("returns ok:false for a missing task without calling mutate", () => {
    const mutate = jest.fn(() => ({}));
    const res = taskMutateMetadata(ORG, "TASK-998", mutate);
    expect(res.ok).toBe(false);
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe("taskUpdate behavior unchanged (regression)", () => {
  it("still applies fields, closed_at on terminal status, and clears it on reopen", () => {
    const t = makeTask({ chain: "x" });
    taskUpdate(ORG, t.id, { status: "done", priority: 0, metadata: { chain: "y" } });
    let after = taskGet(ORG, t.id)!;
    expect(after.status).toBe("done");
    expect(after.priority).toBe(0);
    expect(after.metadata).toEqual({ chain: "y" });
    expect(after.closed_at).not.toBeNull();

    taskUpdate(ORG, t.id, { status: "open" });
    after = taskGet(ORG, t.id)!;
    expect(after.closed_at).toBeNull();
    expect(after.status).toBe("open");
  });

  it("taskGet returns the revision column", () => {
    const t = makeTask();
    expect(typeof t.revision).toBe("number");
  });
});

// Round 2 (Codex VERDICT P1s): the revision bump lives in the
// tasks_revision_bump trigger, so EVERY tasks-row UPDATE bumps — including
// writers that never heard of the revision column.
describe("tasks_revision_bump trigger covers indirect writers", () => {
  it("a raw UPDATE with no revision clause bumps the revision (old-binary case)", () => {
    const t = makeTask({ owner: "a" });
    // an OLD server binary (pre-trigger code) writes metadata via raw SQL,
    // never mentioning revision -- the trigger must bump anyway
    _getDb()
      .prepare("UPDATE tasks SET metadata = ? WHERE id = ?")
      .run(JSON.stringify({ owner: "old-binary" }), t.id);

    const after = taskGet(ORG, t.id)!;
    expect(after.revision).toBe(t.revision! + 1);
    expect(after.metadata).toEqual({ owner: "old-binary" });

    // a CAS holding the pre-write revision must now fail (the P1 scenario:
    // old process overwrites, new process's stale guard would have succeeded)
    const ok = taskUpdateIfUnchanged(ORG, t.id, t.revision!, { priority: 0 });
    expect(ok).toBe(false);
    expect(taskGet(ORG, t.id)!.metadata).toEqual({ owner: "old-binary" });
  });

  it("deleting a parent bumps the child's revision (ON DELETE SET NULL)", () => {
    const parent = makeTask();
    const child = taskCreate(ORG, { title: "child", parent_id: parent.id });
    const childRevision = taskGet(ORG, child.id)!.revision!;

    taskDelete(ORG, parent.id);

    const after = taskGet(ORG, child.id)!;
    expect(after.parent_id).toBeNull();
    expect(after.revision).toBe(childRevision + 1);

    // a CAS holding the pre-delete revision must fail
    const ok = taskUpdateIfUnchanged(ORG, child.id, childRevision, { priority: 0 });
    expect(ok).toBe(false);
  });

  it("startup repair statements bump the revision on reopen", () => {
    // forge lifecycle drift the repairs fix: terminal status, no closed_at,
    // written by raw SQL so nothing but the repair touches it afterwards
    const t = makeTask();
    _getDb()
      .prepare("UPDATE tasks SET status = 'done', closed_at = NULL WHERE id = ?")
      .run(t.id);
    const before = taskGet(ORG, t.id)!;
    expect(before.closed_at).toBeNull();

    // a fresh connection re-runs runMigrations -> the repair UPDATEs
    closeAll();
    const after = taskGet(ORG, t.id)!;
    expect(after.closed_at).not.toBeNull(); // repair landed...
    expect(after.revision).toBe(before.revision! + 1); // ...and bumped

    // a CAS holding the pre-repair revision must fail
    expect(taskUpdateIfUnchanged(ORG, t.id, before.revision!, { priority: 0 })).toBe(false);
  });

  it("an explicit application bump lands exactly one higher, not two", () => {
    const t = makeTask();
    // a writer that still carries its own `revision = revision + 1` (the
    // WHEN clause makes the trigger skip rows whose revision already moved)
    _getDb()
      .prepare("UPDATE tasks SET revision = revision + 1, title = ? WHERE id = ?")
      .run("explicit-bump", t.id);
    expect(taskGet(ORG, t.id)!.revision).toBe(t.revision! + 1);
  });
});

describe("taskMutateMetadata contract (round-2 P2s)", () => {
  // a mutate that always loses the race back; the call count exposes the
  // effective attempt budget
  function makeAlwaysLosing(taskId: string) {
    const spy = { calls: 0 };
    const mutate = (m: Record<string, unknown>) => {
      spy.calls++;
      taskUpdate(ORG, taskId, { metadata: { ...m, winner: spy.calls } });
      return { ...m, loser: spy.calls };
    };
    return { spy, mutate };
  }

  it("clamps maxAttempts: valid values pass through, values above 10 cap at 10", () => {
    // valid values are honored
    for (const [maxAttempts, expectedCalls] of [[2, 2], [1, 1]] as const) {
      const t = makeTask();
      const { spy, mutate } = makeAlwaysLosing(t.id);
      const res = taskMutateMetadata(ORG, t.id, mutate, undefined, { maxAttempts });
      expect(res.ok).toBe(false);
      expect(spy.calls).toBe(expectedCalls);
    }
    // above the ceiling of 10 -> capped at 10 (bounded even for huge input)
    const t = makeTask();
    const { spy, mutate } = makeAlwaysLosing(t.id);
    const res = taskMutateMetadata(ORG, t.id, mutate, undefined, { maxAttempts: 99 });
    expect(res.ok).toBe(false);
    expect(spy.calls).toBe(10);
  });

  it("invalid maxAttempts values (Infinity, NaN, 0, negative, fractional) fall back to the default 3", () => {
    for (const bad of [Infinity, NaN, 0, -5, 2.5]) {
      const t = makeTask();
      const { spy, mutate } = makeAlwaysLosing(t.id);
      const res = taskMutateMetadata(ORG, t.id, mutate, undefined, { maxAttempts: bad });
      expect(res.ok).toBe(false);
      expect(spy.calls).toBe(3);
    }
  });

  it("mutate receives only guard-covered fields (no dependency/comment state)", () => {
    const t = makeTask();
    const blocker = makeTask();
    taskAddDep(ORG, t.id, blocker.id);
    taskAddComment(ORG, t.id, "agent", "a comment");

    let seen: unknown;
    taskMutateMetadata(ORG, t.id, (_m, task) => {
      seen = task;
      return null;
    });

    // taskGet itself exposes the related state; the mutate view must not
    expect(taskGet(ORG, t.id)!.dependencies!.length).toBe(1);
    expect(taskGet(ORG, t.id)!.comment_count).toBe(1);
    expect(seen).not.toHaveProperty("dependencies");
    expect(seen).not.toHaveProperty("dependents");
    expect(seen).not.toHaveProperty("dependency_count");
    expect(seen).not.toHaveProperty("dependent_count");
    expect(seen).not.toHaveProperty("comment_count");
  });

  it("returns the written values it holds, not a re-read, even when the row is deleted mid-write", () => {
    const t = makeTask({ keep: "me" });
    // a trigger that deletes the task the instant our CAS lands with the
    // vanish flag -- deterministic "task deleted between write and re-read"
    _getDb().exec(`
      CREATE TRIGGER vanish_after_guarded_write
      AFTER UPDATE ON tasks
      FOR EACH ROW
      WHEN json_extract(NEW.metadata, '$.vanish') = 1
      BEGIN
        DELETE FROM tasks WHERE id = NEW.id;
      END;
    `);
    try {
      const res = taskMutateMetadata(ORG, t.id, (m) => ({ ...m, vanish: 1 }));
      expect(res.ok).toBe(true); // the write landed; no re-read crash
      expect(res.task!.metadata).toEqual({ keep: "me", vanish: 1 });
      expect(res.task!.revision).toBe(t.revision! + 1);
      expect(taskGet(ORG, t.id)).toBeNull(); // the row really is gone
    } finally {
      _getDb().exec("DROP TRIGGER IF EXISTS vanish_after_guarded_write");
    }
  });
});
