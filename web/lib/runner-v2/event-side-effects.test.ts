import { planCompletionEventSideEffects, eventIsOwnedBy } from "@/lib/runner-v2/event-side-effects";
import { parseRunnerEvent, serializeRunnerEvent } from "@/lib/runner-v2/events";

function event(input: { event: string; source: string; runId: string; agent?: string }) {
  const content = serializeRunnerEvent({
    event: input.event,
    source: input.source,
    runId: input.runId,
    timestamp: "2026-07-14T12:00:00.000Z",
    data: "",
  });
  return parseRunnerEvent(input.agent ? `${content}agent: ${input.agent}\n` : content);
}

describe("runner-v2 completion event side effects", () => {
  it("marks the triggered event processed and archives only same-run owned events", () => {
    const triggered = event({ event: "done", source: "writer", runId: "run-1" });
    const sibling = event({ event: "done", source: "reviewer", runId: "run-1" });
    const otherRun = event({ event: "done", source: "writer", runId: "run-2" });
    const owned = event({ event: "note", source: "writer-helper", runId: "run-1" });

    expect(planCompletionEventSideEffects(triggered, [triggered, sibling, otherRun, owned])).toEqual({
      markProcessed: triggered,
      archiveOwned: [triggered, owned],
    });
  });

  // Diagnostic events carry source=<emitter> with the owning agent in a
  // distinct agent: extension field. The
  // completing agent owns and archives its own diagnostic; a sibling's diagnostic
  // stays for its owner (never over-archived — finding #6).
  it("archives the completing agent's own diagnostic (agent: field ownership) but not a sibling's", () => {
    const triggered = event({ event: "draft-ready", source: "chain-recommender", runId: "run-1" });
    const ownDiagnostic = event({ event: "agent-timeout", source: "monitor", runId: "run-1", agent: "chain-recommender" });
    const siblingDiagnostic = event({ event: "agent-error", source: "chain-runner-complete", runId: "run-1", agent: "findings-aggregator" });

    const plan = planCompletionEventSideEffects(triggered, [triggered, ownDiagnostic, siblingDiagnostic]);
    expect(plan.archiveOwned).toEqual([triggered, ownDiagnostic]);
    expect(plan.archiveOwned).not.toContain(siblingDiagnostic);
  });

  it("eventIsOwnedBy uses the agent extension field and strict run scoping", () => {
    const owner = event({ event: "done", source: "writer", runId: "run-1" });

    // matches on the raw agent field even when the source names a different emitter
    expect(eventIsOwnedBy(owner, event({ event: "agent-error", source: "chain-runner-complete", runId: "run-1", agent: "writer" }))).toBe(true);
    // a populated, mismatched run id excludes regardless of source/agent match
    expect(eventIsOwnedBy(owner, event({ event: "agent-error", source: "chain-runner-complete", runId: "run-2", agent: "writer" }))).toBe(false);
    // neither source nor agent matches -> not owned (no over-archive of siblings)
    expect(eventIsOwnedBy(owner, event({ event: "agent-error", source: "chain-runner-complete", runId: "run-1", agent: "other" }))).toBe(false);
  });

  // A session-suffixed source like "researcher-7f3a"
  // must still resolve to bare agent id "researcher". A real sibling agent id
  // that happens to share a prefix ("api-reviewer" vs "api") is structurally
  // identical to that legitimate case and is unresolvable without knowing the
  // full chain agent-id set -- this is a documented limitation, not a bug fix.
  it("collides on a prefix-matching sibling agent id without the chain agent-id set", () => {
    const triggered = event({ event: "build-complete", source: "api", runId: "run-1" });
    const siblingEvent = event({ event: "review-complete", source: "api-reviewer", runId: "run-1" });

    expect(eventIsOwnedBy(triggered, siblingEvent)).toBe(true);
  });

  it("does not archive a prefix-colliding sibling agent's event once the chain agent-id set disambiguates it (api vs api-reviewer)", () => {
    const triggered = event({ event: "build-complete", source: "api", runId: "run-1" });
    const siblingEvent = event({ event: "review-complete", source: "api-reviewer", runId: "run-1" });
    const allAgentIds = ["api", "api-reviewer"];

    expect(eventIsOwnedBy(triggered, siblingEvent, allAgentIds)).toBe(false);
    expect(planCompletionEventSideEffects(triggered, [triggered, siblingEvent], allAgentIds).archiveOwned).toEqual([triggered]);

    // reverse direction: owner "api-reviewer" must not sweep up sibling "api"'s event
    const reviewerTriggered = event({ event: "review-complete", source: "api-reviewer", runId: "run-1" });
    const apiEvent = event({ event: "build-complete", source: "api", runId: "run-1" });
    expect(eventIsOwnedBy(reviewerTriggered, apiEvent, allAgentIds)).toBe(false);
  });
});
