import { IMPLEMENTATION_CONTRACT_FILES } from "@/lib/runner-v2/contracts";
import { assessImplementationContractBinding } from "@/lib/runner-v2/switch-readiness";

/**
 * UNMOCKED: reads the real docs/orchestration/contracts/ files. This is the
 * enforcement teeth for the migration source of truth — if anyone adds or
 * rewords an owns/invariants line in a per-implementation contract without
 * binding it in runner-v2-contract.json implementation_coverage, this suite
 * fails. Gaps are allowed (they are the honest red on the switch report);
 * unbound or malformed lines are not.
 */
describe("implementation contract binding (real repo contracts)", () => {
  it("binds every owns/invariants line of every implementation contract", () => {
    const summaries = assessImplementationContractBinding();
    expect(summaries.map((summary) => summary.file).sort()).toEqual([...IMPLEMENTATION_CONTRACT_FILES].sort());
    for (const summary of summaries) {
      expect({ file: summary.file, unbound: summary.unbound }).toEqual({ file: summary.file, unbound: [] });
      expect({ file: summary.file, malformed: summary.malformed }).toEqual({ file: summary.file, malformed: [] });
      expect(summary.covered + summary.shellOwned + summary.gaps.length).toBeGreaterThan(0);
    }
  });

  it("carries every known parity gap as a named blocker (switch stays honest-red)", () => {
    const summaries = assessImplementationContractBinding();
    const gaps = summaries.flatMap((summary) => summary.gaps.map((gap) => ({ ...gap, file: summary.file })));
    // runner-v2 is not at parity yet; the gate must say so instead of passing quietly
    expect(gaps.length).toBeGreaterThan(0);
    for (const gap of gaps) {
      expect(gap.blocker.length).toBeGreaterThan(20);
    }
    expect(gaps.map((gap) => gap.key)).toEqual(expect.arrayContaining([
      "owns:startup readiness before instruction submission",
      "invariant:AGENT_COMPLETE must be standalone line",
    ]));
  });
});
