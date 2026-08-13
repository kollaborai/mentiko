/**
 * C2 panel rendering (stall-killer spec v2).
 *
 * The panel used to render statusReason only for `stopped`/`cancelled`, so a
 * FAILED run — the one state a reader most needs explained — showed nothing at
 * all. These cases are driven by the real run records that motivated the fix.
 *
 * @jest-environment jsdom
 */
import { describe, it, expect } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { describeTerminalEvidence } from "@/components/run/terminal-evidence";

/** The exact evidence line the panel renders, in isolation from the panel's data fetching. */
function EvidenceLine({ run }: { run: Parameters<typeof describeTerminalEvidence>[0] }) {
  const terminalEvidence = describeTerminalEvidence(run);
  if (!terminalEvidence) return null;
  return (
    <div>
      <span title={terminalEvidence.detail}>
        {terminalEvidence.label}: {terminalEvidence.detail}
      </span>
    </div>
  );
}

describe("C2 — a terminal run explains itself in the panel", () => {
  it("renders the reason for a FAILED run (run-1786398409783-aed71cf8's shape)", () => {
    render(<EvidenceLine run={{
      status: "failed",
      statusReason: {
        actor: "system",
        reason: "agent agent-generator reported AGENT_COMPLETE without declared event 'agent-generation-complete'",
      },
    }} />);
    expect(screen.getByText(/^failed:/).textContent).toBe(
      "failed: agent agent-generator reported AGENT_COMPLETE without declared event 'agent-generation-complete'",
    );
  });

  it("renders the reason for a launch failure (chain-run-service markChainLaunchFailed)", () => {
    render(<EvidenceLine run={{
      status: "failed",
      statusReason: { actor: "system", reason: "chain launch failed: ENOENT: no such file or directory, posix_spawn 'zsh'" },
      status_message: "chain launch failed: ENOENT: no such file or directory, posix_spawn 'zsh'",
    }} />);
    expect(screen.queryByText(/chain launch failed/)).not.toBeNull();
  });

  it("renders the reason for blocked and completed, not just stopped/cancelled", () => {
    for (const status of ["blocked", "completed", "stopped", "cancelled", "error"]) {
      const { unmount } = render(<EvidenceLine run={{
        status,
        statusReason: { actor: "system", reason: `why it is ${status}` },
      }} />);
      expect(screen.queryByText(new RegExp(`why it is ${status}`))).not.toBeNull();
      unmount();
    }
  });

  it("names the actor when someone other than the runner ended it", () => {
    render(<EvidenceLine run={{
      status: "cancelled",
      statusReason: { actor: "user", reason: "cancelled via run detail API" },
    }} />);
    expect(screen.queryByText(/^stopped by you:/)).not.toBeNull();
  });

  it("falls back to status_message for records written before the contract", () => {
    render(<EvidenceLine run={{ status: "failed", status_message: "legacy free-text cause" }} />);
    expect(screen.queryByText(/legacy free-text cause/)).not.toBeNull();
  });

  it("renders nothing while the run is still live, and nothing it would have to invent", () => {
    const live = render(<EvidenceLine run={{ status: "running", statusReason: { actor: "system", reason: "x" } }} />);
    expect(live.container.innerHTML).toBe("");

    const silent = render(<EvidenceLine run={{ status: "failed" }} />);
    expect(silent.container.innerHTML).toBe("");
  });
});
