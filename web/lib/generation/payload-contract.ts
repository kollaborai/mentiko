// Kind-aware generation-payload contract — the SINGLE source of truth for
// deciding whether JSON is the completion payload for a generation job and
// normalizing it to the canonical shape. TypeScript owns the contract. The
// dependency-free payload-contract.runtime.js file is generated from this
// source only for bare-node consumers that cannot execute TypeScript.

/** Generation kinds the payload contract knows how to validate + normalize. */
export type GenerationKind = "task" | "chain_generation" | "chain_recommendation" | "run_summary";

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Is `obj` a plausible completion payload for a generation job of `kind`? */
export function isPayloadCompatibleWithKind(obj: unknown, kind: string): boolean {
  if (!isJsonRecord(obj)) return false;
  if (kind === "task") {
    // Current task generation is agent-as-gate: the artifact is either a
    // routed task envelope or a decision hand-back. Keep accepting legacy bare
    // task objects, but validate the envelope's actual payload rather than
    // rejecting every modern generation-result.json during recovery.
    if (obj.route === "decision") {
      return typeof obj.reason === "string" && obj.reason.trim().length > 0;
    }
    const task = obj.route === "task" && isJsonRecord(obj.task) ? obj.task : obj;
    return typeof task.title === "string" || Array.isArray(task.tasks) || Array.isArray(task.subtasks);
  }
  if (kind === "chain_generation") {
    return typeof obj.output === "string" || Array.isArray(obj.agents);
  }
  if (kind === "chain_recommendation") {
    const recommendation = isJsonRecord(obj.recommendation) ? obj.recommendation : obj;
    const action = typeof recommendation.action === "string" ? recommendation.action : "";
    return Boolean(
      action ||
        recommendation.chain_id ||
        recommendation.generation_prompt ||
        recommendation.suggested_name ||
        recommendation.reasoning ||
        recommendation.rationale
    );
  }
  if (kind === "run_summary") {
    // A run-summary artifact is both the user-visible outcome record and the
    // completion-audit handoff. Do not let an arbitrary JSON artifact reopen
    // a failed summary import: it must contain the narrative payload plus the
    // auditor's structured verdict.
    const audit = isJsonRecord(obj.audit) ? obj.audit : undefined;
    return typeof obj.headline === "string"
      && typeof obj.narrative === "string"
      && typeof obj.outcome === "string"
      && typeof audit?.verdict === "string"
      && typeof audit.reason === "string";
  }
  return true;
}

/**
 * Normalize a payload to the shape the /complete route expects for `kind`.
 * chain_generation wraps a raw chain object as `{ output: string }`; other
 * kinds pass through unchanged.
 */
export function normalizeResultForKind<T>(result: T, kind: string): T | { output: string } {
  if (kind === "chain_generation" && isJsonRecord(result) && !("output" in result)) {
    return { output: JSON.stringify(result) };
  }
  return result;
}

/** Map a job-store JobType to the generation kind; "" means no gating. */
export function jobTypeToGenerationKind(jobType: string): GenerationKind | "" {
  switch (jobType) {
    case "recommend":
      return "chain_recommendation";
    case "generate":
      return "chain_generation";
    case "task":
      return "task";
    case "task_run_summary":
      return "run_summary";
    default:
      return "";
  }
}
