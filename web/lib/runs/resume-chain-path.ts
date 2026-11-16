import { existsSync } from "fs";
import { join } from "path";

/**
 * Resolve the chain definition a resume should boot: the run's own immutable
 * chain.json snapshot first, the chains-dir copy second.
 *
 * A run record without chainId (the thin child records a prior resume bug
 * produced) must resolve through its own snapshot, never throw on
 * join(chainsDir, undefined) — the route 500 that wedged TASK-010 in
 * `resuming` (issue #142).
 */
export function resolveResumeChainPath(input: {
  runDir: string;
  chainId?: unknown;
  chainsDir: string;
}): string | null {
  const chainInRun = join(input.runDir, "chain.json");
  if (existsSync(chainInRun)) return chainInRun;
  const chainId = typeof input.chainId === "string" && input.chainId ? input.chainId : undefined;
  if (!chainId) return null;
  const chainInChains = join(input.chainsDir, chainId, "chain.json");
  return existsSync(chainInChains) ? chainInChains : null;
}
