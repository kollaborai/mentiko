import { agentOwnsEvent, findCompletionEvent, rejectCompletionEvent, sourceMatchesAgent } from "@/lib/runner-v2/completion";
import { parseRunnerEvent, serializeRunnerEvent } from "@/lib/runner-v2/events";

function eventContent(input: {
  event: string;
  source: string;
  runId: string;
  processed?: boolean;
  agent?: string;
}): string {
  const content = serializeRunnerEvent({
    event: input.event,
    source: input.source,
    runId: input.runId,
    timestamp: "2026-07-14T12:00:00.000Z",
    processed: input.processed,
    data: "",
  });
  return input.agent ? `${content}agent: ${input.agent}\n` : content;
}

describe("runner-v2 completion matcher", () => {
  const agent = { id: "writer", emits: "draft-ready", sessionPrefix: "content-writer" };

  it("matches an unprocessed declared emits event for the same run and agent", () => {
    const result = findCompletionEvent({
      agent,
      runId: "run-123",
      events: [
        // session-suffixed source (session prefix + run suffix) -- the
        // legitimate shell-parity prefix match, not an exact agent id/prefix.
        eventContent({ event: "draft-ready", source: "content-writer-run-123", runId: "run-123" }),
      ],
      allAgentIds: ["writer"],
    });

    expect(result.matched).toBe(true);
    expect(result.event?.event).toBe("draft-ready");
  });

  it("rejects diagnostic events from monitor or completion handler", () => {
    for (const source of ["monitor", "chain-runner-complete"]) {
      const event = parseRunnerEvent(eventContent({ event: "draft-ready", source, runId: "run-123" }));

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
        eventContent({ event: "draft-ready", source: "writer", runId: "run-999" }),
      ],
    });

    expect(result).toEqual({ matched: false, reason: "no matching completion event" });
  });

  it("rejects malformed raw event bytes and reports that they were not accepted", () => {
    expect(findCompletionEvent({
      agent,
      runId: "run-123",
      events: [
        "event: draft-ready\nsource: writer\nrun_id: run-123\ntimestamp: 2026-07-14T12:00:00.000Z\nprocessed: false\n",
      ],
    })).toEqual({
      matched: false,
      reason: "no matching completion event; rejected 1 invalid event record",
    });
  });

  it("rejects hand-built normalized records that bypassed raw parsing", () => {
    expect(findCompletionEvent({
      agent,
      runId: "run-123",
      events: [{
        event: "draft-ready",
        source: "writer",
        runId: "run-123",
        timestamp: "2026-07-14T12:00:00.000Z",
        processed: false,
        data: "ready",
        fields: {
          event: "draft-ready",
          source: "writer",
          run_id: "run-123",
          timestamp: "2026-07-14T12:00:00.000Z",
          processed: "false",
          // Deliberately conflicts with data above.
          data: "not-ready",
        },
      }],
    })).toEqual({
      matched: false,
      reason: "no matching completion event; rejected 1 invalid event record",
    });
  });

  it("rejects unexpected event names from the same agent", () => {
    const event = parseRunnerEvent(eventContent({ event: "review-ready", source: "writer", runId: "run-123" }));

    expect(rejectCompletionEvent(event, agent, "draft-ready", "run-123")).toBe("event name mismatch");
  });

  it("rejects processed events", () => {
    const event = parseRunnerEvent(eventContent({ event: "draft-ready", source: "writer", runId: "run-123", processed: true }));

    expect(rejectCompletionEvent(event, agent, "draft-ready", "run-123")).toBe("event already processed");
  });

  it("matches source against agent id or session prefix, exact or session-suffixed", () => {
    expect(sourceMatchesAgent("writer", agent)).toBe(true);
    expect(sourceMatchesAgent("content-writer", agent)).toBe(true);
    // Delimiter-token matching requires the full identity set; otherwise a
    // sibling id is structurally indistinguishable from a session suffix.
    expect(sourceMatchesAgent("content-writer-run-123", agent)).toBe(false);
    expect(sourceMatchesAgent("content-writer-run-123", agent, ["writer"])).toBe(true);
    expect(sourceMatchesAgent("reviewer", agent)).toBe(false);
  });

  it("does not let a prefix match steal a source that exactly names a different declared agent", () => {
    // "api-reviewer" is a real sibling agent id, not a session-suffixed form
    // of "api" -- structurally identical to the legitimate prefix case above,
    // so it is only resolvable with the full chain agent-id set.
    const api = { id: "api" };
    expect(sourceMatchesAgent("api-reviewer", api)).toBe(false); // unguarded prefix matching fails closed
    expect(sourceMatchesAgent("api-reviewer", api, ["api", "api-reviewer"])).toBe(false); // guarded: disambiguated
    // the exactly-named agent itself is unaffected by the guard
    expect(sourceMatchesAgent("api-reviewer", { id: "api-reviewer" }, ["api", "api-reviewer"])).toBe(true);
  });

  it("does not let a prefix match steal a sibling agent session while retaining legitimate session suffixes", () => {
    const api = { id: "api" };
    const agentIds = ["api", "api-reviewer"];

    expect(sourceMatchesAgent("api-reviewer", api, agentIds)).toBe(false);
    expect(sourceMatchesAgent("api-reviewer-run-123", api, agentIds)).toBe(false);
    expect(sourceMatchesAgent("api-run-123", api, agentIds)).toBe(true);
    expect(sourceMatchesAgent("api-7f3a", api, agentIds)).toBe(true);
  });

  it("does not route a notwriter completion event to writer", () => {
    expect(findCompletionEvent({
      agent,
      runId: "run-123",
      allAgentIds: ["writer"],
      events: [
        eventContent({ event: "draft-ready", source: "notwriter", runId: "run-123" }),
      ],
    })).toEqual({ matched: false, reason: "no matching completion event" });
  });

  it("does not fabricate success for agents with no declared emits event", () => {
    expect(findCompletionEvent({
      agent: { id: "writer" },
      runId: "run-123",
      events: [eventContent({ event: "anything", source: "writer", runId: "run-123" })],
    })).toEqual({
      matched: false,
      reason: "agent has no declared emits event",
    });
  });
});

