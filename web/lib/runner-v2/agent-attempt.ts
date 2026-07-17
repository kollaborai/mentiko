import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { serializeRunnerEvent } from "@/lib/runner-v2/events";
import { updateRunJson, type RunMutationObserver, type RunRecord } from "@/lib/runner-v2/run-state";

export type AgentAttemptPhase =
  | "created"
  | "lease_acquired"
  | "pty_allocated"
  | "process_spawned"
  | "ready_for_instructions"
  | "instructions_submitted"
  | "completed"
  | "completion_failed"
  | "startup_failed"
  | "human_action_required"
  | "stuck"
  | "released";

export type AgentAttemptTerminalReason =
  // Legacy persisted reason. New records name the actual accepted completion
  // evidence below instead of collapsing it into a generic "event" label.
  | "completed_from_event"
  | "completed_from_declared_event"
  | "completed_from_durable_marker"
  | "completed_from_cross_run_event"
  | "completed_from_handoff_artifact"
  | "completed_from_generation_artifact"
  | "completed_empty_emits_last_agent"
  | "no_completion_event"
  | "retries_exhausted"
  | "readiness_deadline_expired"
  | "readiness_policy_blocked"
  | "readiness_policy_recoverable"
  | "readiness_policy_retry"
  | "readiness_no_ready_signal"
  | "concurrency_cap_blocked"
  | "auth_prompt_detected"
  | "instruction_submission_unconfirmed"
  | "invalid_transition"
  | "reconciliation_window_expired"
  | "released";

export interface AgentAttemptTransition {
  from: AgentAttemptPhase;
  to: AgentAttemptPhase;
  at: string;
  reason?: AgentAttemptTerminalReason;
  detail?: string;
}

export interface AgentAttemptInstructionLedgerEntry {
  idempotencyKey: string;
  submittedAt: string;
  instructionPath: string;
  pointer: string;
}

export interface AgentAttemptProcessEvidence {
  processPid?: number;
  processSpawnedAt?: string;
  ptySessionId?: string;
}

export interface AgentAttemptRecord {
  id: string;
  runId: string;
  agentId: string;
  phase: AgentAttemptPhase;
  desiredPhase?: AgentAttemptPhase;
  observedPhase?: AgentAttemptPhase;
  terminalReason?: AgentAttemptTerminalReason;
  terminalDetail?: string;
  releaseReason?: AgentAttemptTerminalReason;
  leaseId?: string;
  leaseAcquiredAt?: string;
  leaseReleasedAt?: string;
  processEvidence?: AgentAttemptProcessEvidence;
  instructionLedger: AgentAttemptInstructionLedgerEntry[];
  recoveryDecisionCount: number;
  createdAt: string;
  updatedAt: string;
  transitions: AgentAttemptTransition[];
  // absent for typed-bootstrap attempts (the typed runtime observed every
  // startup phase). "routed-completion-adoption" marks attempts created at
  // completion time for agents the shell chain-runner launched: their startup
  // lifecycle ran outside the typed runtime and was not observed phase by phase.
  origin?: "routed-completion-adoption";
}

export interface RunnerV2AttemptState {
  attempts: AgentAttemptRecord[];
  stuckEvents?: AgentAttemptStuckEvent[];
}

export interface AgentAttemptStatusDto {
  id: string;
  agentId: string;
  phase: AgentAttemptPhase;
  terminalReason?: AgentAttemptTerminalReason;
  terminalDetail?: string;
  processEvidence?: AgentAttemptProcessEvidence;
  recoveryDecisionCount: number;
  updatedAt: string;
}

export interface AgentAttemptStuckEvent {
  attemptId: string;
  runId: string;
  agentId: string;
  desiredPhase?: AgentAttemptPhase;
  observedPhase?: AgentAttemptPhase;
  phase: AgentAttemptPhase;
  reason: AgentAttemptTerminalReason;
  emittedAt: string;
}

