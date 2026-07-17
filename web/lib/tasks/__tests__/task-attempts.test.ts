import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskRunMissingError } from "../task-run-locator";
import { buildTaskAttempts, listTaskAttempts } from "../task-attempts";
import type { TaskAttemptRun } from "../task-attempt-types";

let mockRoot = "";
const mockResolveLinkRunsDir = jest.fn((namespaceId: string, orgId: string) => join(
  mockRoot,
  "current",
  namespaceId,
  orgId,
  "runs",
));

jest.mock("@/lib/config", () => ({
  orgPath: (namespaceId: string, orgId: string, ...segments: string[]) => join(
    mockRoot,
    "namespaces",
    namespaceId,
    ...(orgId === "default" ? [] : ["orgs", orgId]),
    ...segments,
  ),
}));

jest.mock("@/lib/links/link-run-runtime", () => ({
  resolveLinkRunsDir: (namespaceId: string, orgId: string) => mockResolveLinkRunsDir(namespaceId, orgId),
}));

const baseRun = (overrides: Partial<TaskAttemptRun>): TaskAttemptRun => ({
  id: overrides.id || "run-1",
  taskId: "TASK-1",
  chain: overrides.chain || "User Chain",
  chainId: overrides.chainId || "user-chain",
  status: overrides.status || "completed",
  started: overrides.started || "2026-06-21T10:00:00.000Z",
  completed: overrides.completed,
  metadata: overrides.metadata,
});

function writeScopedRun(scope: {
  taskId: string;
  runId: string;
  namespaceId: string;
  orgId: string;
}) {
  const runDir = join(
    mockRoot,
    "namespaces",
    scope.namespaceId,
    ...(scope.orgId === "default" ? [] : ["orgs", scope.orgId]),
    "runs",
    scope.runId,
  );
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run.json"), JSON.stringify({
    ...baseRun({ id: scope.runId }),
    taskId: scope.taskId,
    goal: "Verify direct task-run lookup.",
    agents: [],
    metadata: { taskExecution: true },
  }));
}

function writeReferencedRun(scope: {
  namespaceId: string;
  orgId: string;
  runId: string;
}, run: Partial<TaskAttemptRun>) {
  const runDir = join(
    mockRoot,
    "namespaces",
    scope.namespaceId,
    ...(scope.orgId === "default" ? [] : ["orgs", scope.orgId]),
    "runs",
    scope.runId,
  );
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run.json"), JSON.stringify({
    ...baseRun({ id: scope.runId, ...run }),
    id: scope.runId,
    goal: "Read an explicitly-linked system run.",
    agents: [],
    metadata: run.metadata,
  }));
}

beforeEach(() => {
  mockRoot = mkdtempSync(join(tmpdir(), "mentiko-task-attempts-"));
  mockResolveLinkRunsDir.mockClear();
});

