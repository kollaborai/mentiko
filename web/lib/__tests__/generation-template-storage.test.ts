import {
  DEFAULT_CHAIN_TEMPLATE,
  DEFAULT_RECOMMEND_TEMPLATE,
  DEFAULT_TASK_TEMPLATE,
  DEFAULT_TASK_RUN_SUMMARY_TEMPLATE,
  DEFAULT_GUIDED_PLAN_TEMPLATE,
  DEFAULT_FAILURE_TRIAGE_TEMPLATE,
} from "@/lib/generation/generation-template-storage";
import { validateGeneratedChainDeliveryContract } from "@/lib/chains/generated-chain-delivery-contract";
import { validateChain } from "@/lib/validators";

function jsonExampleBetween(startMarker: string, endMarker: string) {
  const start = DEFAULT_CHAIN_TEMPLATE.indexOf(startMarker);
  const end = DEFAULT_CHAIN_TEMPLATE.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const json = DEFAULT_CHAIN_TEMPLATE.slice(start + startMarker.length, end).trim();
  return JSON.parse(json) as Record<string, unknown>;
}

describe("DEFAULT_CHAIN_TEMPLATE", () => {
  it("pins branch fan-out to real emitted events and real agent ids", () => {
    expect(DEFAULT_CHAIN_TEMPLATE).toContain("BRANCH FAN-OUT / FAN-IN pattern");
    expect(DEFAULT_CHAIN_TEMPLATE).toContain("branches MUST be keyed by that exact emitted event");
    expect(DEFAULT_CHAIN_TEMPLATE).toContain("NEVER invent a branch key that no agent emits");
    expect(DEFAULT_CHAIN_TEMPLATE).toContain("NEVER put a fan_in agent id that differs from the real agent id");
  });

  it("teaches reusable runtime inputs and only runtime-supported event shapes", () => {
    expect(DEFAULT_CHAIN_TEMPLATE).toContain("Generate a reusable mechanism for this class of work");
    expect(DEFAULT_CHAIN_TEMPLATE).toContain("typed task context in every agent's instructions");
    expect(DEFAULT_CHAIN_TEMPLATE).toContain("do NOT invent multiple outcome events");
    expect(DEFAULT_CHAIN_TEMPLATE).toContain("EXAMPLE A — reusable repository change chain");
    expect(DEFAULT_CHAIN_TEMPLATE).toContain("EXAMPLE B — reusable managed-state operation chain");
  });

  it("keeps both comprehensive examples valid under the contract they teach", () => {
    const delivery = jsonExampleBetween(
      "EXAMPLE A — reusable repository change chain (delivery mode):",
      "EXAMPLE B — reusable managed-state operation chain (operations mode):",
    );
    const operations = jsonExampleBetween(
      "EXAMPLE B — reusable managed-state operation chain (operations mode):",
      "REQUIREMENTS:",
    );

    for (const example of [delivery, operations]) {
      expect(validateChain(example).valid).toBe(true);
      expect(validateGeneratedChainDeliveryContract(example)).toEqual([]);
    }
  });
});

describe("DEFAULT_TASK_TEMPLATE", () => {
  it("keeps the example acceptance criteria aligned with Given/When/Then instructions", () => {
    expect(DEFAULT_TASK_TEMPLATE).toContain(
      'Each criterion: "Given X, when Y, then Z"'
    );
    expect(DEFAULT_TASK_TEMPLATE).toContain(
      '"acceptance_criteria": "Given each webhook endpoint exists, when it is created, then it has a unique signing secret'
    );
    expect(DEFAULT_TASK_TEMPLATE).toContain(
      "Given a consumer receives an outbound request, when it verifies X-Mentiko-Signature"
    );
  });
});

describe("DEFAULT_RECOMMEND_TEMPLATE", () => {
  it("matches reusable mechanisms without hardcoding the current task instance", () => {
    expect(DEFAULT_RECOMMEND_TEMPLATE).toContain(
      "A good fit means the chain implements the same reusable mechanism"
    );
    expect(DEFAULT_RECOMMEND_TEMPLATE).toContain(
      "A generic dependency-removal chain can fit different task IDs"
    );
    expect(DEFAULT_RECOMMEND_TEMPLATE).toContain(
      "Never put the current TASK-NNN identifiers"
    );
    expect(DEFAULT_RECOMMEND_TEMPLATE).toContain(
      '"work_mode": "delivery or operations or research (when generate_new)"'
    );
    expect(DEFAULT_RECOMMEND_TEMPLATE).toContain("{{AGENT_CATALOG}}");
    expect(DEFAULT_RECOMMEND_TEMPLATE).toContain(
      "VALID COMPLETE EXAMPLE (generate_new; use the shape, not the sample wording)"
    );
    expect(DEFAULT_RECOMMEND_TEMPLATE).toContain(
      '"suggested_name": "managed task dependency mutation"'
    );
  });
});

