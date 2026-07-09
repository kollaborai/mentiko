import { agentOwnsEvent, findCompletionEvent, rejectCompletionEvent, sourceMatchesAgent } from "@/lib/runner-v2/completion";
import { parseRunnerEvent } from "@/lib/runner-v2/events";

describe("runner-v2 completion matcher", () => {
  const agent = { id: "writer", emits: "draft-ready", sessionPrefix: "content-writer" };

  it("matches an unprocessed declared emits event for the same run and agent", () => {
    const result = findCompletionEvent({
      agent,
      runId: "run-123",
      events: [
        // session-suffixed source (session prefix + run suffix) -- the
        // legitimate shell-parity prefix match, not an exact agent id/prefix.
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

  it("matches source against agent id or session prefix, exact or session-suffixed", () => {
    expect(sourceMatchesAgent("writer", agent)).toBe(true);
    expect(sourceMatchesAgent("content-writer", agent)).toBe(true);
    // session-suffixed source (session prefix + run suffix) is a legitimate
    // prefix match -- mirrors the shell's _event-belongs-to, which documents
    // this as intentional (a session like "researcher-7f3a" must still be
    // owned by bare agent id "researcher").
    expect(sourceMatchesAgent("content-writer-run-123", agent)).toBe(true);
    expect(sourceMatchesAgent("reviewer", agent)).toBe(false);
  });

  it("does not let a prefix match steal a source that exactly names a different declared agent", () => {
    // "api-reviewer" is a real sibling agent id, not a session-suffixed form
    // of "api" -- structurally identical to the legitimate prefix case above,
    // so it is only resolvable with the full chain agent-id set.
    const api = { id: "api" };
    expect(sourceMatchesAgent("api-reviewer", api)).toBe(true); // unguarded: shell-parity, still collides
    expect(sourceMatchesAgent("api-reviewer", api, ["api", "api-reviewer"])).toBe(false); // guarded: disambiguated
    // the exactly-named agent itself is unaffected by the guard
    expect(sourceMatchesAgent("api-reviewer", { id: "api-reviewer" }, ["api", "api-reviewer"])).toBe(true);
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

describe("agentOwnsEvent", () => {
  const owner = { id: "writer", sessionPrefix: "content-writer" };

  it("matches by exact agent id, session prefix, or session name -- never by substring", () => {
    expect(agentOwnsEvent(parseRunnerEvent("event: draft-ready\nsource: writer\nrun_id: run-123\n"), owner)).toBe(true);
    expect(agentOwnsEvent(parseRunnerEvent("event: draft-ready\nsource: content-writer\nrun_id: run-123\n"), owner)).toBe(true);
    expect(agentOwnsEvent(parseRunnerEvent("event: draft-ready\nsource: writer-run-123\nrun_id: run-123\n"), owner, "writer-run-123")).toBe(true);
    // session-suffixed source with no matching sessionName argument is NOT owned
    // (the old bug would have matched this via substring containment of "writer").
    expect(agentOwnsEvent(parseRunnerEvent("event: draft-ready\nsource: writer-run-123\nrun_id: run-123\n"), owner)).toBe(false);
  });

  it("does not let a prefix-colliding sibling agent id match in either direction (api vs api-reviewer)", () => {
    expect(agentOwnsEvent(parseRunnerEvent("event: review-complete\nsource: api-reviewer\nrun_id: run-1\n"), { id: "api" })).toBe(false);
    expect(agentOwnsEvent(parseRunnerEvent("event: build-complete\nsource: api\nrun_id: run-1\n"), { id: "api-reviewer" })).toBe(false);
  });

  it("matches diagnostic events via the distinct agent: field", () => {
    const event = parseRunnerEvent("event: agent-timeout\nsource: monitor\nagent: writer\nrun_id: run-123\n");
    expect(agentOwnsEvent(event, { id: "writer" })).toBe(true);
  });
});