describe("buildTaskAttempts", () => {
  it("classifies system and execution chain attempts without collapsing to last_run_id", () => {
    const attempts = buildTaskAttempts({
      taskId: "TASK-1",
      metadata: {
        recommendation_run_id: "run-rec",
        generated_chain_run_id: "run-gen",
        last_run_id: "run-exec",
        task_outcome_summary_run_id: "run-summary",
        task_outcome_summary_source_run_id: "run-exec",
      },
      runs: [
        baseRun({
          id: "run-rec",
          chain: "Chain Recommendation",
          chainId: "chain-recommendation",
          started: "2026-06-21T10:00:00.000Z",
          metadata: { generationKind: "chain_recommendation" },
        }),
        baseRun({
          id: "run-gen",
          chain: "Chain Generation",
          chainId: "chain-generation",
          started: "2026-06-21T10:05:00.000Z",
          metadata: { generationKind: "chain_generation" },
        }),
        baseRun({
          id: "run-exec",
          chain: "Git Branch Management API Chain",
          chainId: "git-branch-management-api-chain",
          started: "2026-06-21T10:10:00.000Z",
          metadata: {},
        }),
        baseRun({
          id: "run-summary",
          chain: "Run Summary Generation",
          chainId: "run-summary-generation",
          started: "2026-06-21T10:15:00.000Z",
          metadata: {
            generationKind: "run_summary",
            taskOutcomeSourceRunId: "run-exec",
          },
        }),
      ],
    });

    expect(attempts.map((attempt) => [attempt.runId, attempt.kind, attempt.category])).toEqual([
      ["run-rec", "recommendation", "system"],
      ["run-gen", "chain_generation", "system"],
      ["run-exec", "execution", "task_execution"],
      ["run-summary", "outcome_summary", "system"],
    ]);
    expect(attempts.find((attempt) => attempt.runId === "run-exec")).toMatchObject({
      isCurrent: true,
      isSystem: false,
      source: "merged",
    });
    expect(attempts.filter((attempt) => attempt.isLatestForKind).map((attempt) => attempt.kind)).toEqual([
      "recommendation",
      "chain_generation",
      "execution",
      "outcome_summary",
    ]);
  });

  it("keeps stale task metadata refs visible instead of inventing run proof", () => {
    const attempts = buildTaskAttempts({
      taskId: "TASK-1",
      metadata: {
        recommendation_run_id: "run-missing-rec",
        last_run_id: "run-missing-exec",
      },
      runs: [],
    });

    expect(attempts).toEqual([
      expect.objectContaining({
        runId: "run-missing-rec",
        kind: "recommendation",
        status: "missing",
        source: "task_metadata",
        staleReason: "run not found",
      }),
      expect.objectContaining({
        runId: "run-missing-exec",
        kind: "execution",
        status: "missing",
        source: "task_metadata",
        staleReason: "run not found",
        isCurrent: true,
      }),
    ]);
  });

  it("hides duplicate outcome summary runs marked in task metadata", () => {
    const attempts = buildTaskAttempts({
      taskId: "TASK-1",
      metadata: {
        last_run_id: "run-exec",
        task_outcome_summary_run_id: "run-summary-latest",
        duplicate_outcome_summary_run_ids: ["run-summary-old", "run-summary-recursive"],
      },
      runs: [
        baseRun({
          id: "run-exec",
          chain: "Lead Capture Pipeline",
          chainId: "nextjs-lead-capture-api-pipeline",
          started: "2026-06-21T10:10:00.000Z",
        }),
        baseRun({
          id: "run-summary-old",
          chain: "Run Summary Generation",
          chainId: "run-summary-generation",
          started: "2026-06-21T10:15:00.000Z",
          metadata: { generationKind: "run_summary", taskOutcomeSourceRunId: "run-exec" },
        }),
        baseRun({
          id: "run-summary-latest",
          chain: "Run Summary Generation",
          chainId: "run-summary-generation",
          started: "2026-06-21T10:20:00.000Z",
          metadata: { generationKind: "run_summary", taskOutcomeSourceRunId: "run-exec" },
        }),
        baseRun({
          id: "run-summary-recursive",
          chain: "Run Summary Generation",
          chainId: "run-summary-generation",
          started: "2026-06-21T10:25:00.000Z",
          metadata: { generationKind: "run_summary", taskOutcomeSourceRunId: "run-summary-latest" },
        }),
      ],
    });

    expect(attempts.map((attempt) => attempt.runId)).toEqual(["run-exec", "run-summary-latest"]);
  });

  it("sorts attempts by actual start time across system and execution runs", () => {
    const attempts = buildTaskAttempts({
      taskId: "TASK-1",
      metadata: {
        recommendation_run_id: "run-rec",
        generated_chain_run_id: "run-gen",
        last_run_id: "run-exec-2",
        task_outcome_summary_run_id: "run-summary-2",
      },
      runs: [
        baseRun({
          id: "run-exec-2",
          chain: "Delivery Pipeline",
          chainId: "delivery-pipeline",
          started: "2026-06-21T10:30:00.000Z",
        }),
        baseRun({
          id: "run-summary-1",
          chain: "Run Summary Generation",
          chainId: "run-summary-generation",
          started: "2026-06-21T10:20:00.000Z",
          metadata: { generationKind: "run_summary", taskOutcomeSourceRunId: "run-exec-1" },
        }),
        baseRun({
          id: "run-gen",
          chain: "Chain Generation",
          chainId: "chain-generation",
          started: "2026-06-21T10:05:00.000Z",
          metadata: { generationKind: "chain_generation" },
        }),
        baseRun({
          id: "run-exec-1",
          chain: "Delivery Pipeline",
          chainId: "delivery-pipeline",
          started: "2026-06-21T10:10:00.000Z",
        }),
        baseRun({
          id: "run-summary-2",
          chain: "Run Summary Generation",
          chainId: "run-summary-generation",
          started: "2026-06-21T10:40:00.000Z",
          metadata: { generationKind: "run_summary", taskOutcomeSourceRunId: "run-exec-2" },
        }),
        baseRun({
          id: "run-rec",
          chain: "Chain Recommendation",
          chainId: "chain-recommendation",
          started: "2026-06-21T10:00:00.000Z",
          metadata: { generationKind: "chain_recommendation" },
        }),
      ],
    });

    expect(attempts.map((attempt) => [attempt.runId, attempt.kind])).toEqual([
      ["run-rec", "recommendation"],
      ["run-gen", "chain_generation"],
      ["run-exec-1", "execution"],
      ["run-summary-1", "outcome_summary"],
      ["run-exec-2", "execution"],
      ["run-summary-2", "outcome_summary"],
    ]);
  });

  it("reads a persisted task-run scope directly instead of scanning the current request root", () => {
    const taskRunScope = {
      version: 1 as const,
      taskId: "TASK-1",
      runId: "run-scoped",
      namespaceId: "persisted-namespace",
      orgId: "engineering",
    };
    writeScopedRun(taskRunScope);

    const attempts = listTaskAttempts({
      namespaceId: "request-namespace",
      orgId: "default",
      taskId: "TASK-1",
      metadata: {
        last_run_id: "run-scoped",
        task_run_scope: taskRunScope,
      },
    });

    expect(attempts).toEqual([
      expect.objectContaining({
        runId: "run-scoped",
        kind: "execution",
        isCurrent: true,
        status: "completed",
      }),
    ]);
    expect(mockResolveLinkRunsDir).not.toHaveBeenCalled();
  });

  it("keeps an outcome summary visible when an execution scope is persisted", () => {
    const taskRunScope = {
      version: 1 as const,
      taskId: "TASK-1",
      runId: "run-scoped",
      namespaceId: "persisted-namespace",
      orgId: "engineering",
    };
    writeScopedRun(taskRunScope);
    writeReferencedRun({
      namespaceId: taskRunScope.namespaceId,
      orgId: taskRunScope.orgId,
      runId: "run-summary",
    }, {
      taskId: undefined,
      chain: "Run Summary Generation",
      chainId: "run-summary-generation",
      started: "2026-06-21T10:15:00.000Z",
      metadata: {
        generationKind: "run_summary",
        taskOutcomeSourceRunId: "run-scoped",
      },
    });

    const attempts = listTaskAttempts({
      namespaceId: "request-namespace",
      orgId: "default",
      taskId: "TASK-1",
      metadata: {
        last_run_id: "run-scoped",
        task_outcome_summary_run_id: "run-summary",
        task_run_scope: taskRunScope,
      },
    });

    expect(attempts).toEqual([
      expect.objectContaining({ runId: "run-scoped", kind: "execution", status: "completed" }),
      expect.objectContaining({
        runId: "run-summary",
        kind: "outcome_summary",
        status: "completed",
        source: "merged",
        sourceRunId: "run-scoped",
      }),
    ]);
    expect(mockResolveLinkRunsDir).not.toHaveBeenCalled();
  });

  it("does not fall back to the current request root when the persisted scope is missing", () => {
    const taskRunScope = {
      version: 1 as const,
      taskId: "TASK-1",
      runId: "run-scoped-missing",
      namespaceId: "persisted-namespace",
      orgId: "engineering",
    };
    const currentRunDir = join(mockRoot, "current", "runs", "run-scoped-missing");
    mkdirSync(currentRunDir, { recursive: true });
    writeFileSync(join(currentRunDir, "run.json"), JSON.stringify({
      ...baseRun({ id: "run-scoped-missing" }),
      goal: "Incorrect request-root run.",
      metadata: { taskExecution: true },
    }));

    expect(() => listTaskAttempts({
      namespaceId: "request-namespace",
      orgId: "default",
      taskId: "TASK-1",
      metadata: {
        last_run_id: "run-scoped-missing",
        task_run_scope: taskRunScope,
      },
    })).toThrow(TaskRunMissingError);
    expect(mockResolveLinkRunsDir).not.toHaveBeenCalled();
  });
});