const ALLOWED_TRANSITIONS: Record<AgentAttemptPhase, AgentAttemptPhase[]> = {
  created: ["lease_acquired", "startup_failed", "human_action_required", "stuck", "released"],
  lease_acquired: ["pty_allocated", "startup_failed", "human_action_required", "released"],
  pty_allocated: ["process_spawned", "startup_failed", "human_action_required", "released"],
  process_spawned: ["ready_for_instructions", "startup_failed", "human_action_required", "stuck", "released"],
  ready_for_instructions: ["instructions_submitted", "startup_failed", "human_action_required", "stuck", "released"],
  instructions_submitted: ["completed", "completion_failed", "startup_failed", "human_action_required", "stuck", "released"],
  completed: ["released"],
  completion_failed: ["released"],
  startup_failed: ["released"],
  human_action_required: ["released"],
  stuck: ["released"],
  released: [],
};

const TERMINAL_PHASES = new Set<AgentAttemptPhase>([
  "completed",
  "completion_failed",
  "startup_failed",
  "human_action_required",
  "stuck",
  "released",
]);

/** Terminal attempts are historical evidence; a stale live-state overlay must
 * never be allowed to erase or outrank them during launch admission. */
export function isTerminalAgentAttemptPhase(phase: AgentAttemptPhase): boolean {
  return TERMINAL_PHASES.has(phase);
}

const NEXT_DESIRED_PHASE: Partial<Record<AgentAttemptPhase, AgentAttemptPhase>> = {
  created: "lease_acquired",
  lease_acquired: "pty_allocated",
  pty_allocated: "process_spawned",
  process_spawned: "ready_for_instructions",
  ready_for_instructions: "instructions_submitted",
  instructions_submitted: "completed",
};

export class AgentAttemptTransitionError extends Error {
  readonly reason = "invalid_transition" as const;

  constructor(readonly from: AgentAttemptPhase, readonly to: AgentAttemptPhase) {
    super(`invalid AgentAttempt transition: ${from} -> ${to}`);
  }
}

export function createAgentAttempt(input: {
  runJsonPath: string;
  runId: string;
  agentId: string;
  attemptId?: string;
  leaseId?: string;
  now?: Date;
}): AgentAttemptRecord {
  const at = iso(input.now);
  const state = readRunnerV2AttemptState(input.runJsonPath);
  const matching = state.attempts.filter(
    (attempt) => attempt.runId === input.runId && attempt.agentId === input.agentId,
  );
  const latest = matching[matching.length - 1];
  const attemptId = input.attemptId || (
    latest && isTerminalAgentAttemptPhase(latest.phase)
      ? `${input.runId}:${input.agentId}:${matching.length + 1}`
      : latest?.id || `${input.runId}:${input.agentId}:1`
  );
  const existing = state.attempts.find((item) => item.id === attemptId);
  if (existing) return existing;
  const attempt: AgentAttemptRecord = {
    id: attemptId,
    runId: input.runId,
    agentId: input.agentId,
    phase: "created",
    desiredPhase: "lease_acquired",
    observedPhase: "created",
    leaseId: input.leaseId,
    instructionLedger: [],
    recoveryDecisionCount: 0,
    createdAt: at,
    updatedAt: at,
    transitions: [],
  };
  writeAttempt(input.runJsonPath, attempt);
  return attempt;
}

/**
 * Adopt an attempt for an agent whose startup lifecycle ran outside the typed
 * runtime (for example, a pre-cutover routed/relaunched agent). The typed runtime never observed
 * lease/PTY/spawn phases for these agents, so the record is created directly
 * at instructions_submitted — the earliest phase supported by completion-time
 * evidence (the agent ran and reached its completion handoff) — with a single
 * adoption transition documenting that provenance instead of fabricated
 * per-phase observations. The completion verdict then drives the normal
 * instructions_submitted -> completed/completion_failed edges.
 *
 * No-op when any attempt already exists for (runId, agentId): typed-bootstrap
 * and retry lifecycles keep their existing records.
 */
