import Ajv from "ajv";
import addFormats from "ajv-formats";
import { getChainSchema } from "@/lib/schema-loader";

// Regression: TASK-203 (2026-07-23). lib/schemas/chain.schema.json is injected
// into the generation prompt under "JSON SCHEMA (your output MUST match this
// structure)" and is ~57KB of the 85KB prompt -- but it had no `metadata`
// property at all. One generation attempt followed it perfectly and emitted a
// chain with zero metadata, which the delivery contract then rejected. The most
// authoritative-looking artifact in the prompt has to describe the contract the
// validator enforces.

const compile = () => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(JSON.parse(getChainSchema()));
};

const agents = [{
  id: "worker",
  name: "Worker",
  triggers: ["manual-start"],
  emits: "work-done",
  prompt: "do the work",
}];

describe("chain.schema.json teaches the generated-chain contract", () => {
  it("accepts a chain carrying a well-formed contract", () => {
    const validate = compile();
    expect(validate({
      name: "example",
      version: "1.0.0",
      metadata: {
        generated_chain_contract: {
          version: 1,
          mode: "delivery",
          acceptance_criteria: "the assigned task's criteria pass in the workspace",
        },
      },
      agents,
    })).toBe(true);
  });

  it("rejects the acceptance_assertion misspelling the model actually produced", () => {
    const validate = compile();
    expect(validate({
      name: "example",
      version: "1.0.0",
      metadata: {
        generated_chain_contract: {
          version: 1,
          mode: "delivery",
          acceptance_assertion: "the assigned task's criteria pass in the workspace",
        },
      },
      agents,
    })).toBe(false);
    expect(JSON.stringify(validate.errors)).toContain("acceptance_criteria");
  });

  it("rejects a mode outside the enum and a version other than 1", () => {
    const validate = compile();
    expect(validate({
      name: "example",
      version: "1.0.0",
      metadata: { generated_chain_contract: { version: 2, mode: "audit", acceptance_criteria: "x" } },
      agents,
    })).toBe(false);
  });

  // The 84 chains stored under ~/.mentiko keep other metadata keys
  // (coreGenerationChain, decisionPhase, ...). metadata must stay an open map.
  it("leaves metadata open for hand-written and core chains", () => {
    const validate = compile();
    expect(validate({
      name: "example",
      version: "1.0.0",
      metadata: { coreGenerationChain: true, generationKind: "chain_generation" },
      agents,
    })).toBe(true);
    expect(validate({ name: "example", version: "1.0.0", agents })).toBe(true);
  });
});
