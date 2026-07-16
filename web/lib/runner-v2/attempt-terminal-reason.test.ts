import { formatAgentAttemptTerminalReason } from "@/lib/runner-v2/attempt-terminal-reason";

describe("agent attempt terminal reason presentation", () => {
  it("distinguishes canonical event completion from each recovery evidence source", () => {
    expect(formatAgentAttemptTerminalReason("completed_from_declared_event"))
      .toBe("Declared completion event accepted");
    expect(formatAgentAttemptTerminalReason("completed_from_durable_marker"))
      .toBe("Recovered from durable AGENT_COMPLETE marker");
    expect(formatAgentAttemptTerminalReason("completed_from_cross_run_event"))
      .toBe("Recovered from verified cross-run completion event");
    expect(formatAgentAttemptTerminalReason("completed_from_handoff_artifact"))
      .toBe("Recovered from fresh handoff artifact");
  });

  it("keeps historic codes and unknown future codes truthful", () => {
    expect(formatAgentAttemptTerminalReason("completed_from_event"))
      .toBe("Completion event accepted (legacy provenance)");
    expect(formatAgentAttemptTerminalReason("future_reason_code"))
      .toBe("future reason code");
    expect(formatAgentAttemptTerminalReason()).toBe("No terminal reason recorded");
  });
});
