import { existsSync, readdirSync, readFileSync } from "fs";
import {
  buildRunsSnapshot,
  canAdmitAutoRun,
  findActiveRunForTask,
  getAutoRunCandidates,
  reconcileTaskActiveRun,
  removeRunFromSnapshot,
} from "../runs/auto-run";
import { taskGet, taskList, taskUpdate } from "../tasks/task-store";

jest.mock("fs", () => ({
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  readFileSync: jest.fn(),
}));

jest.mock("@/lib/config", () => ({
  nsPath: (_nsId: string, ...segments: string[]) => ["/tmp/mentiko-test", ...segments].join("/"),
}));

jest.mock("../tasks/task-store", () => ({
  taskGet: jest.fn(),
  taskList: jest.fn(),
  taskUpdate: jest.fn(),
}));

const mockTaskList = taskList as jest.MockedFunction<typeof taskList>;
const mockTaskGet = taskGet as jest.MockedFunction<typeof taskGet>;
const mockTaskUpdate = taskUpdate as jest.MockedFunction<typeof taskUpdate>;
const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockReaddirSync = readdirSync as jest.MockedFunction<typeof readdirSync>;
const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;

describe("getAutoRunCandidates", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);
    mockTaskGet.mockImplementation((_orgId, taskId) => ({
      id: String(taskId),
      title: String(taskId),
      status: "open",
      dependencies: [],
      metadata: {},
    }) as never);
  });

  it("includes in-progress auto-run tasks whose last run stopped", () => {
    mockTaskList.mockReturnValue([
      {
        id: "TASK-031",
        title: "Retry me",
        status: "in_progress",
        issue_type: "task",
        metadata: {
          auto_run: true,
          last_run_status: "stopped",
          last_run_id: "run-1",
        },
      },
    ] as never);

    expect(getAutoRunCandidates("default")).toEqual([
      expect.objectContaining({
        taskId: "TASK-031",
        title: "Retry me",
      }),
    ]);
    expect(mockTaskList).toHaveBeenCalledWith("default", { status: "all" }, undefined, undefined);
  });

  it("skips in-progress tasks while their last run is still active", () => {
    mockTaskList.mockReturnValue([
      {
        id: "TASK-032",
        title: "Still running",
        status: "in_progress",
        issue_type: "task",
        metadata: {
          auto_run: true,
          last_run_status: "running",
          last_run_id: "run-2",
        },
      },
    ] as never);

    expect(getAutoRunCandidates("default")).toEqual([]);
  });

  it("skips tasks waiting on a run decision", () => {
    mockTaskList.mockReturnValue([
      {
        id: "TASK-001",
        title: "Needs review",
        status: "open",
        issue_type: "task",
        metadata: {
          auto_run: true,
          last_run_status: "completed",
          last_run_outcome: "partial_pass",
          last_run_decision_required: true,
        },
      },
    ] as never);

    expect(getAutoRunCandidates("default")).toEqual([]);
  });

  it("skips open auto-run tasks after a completed execution of the assigned chain", () => {
    mockTaskList.mockReturnValue([
      {
        id: "TASK-040",
        title: "Needs human close",
        status: "open",
        issue_type: "task",
        metadata: {
          auto_run: true,
          chain_id: "release-review",
          last_run_status: "completed",
          last_run_id: "run-done",
        },
      },
    ] as never);

    expect(getAutoRunCandidates("default")).toEqual([]);
  });

  it("does not skip a completed status with no chain_id assigned (recommendation/generation bookkeeping)", () => {
    // Revision 2 invariant: "completed" is only terminal for the CURRENT assigned
    // chain's execution. A task that has never had a chain assigned yet (e.g. a
    // chain-recommendation or generation job recorded a "completed" status on
    // itself) must still be allowed to continue toward execution.
    mockTaskList.mockReturnValue([
      {
        id: "TASK-041",
        title: "Recommendation bookkeeping only",
        status: "open",
        issue_type: "task",
        metadata: {
          auto_run: true,
          last_run_status: "completed",
        },
      },
    ] as never);

    expect(getAutoRunCandidates("default")).toEqual([
      expect.objectContaining({ taskId: "TASK-041" }),
    ]);
  });

  it("skips a retryable task when live run state says it is already active", () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["run-active"] as never);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-active",
      taskId: "TASK-031",
      status: "running",
      chain: "release-review",
      started: "2026-05-01T01:00:00.000Z",
    }));
    mockTaskList.mockReturnValue([
      {
        id: "TASK-031",
        title: "Retry me",
        status: "in_progress",
        issue_type: "task",
        metadata: {
          auto_run: true,
          last_run_status: "stopped",
          last_run_id: "old-run",
        },
      },
    ] as never);

    expect(getAutoRunCandidates("default")).toEqual([]);
  });

  it("does not classify generation audit runs as active task runs", () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["run-audit"] as never);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-audit",
      taskId: "TASK-044",
      status: "running",
      chain: "Chain Recommendation",
      started: "2026-05-01T01:00:00.000Z",
      metadata: {
        generationKind: "chain_recommendation",
      },
    }));

    expect(findActiveRunForTask("TASK-044", "default")).toBeNull();

    const result = reconcileTaskActiveRun("default", {
      id: "TASK-044",
      title: "Run recommended chain",
      status: "open",
      issue_type: "task",
      metadata: {
        auto_run: true,
      },
    } as never, "default");

    expect(result).toEqual({ activeRun: null, reconciled: false });
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  it("does not classify run-summary chains as active task execution when metadata is missing", () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["run-summary"] as never);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-summary",
      taskId: "TASK-093",
      status: "running",
      chainId: "run-summary-generation",
      chain: "run-summary-generation",
      started: "2026-07-06T22:35:09.144Z",
    }));

    expect(findActiveRunForTask("TASK-093", "default")).toBeNull();

    const result = reconcileTaskActiveRun("default", {
      id: "TASK-093",
      title: "Build backend lead-capture function",
      status: "open",
      issue_type: "task",
      metadata: {
        auto_run: true,
      },
    } as never, "default");

    expect(result).toEqual({ activeRun: null, reconciled: false });
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  it("does not classify decision runs as active task runs", () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["run-decision"] as never);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-decision",
      taskId: "TASK-044",
      status: "running",
      chain: "Decision Research",
      started: "2026-05-01T01:00:00.000Z",
      metadata: {
        decisionId: "decision-1",
        decisionPhase: "research",
      },
    }));

    expect(findActiveRunForTask("TASK-044", "default")).toBeNull();
  });

  it("does not classify runner-v2 completion_failed attempts as active task runs", () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["run-failed-typed"] as never);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-failed-typed",
      taskId: "TASK-093",
      status: "running",
      chain: "nextjs-lead-capture-api-pipeline",
      started: "2026-07-06T22:29:16.924Z",
      runnerV2: {
        attempts: [
          {
            id: "run-failed-typed:api-route-architect:1",
            phase: "completion_failed",
            terminalReason: "retries_exhausted",
          },
        ],
      },
    }));

    expect(findActiveRunForTask("TASK-093", "default")).toBeNull();

    const result = reconcileTaskActiveRun("default", {
      id: "TASK-093",
      title: "Build backend lead-capture function",
      status: "open",
      issue_type: "task",
      metadata: {
        auto_run: true,
      },
    } as never, "default");

    expect(result).toEqual({ activeRun: null, reconciled: false });
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  it("reconciles stale task metadata from active run state", () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["run-active"] as never);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-active",
      taskId: "TASK-031",
      status: "running",
      chain: "release-review",
      started: "2026-05-01T01:00:00.000Z",
    }));

    const result = reconcileTaskActiveRun("default", {
      id: "TASK-031",
      title: "Retry me",
      status: "open",
      issue_type: "task",
      metadata: {
        auto_run: true,
        last_run_id: "old-run",
        last_run_status: "stopped",
      },
    } as never, "default");

    expect(result).toEqual({
      activeRun: expect.objectContaining({ id: "run-active", status: "running" }),
      reconciled: true,
    });
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-031",
      expect.objectContaining({
        status: "in_progress",
        metadata: expect.objectContaining({
          auto_run: true,
          lifecycle_phase: "executing",
          execution_retries: 0,
          last_run_id: "run-active",
          last_run_status: "running",
          last_run_chain: "release-review",
          last_run_started: "2026-05-01T01:00:00.000Z",
          last_run_completed: null,
        }),
      }),
      "default",
    );
  });

  it("orders ready tasks by priority, creation time, then natural task id", () => {
    mockTaskList.mockReturnValue([
      {
        id: "TASK-010",
        title: "Later medium",
        status: "open",
        issue_type: "task",
        priority: 2,
        created_at: "2026-04-30T02:00:00.000Z",
        metadata: { auto_run: true },
      },
      {
        id: "TASK-002",
        title: "Early high",
        status: "open",
        issue_type: "task",
        priority: 0,
        created_at: "2026-04-30T01:00:00.000Z",
        metadata: { auto_run: true },
      },
      {
        id: "TASK-001",
        title: "Later high",
        status: "open",
        issue_type: "task",
        priority: 0,
        created_at: "2026-04-30T03:00:00.000Z",
        metadata: { auto_run: true },
      },
    ] as never);

    expect(getAutoRunCandidates("default").map((candidate) => candidate.taskId)).toEqual([
      "TASK-002",
      "TASK-001",
      "TASK-010",
    ]);
  });

  it("canAdmitAutoRun rejects a completed run when a chain is assigned, purely from the predicate, even with a stale generation_job_id", () => {
    const task = {
      id: "TASK-050",
      title: "Stale generation after completion",
      status: "open",
      issue_type: "task",
      metadata: {
        auto_run: true,
        chain_id: "release-review",
        last_run_status: "completed",
        generation_job_id: "job-stale",
      },
    } as never;

    const admission = canAdmitAutoRun(task, "default");

    expect(admission).toEqual(
      expect.objectContaining({ admit: false, action: "already_completed" }),
    );
    // No job/run lookup needed -- the chain_id + completed check alone rejects.
    expect(mockExistsSync).not.toHaveBeenCalled();
    expect(mockTaskGet).not.toHaveBeenCalled();
  });

  it("canAdmitAutoRun does not reject completion when no chain_id is assigned yet", () => {
    const task = {
      id: "TASK-051",
      title: "Recommendation bookkeeping",
      status: "open",
      issue_type: "task",
      metadata: {
        auto_run: true,
        last_run_status: "completed",
      },
    } as never;

    const admission = canAdmitAutoRun(task, "default");

    expect(admission.action).not.toBe("already_completed");
    expect(admission.admit).toBe(true);
  });

  it("canAdmitAutoRun still rejects a completed run when chain_id is present but empty (\"\"), unlike a genuinely absent chain_id", () => {
    // Fix C: chain_id:"" (which task-transforms' String(metadata.chain_id||"")
    // can produce) is falsy but IS a present key -- a completed status only
    // ever follows a real execution, and an execution always runs via a real
    // chain_id, so "" here is corrupted/lost bookkeeping from a real
    // execution, not "no chain was ever assigned" (that case has the key
    // absent entirely, covered by the sibling test above). The guard must
    // check presence (!== undefined), not truthiness, or this re-admits a
    // completed execution.
    const task = {
      id: "TASK-052",
      title: "Corrupted chain_id bookkeeping",
      status: "open",
      issue_type: "task",
      metadata: {
        auto_run: true,
        chain_id: "",
        last_run_status: "completed",
      },
    } as never;

    const admission = canAdmitAutoRun(task, "default");

    expect(admission).toEqual(
      expect.objectContaining({ admit: false, action: "already_completed" }),
    );
  });

  it("canAdmitAutoRun rejects an audited-closed execution even when last_run_* evidence was wiped", () => {
    // The audit-run launch can clobber last_run_id, and the non-execution
    // repair then deletes every last_run_* field -- leaving the
    // already-completed rule blind. The completion_audit_* fields survive that
    // wipe and must keep the finished chain terminal (the 2026-07-11
    // close -> re-run -> re-audit loop on TASK-264/TASK-152/BUG-022).
    const task = {
      id: "TASK-264",
      title: "Audited closed, evidence wiped",
      status: "open",
      issue_type: "task",
      metadata: {
        auto_run: true,
        chain_id: "property-photo-sourcing-scope-audit",
        last_audit_verdict: "close",
        completion_audit_apply_status: "applied",
        completion_audit_run_id: "run-exec",
      },
    } as never;

    const admission = canAdmitAutoRun(task, "default");

    expect(admission).toEqual(
      expect.objectContaining({ admit: false, action: "already_completed" }),
    );
  });

  it("canAdmitAutoRun rejects while a close verdict is pending_close (auditor re-close in flight)", () => {
    const task = {
      id: "TASK-095",
      title: "Close verdict not yet landed",
      status: "open",
      issue_type: "task",
      metadata: {
        auto_run: true,
        chain_id: "release-review",
        last_audit_verdict: "close",
        completion_audit_apply_status: "pending_close",
      },
    } as never;

    const admission = canAdmitAutoRun(task, "default");

    expect(admission).toEqual(
      expect.objectContaining({ admit: false, action: "already_completed" }),
    );
  });

  it("canAdmitAutoRun does not treat a retry verdict as terminal", () => {
    const task = {
      id: "TASK-059",
      title: "Retry verdict must re-admit",
      status: "open",
      issue_type: "task",
      metadata: {
        auto_run: true,
        chain_id: "release-review",
        last_audit_verdict: "retry",
        completion_audit_apply_status: "applied",
        last_run_status: "retry_requested",
      },
    } as never;

    const admission = canAdmitAutoRun(task, "default");

    expect(admission.action).not.toBe("already_completed");
  });

  it("excludes a task paused via auto_run_paused_reason from auto-run candidates", () => {
    mockTaskList.mockReturnValue([
      {
        id: "TASK-060",
        title: "Paused via reason only",
        status: "open",
        issue_type: "task",
        metadata: {
          auto_run: true,
          auto_run_paused_reason: "waiting on design review",
        },
      },
    ] as never);

    expect(getAutoRunCandidates("default")).toEqual([]);
  });

  it("reconcileTaskActiveRun refuses to reopen a closed task even with an orphaned active run on disk", () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["run-orphan"] as never);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-orphan",
      taskId: "TASK-095",
      status: "running",
      chain: "release-review",
      started: "2026-05-01T01:00:00.000Z",
    }));

    const result = reconcileTaskActiveRun("default", {
      id: "TASK-095",
      title: "Already closed",
      status: "closed",
      issue_type: "task",
      metadata: {
        auto_run: true,
        last_run_id: "run-orphan",
        last_run_status: "running",
      },
    } as never, "default");

    expect(result).toEqual({ activeRun: null, reconciled: false });
    expect(mockTaskUpdate).not.toHaveBeenCalled();
    // DONE guard short-circuits before ever scanning the runs directory.
    expect(mockReaddirSync).not.toHaveBeenCalled();
  });
});

