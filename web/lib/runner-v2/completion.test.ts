import { findCompletionEvent, rejectCompletionEvent, sourceMatchesAgent } from "@/lib/runner-v2/completion";
import { parseRunnerEvent } from "@/lib/runner-v2/events";

describe("runner-v2 completion matcher", () => {
  const agent = { id: "writer", emits: "draft-ready", sessionPrefix: "content-writer" };

  it("matches an unprocessed declared emits event for the same run and agent", () => {
    const result = findCompletionEvent({
      agent,
      runId: "run-123",
      events: [
        "event: draft-ready\nsource: content-writer-run-123\nrun_id: run-123\nprocessed: false\n",
      ],
    });

    expect(result.matched).toBe(true);
    expect(result.event?.event).toBe("draft-ready");
  });

  it("rejects diagnostic events from monitor or completion handler", () => {
    for (const source of ["monitor", "chain-runner-complete"]) {
      const event = parseRunnerEvent(`event: draft-ready\nsource: ${source}\nrun_id: run-123\nprocessed: false\n`);

      expect(rejectCompletionEvent(event, agent, "draft-ready", "run-123")).toBe(
        "diagnostic source cannot complete agent",
      );
    }
  });

  it("rejects same-agent events from another run", () => {
    const result = findCompletionEvent({
      agent,
      runId: "run-123",
      events: [
        "event: draft-ready\nsource: writer\nrun_id: run-999\nprocessed: false\n",
      ],
    });

    expect(result).toEqual({ matched: false, reason: "no matching completion event" });
  });

  it("rejects unexpected event names from the same agent", () => {
    const event = parseRunnerEvent("event: review-ready\nsource: writer\nrun_id: run-123\nprocessed: false\n");

    expect(rejectCompletionEvent(event, agent, "draft-ready", "run-123")).toBe("event name mismatch");
  });

  it("rejects processed events", () => {
    const event = parseRunnerEvent("event: draft-ready\nsource: writer\nrun_id: run-123\nprocessed: true\n");

    expect(rejectCompletionEvent(event, agent, "draft-ready", "run-123")).toBe("event already processed");
  });

  it("matches source against agent id or session prefix", () => {
    expect(sourceMatchesAgent("content-writer-run-123", agent)).toBe(true);
    expect(sourceMatchesAgent("writer", agent)).toBe(true);
    expect(sourceMatchesAgent("reviewer", agent)).toBe(false);
  });

  it("does not fabricate success for agents with no declared emits event", () => {
    expect(findCompletionEvent({
      agent: { id: "writer" },
      runId: "run-123",
      events: ["event: anything\nsource: writer\nrun_id: run-123\nprocessed: false\n"],
    })).toEqual({
      matched: false,
      reason: "agent has no declared emits event",
    });
  });
});
