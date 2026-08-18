import {
  eventMatchesRunId,
  eventMatchesTrigger,
  filterEnabledEventTriggers,
  isUnprocessedRunnerEvent,
  parseRunnerEvent,
  serializeRunnerEvent,
  validateRawRunnerEvent,
  validateRunnerEventRecord,
} from "@/lib/runner-v2/events";

function eventContent(overrides: Partial<Parameters<typeof serializeRunnerEvent>[0]> = {}): string {
  return serializeRunnerEvent({
    event: "x",
    source: "a",
    runId: "run-a",
    timestamp: "2026-06-25T12:34:56-07:00",
    data: "",
    ...overrides,
  });
}

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

  it("serializes validated extension fields without weakening the six canonical fields", () => {
    const content = serializeRunnerEvent({
      event: "agent-timeout",
      source: "monitor",
      runId: "run-456",
      timestamp: "2026-06-25T13:00:00-07:00",
      data: "diagnostic",
      extensionFields: { agent: "writer", reason: "no progress", stale_count: "5" },
    });
    const event = parseRunnerEvent(content);

    expect(event.fields).toMatchObject({
      agent: "writer",
      reason: "no progress",
      stale_count: "5",
    });
    expect(validateRawRunnerEvent(content).valid).toBe(true);
  });

  it("rejects extension fields that collide with canonical fields or inject lines", () => {
    const base = {
      event: "agent-timeout",
      source: "monitor",
      runId: "run-456",
      timestamp: "2026-06-25T13:00:00-07:00",
      data: "diagnostic",
    };

    expect(() => serializeRunnerEvent({
      ...base,
      extensionFields: { source: "other" },
    })).toThrow(/duplicates a canonical field/);
    expect(() => serializeRunnerEvent({
      ...base,
      extensionFields: { reason: "one\nprocessed: true" },
    })).toThrow(/reason must be a single line/);
  });

  it("tracks canonical processed false and true values", () => {
    const pending = parseRunnerEvent(eventContent());
    const done = parseRunnerEvent(eventContent({ processed: true }));

    expect(isUnprocessedRunnerEvent(pending)).toBe(true);
    expect(isUnprocessedRunnerEvent(done)).toBe(false);
  });

  it("requires a matching run_id only when a run id is supplied", () => {
    const event = parseRunnerEvent(eventContent());

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
    const event = parseRunnerEvent(eventContent({ event: "review-approved", source: "review-chain" }));

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

  it("rejects missing raw fields instead of synthesizing normalized defaults", () => {
    const content = "event: x\nsource: a\nprocessed: false\n";
    const validation = validateRawRunnerEvent(content);

    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing-field", field: "run_id" }),
      expect.objectContaining({ code: "missing-field", field: "timestamp" }),
      expect.objectContaining({ code: "missing-field", field: "data" }),
    ]));
    expect(() => parseRunnerEvent(content)).toThrow(/Invalid runner event file/);
  });

  it("rejects an explicit invalid processed value rather than coercing it to false", () => {
    const content = eventContent().replace("processed: false", "processed: banana");

    expect(validateRawRunnerEvent(content).issues).toContainEqual(
      expect.objectContaining({ code: "invalid-processed", field: "processed" }),
    );
    expect(() => parseRunnerEvent(content)).toThrow(/invalid-processed/);
  });

  it("rejects uppercase processed values instead of accepting compatibility casing", () => {
    const content = eventContent().replace("processed: false", "processed: FALSE");

    expect(validateRawRunnerEvent(content).issues).toContainEqual(
      expect.objectContaining({ code: "invalid-processed", field: "processed" }),
    );
    expect(() => parseRunnerEvent(content)).toThrow(/invalid-processed/);
  });

  it("validates normalized records independently from raw files", () => {
    const record = parseRunnerEvent(eventContent({ processed: true }));

    expect(validateRunnerEventRecord(record)).toEqual({ valid: true, issues: [] });
    expect(validateRunnerEventRecord({
      ...record,
      processed: "true",
      fields: { ...record.fields, processed: "true" },
    })).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ code: "invalid-processed", field: "processed" })],
    });
  });

  it("rejects non-boolean serializer input instead of coercing it to false", () => {
    expect(() => serializeRunnerEvent({
      event: "review-approved",
      source: "reviewer",
      runId: "run-456",
      timestamp: "2026-06-25T13:00:00-07:00",
      processed: "false",
      data: "ok",
    } as never)).toThrow(/processed must be a boolean/);
  });

  it("rejects values that cannot round-trip without normalization loss", () => {
    expect(() => serializeRunnerEvent({
      event: "review-approved",
      source: "reviewer",
      runId: "run-456",
      timestamp: "2026-06-25T13:00:00-07:00",
      data: " approved ",
    })).toThrow(/data does not round-trip exactly/);
  });

  it("rejects multiline serializer input so emitted files always round-trip", () => {
    expect(() => serializeRunnerEvent({
      event: "review-approved",
      source: "reviewer",
      runId: "run-456",
      timestamp: "2026-06-25T13:00:00-07:00",
      data: "line one\nsource: injected",
    })).toThrow(/data must be a single line/);
  });

  it("rejects duplicate canonical fields before first-occurrence parsing can hide them", () => {
    const content = `${eventContent()}event: second\n`;

    expect(validateRawRunnerEvent(content).issues).toContainEqual(
      expect.objectContaining({ code: "duplicate-field", field: "event" }),
    );
    expect(() => parseRunnerEvent(content)).toThrow(/duplicate-field/);
  });
});
