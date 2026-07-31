// Single source of truth for a task's auto-run state.
//
// PURE — no I/O — so the server admission gate (lib/runs/auto-run.ts) and the
// client task UI (components/task/*) resolve "is auto-run on / paused / how many
// retries" IDENTICALLY, instead of each re-deriving it from raw metadata (which
// is how the workspace default silently went unhonored). The workspace default
// is fs-backed, so it is resolved ONCE server-side (resolveTaskAutoRunDefault)
// and passed in here as `workspaceDefault`; the client reads the already-resolved
// result off the task DTO (Task.autoRun).

export const MAX_AUTO_RUN_RETRIES = 3;

export type AutoRunSource = "task" | "workspace" | "off";

export interface AutoRunState {
  /** resolved: the explicit per-task flag if set, else the workspace default */
  enabled: boolean;
  /** where `enabled` came from — for the UI to show "on (workspace default)" */
  source: AutoRunSource;
  retries: number;
  /** retries exhausted — auto-run will not admit again until attempts are reset */
  retriesExhausted: boolean;
  /** explicit user pause (distinct from retry exhaustion) */
  userPaused: boolean;
  pausedReason: string;
  /** deterministic generation rejection stop (metadata.generation_stop_reason) */
  generationStopped: boolean;
  generationStopReason: string;
  /** the ONE admit predicate the gate and the UI must agree on */
  willAdmit: boolean;
}

/**
 * Resolve a task's auto-run state from its raw fields plus the (server-resolved)
 * workspace default. This is the only place the rules live.
 */
export function resolveAutoRunState(input: {
  /** metadata.auto_run — undefined means "not explicitly set, fall to default" */
  explicitAutoRun?: boolean;
  /** resolveTaskAutoRunDefault() result for the task's workspace */
  workspaceDefault?: boolean;
  retries?: number;
  /** metadata.auto_run_paused */
  userPaused?: boolean;
  /** metadata.auto_run_paused_reason */
  pausedReason?: string;
  /** metadata.generation_stop_reason — deterministic rejection stop (A4) */
  generationStopReason?: string;
  completed?: boolean;
}): AutoRunState {
  const explicit = typeof input.explicitAutoRun === "boolean" ? input.explicitAutoRun : undefined;
  const enabled = explicit ?? !!input.workspaceDefault;
  const source: AutoRunSource =
    explicit === true ? "task"
    : explicit === false ? "off"
    : input.workspaceDefault ? "workspace"
    : "off";

  const retries = typeof input.retries === "number" && input.retries > 0 ? input.retries : 0;
  const completed = !!input.completed;
  const retriesExhausted = enabled && retries >= MAX_AUTO_RUN_RETRIES && !completed;

  const pausedReason = input.pausedReason?.trim() ?? "";
  const userPaused = !!input.userPaused || pausedReason.length > 0;

  // A deterministic rejection stop is intentional and permanent until a human
  // clears it: re-admitting would re-submit the same rejected artifact family.
  const generationStopReason = input.generationStopReason?.trim() ?? "";
  const generationStopped = generationStopReason.length > 0 && !completed;

  const willAdmit = enabled && !userPaused && !retriesExhausted && !generationStopped && !completed;

  return { enabled, source, retries, retriesExhausted, userPaused, pausedReason, generationStopped, generationStopReason, willAdmit };
}
