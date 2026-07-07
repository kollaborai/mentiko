import { buildTaskAttempts } from "../task-attempts";
import type { TaskAttemptRun } from "../task-attempt-types";

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
});
