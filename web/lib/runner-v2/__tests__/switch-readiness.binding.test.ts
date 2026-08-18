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

  it("has no remaining implementation-contract gaps", () => {
    // Gaps are the honest red on the switch report. Once the late-event
    // recovery/default-switch parity item is wired, the real contract ledger
    // must be all covered/shell-owned with no readiness-blocking gaps.
    const summaries = assessImplementationContractBinding();
    const gaps = summaries.flatMap((summary) => summary.gaps.map((gap) => ({ file: summary.file, key: gap.key })));
    expect(gaps).toEqual([]);
  });
});
