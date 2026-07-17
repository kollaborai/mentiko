import { normalizeTaskChainBindingMetadata } from "@/lib/tasks/task-chain-binding";

describe("normalizeTaskChainBindingMetadata", () => {
  it("projects the nested task-create assignment for execution readers", () => {
    expect(normalizeTaskChainBindingMetadata({
      chainBinding: { chain_id: "release-review", chain_name: "Release Review", auto_run: true },
    })).toMatchObject({ chain_id: "release-review", chain_name: "Release Review", auto_run: true });
  });

  it("keeps later direct lifecycle fields authoritative", () => {
    expect(normalizeTaskChainBindingMetadata({
      chainBinding: { chain_id: "release-review", auto_run: true },
      auto_run: false,
      last_run_id: "run-1",
    })).toMatchObject({ chain_id: "release-review", auto_run: false, last_run_id: "run-1" });
  });

  it("does not treat malformed nested values as an assignment", () => {
    const metadata = { chainBinding: "not-an-object", auto_run: true };
    expect(normalizeTaskChainBindingMetadata(metadata)).toBe(metadata);
  });
});
