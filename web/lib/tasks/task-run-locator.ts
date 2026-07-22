import {
  isRunId,
  readRunRecordAt,
  resolveExistingRunRecordPaths,
  resolveRunRecordPaths,
  type RunRecord,
  type RunRecordPaths,
} from "@/lib/runs/run-record";
import { shouldRecordTaskExecutionMetadata } from "@/lib/runs/run-provenance";
import { orgPath } from "@/lib/config";

/**
 * The sole task metadata key for the authoritative location of a task-linked
 * run. The same value is written to run.json metadata at launch time.
 */
export const TASK_RUN_SCOPE_METADATA_KEY = "task_run_scope" as const;
export const TASK_RUN_LAUNCH_FAILURE_METADATA_KEY = "task_run_launch_failure" as const;

/**
 * Historical provenance for the terminal execution that a retry replaced.
 * Unlike task_run_scope, this is never an active admission claim.
 */
export const TASK_RETRY_SOURCE_RUN_ID_METADATA_KEY = "retry_source_run_id" as const;
export const TASK_RETRY_SOURCE_SCOPE_METADATA_KEY = "retry_source_task_run_scope" as const;

/**
 * Durable task-to-run location. Persist this alongside the task's claimed run
 * so every reader uses the same namespace/org root that created the run.
 */
export interface TaskRunScope {
  readonly version: 1;
  readonly taskId: string;
  readonly runId: string;
  readonly namespaceId: string;
  readonly orgId: string;
}

export interface TaskRunLocation extends RunRecordPaths {
  readonly scope: TaskRunScope;
}

export interface LocatedTaskRun extends TaskRunLocation {
  readonly run: RunRecord;
}

export type TaskRunMismatchField = "id" | "taskId" | "provenance";

export class TaskRunScopeError extends Error {
  constructor(readonly field: "scope" | keyof TaskRunScope, message: string) {
    super(message);
    this.name = "TaskRunScopeError";
  }
}

export class TaskRunMissingError extends Error {
  constructor(readonly scope: TaskRunScope, readonly runJsonPath: string) {
    super(`Task run ${scope.runId} is missing from its persisted scope.`);
    this.name = "TaskRunMissingError";
  }
}

export class TaskRunMismatchError extends Error {
  constructor(
    readonly scope: TaskRunScope,
    readonly field: TaskRunMismatchField,
    readonly actual: unknown,
  ) {
    super(`Task run ${scope.runId} does not match persisted ${field}.`);
    this.name = "TaskRunMismatchError";
  }
}

/**
 * Raised from caller-provided persisted claims. This deliberately does not
 * search alternate roots: a duplicate claim is invalid evidence, not a reason
 * to guess which root should win.
 */
export class DuplicateTaskRunLocationError extends Error {
  constructor(
    readonly first: TaskRunScope,
    readonly duplicate: TaskRunScope,
  ) {
    super(`Task run ${duplicate.runId} has duplicate persisted locations.`);
    this.name = "DuplicateTaskRunLocationError";
  }
}

export function createTaskRunScope(input: TaskRunScope): TaskRunScope {
  return parseTaskRunScope(input);
}

/**
 * A launch rejected before run.json exists must not retain an authoritative
 * task_run_scope. Preserve the attempted scope as diagnostic evidence, pause
 * automatic admission, and leave any older durable run history untouched.
 */
export function taskRunLaunchFailureMetadata(input: {
  metadata: Record<string, unknown>;
  scope: TaskRunScope;
  message: string;
}): Record<string, unknown> {
  const { [TASK_RUN_SCOPE_METADATA_KEY]: _provisionalScope, ...priorMetadata } = input.metadata;
  return {
    ...priorMetadata,
    auto_run_paused: true,
    auto_run_paused_reason: input.message,
    [TASK_RUN_LAUNCH_FAILURE_METADATA_KEY]: {
      version: 1,
      attempted_scope: input.scope,
      message: input.message,
    },
  };
}

/**
 * Release the active task->run claim when a terminal execution is scheduled
 * for retry. The source remains traceable, but cannot block the next attempt.
 *
 * Callers have already established that sourceRunId is the terminal run they
 * are reducing. We retain the full scoped location only when it agrees with
 * that source and this task; malformed claims are cleared rather than being
 * promoted into retry provenance.
 */
