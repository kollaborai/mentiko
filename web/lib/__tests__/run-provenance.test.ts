/**
 * @jest-environment node
 *
 * Covers the live run provenance helpers in web/lib/run-provenance.ts.
 * These functions are consumed in production by run-reconciler.ts and the runs API
 * (cancel/stop/delete) to avoid stamping execution metadata onto non-execution runs.
 */

import {
  cleanTaskExecutionRunMetadata,
  generationKindFromMetadata,
  isGenerationAuditRun,
  isNonExecutionRun,
  isNonExecutionRunMetadata,
  shouldRecordTaskExecutionMetadata,
} from "@/lib/run-provenance";

describe("run-provenance classification", () => {
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

    it("skips execution metadata for generation, recommendation, and decision runs", () => {
      expect(shouldRecordTaskExecutionMetadata({ generationKind: "chain_generation" })).toBe(false);
      expect(shouldRecordTaskExecutionMetadata({ generationKind: "chain_recommendation" })).toBe(
        false,
      );
      expect(shouldRecordTaskExecutionMetadata({
        decisionId: "decision-1",
        decisionPhase: "research",
      })).toBe(false);
    });
  });

  describe("isNonExecutionRun", () => {
    it("classifies generation and decision runs as non-execution runs", () => {
      expect(isNonExecutionRun(recommendationRun)).toBe(true);
      expect(isNonExecutionRun({
        id: "run-decision",
        metadata: {
          decisionId: "decision-1",
          decisionPhase: "research",
        },
      })).toBe(true);
      expect(isNonExecutionRunMetadata({
        decisionId: "decision-1",
        decisionPhase: "research",
      })).toBe(true);
    });

    it("requires both decision id and phase before classifying decision metadata", () => {
      expect(isNonExecutionRunMetadata({ decisionId: "decision-1" })).toBe(false);
      expect(isNonExecutionRunMetadata({ decisionPhase: "research" })).toBe(false);
      expect(isNonExecutionRun({ metadata: { decisionPhase: "research" } })).toBe(false);
    });
  });

  describe("cleanTaskExecutionRunMetadata", () => {
    it("strips execution fields and refiles recommendation audit run ids", () => {
      expect(cleanTaskExecutionRunMetadata({
        auto_run: true,
        last_run_id: "run-recommend",
        last_run_status: "running",
        last_run_chain: "Chain Recommendation",
        last_run_summary: { outcome: "pass" },
      }, recommendationRun, "run-recommend")).toEqual({
        auto_run: true,
        recommendation_run_id: "run-recommend",
        recommendation_chain_id: "chain-recommendation",
      });
    });

    it("strips execution fields for decision runs without inventing task metadata", () => {
      expect(cleanTaskExecutionRunMetadata({
        auto_run: true,
        last_run_id: "run-decision",
        last_run_status: "running",
      }, {
        chainId: "decision-research",
        metadata: {
          decisionId: "decision-1",
          decisionPhase: "research",
        },
      }, "run-decision")).toEqual({
        auto_run: true,
      });
    });
  });
});
