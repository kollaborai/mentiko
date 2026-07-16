import { DATA_SHAPE_CATALOG } from "@/lib/data-shapes/catalog";
import {
  CLAIM_STALE_MS,
  MIGRATION_CLAIM_BY_SHAPE_ID,
  migrationClaimState,
  type MigrationClaim,
} from "@/lib/data-shapes/migration-claims";

const claim = (overrides: Partial<MigrationClaim> = {}): MigrationClaim => ({
  holder: "agent",
  since: "2026-07-16T05:00:00Z",
  heartbeat: "2026-07-16T05:00:00Z",
  note: "note",
  ...overrides,
});

describe("migration claims", () => {
  it("treats a fresh heartbeat as an active claim", () => {
    const beat = Date.parse("2026-07-16T05:00:00Z");
    expect(migrationClaimState(claim(), beat)).toBe("active");
    expect(migrationClaimState(claim(), beat + CLAIM_STALE_MS - 1)).toBe("active");
  });

  it("releases a claim once the heartbeat passes the stale window", () => {
    const beat = Date.parse("2026-07-16T05:00:00Z");
    expect(migrationClaimState(claim(), beat + CLAIM_STALE_MS + 1)).toBe("stale");
  });

  it("treats an unparseable heartbeat as stale rather than pinning the shape forever", () => {
    expect(migrationClaimState(claim({ heartbeat: "not-a-date" }), Date.now())).toBe("stale");
  });

  it("keeps every claim well formed so a holder is always identifiable", () => {
    for (const [shapeId, entry] of Object.entries(MIGRATION_CLAIM_BY_SHAPE_ID)) {
      expect(entry.holder.trim()).not.toBe("");
      expect(entry.note.trim()).not.toBe("");
      expect(Number.isNaN(Date.parse(entry.since))).toBe(false);
      expect(Number.isNaN(Date.parse(entry.heartbeat))).toBe(false);
      // A heartbeat before the claim was taken means the two drifted apart.
      expect(Date.parse(entry.heartbeat)).toBeGreaterThanOrEqual(Date.parse(entry.since));
      expect(shapeId.trim()).not.toBe("");
    }
  });

  it("merges a claim onto its shape when the catalog documents that shape", () => {
    for (const shapeId of Object.keys(MIGRATION_CLAIM_BY_SHAPE_ID)) {
      const shape = DATA_SHAPE_CATALOG.find((entry) => entry.id === shapeId);
      // A claim may legitimately precede its shape: an agent announces the work
      // before the migration that adds the shape lands. Only assert the merge
      // once the shape exists.
      if (!shape) continue;
      expect(shape.migrationClaim).toEqual(MIGRATION_CLAIM_BY_SHAPE_ID[shapeId]);
    }
  });

  it("leaves unclaimed shapes without a claim", () => {
    const unclaimed = DATA_SHAPE_CATALOG.filter((entry) => !MIGRATION_CLAIM_BY_SHAPE_ID[entry.id]);
    expect(unclaimed.every((entry) => entry.migrationClaim === undefined)).toBe(true);
  });
});