export function adoptAgentAttemptForCompletion(input: {
  runJsonPath: string;
  runId: string;
  agentId: string;
  sessionName?: string;
  now?: Date;
  onMutation?: RunMutationObserver;
}): AgentAttemptRecord {
  const existing = findLatestAttempt(input.runJsonPath, input.runId, input.agentId);
  // a completed latest attempt stays authoritative (duplicate completion events
  // are idempotent downstream). A FAILURE-terminal latest must not wedge the
  // agent forever: a false early completion (e.g. the monitor latching a
  // rendered AGENT_COMPLETE from wrapped instruction text) marks the attempt
  // completion_failed while the agent is still working — when the real
  // completion evidence arrives, record it on a fresh adopted attempt instead
  // of rejecting the legal-history transition and aborting the whole handoff.
  if (existing && (existing.phase === "completed" || !isTerminalAgentAttemptPhase(existing.phase))) {
    return existing;
  }

  const at = iso(input.now);
  const sequence = readRunnerV2AttemptState(input.runJsonPath).attempts
    .filter((attempt) => attempt.runId === input.runId && attempt.agentId === input.agentId)
    .length + 1;
  const detail = existing
    ? `adopted at completion: previous attempt ${existing.id} ended ${existing.phase}${existing.terminalReason ? ` (${existing.terminalReason})` : ""} but new completion evidence arrived for the same agent${input.sessionName ? `; session ${input.sessionName}` : ""}`
    : `adopted at completion: agent launched by shell chain-runner (typed runtime did not observe startup)${input.sessionName ? `; session ${input.sessionName}` : ""}`;
  const attempt: AgentAttemptRecord = {
    id: `${input.runId}:${input.agentId}:${sequence}`,
    runId: input.runId,
    agentId: input.agentId,
    phase: "instructions_submitted",
    desiredPhase: "completed",
    observedPhase: "instructions_submitted",
    leaseId: input.sessionName,
    ...(input.sessionName ? { processEvidence: { ptySessionId: input.sessionName } } : {}),
    instructionLedger: [],
    recoveryDecisionCount: 0,
    createdAt: at,
    updatedAt: at,
    transitions: [{ from: "created", to: "instructions_submitted", at, detail }],
    origin: "routed-completion-adoption",
  };
  writeAttempt(input.runJsonPath, attempt, input.onMutation);
  return attempt;
}

export function transitionAgentAttempt(input: {
  runJsonPath: string;
  attemptId: string;
  to: AgentAttemptPhase;
  reason?: AgentAttemptTerminalReason;
  detail?: string;
  now?: Date;
  onMutation?: RunMutationObserver;
}): AgentAttemptRecord {
  const at = iso(input.now);
  return updateAttempt(input.runJsonPath, input.attemptId, (attempt) => {
    if (!canTransition(attempt.phase, input.to)) {
      throw new AgentAttemptTransitionError(attempt.phase, input.to);
    }
    const terminalReason = terminalReasonForTransition(attempt, input.to, input.reason);
    const terminalDetail = terminalDetailForTransition(attempt, input.to, input.detail);
    return {
      ...attempt,
      phase: input.to,
      desiredPhase: NEXT_DESIRED_PHASE[input.to] || input.to,
      observedPhase: input.to,
      terminalReason,
      terminalDetail,
      releaseReason: input.to === "released" ? input.reason : attempt.releaseReason,
      leaseAcquiredAt: input.to === "lease_acquired" ? at : attempt.leaseAcquiredAt,
      leaseReleasedAt: input.to === "released" ? at : attempt.leaseReleasedAt,
      updatedAt: at,
      transitions: [
        ...attempt.transitions,
        { from: attempt.phase, to: input.to, at, reason: input.reason, detail: input.detail },
      ],
    };
  }, input.onMutation);
}