describe("DEFAULT_TASK_RUN_SUMMARY_TEMPLATE", () => {
  it("audits delivery, operations, and research by observable end state", () => {
    expect(DEFAULT_TASK_RUN_SUMMARY_TEMPLATE).toContain("OBSERVABLE END-STATE DELIVERY CHECK");
    expect(DEFAULT_TASK_RUN_SUMMARY_TEMPLATE).toContain("operations: acceptance criteria require managed");
    expect(DEFAULT_TASK_RUN_SUMMARY_TEMPLATE).toContain("do not demand a");
    expect(DEFAULT_TASK_RUN_SUMMARY_TEMPLATE).not.toContain(
      'if TASK DATA\'s type is\n   "feature", "task", or "bug", the acceptance criteria describe working software'
    );
  });
});

describe("DEFAULT_TASK_RUN_SUMMARY_TEMPLATE", () => {
  it("requires grounded outcome dashboard fields", () => {
    expect(DEFAULT_TASK_RUN_SUMMARY_TEMPLATE).toContain("TASK DATA:");
    expect(DEFAULT_TASK_RUN_SUMMARY_TEMPLATE).toContain("RUN SUMMARY:");
    expect(DEFAULT_TASK_RUN_SUMMARY_TEMPLATE).toContain("GENERATION FLOW:");
    expect(DEFAULT_TASK_RUN_SUMMARY_TEMPLATE).toContain('"headline"');
    expect(DEFAULT_TASK_RUN_SUMMARY_TEMPLATE).toContain('"improvement_signals"');
    expect(DEFAULT_TASK_RUN_SUMMARY_TEMPLATE).toContain("Do not invent files, edits, errors, costs, agents, or acceptance proof");
  });

  it("does not contradict the audit rule's evidence check: rule 1 permits reading files under the given artifacts root", () => {
    expect(DEFAULT_TASK_RUN_SUMMARY_TEMPLATE).toContain("ARTIFACTS ROOT");
    expect(DEFAULT_TASK_RUN_SUMMARY_TEMPLATE).toContain("You MAY read files directly under that ARTIFACTS ROOT");
    expect(DEFAULT_TASK_RUN_SUMMARY_TEMPLATE).toContain("Never resolve a relative artifact path against your");
  });

  it("requires citing the exact absolute path before claiming evidence is missing", () => {
    expect(DEFAULT_TASK_RUN_SUMMARY_TEMPLATE).toContain("CITATION DISCIPLINE");
    expect(DEFAULT_TASK_RUN_SUMMARY_TEMPLATE).toContain(
      "never claim an artifact or piece of evidence is MISSING without citing the exact"
    );
  });

  it("closes on stale-but-proven criteria instead of opening a moot decision gate (TASK-010)", () => {
    expect(DEFAULT_TASK_RUN_SUMMARY_TEMPLATE).toContain("MOOT CRITERIA CLOSE RULE");
    expect(DEFAULT_TASK_RUN_SUMMARY_TEMPLATE).toContain("TASK-010");
    expect(DEFAULT_TASK_RUN_SUMMARY_TEMPLATE).toContain(
      "This is NOT \"unsure\" under rule (b)"
    );
    expect(DEFAULT_TASK_RUN_SUMMARY_TEMPLATE).toContain("Inverse guard:");
    expect(DEFAULT_TASK_RUN_SUMMARY_TEMPLATE).toContain(
      "this rule does not apply and rule (b) governs"
    );
  });
});

describe("criteria-authoring templates require observable end-state acceptance criteria", () => {
  it("task_generation instructs against volatile source specifics", () => {
    expect(DEFAULT_TASK_TEMPLATE).toContain("OBSERVABLE_END_STATE_CRITERIA");
    expect(DEFAULT_TASK_TEMPLATE).toContain("no line numbers");
    expect(DEFAULT_TASK_TEMPLATE).toContain(
      "attempt is defined before first use in the retry path of base_scraper.py"
    );
  });

  it("decision_guided_plan instructs against volatile source specifics", () => {
    expect(DEFAULT_GUIDED_PLAN_TEMPLATE).toContain("OBSERVABLE_END_STATE_CRITERIA");
    expect(DEFAULT_GUIDED_PLAN_TEMPLATE).toContain("no line numbers");
  });

  it("failure_triage instructs against volatile source specifics", () => {
    expect(DEFAULT_FAILURE_TRIAGE_TEMPLATE).toContain("OBSERVABLE_END_STATE_CRITERIA");
    expect(DEFAULT_FAILURE_TRIAGE_TEMPLATE).toContain("no line numbers");
  });
});