export function releaseTaskRunScopeForRetry(
  metadata: Record<string, unknown>,
  input: { taskId: string; sourceRunId: string },
): Record<string, unknown> {
  let sourceScope: TaskRunScope | undefined;
  try {
    const activeScope = parseTaskRunScope(metadata[TASK_RUN_SCOPE_METADATA_KEY]);
    if (activeScope.taskId === input.taskId && activeScope.runId === input.sourceRunId) {
      sourceScope = activeScope;
    }
  } catch {
    // A retry must release a malformed active claim too. It is not provenance.
  }

  return {
    ...metadata,
    [TASK_RUN_SCOPE_METADATA_KEY]: undefined,
    [TASK_RETRY_SOURCE_RUN_ID_METADATA_KEY]: input.sourceRunId,
    [TASK_RETRY_SOURCE_SCOPE_METADATA_KEY]: sourceScope,
  };
}

/** Parse an untrusted persisted JSON value into the immutable scope contract. */
export function parseTaskRunScope(input: unknown): TaskRunScope {
  assertTaskRunScope(input);
  return Object.freeze({
    version: 1,
    taskId: input.taskId,
    runId: input.runId,
    namespaceId: input.namespaceId,
    orgId: input.orgId,
  });
}

export function resolveTaskRunLocation(input: TaskRunScope): TaskRunLocation {
  const scope = createTaskRunScope(input);
  // orgPath intentionally collapses the default org into the namespace root.
  const runsDir = orgPath(scope.namespaceId, scope.orgId, "runs");
  return {
    scope,
    ...resolveRunRecordPaths(runsDir, scope.runId),
  };
}

/** Locate exactly the run declared by the persisted scope; never scan roots. */
export function locateTaskRun(input: TaskRunScope): LocatedTaskRun {
  const location = resolveTaskRunLocation(input);
  let paths: RunRecordPaths;
  let run: RunRecord;
  try {
    paths = resolveExistingRunRecordPaths(location.runsDir, location.scope.runId);
    run = readRunRecordAt(paths.runsDir, location.scope.runId);
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new TaskRunMissingError(location.scope, location.runJsonPath);
    }
    throw error;
  }

  verifyTaskRunRecord(location.scope, run);
  return { ...paths, scope: location.scope, run };
}

/** Verify identity, task ownership, and execution provenance after direct lookup. */
export function verifyTaskRunRecord(scopeInput: TaskRunScope, run: RunRecord): void {
  const scope = createTaskRunScope(scopeInput);
  if (run.id !== scope.runId) {
    throw new TaskRunMismatchError(scope, "id", run.id);
  }
  if (run.taskId !== scope.taskId) {
    throw new TaskRunMismatchError(scope, "taskId", run.taskId);
  }
  if (!shouldRecordTaskExecutionMetadata(run.metadata)) {
    throw new TaskRunMismatchError(scope, "provenance", run.metadata);
  }
}

/**
 * Validate a set of persisted claims without touching the filesystem. A run
 * cannot be claimed by two tasks in one root, nor can one task/run pair point
 * at two roots.
 */
export function assertNoDuplicateTaskRunLocations(scopes: Iterable<TaskRunScope>): void {
  const byLocation = new Map<string, TaskRunScope>();
  const byTaskRun = new Map<string, TaskRunScope>();

  for (const input of scopes) {
    const scope = createTaskRunScope(input);
    const locationKey = [scope.namespaceId, scope.orgId, scope.runId].join("\u0000");
    const taskRunKey = [scope.taskId, scope.runId].join("\u0000");
    const sameLocation = byLocation.get(locationKey);
    const sameTaskRun = byTaskRun.get(taskRunKey);
    if (sameLocation) throw new DuplicateTaskRunLocationError(sameLocation, scope);
    if (sameTaskRun) throw new DuplicateTaskRunLocationError(sameTaskRun, scope);
    byLocation.set(locationKey, scope);
    byTaskRun.set(taskRunKey, scope);
  }
}

function assertTaskRunScope(scope: unknown): asserts scope is TaskRunScope {
  if (!isRecord(scope)) {
    throw new TaskRunScopeError("scope", "Task run scope must be an object.");
  }
  if (scope.version !== 1) {
    throw new TaskRunScopeError("version", "Task run scope version must be 1.");
  }
  for (const field of ["taskId", "namespaceId", "orgId"] as const) {
    if (typeof scope[field] !== "string" || scope[field].trim() === "") {
      throw new TaskRunScopeError(field, `Task run scope ${field} is required.`);
    }
  }
  if (!isRunId(scope.runId)) {
    throw new TaskRunScopeError("runId", "Task run scope runId is invalid.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}
