/** @jest-environment node */

import { isOutcomeSummaryTerminalStatus } from "./run-outcome-evidence";

describe("outcome-summary execution terminal statuses", () => {
  it("accepts a blocked run so its terminal cause can be summarized", () => {
    expect(isOutcomeSummaryTerminalStatus("blocked")).toBe(true);
  });

  it("does not treat an active run as summary-ready", () => {
    expect(isOutcomeSummaryTerminalStatus("running")).toBe(false);
  });
});
