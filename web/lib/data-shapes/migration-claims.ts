/**
 * Cooperative migration claims for the shared checkout.
 *
 * Several agents migrate data shapes on the same branch at the same time. A
 * claim announces that a shape is actively being worked so a second agent picks
 * a different one, and the heartbeat lets an abandoned claim be reclaimed
 * instead of parking a shape forever.
 *
 * Claims are advisory coordination state, never a data contract: no runtime
 * path reads them, and a missing claim never blocks work. They live outside
 * catalog.ts on purpose — a heartbeat rewrites its claim on every pass while
 * catalog.ts is edited by every in-flight migration at once, so co-locating the
 * two would turn each heartbeat into a merge conflict.
 *
 * Timestamps are ISO-8601 UTC. `since` is fixed when the claim is taken;
 * `heartbeat` is refreshed as the holder makes progress.
 */

export interface MigrationClaim {
  /** Who holds the claim. Stable across the claim's life. */
  holder: string;
  /** ISO-8601 UTC instant the claim was first taken. */
  since: string;
  /** ISO-8601 UTC instant the holder last reported progress. */
  heartbeat: string;
  /** What is being migrated, concretely enough for another agent to stay clear. */
  note: string;
}

/**
 * A claim whose heartbeat is older than this is treated as released, so a
 * crashed or reassigned holder cannot strand a shape. Sized well above a normal
 * migration pass but below a full session.
 */
export const CLAIM_STALE_MS = 45 * 60 * 1000;

export type MigrationClaimState = "active" | "stale";

/**
 * Claims keyed by data-shape id. Merged onto the shape by catalog.ts so the
 * docs ledger renders the claim next to the shape it covers.
 */
export const MIGRATION_CLAIM_BY_SHAPE_ID: Record<string, MigrationClaim> = {
  "startup-recovery-decision-log": {
    holder: "claude-opus-4-8",
    since: "2026-07-16T05:30:24Z",
    heartbeat: "2026-07-16T06:04:00Z",
    note: "Cataloging the startup recovery decision log and retiring lib/advisor-recovery.sh, the dead duplicate of the readiness-cli.ts recovery contract. Touching web/lib/data-shapes/*, web/e2e/engine/ comments. Not touching readiness-cli.ts behavior.",
  },
};

/**
 * `now` is injected rather than read from the clock so catalog rendering and
 * tests stay deterministic.
 */
export function migrationClaimState(
  claim: MigrationClaim,
  now: number = Date.now(),
): MigrationClaimState {
  const beat = Date.parse(claim.heartbeat);
  if (Number.isNaN(beat)) return "stale";
  return now - beat > CLAIM_STALE_MS ? "stale" : "active";
}