export function recordAgentAttemptRecoveryDecision(input: {
  runJsonPath: string;
  attemptId: string;
  now?: Date;
}): AgentAttemptRecord {
  const at = iso(input.now);
  return updateAttempt(input.runJsonPath, input.attemptId, (attempt) => ({
    ...attempt,
    recoveryDecisionCount: attempt.recoveryDecisionCount + 1,
    updatedAt: at,
  }));
}

export function recordAgentAttemptProcess(input: {
  runJsonPath: string;
  attemptId: string;
  processPid: number;
  ptySessionId: string;
  now?: Date;
}): AgentAttemptRecord {
  const at = iso(input.now);
  return updateAttempt(input.runJsonPath, input.attemptId, (attempt) => ({
    ...attempt,
    processEvidence: {
      processPid: input.processPid,
      processSpawnedAt: at,
      ptySessionId: input.ptySessionId,
    },
    updatedAt: at,
  }));
}

export function submitAgentAttemptInstructions(input: {
  runJsonPath: string;
  attemptId: string;
  idempotencyKey: string;
  instructionPath: string;
  pointer: string;
  now?: Date;
}): { attempt: AgentAttemptRecord; delivered: boolean } {
  let delivered = false;
  const at = iso(input.now);
  const attempt = updateAttempt(input.runJsonPath, input.attemptId, (current) => {
    const exists = current.instructionLedger.some((entry) => entry.idempotencyKey === input.idempotencyKey);
    if (exists) return current;
    delivered = true;
    return {
      ...current,
      instructionLedger: [
        ...current.instructionLedger,
        {
          idempotencyKey: input.idempotencyKey,
          submittedAt: at,
          instructionPath: input.instructionPath,
          pointer: input.pointer,
        },
      ],
      updatedAt: at,
    };
  });
  return { attempt, delivered };
}

export function markAgentAttemptCompletedFromGeneration(input: {
  runJsonPath: string;
  runId: string;
  agentId: string;
  detail?: string;
  now?: Date;
  onMutation?: RunMutationObserver;
}): AgentAttemptRecord | undefined {
  return markLatestAttemptCompleted({
    ...input,
    reason: "completed_from_generation_artifact",
  });
}

export function markAgentAttemptCompletedFromEvent(input: {
  runJsonPath: string;
  runId: string;
  agentId: string;
  detail?: string;
  now?: Date;
  onMutation?: RunMutationObserver;
}): AgentAttemptRecord | undefined {
  return markLatestAttemptCompleted({
    ...input,
    reason: "completed_from_declared_event",
  });
}

export function markAgentAttemptCompletedFromDurableMarker(input: {
  runJsonPath: string;
  runId: string;
  agentId: string;
  detail?: string;
  now?: Date;
  onMutation?: RunMutationObserver;
}): AgentAttemptRecord | undefined {
  return markLatestAttemptCompleted({
    ...input,
    reason: "completed_from_durable_marker",
  });
}

export function markAgentAttemptCompletedFromCrossRunEvent(input: {
  runJsonPath: string;
  runId: string;
  agentId: string;
  detail?: string;
  now?: Date;
  onMutation?: RunMutationObserver;
}): AgentAttemptRecord | undefined {
  return markLatestAttemptCompleted({
    ...input,
    reason: "completed_from_cross_run_event",
  });
}

export function markAgentAttemptCompletedFromHandoffArtifact(input: {
  runJsonPath: string;
  runId: string;
  agentId: string;
  detail?: string;
  now?: Date;
  onMutation?: RunMutationObserver;
}): AgentAttemptRecord | undefined {
  return markLatestAttemptCompleted({
    ...input,
    reason: "completed_from_handoff_artifact",
  });
}

export function markAgentAttemptCompletedFromEmptyEmits(input: {
  runJsonPath: string;
  runId: string;
  agentId: string;
  detail?: string;
  now?: Date;
  onMutation?: RunMutationObserver;
}): AgentAttemptRecord | undefined {
  return markLatestAttemptCompleted({
    ...input,
    reason: "completed_empty_emits_last_agent",
  });
}

