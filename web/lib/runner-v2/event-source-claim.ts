import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { withExclusiveFileClaim } from "@/lib/runner-v2/file-claim";

export interface EventSourceClaimIdentity {
  scope: "run" | "ingress";
  runId: string;
  source: string;
}

/**
 * Serialize publishers and lifecycle consumers for one logical event source.
 * Monitor diagnostics are owned by their agent, although their persisted event
 * source remains `monitor` so they cannot satisfy a completion handoff.
 */
export function withEventSourceClaim<T>(
  eventsDir: string,
  identity: EventSourceClaimIdentity,
  fn: () => T,
): T {
  if (!isAbsolute(eventsDir)) {
    throw new Error(`eventsDir must be an absolute configured path: ${eventsDir}`);
  }
  const root = resolve(eventsDir);
  try {
    if (!lstatSync(root).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new Error(`Configured eventsDir is not a directory: ${root}`);
  }
  const digest = createHash("sha256")
    .update(JSON.stringify([identity.scope, identity.runId, identity.source]))
    .digest("hex");
  const rootDigest = createHash("sha256").update(root).digest("hex").slice(0, 16);
  return withExclusiveFileClaim(
    join(dirname(root), `.event-claims-${rootDigest}`, `${digest}.lock`),
    fn,
    { waitTimeoutMs: 10_000, retryDelayMs: 5 },
  );
}
