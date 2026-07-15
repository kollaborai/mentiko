// GENERATED FILE. DO NOT EDIT.
// Canonical source: web/lib/generation/payload-contract.ts
// Regenerate: npm run generate:payload-contract
"use strict";
// Kind-aware generation-payload contract — the SINGLE source of truth for
// deciding whether JSON is the completion payload for a generation job and
// normalizing it to the canonical shape. TypeScript owns the contract. The
// dependency-free payload-contract.runtime.js file is generated from this
// source only for bare-node consumers that cannot execute TypeScript.
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPayloadCompatibleWithKind = isPayloadCompatibleWithKind;
exports.normalizeResultForKind = normalizeResultForKind;
exports.jobTypeToGenerationKind = jobTypeToGenerationKind;
function isJsonRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
/** Is `obj` a plausible completion payload for a generation job of `kind`? */
function isPayloadCompatibleWithKind(obj, kind) {
    if (!isJsonRecord(obj))
        return false;
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
        return Boolean(action ||
            recommendation.chain_id ||
            recommendation.generation_prompt ||
            recommendation.suggested_name ||
            recommendation.reasoning ||
            recommendation.rationale);
    }
    return true;
}
/**
 * Normalize a payload to the shape the /complete route expects for `kind`.
 * chain_generation wraps a raw chain object as `{ output: string }`; other
 * kinds pass through unchanged.
 */
function normalizeResultForKind(result, kind) {
    if (kind === "chain_generation" && isJsonRecord(result) && !("output" in result)) {
        return { output: JSON.stringify(result) };
    }
    return result;
}
/** Map a job-store JobType to the generation kind; "" means no gating. */
function jobTypeToGenerationKind(jobType) {
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
