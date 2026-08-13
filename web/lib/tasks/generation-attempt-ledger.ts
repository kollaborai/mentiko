// Phase-aware attempt ledger for a task's chain pipeline
// (chain-contract-plan-of-record.md B7). PURE — no I/O. Entries live in task
// metadata under `generation_attempts` and are appended by the door that
// observed the outcome: generation dispatch/failure, import rejection,
// artifact recovery, save, run binding, execution launch, completion audit.
//
// The ledger REPLACES the generic retry integer as the source of truth for
// status display: `auto_run_retries` remains only as the transient-failure
// budget counter, and deterministic stops are decided by
// generation-rejection-policy — both decisions are RECORDED here so the UI
// and diagnostics can show what actually happened, in order, with hashes.

export type GenerationAttemptPhase =
  | "generation"
  | "import"
  | "recovery"
  | "save"
  | "binding"
  | "execution"
  | "completion_audit";

export type GenerationAttemptClass = "deterministic" | "transient" | "success";

export interface GenerationAttemptEntry {
  phase: GenerationAttemptPhase;
  /** stable outcome code, e.g. generated_chain_contract_violation, dispatch_failed, accepted */
  code: string;
  class: GenerationAttemptClass;
  at: string;
  input_hash?: string;
  output_hash?: string;
  /** contract/validator revision that made the decision */
  revision?: string;
  /** corrective guidance carried into the next attempt, if any */
  guidance?: string;
  /** terminal stop reason when this entry ended the loop */
  stop_reason?: string;
}

export const GENERATION_ATTEMPTS_KEY = "generation_attempts";

/** Bounded history — enough to show the full story of any real incident. */
const LEDGER_CAP = 30;

export function readGenerationAttempts(metadata: Record<string, unknown>): GenerationAttemptEntry[] {
  const raw = metadata[GENERATION_ATTEMPTS_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is GenerationAttemptEntry =>
    Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
    && typeof (entry as GenerationAttemptEntry).phase === "string"
    && typeof (entry as GenerationAttemptEntry).code === "string");
}

/**
 * Returns the metadata patch that appends one attempt. Merge it into the
 * task-metadata update the caller is already writing — one write, no extra
 * store round-trip.
 */
export function appendGenerationAttempt(
  metadata: Record<string, unknown>,
  entry: Omit<GenerationAttemptEntry, "at"> & { at?: string },
): { [GENERATION_ATTEMPTS_KEY]: GenerationAttemptEntry[] } {
  const attempts = readGenerationAttempts(metadata);
  attempts.push({ ...entry, at: entry.at ?? new Date().toISOString() });
  return { [GENERATION_ATTEMPTS_KEY]: attempts.slice(-LEDGER_CAP) };
}

/** Latest entry — what the UI leads with instead of a bare retry integer. */
export function latestGenerationAttempt(metadata: Record<string, unknown>): GenerationAttemptEntry | undefined {
  const attempts = readGenerationAttempts(metadata);
  return attempts[attempts.length - 1];
}
