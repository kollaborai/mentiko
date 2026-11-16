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
    expect(after.revision).toBe(t.revision! + 1); // ...but revision moved

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
