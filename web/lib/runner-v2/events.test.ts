import {
  eventMatchesRunId,
  eventMatchesTrigger,
  filterEnabledEventTriggers,
  isUnprocessedRunnerEvent,
  parseRunnerEvent,
  serializeRunnerEvent,
} from "@/lib/runner-v2/events";

describe("runner-v2 event helpers", () => {
  it("parses key-value event files by splitting on the first colon", () => {
    const event = parseRunnerEvent([
      "event: agent-complete",
      "source: writer",
      "run_id: run-123",
      "timestamp: 2026-06-25T12:34:56-07:00",
      "processed: false",
      "data: url=https://example.com/a:b:c at 2026-06-25T12:34:56-07:00",
    ].join("\n"));

    expect(event.event).toBe("agent-complete");
    expect(event.source).toBe("writer");
    expect(event.runId).toBe("run-123");
    expect(event.timestamp).toBe("2026-06-25T12:34:56-07:00");
    expect(event.processed).toBe(false);
    expect(event.data).toBe("url=https://example.com/a:b:c at 2026-06-25T12:34:56-07:00");
  });

  it("serializes canonical event fields with processed false by default", () => {
    expect(serializeRunnerEvent({
      event: "review-approved",
      source: "reviewer",
      runId: "run-456",
      timestamp: "2026-06-25T13:00:00-07:00",
      data: "ok: yes",
    })).toBe([
      "event: review-approved",
      "source: reviewer",
      "run_id: run-456",
      "timestamp: 2026-06-25T13:00:00-07:00",
      "processed: false",
      "data: ok: yes",
      "",
    ].join("\n"));
  });

  it("tracks processed false and true using the shell watcher semantics", () => {
    const pending = parseRunnerEvent("event: x\nsource: a\nprocessed: false\n");
    const done = parseRunnerEvent("event: x\nsource: a\nprocessed: TRUE\n");

    expect(isUnprocessedRunnerEvent(pending)).toBe(true);
    expect(isUnprocessedRunnerEvent(done)).toBe(false);
  });

  it("requires a matching run_id only when a run id is supplied", () => {
    const event = parseRunnerEvent("event: x\nsource: a\nrun_id: run-a\nprocessed: false\n");

    expect(eventMatchesRunId(event)).toBe(true);
    expect(eventMatchesRunId(event, "run-a")).toBe(true);
    expect(eventMatchesRunId(event, "run-b")).toBe(false);
  });

  it("filters event triggers using enabled false exactly like chain-event-watcher", () => {
    const triggers = [
      { event: "review-approved", chain_name: "enabled" },
      { event: "review-approved", chain_name: "disabled", enabled: false },
      { event: "review-approved", chain_name: "explicit", enabled: true },
    ];

    expect(filterEnabledEventTriggers(triggers).map((trigger) => trigger.chain_name)).toEqual([
      "enabled",
      "explicit",
    ]);
  });

  it("matches watcher triggers by event, optional source_chain, and enabled flag", () => {
    const event = parseRunnerEvent("event: review-approved\nsource: review-chain\nprocessed: false\n");

    expect(eventMatchesTrigger(event, { event: "review-approved" })).toBe(true);
    expect(eventMatchesTrigger(event, {
      event: "review-approved",
      source_chain: "review-chain",
    })).toBe(true);
    expect(eventMatchesTrigger(event, {
      event: "review-approved",
      source_chain: "other-chain",
    })).toBe(false);
    expect(eventMatchesTrigger(event, {
      event: "review-approved",
      enabled: false,
    })).toBe(false);
  });
});
