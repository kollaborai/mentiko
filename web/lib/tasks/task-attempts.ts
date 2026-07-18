import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { resolveLinkRunsDir } from "@/lib/links/link-run-runtime";
import {
  locateTaskRun,
  parseTaskRunScope,
  TaskRunScopeError,
} from "./task-run-locator";
import type {
  TaskAttempt,
  TaskAttemptCategory,
  TaskAttemptKind,
  TaskAttemptRun,
} from "./task-attempt-types";

const ATTEMPT_ORDER: Record<TaskAttemptKind, number> = {
  task_generation: 0,
  recommendation: 1,
  chain_generation: 2,
  execution: 3,
  outcome_summary: 4,
  decision_system: 5,
  unknown: 6,
};

const METADATA_RUN_REFS: Array<{ key: string; kind: TaskAttemptKind }> = [
  { key: "task_generation_run_id", kind: "task_generation" },
  { key: "recommendation_run_id", kind: "recommendation" },
  { key: "generated_chain_run_id", kind: "chain_generation" },
  { key: "last_run_id", kind: "execution" },
  { key: "task_outcome_summary_run_id", kind: "outcome_summary" },
  { key: "completion_audit_run_id", kind: "outcome_summary" },
];

function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function maybeJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return recordValue(value);
  try {
    return recordValue(JSON.parse(value));
  } catch {
    return {};
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function timeValue(value?: string) {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function runMetadata(run: TaskAttemptRun): Record<string, unknown> {
  const metadata = maybeJsonRecord(run.metadata);
  return Object.keys(metadata).length ? metadata : recordValue(run);
}

function sourceRunIdFor(kind: TaskAttemptKind, metadata: Record<string, unknown>) {
  if (kind === "outcome_summary") {
    return stringValue(metadata.taskOutcomeSourceRunId)
      || stringValue(metadata.task_outcome_summary_source_run_id)
      || stringValue(metadata.sourceRunId);
  }
  return stringValue(metadata.sourceRunId);
}

function classifyGenerationKind(value?: string): TaskAttemptKind | undefined {
  switch (value) {
    case "task_generation":
    case "task":
      return "task_generation";
    case "chain_recommendation":
    case "recommendation":
      return "recommendation";
    case "chain_generation":
      return "chain_generation";
    case "run_summary":
    case "task_run_summary":
    case "outcome_summary":
      return "outcome_summary";
    default:
      return undefined;
  }
}

function classifyRun(run: TaskAttemptRun, metadataKind?: TaskAttemptKind): TaskAttemptKind {
  if (metadataKind) return metadataKind;

  const metadata = runMetadata(run);
  const generationKind = stringValue(metadata.generationKind) || stringValue(run.generationKind);
  const fromGeneration = classifyGenerationKind(generationKind);
  if (fromGeneration) return fromGeneration;

  if (metadata.decisionPhase || metadata.decisionId) return "decision_system";
  return "execution";
}

function categoryFor(kind: TaskAttemptKind): TaskAttemptCategory {
  return kind === "execution" ? "task_execution" : "system";
}

function metadataRunRefs(metadata: Record<string, unknown>) {
  const refs = new Map<string, TaskAttemptKind>();
  for (const { key, kind } of METADATA_RUN_REFS) {
    const runId = stringValue(metadata[key]);
    if (runId && !refs.has(runId)) refs.set(runId, kind);
  }
  return refs;
}

function duplicateOutcomeSummaryRunIds(metadata: Record<string, unknown>): Set<string> {
  const value = metadata.duplicate_outcome_summary_run_ids;
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0));
}

function persistedTaskRunScope(metadata: Record<string, unknown>) {
  if (!("task_run_scope" in metadata)) return undefined;
  return parseTaskRunScope(metadata.task_run_scope);
}

function toAttempt(
  run: TaskAttemptRun,
  kind: TaskAttemptKind,
  source: "run_json" | "merged",
  currentExecutionRunId?: string,
): TaskAttempt | null {
  const runId = stringValue(run.id);
  if (!runId) return null;

  const metadata = runMetadata(run);
  const generationKind = stringValue(metadata.generationKind) || stringValue(run.generationKind);
  const category = categoryFor(kind);

  return {
    runId,
    kind,
    category,
    chainId: stringValue(run.chainId) || stringValue(metadata.chainId),
    chainName: stringValue(run.chain) || stringValue(metadata.chain),
    status: stringValue(run.status) || "unknown",
    startedAt: stringValue(run.started),
    completedAt: stringValue(run.completed),
    jobId: stringValue(run.jobId) || stringValue(metadata.generationJobId),
    generationKind,
    sourceRunId: sourceRunIdFor(kind, metadata),
    source,
    isSystem: category === "system",
    isCurrent: kind === "execution" && runId === currentExecutionRunId,
    isLatestForKind: false,
  };
}

