import {
  DEFAULT_CHAIN_TEMPLATE,
  DEFAULT_RECOMMEND_TEMPLATE,
  DEFAULT_TASK_TEMPLATE,
  DEFAULT_TASK_RUN_SUMMARY_TEMPLATE,
  DEFAULT_GUIDED_PLAN_TEMPLATE,
  DEFAULT_FAILURE_TRIAGE_TEMPLATE,
} from "@/lib/generation/generation-template-storage";

describe("DEFAULT_CHAIN_TEMPLATE", () => {
  it("pins branch fan-out to real emitted events and real agent ids", () => {
    expect(DEFAULT_CHAIN_TEMPLATE).toContain("BRANCH FAN-OUT / FAN-IN pattern");
    expect(DEFAULT_CHAIN_TEMPLATE).toContain("branches MUST be keyed by that exact emitted event");
    expect(DEFAULT_CHAIN_TEMPLATE).toContain("NEVER invent a branch key that no agent emits");
    expect(DEFAULT_CHAIN_TEMPLATE).toContain("NEVER put a fan_in agent id that differs from the real agent id");
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
  it("requires exact task-contract matches before reusing a chain", () => {
    expect(DEFAULT_RECOMMEND_TEMPLATE).toContain(
      "A good fit means the chain satisfies the exact task contract"
    );
    expect(DEFAULT_RECOMMEND_TEMPLATE).toContain(
      "required file, artifact, command, framework, workspace, acceptance criterion, or output shape"
    );
    expect(DEFAULT_RECOMMEND_TEMPLATE).toContain(
      "hardcoded for a different one, recommend \"generate_new\""
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
