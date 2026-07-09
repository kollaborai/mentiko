import { planCompletionEventSideEffects, eventIsOwnedBy } from "@/lib/runner-v2/event-side-effects";
import { parseRunnerEvent } from "@/lib/runner-v2/events";

describe("runner-v2 completion event side effects", () => {
  it("marks the triggered event processed and archives only same-run owned events", () => {
    const triggered = parseRunnerEvent("event: done\nsource: writer\nrun_id: run-1\nprocessed: false\n");
    const sibling = parseRunnerEvent("event: done\nsource: reviewer\nrun_id: run-1\nprocessed: false\n");
    const otherRun = parseRunnerEvent("event: done\nsource: writer\nrun_id: run-2\nprocessed: false\n");
    const owned = parseRunnerEvent("event: note\nsource: writer-helper\nrun_id: run-1\nprocessed: false\n");

    expect(planCompletionEventSideEffects(triggered, [triggered, sibling, otherRun, owned])).toEqual({
      markProcessed: triggered,
      archiveOwned: [triggered, owned],
    });
  });

  // v1 parity (lib/event-trigger.sh _event-belongs-to): diagnostic events carry
  // source=<emitter> with the owning agent in a DISTINCT agent: field. The
  // completing agent owns and archives its own diagnostic; a sibling's diagnostic
  // stays for its owner (never over-archived — finding #6).
  it("archives the completing agent's own diagnostic (agent: field ownership) but not a sibling's", () => {
    const triggered = parseRunnerEvent("event: draft-ready\nsource: chain-recommender\nrun_id: run-1\nprocessed: false\n");
    const ownDiagnostic = parseRunnerEvent("event: agent-timeout\nsource: monitor\nagent: chain-recommender\nrun_id: run-1\nprocessed: false\n");
    const siblingDiagnostic = parseRunnerEvent("event: agent-error\nsource: chain-runner-complete\nagent: findings-aggregator\nrun_id: run-1\nprocessed: false\n");

    const plan = planCompletionEventSideEffects(triggered, [triggered, ownDiagnostic, siblingDiagnostic]);
    expect(plan.archiveOwned).toEqual([triggered, ownDiagnostic]);
    expect(plan.archiveOwned).not.toContain(siblingDiagnostic);
  });

  it("eventIsOwnedBy mirrors v1 _event-belongs-to: agent field, run scoping, filename fallback", () => {
    const owner = parseRunnerEvent("event: done\nsource: writer\nrun_id: run-1\n");

    // matches on the raw agent field even when the source names a different emitter
    expect(eventIsOwnedBy(owner, parseRunnerEvent("event: agent-error\nsource: chain-runner-complete\nagent: writer\nrun_id: run-1\n"))).toBe(true);
    // a populated, mismatched run id excludes regardless of source/agent match
    expect(eventIsOwnedBy(owner, parseRunnerEvent("event: agent-error\nsource: chain-runner-complete\nagent: writer\nrun_id: run-2\n"))).toBe(false);
    // neither source nor agent matches -> not owned (no over-archive of siblings)
    expect(eventIsOwnedBy(owner, parseRunnerEvent("event: agent-error\nsource: chain-runner-complete\nagent: other\nrun_id: run-1\n"))).toBe(false);
    // last resort: no source/agent field, but the filename names the owner
    expect(eventIsOwnedBy(owner, { ...parseRunnerEvent("event: done\nrun_id: run-1\n"), path: "/events/run-1-writer-done.event" })).toBe(true);
  });

  // lib/event-trigger.sh _event-belongs-to (L181-188) documents the both-way
  // substring as INTENTIONAL: a session-suffixed source like "researcher-7f3a"
  // must still resolve to bare agent id "researcher". A real sibling agent id
  // that happens to share a prefix ("api-reviewer" vs "api") is structurally
  // identical to that legitimate case and is unresolvable without knowing the
  // full chain agent-id set -- this is a documented limitation, not a bug fix.
  it("collides on a prefix-matching sibling agent id without the chain agent-id set (documented shell-parity limitation)", () => {
    const triggered = parseRunnerEvent("event: build-complete\nsource: api\nrun_id: run-1\nprocessed: false\n");
    const siblingEvent = parseRunnerEvent("event: review-complete\nsource: api-reviewer\nrun_id: run-1\nprocessed: false\n");

    expect(eventIsOwnedBy(triggered, siblingEvent)).toBe(true);
  });

  it("does not archive a prefix-colliding sibling agent's event once the chain agent-id set disambiguates it (api vs api-reviewer)", () => {
    const triggered = parseRunnerEvent("event: build-complete\nsource: api\nrun_id: run-1\nprocessed: false\n");
    const siblingEvent = parseRunnerEvent("event: review-complete\nsource: api-reviewer\nrun_id: run-1\nprocessed: false\n");
    const allAgentIds = ["api", "api-reviewer"];

    expect(eventIsOwnedBy(triggered, siblingEvent, allAgentIds)).toBe(false);
    expect(planCompletionEventSideEffects(triggered, [triggered, siblingEvent], allAgentIds).archiveOwned).toEqual([triggered]);

    // reverse direction: owner "api-reviewer" must not sweep up sibling "api"'s event
    const reviewerTriggered = parseRunnerEvent("event: review-complete\nsource: api-reviewer\nrun_id: run-1\nprocessed: false\n");
    const apiEvent = parseRunnerEvent("event: build-complete\nsource: api\nrun_id: run-1\nprocessed: false\n");
    expect(eventIsOwnedBy(reviewerTriggered, apiEvent, allAgentIds)).toBe(false);
  });
});
