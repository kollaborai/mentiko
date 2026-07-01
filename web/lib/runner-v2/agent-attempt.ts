import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { updateRunJson, type RunRecord } from "@/lib/runner-v2/run-state";

export type AgentAttemptPhase =
  | "created"
  | "lease_acquired"
  | "pty_allocated"
  | "process_spawned"
  | "ready_for_instructions"
  | "instructions_submitted"
  | "completed"
  | "startup_failed"
  | "human_action_required"
  | "stuck"
  | "released";

export type AgentAttemptTerminalReason =
  | "completed_from_event"
  | "completed_from_generation_artifact"
  | "readiness_deadline_expired"
  | "auth_prompt_detected"
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
  leaseId?: string;
  leaseAcquiredAt?: string;
  leaseReleasedAt?: string;
  processEvidence?: AgentAttemptProcessEvidence;
  instructionLedger: AgentAttemptInstructionLedgerEntry[];
  recoveryDecisionCount: number;
  createdAt: string;
  updatedAt: string;
  transitions: AgentAttemptTransition[];
}

export interface RunnerV2AttemptState {
  attempts: AgentAttemptRecord[];
  stuckEvents?: AgentAttemptStuckEvent[];
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
  instructions_submitted: ["completed", "startup_failed", "human_action_required", "stuck", "released"],
  completed: ["released"],
  startup_failed: ["released"],
  human_action_required: ["released"],
  stuck: ["released"],
  released: [],
};

const TERMINAL_PHASES = new Set<AgentAttemptPhase>([
  "completed",
  "startup_failed",
  "human_action_required",
  "stuck",
  "released",
]);

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
  const attemptId = input.attemptId || `${input.runId}:${input.agentId}:1`;
  const existing = readRunnerV2AttemptState(input.runJsonPath).attempts.find((item) => item.id === attemptId);
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

export function transitionAgentAttempt(input: {
  runJsonPath: string;
  attemptId: string;
  to: AgentAttemptPhase;
  reason?: AgentAttemptTerminalReason;
  detail?: string;
  now?: Date;
}): AgentAttemptRecord {
  const at = iso(input.now);
  return updateAttempt(input.runJsonPath, input.attemptId, (attempt) => {
    if (!canTransition(attempt.phase, input.to)) {
      throw new AgentAttemptTransitionError(attempt.phase, input.to);
    }
    return {
      ...attempt,
      phase: input.to,
      observedPhase: input.to,
      terminalReason: TERMINAL_PHASES.has(input.to) ? input.reason : attempt.terminalReason,
      terminalDetail: TERMINAL_PHASES.has(input.to) ? input.detail : attempt.terminalDetail,
      leaseAcquiredAt: input.to === "lease_acquired" ? at : attempt.leaseAcquiredAt,
      leaseReleasedAt: input.to === "released" ? at : attempt.leaseReleasedAt,
      updatedAt: at,
      transitions: [
        ...attempt.transitions,
        { from: attempt.phase, to: input.to, at, reason: input.reason, detail: input.detail },
      ],
    };
  });
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
}): AgentAttemptRecord | undefined {
  const attempt = findLatestAttempt(input.runJsonPath, input.runId, input.agentId);
  if (!attempt || attempt.phase === "completed" || attempt.phase === "released") return attempt;
  return transitionAgentAttempt({
    runJsonPath: input.runJsonPath,
    attemptId: attempt.id,
    to: "completed",
    reason: "completed_from_generation_artifact",
    detail: input.detail,
    now: input.now,
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
  if (!attempt.desiredPhase || attempt.desiredPhase === attempt.observedPhase) return attempt;
  if (now.getTime() - new Date(attempt.updatedAt).getTime() < input.reconciliationWindowMs) return attempt;

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
    normalized.includes("login")
    || normalized.includes("sign in")
    || normalized.includes("authentication")
    || normalized.includes("auth")
    || normalized.includes("api key")
    || normalized.includes("install")
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

function writeAttempt(runJsonPath: string, attempt: AgentAttemptRecord): void {
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
  });
}

function updateAttempt(
  runJsonPath: string,
  attemptId: string,
  update: (attempt: AgentAttemptRecord) => AgentAttemptRecord,
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
  });
  if (!updated) throw new Error(`AgentAttempt not updated: ${attemptId}`);
  return updated;
}

function appendStuckEvent(runJsonPath: string, event: AgentAttemptStuckEvent): void {
  updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${runJsonPath}`);
    const runnerV2 = current.runnerV2 as RunnerV2AttemptState | undefined;
    return {
      ...current,
      runnerV2: {
        ...(runnerV2 || {}),
        attempts: Array.isArray(runnerV2?.attempts) ? runnerV2.attempts : [],
        stuckEvents: [...(Array.isArray(runnerV2?.stuckEvents) ? runnerV2.stuckEvents : []), event],
      },
    };
  });
}

function writeStuckEventFile(eventsDir: string, event: AgentAttemptStuckEvent): void {
  mkdirSync(eventsDir, { recursive: true });
  const path = join(eventsDir, `agent-attempt-stuck-${event.attemptId.replace(/[^a-zA-Z0-9_.-]/g, "-")}.event`);
  writeFileSync(path, [
    "event: agent_attempt_stuck",
    `source: ${event.agentId}`,
    `run_id: ${event.runId}`,
    `timestamp: ${event.emittedAt}`,
    "processed: false",
    `data: ${JSON.stringify(event)}`,
    "",
  ].join("\n"));
}

function iso(now = new Date()): string {
  return now.toISOString();
}
