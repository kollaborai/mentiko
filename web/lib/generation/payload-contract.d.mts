// Typed surface for payload-contract.mjs. The runtime module is plain .mjs (so
// the bare-node CLI can import it without a build); this declaration gives the
// TS consumers (job-store.ts hydration boundary, auto-run/route.ts) real types
// instead of `any`, so a producer/consumer shape drift surfaces at compile time.

/** Generation kinds the payload contract knows how to validate + normalize. */
export type GenerationKind = "task" | "chain_generation" | "chain_recommendation";

/** Is `obj` a plausible completion payload for a generation job of `kind`? */
export function isPayloadCompatibleWithKind(obj: unknown, kind: string): boolean;

/**
 * Normalize a payload to the shape the /complete route expects for `kind`.
 * chain_generation wraps a raw chain object as `{ output: string }`; other
 * kinds pass through unchanged.
 */
export function normalizeResultForKind<T>(result: T, kind: string): T | { output: string };

/** Map a job-store JobType to the generation kind; "" = no gating. */
export function jobTypeToGenerationKind(jobType: string): GenerationKind | "";