describe("RunsSnapshot", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockTaskGet.mockImplementation((_orgId, taskId) => ({
      id: String(taskId),
      title: String(taskId),
      status: "open",
      dependencies: [],
      metadata: {},
    }) as never);
  });

  function stageRuns(runs: Array<Record<string, unknown>>) {
    mockReaddirSync.mockReturnValue(runs.map((r) => String(r.id)) as never);
    // chain.json reads (allDeclaredAgentsComplete) resolve to "no declared
    // agents" via the run.json content lacking a chain agents array.
    mockReadFileSync.mockImplementation(((path: string) => {
      const run = runs.find((r) => String(path).includes(`/${r.id}/`));
      if (!run) throw new Error(`unexpected read: ${path}`);
      return JSON.stringify(run);
    }) as never);
  }

  it("walks the runs directory exactly ONCE for a whole candidate scan, regardless of task count", () => {
    // The O(tasks x runs) regression guard: N admission-checked tasks must
    // cost O(1) directory reads, not O(N). If someone reintroduces a per-task
    // scan inside canAdmitAutoRun/findActiveRunForTask, this fails loudly.
    stageRuns([
      { id: "run-1", taskId: "TASK-900", status: "running", started: "2026-05-01T01:00:00.000Z" },
      { id: "run-2", taskId: "TASK-901", status: "completed" },
      { id: "run-3", taskId: "TASK-902", status: "failed" },
    ]);
    const tasks = Array.from({ length: 25 }, (_, i) => ({
      id: `TASK-${100 + i}`,
      title: `Task ${i}`,
      status: "open",
      issue_type: "task",
      metadata: { auto_run: true },
    }));
    mockTaskList.mockReturnValue(tasks as never);

    const candidates = getAutoRunCandidates("default", undefined, "default");

    expect(candidates).toHaveLength(25);
    expect(mockReaddirSync).toHaveBeenCalledTimes(1);
  });

  it("a provided snapshot makes findActiveRunForTask a pure lookup (zero fs reads)", () => {
    stageRuns([
      { id: "run-live", taskId: "TASK-800", status: "running", started: "2026-05-01T01:00:00.000Z" },
    ]);
    const snapshot = buildRunsSnapshot("default");
    jest.clearAllMocks();

    expect(findActiveRunForTask("TASK-800", "default", snapshot)).toEqual(
      expect.objectContaining({ id: "run-live", status: "running" })
    );
    expect(findActiveRunForTask("TASK-999", "default", snapshot)).toBeNull();
    expect(mockReaddirSync).not.toHaveBeenCalled();
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it("matches findActiveRunForTask semantics: newest run wins, non-execution and terminal-attempt runs excluded from per-task view but counted for the cap", () => {
    stageRuns([
      { id: "run-old", taskId: "TASK-700", status: "running", started: "2026-05-01T01:00:00.000Z" },
      { id: "run-new", taskId: "TASK-700", status: "running", started: "2026-05-02T01:00:00.000Z" },
      {
        id: "run-gen", taskId: "TASK-701", status: "running",
        started: "2026-05-01T01:00:00.000Z", metadata: { generationKind: "chain_recommendation" },
      },
    ]);

    const snapshot = buildRunsSnapshot("default");

    // cap count includes the generation run (countActiveRuns semantics)...
    expect(snapshot.activeRuns).toHaveLength(3);
    // ...but the per-task admission view excludes it
    expect(snapshot.activeRunByTask.get("TASK-701")).toBeUndefined();
    expect(snapshot.activeRunByTask.get("TASK-700")).toEqual(
      expect.objectContaining({ id: "run-new" })
    );
  });

  it("removeRunFromSnapshot frees the cap slot and restores the runner-up active run for the task", () => {
    stageRuns([
      { id: "run-old", taskId: "TASK-700", status: "running", started: "2026-05-01T01:00:00.000Z" },
      { id: "run-new", taskId: "TASK-700", status: "running", started: "2026-05-02T01:00:00.000Z" },
    ]);
    const snapshot = buildRunsSnapshot("default");

    removeRunFromSnapshot(snapshot, "run-new");

    expect(snapshot.activeRuns).toHaveLength(1);
    // A fresh walk would now surface run-old -- the snapshot must agree, or a
    // reap of the newer run would wrongly admit the task while run-old lives.
    expect(snapshot.activeRunByTask.get("TASK-700")).toEqual(
      expect.objectContaining({ id: "run-old" })
    );

    removeRunFromSnapshot(snapshot, "run-old");
    expect(snapshot.activeRuns).toHaveLength(0);
    expect(snapshot.activeRunByTask.get("TASK-700")).toBeUndefined();
  });
});