export function markAgentAttemptFailedNoCompletion(input: {
  runJsonPath: string;
  runId: string;
  agentId: string;
  detail?: string;
  now?: Date;
  onMutation?: RunMutationObserver;
}): AgentAttemptRecord | undefined {
  return markLatestAttemptFailed({
    ...input,
    reason: "no_completion_event",
  });
}

export function markAgentAttemptRetriesExhausted(input: {
  runJsonPath: string;
  runId: string;
  agentId: string;
  detail?: string;
  now?: Date;
  onMutation?: RunMutationObserver;
}): AgentAttemptRecord | undefined {
  return markLatestAttemptFailed({
    ...input,
    reason: "retries_exhausted",
  });
}

export function reconcileAgentAttempt(input: {
  runJsonPath: string;
  attemptId: string;
  reconciliationWindowMs: number;
  now?: Date;
  eventsDir?: string;
}): AgentAttemptRecord {
  const now = input.now || new Date();
  const attempt = readAttempt(input.runJsonPath, input.attemptId);
  if (isTerminalAgentAttemptPhase(attempt.phase)) return attempt;
  if (!attempt.desiredPhase || attempt.desiredPhase === attempt.observedPhase) return attempt;
  if (now.getTime() - new Date(attempt.updatedAt).getTime() < input.reconciliationWindowMs) return attempt;

  recordAgentAttemptRecoveryDecision({
    runJsonPath: input.runJsonPath,
    attemptId: input.attemptId,
    now,
  });
  const stuck = transitionAgentAttempt({
    runJsonPath: input.runJsonPath,
    attemptId: input.attemptId,
    to: "stuck",
    reason: "reconciliation_window_expired",
    detail: `${attempt.observedPhase || attempt.phase} did not reach ${attempt.desiredPhase}`,
    now,
  });
  const event: AgentAttemptStuckEvent = {
    attemptId: stuck.id,
    runId: stuck.runId,
    agentId: stuck.agentId,
    desiredPhase: stuck.desiredPhase,
    observedPhase: stuck.observedPhase,
    phase: stuck.phase,
    reason: "reconciliation_window_expired",
    emittedAt: iso(now),
  };
  appendStuckEvent(input.runJsonPath, event);
  if (input.eventsDir) writeStuckEventFile(input.eventsDir, event);
  return stuck;
}

export function releaseAgentAttempt(input: {
  runJsonPath: string;
  attemptId: string;
  now?: Date;
}): AgentAttemptRecord {
  const attempt = readAttempt(input.runJsonPath, input.attemptId);
  if (attempt.phase === "released") return attempt;
  return transitionAgentAttempt({
    runJsonPath: input.runJsonPath,
    attemptId: input.attemptId,
    to: "released",
    reason: "released",
    now: input.now,
  });
}

export function readRunnerV2AttemptState(runJsonPath: string): RunnerV2AttemptState {
  if (!existsSync(runJsonPath)) return { attempts: [] };
  const run = JSON.parse(readFileSync(runJsonPath, "utf8")) as RunRecord & { runnerV2?: RunnerV2AttemptState };
  return {
    attempts: Array.isArray(run.runnerV2?.attempts) ? run.runnerV2.attempts : [],
    stuckEvents: Array.isArray(run.runnerV2?.stuckEvents) ? run.runnerV2.stuckEvents : [],
  };
}

export function projectAgentAttemptsForStatus(state: RunnerV2AttemptState | undefined): {
  attempts: AgentAttemptStatusDto[];
} {
  return {
    attempts: (Array.isArray(state?.attempts) ? state.attempts : []).map((attempt) => ({
      id: attempt.id,
      agentId: attempt.agentId,
      phase: attempt.phase,
      terminalReason: attempt.terminalReason,
      terminalDetail: attempt.terminalDetail,
      processEvidence: attempt.processEvidence,
      recoveryDecisionCount: attempt.recoveryDecisionCount,
      updatedAt: attempt.updatedAt,
    })),
  };
}

