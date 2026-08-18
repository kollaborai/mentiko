import {
  buildMonitorDiagnosticEvent,
  classifyContextExhaustion,
  classifyDeath,
  classifyStall,
  detectContextExhaustion,
  MONITOR_DIAGNOSTIC_SOURCE,
} from "@/lib/runner-v2/monitor-diagnostics";

const TS = "2026-07-07T00:00:00Z";

describe("monitor diagnostics — dead != succeeded, stale != complete", () => {
  it("a diagnostic's source is 'monitor', never the agent id (cannot satisfy the completion matcher)", () => {
    const ev = buildMonitorDiagnosticEvent({
      kind: "agent-error",
      runId: "run-1",
      agentId: "api-route-architect",
      reason: "died",
      timestamp: TS,
    });
    expect(ev.source).toBe(MONITOR_DIAGNOSTIC_SOURCE);
    expect(ev.source).not.toBe("api-route-architect");
    // the completion matcher accepts an event only if source contains the agent id
    expect(ev.source.includes("api-route-architect")).toBe(false);
  });

  it("uses the diagnostic filename scheme, not the canonical handoff naming", () => {
    const ev = buildMonitorDiagnosticEvent({
      kind: "agent-timeout",
      runId: "run-1",
      agentId: "writer",
      reason: "quiescent",
      staleCount: 5,
      timestamp: TS,
    });
    // ts-runId-agentId-kind.event, NOT runId-source-event.event
    expect(ev.filename).toBe("2026-07-07T00:00:00Z-run-1-writer-agent-timeout.event");
    expect(ev.staleCount).toBe(5);
    expect(ev.processed).toBe(false);
  });

  it("the diagnostic event name is a lifecycle enum, never a success/emits name", () => {
    expect(classifyStall({ runId: "r", agentId: "a", reason: "x", staleCount: 5, timestamp: TS }).diagnostic.event)
      .toBe("agent-timeout");
    const death = classifyDeath({ hasCompletionEvent: false, runId: "r", agentId: "a", reason: "x", timestamp: TS });
    if (death.outcome === "failed") expect(death.diagnostic.event).toBe("agent-error");
  });

  it("stall is BLOCKED — never failed, never complete", () => {
    const v = classifyStall({ runId: "r", agentId: "a", reason: "quiescent", staleCount: 6, timestamp: TS });
    expect(v.runStatus).toBe("blocked");
    expect(v.agentStatus).toBe("blocked");
  });

  it("death is event-first: process gone WITH a completion event completes normally", () => {
    const v = classifyDeath({ hasCompletionEvent: true, runId: "r", agentId: "a", reason: "exited", timestamp: TS });
    expect(v.outcome).toBe("complete-normally");
  });

  it("death WITHOUT an event is FAILED, never a fabricated success", () => {
    const v = classifyDeath({ hasCompletionEvent: false, runId: "r", agentId: "a", reason: "crashed", timestamp: TS });
    expect(v.outcome).toBe("failed");
    if (v.outcome === "failed") {
      expect(v.runStatus).toBe("failed");
      expect(v.diagnostic.source).toBe("monitor");
      expect(v.diagnostic.source).not.toBe("a");
    }
  });
});

describe("ISSUE-008 — context-window exhaustion detection", () => {
  it("detects the API-level context-window-limit error strings the CLIs surface", () => {
    for (const capture of [
      "API Error: The model has reached its context window limit",
      "prompt is too long: 202315 tokens > 200000 maximum",
      "openai.BadRequestError: context_length_exceeded",
      "Error: input length and `max_tokens` exceed context limit",
      "⎿  API Error (400): the maximum context length for this model was reached",
    ]) {
      expect(detectContextExhaustion(capture)).toBe(true);
    }
  });

  it("does NOT flag an agent that merely mentions the concept in normal working output", () => {
    for (const capture of [
      "Editing monitor.ts to guard the context window limit debounce path",
      "The chain ran and produced 23 SVG files; no errors.",
      "TODO: document how the context window is bounded for research agents",
      "",
    ]) {
      expect(detectContextExhaustion(capture)).toBe(false);
    }
  });

  it("classifies context exhaustion as FAILED with the agent-context-exhausted diagnostic", () => {
    const v = classifyContextExhaustion({ runId: "run-9", agentId: "decision-researcher", reason: "ctx full", timestamp: TS });
    expect(v.runStatus).toBe("failed");
    expect(v.agentStatus).toBe("failed");
    expect(v.diagnostic.event).toBe("agent-context-exhausted");
    // still monitor-sourced so it can never route forward as a success handoff
    expect(v.diagnostic.source).toBe("monitor");
    expect(v.diagnostic.source).not.toBe("decision-researcher");
  });
});