function staleAttempt(
  runId: string,
  kind: TaskAttemptKind,
  currentExecutionRunId?: string,
): TaskAttempt {
  const category = categoryFor(kind);
  return {
    runId,
    kind,
    category,
    status: "missing",
    source: "task_metadata",
    isSystem: category === "system",
    isCurrent: kind === "execution" && runId === currentExecutionRunId,
    isLatestForKind: false,
    staleReason: "run not found",
  };
}

function markLatestForKind(attempts: TaskAttempt[]) {
  const latest = new Map<TaskAttemptKind, TaskAttempt>();
  for (const attempt of attempts) {
    const existing = latest.get(attempt.kind);
    if (!existing || timeValue(attempt.startedAt) >= timeValue(existing.startedAt)) {
      latest.set(attempt.kind, attempt);
    }
  }

  for (const attempt of attempts) {
    attempt.isLatestForKind = latest.get(attempt.kind) === attempt;
  }
}

function sortAttempts(a: TaskAttempt, b: TaskAttempt) {
  const aTime = timeValue(a.startedAt);
  const bTime = timeValue(b.startedAt);
  const byTime = (aTime || Number.MAX_SAFE_INTEGER) - (bTime || Number.MAX_SAFE_INTEGER);
  if (byTime !== 0) return byTime;

  const byKind = ATTEMPT_ORDER[a.kind] - ATTEMPT_ORDER[b.kind];
  if (byKind !== 0) return byKind;

  return a.runId.localeCompare(b.runId);
}

export function buildTaskAttempts({
  taskId,
  metadata,
  runs,
}: {
  taskId: string;
  metadata?: unknown;
  runs: TaskAttemptRun[];
}): TaskAttempt[] {
  const metadataRecord = maybeJsonRecord(metadata);
  const currentExecutionRunId = stringValue(metadataRecord.last_run_id);
  const refs = metadataRunRefs(metadataRecord);
  const duplicateOutcomeSummaries = duplicateOutcomeSummaryRunIds(metadataRecord);
  const attempts: TaskAttempt[] = [];
  const seen = new Set<string>();

  for (const run of runs) {
    const runId = stringValue(run.id);
    if (!runId) continue;
    if (duplicateOutcomeSummaries.has(runId)) continue;
    const metadataKind = refs.get(runId);
    if (run.taskId !== taskId && !metadataKind) continue;

    const attempt = toAttempt(
      run,
      classifyRun(run, metadataKind),
      metadataKind ? "merged" : "run_json",
      currentExecutionRunId,
    );
    if (!attempt) continue;

    attempts.push(attempt);
    seen.add(runId);
  }

  for (const [runId, kind] of refs) {
    if (!seen.has(runId)) attempts.push(staleAttempt(runId, kind, currentExecutionRunId));
  }

  attempts.sort(sortAttempts);
  markLatestForKind(attempts);
  return attempts;
}

export function listTaskAttempts({
  namespaceId,
  orgId,
  taskId,
  metadata,
}: {
  namespaceId: string;
  orgId: string;
  taskId: string;
  metadata?: unknown;
}): TaskAttempt[] {
  const metadataRecord = maybeJsonRecord(metadata);
  const persistedScope = persistedTaskRunScope(metadataRecord);
  if (persistedScope) {
    if (persistedScope.taskId !== taskId) {
      throw new TaskRunScopeError(
        "taskId",
        "Task run scope taskId must match the task attempts request.",
      );
    }
    const located = locateTaskRun(persistedScope);
    return buildTaskAttempts({ taskId, metadata: metadataRecord, runs: [located.run] });
  }

  const runsDir = resolveLinkRunsDir(namespaceId, orgId);
  if (!existsSync(runsDir)) {
    return buildTaskAttempts({ taskId, metadata, runs: [] });
  }

  const runs = readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry): TaskAttemptRun[] => {
      const runJsonPath = join(runsDir, entry.name, "run.json");
      if (!existsSync(runJsonPath)) return [];
      try {
        return [JSON.parse(readFileSync(runJsonPath, "utf-8")) as TaskAttemptRun];
      } catch {
        return [];
      }
    });

  return buildTaskAttempts({ taskId, metadata, runs });
}
