// Deterministic-rejection retry policy for a task's chain-generation loop
// (chain-contract-plan-of-record.md A4). PURE -- no I/O -- shared by the
// import door (/api/jobs/[id]/complete) and the save/recovery door
// (/api/tasks/auto-run) so both make the identical decision.
//
// Policy: a deterministic rejection allows AT MOST ONE guided regeneration,
// and only while each rejected candidate is new. The same fingerprint seen
// twice stops immediately. Deterministic stops are tracked separately from
// auto_run_retries: they never consume the transient retry budget, and a
// transient failure never consumes the deterministic allowance.

import {
  generatedChainRejectionFingerprint,
  type GeneratedChainRejectionEnvelope,
} from "@/lib/chains/generated-chain-rejections";

export const GENERATION_STOP_DUPLICATE = "deterministic_duplicate";
export const GENERATION_STOP_BUDGET = "deterministic_budget_exhausted";

export type GenerationStopReason =
  | typeof GENERATION_STOP_DUPLICATE
  | typeof GENERATION_STOP_BUDGET;

/** Initial rejection + one guided regeneration; a third candidate never launches. */
export const MAX_DISTINCT_DETERMINISTIC_REJECTIONS = 2;

export interface GenerationRejectionDecision {
  stop: boolean;
  stopReason?: GenerationStopReason;
  /** Updated fingerprint list to persist on the task. */
  fingerprints: string[];
}

export function readGenerationRejectionFingerprints(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

export function decideGenerationRejection(input: {
  envelope: GeneratedChainRejectionEnvelope;
  priorFingerprints: unknown;
}): GenerationRejectionDecision {
  const fingerprint = generatedChainRejectionFingerprint(input.envelope);
  const prior = readGenerationRejectionFingerprints(input.priorFingerprints);
  if (prior.includes(fingerprint)) {
    return { stop: true, stopReason: GENERATION_STOP_DUPLICATE, fingerprints: prior };
  }
  const fingerprints = [...prior, fingerprint];
  if (fingerprints.length >= MAX_DISTINCT_DETERMINISTIC_REJECTIONS) {
    return { stop: true, stopReason: GENERATION_STOP_BUDGET, fingerprints };
  }
  return { stop: false, fingerprints };
}
