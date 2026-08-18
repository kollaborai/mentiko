import { collectStaleRunSessionNames } from "@/lib/runs/stale-run-sessions";

describe("collectStaleRunSessionNames", () => {
  it("includes a typed bootstrap lease when the run agent has no session field", () => {
    expect(collectStaleRunSessionNames({
      id: "run-failed",
      agents: [{ session: "" }],
      runnerV2: {
        attempts: [{
          runId: "run-failed",
          leaseId: "failed-bootstrap",
          processEvidence: { ptySessionId: "failed-bootstrap" },
        }],
      },
    })).toEqual(["failed-bootstrap", "monitor-failed-bootstrap"]);
  });

  it("derives monitor PTYs for every usable agent or typed attempt identity", () => {
    expect(collectStaleRunSessionNames({
      id: "run-typed",
      agents: [{ session: "agent-live" }, { session: "" }],
      sessions: ["historical-session"],
      runnerV2: {
        attempts: [{
          runId: "run-typed",
          leaseId: "typed-lease",
          processEvidence: { ptySessionId: "typed-pty" },
        }],
      },
    })).toEqual([
      "agent-live",
      "monitor-agent-live",
      "historical-session",
      "monitor-historical-session",
      "typed-lease",
      "monitor-typed-lease",
      "typed-pty",
      "monitor-typed-pty",
    ]);
  });

  it("skips malformed or blank session identities instead of deriving unsafe monitor names", () => {
    expect(collectStaleRunSessionNames({
      id: "run-malformed",
      agents: [{ session: null as unknown as string }, { session: "   " }],
      sessions: ["sessions-only", ""],
      runnerV2: {
        attempts: [{
          runId: "run-other",
          leaseId: 42 as unknown as string,
          processEvidence: { ptySessionId: "" },
        }],
      },
    })).toEqual(["sessions-only", "monitor-sessions-only"]);
  });

  it("does not remove a foreign run's typed lease or monitor", () => {
    expect(collectStaleRunSessionNames({
      id: "run-current",
      runnerV2: {
        attempts: [
          { runId: "run-current", leaseId: "current-lease" },
          { runId: "run-foreign", leaseId: "foreign-lease", processEvidence: { ptySessionId: "foreign-pty" } },
        ],
      },
    })).toEqual(["current-lease", "monitor-current-lease"]);
  });

  it("cleans a legacy sessions-only run record and its monitor", () => {
    expect(collectStaleRunSessionNames({
      id: "run-sessions-only",
      sessions: ["legacy-only"],
      agents: [],
    })).toEqual(["legacy-only", "monitor-legacy-only"]);
  });
});
