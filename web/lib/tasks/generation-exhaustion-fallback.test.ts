/**
 * W1 — what happens when chain generation is exhausted (stall-killer spec v2).
 *
 * Before this, an exhausted task parked and waited for a human, even when a
 * chain that could do the job had appeared in the meantime. Now it asks the
 * existing-only question — but only when the catalog changed, because the
 * first recommender already answered it against the old one.
 *
 * @jest-environment node
 */
import { describe, it, expect } from "@jest/globals";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  chainCatalogDigest,
  decideGenerationExhaustionFallback,
  generationAttentionRequiredMetadata,
  generationAttentionNotificationKey,
  readGenerationCatalogDigest,
  readGenerationFallbackState,
  FALLBACK_PARK_CATALOG_UNCHANGED,
  GENERATION_CATALOG_DIGEST_KEY,
  GENERATION_FALLBACK_STATE_KEY,
} from "@/lib/tasks/generation-exhaustion-fallback";

const CATALOG = [
  { id: "code-review", name: "Code Review", agentCount: 3 },
  { id: "release-notes", name: "Release Notes", agentCount: 2 },
];

describe("chainCatalogDigest", () => {
  it("ignores the order the catalog happened to be scanned in", () => {
    expect(chainCatalogDigest(CATALOG)).toBe(chainCatalogDigest([...CATALOG].reverse()));
  });

  it("changes when a chain is added, removed, or resized", () => {
    const base = chainCatalogDigest(CATALOG);
    expect(chainCatalogDigest([...CATALOG, { id: "new", name: "New", agentCount: 1 }])).not.toBe(base);
    expect(chainCatalogDigest(CATALOG.slice(1))).not.toBe(base);
    expect(chainCatalogDigest([{ ...CATALOG[0], agentCount: 9 }, CATALOG[1]])).not.toBe(base);
  });

  it("is unchanged by things a reuse decision cannot turn on", () => {
    // run counts, timestamps: not part of the summary at all.
    expect(chainCatalogDigest(CATALOG)).toBe(chainCatalogDigest(CATALOG.map((c) => ({ ...c }))));
  });

  it("treats an empty catalog as a real, stable value", () => {
    expect(chainCatalogDigest([])).toBe(chainCatalogDigest([]));
    expect(chainCatalogDigest([])).not.toBe(chainCatalogDigest(CATALOG));
  });
});

describe("decideGenerationExhaustionFallback", () => {
  const digest = chainCatalogDigest(CATALOG);

  it("parks immediately when the catalog is the one the recommender already saw", () => {
    const decision = decideGenerationExhaustionFallback({
      metadata: { [GENERATION_CATALOG_DIGEST_KEY]: digest },
      currentDigest: digest,
    });
    expect(decision).toEqual({ action: "park", reason: FALLBACK_PARK_CATALOG_UNCHANGED });
  });

  it("asks the existing-only question when a chain appeared since", () => {
    const decision = decideGenerationExhaustionFallback({
      metadata: { [GENERATION_CATALOG_DIGEST_KEY]: digest },
      currentDigest: chainCatalogDigest([...CATALOG, { id: "new", name: "New", agentCount: 1 }]),
    });
    expect(decision.action).toBe("retry_existing_only");
  });

  it("asks when no digest was ever recorded — absence is not evidence of sameness", () => {
    expect(decideGenerationExhaustionFallback({ metadata: {}, currentDigest: digest }).action)
      .toBe("retry_existing_only");
  });

  it("lets exactly one concurrent poller run the fallback", () => {
    // First poller claims; every later one sees the durable claim and stands down.
    const claimedMetadata = { [GENERATION_FALLBACK_STATE_KEY]: "existing_only_pending" };
    const decisions = [1, 2, 3].map(() => decideGenerationExhaustionFallback({
      metadata: claimedMetadata,
      currentDigest: chainCatalogDigest([...CATALOG, { id: "new", agentCount: 1 }]),
    }));
    for (const decision of decisions) {
      expect(decision).toEqual({ action: "already_claimed", state: "existing_only_pending" });
    }
  });

  it("never re-runs a fallback for a task already parked for a human", () => {
    const decision = decideGenerationExhaustionFallback({
      metadata: { [GENERATION_FALLBACK_STATE_KEY]: "attention_required" },
      currentDigest: chainCatalogDigest([...CATALOG, { id: "new", agentCount: 1 }]),
    });
    expect(decision).toEqual({ action: "already_claimed", state: "attention_required" });
  });

  it("does not park on an unreadable catalog (digest '') — that is not 'unchanged'", () => {
    const decision = decideGenerationExhaustionFallback({
      metadata: { [GENERATION_CATALOG_DIGEST_KEY]: digest },
      currentDigest: "",
    });
    expect(decision.action).toBe("retry_existing_only");
  });

  it("ignores a garbage digest the same way it ignores a missing one", () => {
    for (const junk of [42, null, "", [], {}]) {
      expect(readGenerationCatalogDigest({ [GENERATION_CATALOG_DIGEST_KEY]: junk })).toBeUndefined();
    }
  });

  it("ignores a state value outside the state machine", () => {
    expect(readGenerationFallbackState({ [GENERATION_FALLBACK_STATE_KEY]: "bogus" })).toBeUndefined();
  });
});

describe("the park record", () => {
  it("keeps generation_stop_reason as the flag admission reads, so manual recovery is unchanged", () => {
    const metadata = generationAttentionRequiredMetadata({
      reason: FALLBACK_PARK_CATALOG_UNCHANGED,
      stopReason: "deterministic_budget_exhausted",
      detail: "same two artifacts failed",
      now: new Date("2026-08-10T12:00:00.000Z"),
    });
    expect(metadata.generation_stop_reason).toBe("deterministic_budget_exhausted");
    expect(metadata[GENERATION_FALLBACK_STATE_KEY]).toBe("attention_required");
    expect(metadata.generation_attention_reason).toBe(FALLBACK_PARK_CATALOG_UNCHANGED);
    expect(metadata.generation_attention_at).toBe("2026-08-10T12:00:00.000Z");
  });

  it("raises exactly one attention card no matter how many pollers park it", async () => {
    const root = mkdtempSync(join(tmpdir(), "generation-attention-"));
    const previous = process.env.MENTIKO_GLOBAL_ROOT;
    process.env.MENTIKO_GLOBAL_ROOT = root;
    try {
      const { addNotification, readNotifications } = await import("@/lib/notifications/notification-persistence");
      for (let i = 0; i < 4; i++) {
        addNotification("default", {
          idempotencyKey: generationAttentionNotificationKey("TASK-123"),
          type: "warning",
          title: "Chain generation needs attention",
          message: "poller " + i,
        });
      }
      expect(readNotifications("default")).toHaveLength(1);
    } finally {
      if (previous === undefined) delete process.env.MENTIKO_GLOBAL_ROOT;
      else process.env.MENTIKO_GLOBAL_ROOT = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("parks into a state the next decision refuses to re-run", () => {
    const parked = generationAttentionRequiredMetadata({
      reason: FALLBACK_PARK_CATALOG_UNCHANGED,
      stopReason: "deterministic_duplicate",
    });
    expect(decideGenerationExhaustionFallback({ metadata: parked, currentDigest: "anything" }).action)
      .toBe("already_claimed");
  });
});
