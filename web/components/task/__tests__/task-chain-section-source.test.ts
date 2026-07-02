import { readFileSync } from "fs";

describe("task chain section source contract", () => {
  const source = readFileSync(new URL("../task-chain-section.tsx", import.meta.url), "utf8");
  const workflowSource = readFileSync(new URL("../chain-assign-workflow.tsx", import.meta.url), "utf8");

  it("does not render duplicate provenance run links above the task run panel", () => {
    expect(source).not.toContain("TaskChainProvenanceLinks");
    expect(source).not.toContain("analysis run");
    expect(source).not.toContain("chain generation run");
    expect(workflowSource).not.toContain("JobRunLink");
    expect(workflowSource).not.toContain("analysis run");
    expect(workflowSource).not.toContain("chain generation run");
  });
});
