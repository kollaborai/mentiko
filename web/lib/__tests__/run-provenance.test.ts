/**
 * @jest-environment node
 *
 * Covers the live generation-audit classification helpers in web/lib/run-provenance.ts.
 * These functions are consumed in production by run-reconciler.ts and the runs API
 * (cancel/stop/delete) to avoid stamping execution metadata onto generation/recommendation
 * runs. The equivalent JS logic previously lived only in lib/chain-runner.mjs (now retired
 * to .trash); this test owns the coverage for the surviving production copy.
 */

import {
  generationKindFromMetadata,
  isGenerationAuditRun,
  shouldRecordTaskExecutionMetadata,
} from "@/lib/run-provenance";

describe("run-provenance generation classification", () => {
  const recommendationRun = {
    id: "run-recommend",
    chain: "Chain Recommendation",
    chainId: "chain-recommendation",
    metadata: { generationKind: "chain_recommendation" },
  };
  const generationRun = {
    id: "run-generate",
    chain: "Chain Generation",
    chainId: "chain-generation",
    metadata: { generationKind: "chain_generation" },
  };

  describe("generationKindFromMetadata", () => {
    it("returns the generationKind when present and non-empty", () => {
      expect(generationKindFromMetadata({ generationKind: "chain_recommendation" })).toBe(
        "chain_recommendation",
      );
      expect(generationKindFromMetadata({ generationKind: "chain_generation" })).toBe(
        "chain_generation",
      );
    });

    it("returns undefined for missing, empty, or non-object metadata", () => {
      expect(generationKindFromMetadata({})).toBeUndefined();
      expect(generationKindFromMetadata({ generationKind: "" })).toBeUndefined();
      expect(generationKindFromMetadata({ generationKind: 5 })).toBeUndefined();
      expect(generationKindFromMetadata(null)).toBeUndefined();
      expect(generationKindFromMetadata(undefined)).toBeUndefined();
      expect(generationKindFromMetadata([])).toBeUndefined();
      expect(generationKindFromMetadata("nope")).toBeUndefined();
    });
  });

  describe("isGenerationAuditRun", () => {
    it("classifies generation chain runs as audit runs, not execution runs", () => {
      expect(isGenerationAuditRun(recommendationRun)).toBe(true);
      expect(isGenerationAuditRun(generationRun)).toBe(true);
    });

    it("does not classify plain runs as audit runs", () => {
      expect(isGenerationAuditRun({ metadata: {} })).toBe(false);
      expect(isGenerationAuditRun({ id: "run-plain" })).toBe(false);
      expect(isGenerationAuditRun(null)).toBe(false);
      expect(isGenerationAuditRun([])).toBe(false);
    });
  });

  describe("shouldRecordTaskExecutionMetadata", () => {
    it("records execution metadata for plain (non-generation) runs", () => {
      expect(shouldRecordTaskExecutionMetadata({})).toBe(true);
      expect(shouldRecordTaskExecutionMetadata({ generationKind: "" })).toBe(true);
    });

    it("skips execution metadata for generation and recommendation runs", () => {
      expect(shouldRecordTaskExecutionMetadata({ generationKind: "chain_generation" })).toBe(false);
      expect(shouldRecordTaskExecutionMetadata({ generationKind: "chain_recommendation" })).toBe(
        false,
      );
    });
  });
});
