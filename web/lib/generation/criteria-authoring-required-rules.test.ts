import { withRequiredObservableEndStateCriteriaRule } from "./criteria-authoring-required-rules";

describe("withRequiredObservableEndStateCriteriaRule", () => {
  it("appends the marker to a template that lacks it", () => {
    const result = withRequiredObservableEndStateCriteriaRule("Write acceptance criteria for the task.");
    expect(result).toContain("OBSERVABLE_END_STATE_CRITERIA");
    expect(result).toContain("no line numbers");
  });

  it("does not duplicate the marker when a stored namespace template already carries it", () => {
    const alreadyHasRule = "Some template.\n\nOBSERVABLE_END_STATE_CRITERIA already present here.";
    const result = withRequiredObservableEndStateCriteriaRule(alreadyHasRule);
    expect(result.split("OBSERVABLE_END_STATE_CRITERIA").length - 1).toBe(1);
  });

  // Regression: TASK-010 -- a task_generation-authored criterion pinned to an
  // exact line number, a refactor landed before execution, and the stale
  // wording forced a wasted human decision gate even though the underlying
  // fix was already verifiably in place.
  it("gives a concrete bad/good example distinguishing line-pinned from observable criteria", () => {
    const result = withRequiredObservableEndStateCriteriaRule("Write acceptance criteria for the task.");
    expect(result).toContain("line 108 shows wait_time=");
    expect(result).toContain("attempt is defined before first use in the retry path of base_scraper.py");
  });
});