describe("agentOwnsEvent", () => {
  const owner = { id: "writer", sessionPrefix: "content-writer" };

  it("matches by exact agent id, session prefix, or session name -- never by substring", () => {
    expect(agentOwnsEvent(parseRunnerEvent(eventContent({ event: "draft-ready", source: "writer", runId: "run-123" })), owner)).toBe(true);
    expect(agentOwnsEvent(parseRunnerEvent(eventContent({ event: "draft-ready", source: "content-writer", runId: "run-123" })), owner)).toBe(true);
    expect(agentOwnsEvent(parseRunnerEvent(eventContent({ event: "draft-ready", source: "writer-run-123", runId: "run-123" })), owner, "writer-run-123")).toBe(true);
    // session-suffixed source with no matching sessionName argument is NOT owned
    // (the old bug would have matched this via substring containment of "writer").
    expect(agentOwnsEvent(parseRunnerEvent(eventContent({ event: "draft-ready", source: "writer-run-123", runId: "run-123" })), owner)).toBe(false);
  });

  it("does not let a prefix-colliding sibling agent id match in either direction (api vs api-reviewer)", () => {
    expect(agentOwnsEvent(parseRunnerEvent(eventContent({ event: "review-complete", source: "api-reviewer", runId: "run-1" })), { id: "api" })).toBe(false);
    expect(agentOwnsEvent(parseRunnerEvent(eventContent({ event: "build-complete", source: "api", runId: "run-1" })), { id: "api-reviewer" })).toBe(false);
  });

  it("matches diagnostic events via the distinct agent: field", () => {
    const event = parseRunnerEvent(eventContent({ event: "agent-timeout", source: "monitor", runId: "run-123", agent: "writer" }));
    expect(agentOwnsEvent(event, { id: "writer" })).toBe(true);
  });
});
