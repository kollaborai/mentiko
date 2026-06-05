import {
  DEFAULT_RECOMMEND_TEMPLATE,
  DEFAULT_TASK_TEMPLATE,
  DEFAULT_TASK_RUN_SUMMARY_TEMPLATE,
} from "@/lib/generation/generation-template-storage";

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
});