export function canTransition(from: AgentAttemptPhase, to: AgentAttemptPhase): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) === true;
}

export function classifyReadinessFailure(output: string): {
  phase: "startup_failed" | "human_action_required";
  reason: AgentAttemptTerminalReason;
  detail: string;
} {
  const normalized = output.toLowerCase();
  if (
    /\b(log in|login|sign in|authenticate|authentication required|please authenticate)\b/.test(normalized)
    || /\b(api key|token)\b.*\b(required|missing|not found|invalid)\b/.test(normalized)
    || /\b(required|missing|invalid)\b.*\b(api key|token)\b/.test(normalized)
    || normalized.includes("oauth")
  ) {
    return {
      phase: "human_action_required",
      reason: "auth_prompt_detected",
      detail: output.slice(-500),
    };
  }
  return {
    phase: "startup_failed",
    reason: "readiness_deadline_expired",
    detail: output.slice(-500),
  };
}

function readAttempt(runJsonPath: string, attemptId: string): AgentAttemptRecord {
  const attempt = readRunnerV2AttemptState(runJsonPath).attempts.find((item) => item.id === attemptId);
  if (!attempt) throw new Error(`AgentAttempt not found: ${attemptId}`);
  return attempt;
}

function findLatestAttempt(runJsonPath: string, runId: string, agentId: string): AgentAttemptRecord | undefined {
  const attempts = readRunnerV2AttemptState(runJsonPath).attempts
    .filter((attempt) => attempt.runId === runId && attempt.agentId === agentId);
  return attempts[attempts.length - 1];
}

function markLatestAttemptCompleted(input: {
  runJsonPath: string;
  runId: string;
  agentId: string;
  reason: AgentAttemptTerminalReason;
  detail?: string;
  now?: Date;
  onMutation?: RunMutationObserver;
}): AgentAttemptRecord | undefined {
  const attempt = findLatestAttempt(input.runJsonPath, input.runId, input.agentId);
  if (!attempt || attempt.phase === "completed" || attempt.phase === "released") return attempt;
  // same guard as markLatestAttemptFailed: the ledger records evidence, it must
  // never abort the live completion handoff with an invalid-transition throw
  // (a falsely failure-terminal attempt otherwise wedges the agent's REAL
  // completion — adoption creates a fresh attempt for that case upstream).
  if (!canTransition(attempt.phase, "completed")) return attempt;
  return transitionAgentAttempt({
    runJsonPath: input.runJsonPath,
    attemptId: attempt.id,
    to: "completed",
    reason: input.reason,
    detail: input.detail,
    now: input.now,
    onMutation: input.onMutation,
  });
}

function markLatestAttemptFailed(input: {
  runJsonPath: string;
  runId: string;
  agentId: string;
  reason: AgentAttemptTerminalReason;
  detail?: string;
  now?: Date;
  onMutation?: RunMutationObserver;
}): AgentAttemptRecord | undefined {
  const attempt = findLatestAttempt(input.runJsonPath, input.runId, input.agentId);
  if (!attempt) return undefined;
  // completion failure only applies to an attempt that actually reached a running
  // agent; leave already-terminal or pre-instructions attempts untouched instead
  // of throwing an invalid-transition error into the live completion path.
  if (isTerminalAgentAttemptPhase(attempt.phase)) return attempt;
  if (!canTransition(attempt.phase, "completion_failed")) return attempt;
  return transitionAgentAttempt({
    runJsonPath: input.runJsonPath,
    attemptId: attempt.id,
    to: "completion_failed",
    reason: input.reason,
    detail: input.detail,
    now: input.now,
    onMutation: input.onMutation,
  });
}

