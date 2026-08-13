/**
 * Phase-aware attempt ledger (chain-contract-plan-of-record.md B7).
 * The ledger is the status source of truth: it records WHICH door decided
 * WHAT, in order, so a reader never has to infer the story from a single
 * generic retry integer.
 */
import { describe, it, expect } from "@jest/globals";
import {
  GENERATION_ATTEMPTS_KEY,
  appendGenerationAttempt,
  latestGenerationAttempt,
  readGenerationAttempts,
} from "./generation-attempt-ledger";

describe("generation attempt ledger", () => {
  it("returns an empty history for metadata that has never recorded an attempt", () => {
    expect(readGenerationAttempts({})).toEqual([]);
    expect(latestGenerationAttempt({})).toBeUndefined();
  });

  it("appends in order and preserves each door's typed decision", () => {
    let metadata: Record<string, unknown> = {};
    metadata = {
      ...metadata,
      ...appendGenerationAttempt(metadata, {
        phase: "generation",
        code: "generation_job_failed",
        class: "transient",
        guidance: "worker timeout",
      }),
    };
    metadata = {
      ...metadata,
      ...appendGenerationAttempt(metadata, {
        phase: "import",
        code: "generated_chain_contract_violation",
        class: "deterministic",
        input_hash: "sha256:abc",
        revision: "2026-07-31.v0349",
        stop_reason: "deterministic_duplicate",
      }),
    };

    const attempts = readGenerationAttempts(metadata);
    expect(attempts.map((a) => [a.phase, a.class])).toEqual([
      ["generation", "transient"],
      ["import", "deterministic"],
    ]);
    // A deterministic stop is distinguishable from a transient failure without
    // reading any message string -- that is the whole point of the ledger.
    expect(latestGenerationAttempt(metadata)).toMatchObject({
      phase: "import",
      stop_reason: "deterministic_duplicate",
      input_hash: "sha256:abc",
    });
    expect(attempts.every((a) => typeof a.at === "string" && a.at.length > 0)).toBe(true);
  });

  it("bounds history without losing the most recent attempts", () => {
    let metadata: Record<string, unknown> = {};
    for (let i = 0; i < 45; i++) {
      metadata = {
        ...metadata,
        ...appendGenerationAttempt(metadata, {
          phase: "save",
          code: `attempt-${i}`,
          class: "transient",
        }),
      };
    }
    const attempts = readGenerationAttempts(metadata);
    expect(attempts).toHaveLength(30);
    expect(attempts[attempts.length - 1].code).toBe("attempt-44");
    expect(attempts[0].code).toBe("attempt-15");
  });

  it("ignores a corrupted ledger instead of throwing on read", () => {
    expect(readGenerationAttempts({ [GENERATION_ATTEMPTS_KEY]: "not-an-array" })).toEqual([]);
    expect(readGenerationAttempts({
      [GENERATION_ATTEMPTS_KEY]: [null, { phase: "save" }, { phase: "save", code: "ok", class: "success", at: "t" }],
    })).toEqual([{ phase: "save", code: "ok", class: "success", at: "t" }]);
  });
});
