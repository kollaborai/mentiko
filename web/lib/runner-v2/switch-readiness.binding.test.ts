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

  it("has only the known, tracked monitor-v2 completion-handoff gap (which blocks the switch)", () => {
    // Gaps are the honest red on the switch report. The runner/completion path is
    // fully bound (no gaps); the one intentional, readiness-blocking gap is the
    // monitor-v2 completion-handoff wiring (buildMonitorCommand + liveness feed +
    // late-event recovery). This assertion fails on any UNEXPECTED gap, and also
    // fails when this gap is silently removed without wiring the handoff — forcing
    // the coverage flip to be deliberate.
    const summaries = assessImplementationContractBinding();
    const gaps = summaries.flatMap((summary) => summary.gaps.map((gap) => ({ file: summary.file, key: gap.key })));
    expect(gaps).toEqual([
      {
        file: "monitor-v2.contract.json",
        key: "invariant:the completion handoff wiring (gate/feed liveness, connect late-event recovery) is connected before readiness",
      },
    ]);
  });
});