function writeAttempt(
  runJsonPath: string,
  attempt: AgentAttemptRecord,
  onMutation?: RunMutationObserver,
): void {
  updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${runJsonPath}`);
    const runnerV2 = current.runnerV2 as RunnerV2AttemptState | undefined;
    const attempts = Array.isArray(runnerV2?.attempts) ? runnerV2.attempts : [];
    const existing = attempts.findIndex((item) => item.id === attempt.id);
    const nextAttempts = [...attempts];
    if (existing >= 0) nextAttempts[existing] = attempt;
    else nextAttempts.push(attempt);
    return {
      ...current,
      runnerV2: {
        ...(runnerV2 || {}),
        attempts: nextAttempts,
      },
    };
  }, undefined, onMutation);
}

function updateAttempt(
  runJsonPath: string,
  attemptId: string,
  update: (attempt: AgentAttemptRecord) => AgentAttemptRecord,
  onMutation?: RunMutationObserver,
): AgentAttemptRecord {
  let updated: AgentAttemptRecord | undefined;
  updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${runJsonPath}`);
    const runnerV2 = current.runnerV2 as RunnerV2AttemptState | undefined;
    const attempts = Array.isArray(runnerV2?.attempts) ? runnerV2.attempts : [];
    const existing = attempts.findIndex((item) => item.id === attemptId);
    if (existing < 0) throw new Error(`AgentAttempt not found: ${attemptId}`);
    const nextAttempts = [...attempts];
    updated = update(nextAttempts[existing]);
    nextAttempts[existing] = updated;
    return {
      ...current,
      runnerV2: {
        ...(runnerV2 || {}),
        attempts: nextAttempts,
      },
    };
  }, undefined, onMutation);
  if (!updated) throw new Error(`AgentAttempt not updated: ${attemptId}`);
  return updated;
}

function appendStuckEvent(runJsonPath: string, event: AgentAttemptStuckEvent): void {
  updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${runJsonPath}`);
    const runnerV2 = current.runnerV2 as RunnerV2AttemptState | undefined;
    const existing = Array.isArray(runnerV2?.stuckEvents) ? runnerV2.stuckEvents : [];
    if (existing.some((item) => item.attemptId === event.attemptId)) {
      return current;
    }
    return {
      ...current,
      runnerV2: {
        ...(runnerV2 || {}),
        attempts: Array.isArray(runnerV2?.attempts) ? runnerV2.attempts : [],
        stuckEvents: [...existing, event],
      },
    };
  });
}

function writeStuckEventFile(eventsDir: string, event: AgentAttemptStuckEvent): void {
  mkdirSync(eventsDir, { recursive: true });
  const path = join(eventsDir, `agent-attempt-stuck-${event.attemptId.replace(/[^a-zA-Z0-9_.-]/g, "-")}.event`);
  writeFileSync(path, serializeRunnerEvent({
    event: "agent_attempt_stuck",
    source: event.agentId,
    runId: event.runId,
    timestamp: event.emittedAt,
    data: JSON.stringify(event),
  }));
}

function iso(now = new Date()): string {
  return now.toISOString();
}

function terminalReasonForTransition(
  attempt: AgentAttemptRecord,
  to: AgentAttemptPhase,
  reason: AgentAttemptTerminalReason | undefined,
): AgentAttemptTerminalReason | undefined {
  if (!TERMINAL_PHASES.has(to)) return attempt.terminalReason;
  if (to === "released" && attempt.terminalReason) return attempt.terminalReason;
  return reason || attempt.terminalReason;
}

function terminalDetailForTransition(
  attempt: AgentAttemptRecord,
  to: AgentAttemptPhase,
  detail: string | undefined,
): string | undefined {
  if (!TERMINAL_PHASES.has(to)) return attempt.terminalDetail;
  if (to === "released" && attempt.terminalDetail) return attempt.terminalDetail;
  return detail || attempt.terminalDetail;
}
