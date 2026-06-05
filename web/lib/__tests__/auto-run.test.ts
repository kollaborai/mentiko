import { existsSync, readdirSync, readFileSync } from "fs";
import { findActiveRunForTask, getAutoRunCandidates, reconcileTaskActiveRun } from "../runs/auto-run";
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

  it("skips open auto-run tasks after a completed execution", () => {
    mockTaskList.mockReturnValue([
      {
        id: "TASK-040",
        title: "Needs human close",
        status: "open",
        issue_type: "task",
        metadata: {
          auto_run: true,
          last_run_status: "completed",
          last_run_id: "run-done",
        },
      },
    ] as never);

    expect(getAutoRunCandidates("default")).toEqual([]);
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
});
