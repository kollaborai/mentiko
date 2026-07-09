// Kind-aware generation-payload contract — the SINGLE source of truth for
// "is this JSON the completion payload for a generation job of this kind, and
// what is its canonical shape?". Shared by BOTH consumer doors so they can
// never drift:
//   1. CLI import path — lib/mentiko-cli-generation.mjs (salvage source select)
//   2. in-process path — web/lib/runs/job-store.ts (hydration boundary) and
//                        web/app/api/tasks/auto-run/route.ts (recommendation consumer)
//
// Pure + dependency-free BY DESIGN: the bare-node CLI imports it with no build
// step, and the Next server traces it into the standalone build. It lives under
// web/lib/ (inside next.config's outputFileTracingRoot, pinned to web/) so
// server tracing is guaranteed; the Dockerfile assemble step also flattens
// web/lib/ into /opt/mentiko/lib/, so the CLI finds it as a sibling at tenant
// runtime. See payload-contract.d.mts for the typed surface consumed by the TS
// side.

/**
 * Is `obj` a plausible completion payload for a generation job of `kind`?
 *
 * This was previously private to mentiko-cli-generation.mjs; it is now the
 * canonical definition both doors call, so an artifact accepted by the CLI
 * import path and one accepted by the in-process hydration path are decided by
 * the exact same predicate. Unknown/empty kinds return true (no gating), which
 * preserves behavior for non-generation callers.
 */
export function isPayloadCompatibleWithKind(obj, kind) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  if (kind === "task") {
    return typeof obj.title === "string" || Array.isArray(obj.tasks) || Array.isArray(obj.subtasks);
  }
  if (kind === "chain_generation") {
    return typeof obj.output === "string" || Array.isArray(obj.agents);
  }
  if (kind === "chain_recommendation") {
    const recommendation =
      obj.recommendation && typeof obj.recommendation === "object" && !Array.isArray(obj.recommendation)
        ? obj.recommendation
        : obj;
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
  return true;
}

/**
 * Normalize a salvaged payload to the shape the /complete route expects for the
 * kind. chain_generation post-processes via result.output (a chain JSON
 * *string*); when the agent emitted the raw chain object instead, wrap it so
 * postProcessChain still runs. Task and other kinds pass through untouched.
 */
export function normalizeResultForKind(result, kind) {
  if (kind === "chain_generation" && result && typeof result === "object" && !("output" in result)) {
    return { output: JSON.stringify(result) };
  }
  return result;
}

/**
 * Map a job-store JobType to the generation `kind` this contract validates
 * against. Returns "" for non-generation job types so callers get no gating
 * (isPayloadCompatibleWithKind's default branch returns true), preserving the
 * prior hydration behavior for those jobs.
 */
export function jobTypeToGenerationKind(jobType) {
  switch (jobType) {
    case "recommend":
      return "chain_recommendation";
    case "generate":
      return "chain_generation";
    case "task":
      return "task";
    default:
      return "";
  }
}
