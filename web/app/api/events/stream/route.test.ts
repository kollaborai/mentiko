import { parseRunnerEvent, serializeRunnerEvent } from "@/lib/runner-v2/events";
import {
  parseRunnerEventStreamFile,
  runnerEventBelongsToStream,
  runnerEventStreamType,
} from "./runner-event-stream";

function eventRecord(event: string) {
  return parseRunnerEvent(serializeRunnerEvent({
    event,
    source: "stream-test",
    runId: "run-123",
    timestamp: "2026-07-14T12:00:00.000Z",
    data: "done",
  }));
}

describe("runner event SSE mapping", () => {
  it("maps the canonical hyphenated chain completion event", () => {
    expect(runnerEventStreamType(eventRecord("chain-complete"))).toBe("chain_complete");
  });

  it("does not accept the underscore spelling as a compatibility alias", () => {
    expect(runnerEventStreamType(eventRecord("chain_complete"))).toBeNull();
  });

  it("parses the physical event through the shared strict contract", () => {
    const content = serializeRunnerEvent({
      event: "chain-complete",
      source: "stream-test",
      runId: "run-123",
      timestamp: "2026-07-14T12:00:00.000Z",
      processed: true,
      data: "done",
    });

    expect(parseRunnerEventStreamFile("run-123-chain-complete.event", content)).toEqual({
      lifecycleType: "chain_complete",
      event: {
        filename: "run-123-chain-complete.event",
        event: "chain-complete",
        source: "stream-test",
        runId: "run-123",
        timestamp: "2026-07-14T12:00:00.000Z",
        processed: true,
        data: "done",
      },
    });
  });

  it("does not route another run's chain completion to this stream", () => {
    const { event, lifecycleType } = parseRunnerEventStreamFile(
      "run-999-chain-complete.event",
      serializeRunnerEvent({
        event: "chain-complete",
        source: "stream-test",
        runId: "run-999",
        timestamp: "2026-07-14T12:00:00.000Z",
        data: "done",
      }),
    );

    expect(lifecycleType).toBe("chain_complete");
    expect(runnerEventBelongsToStream(event, "run-123")).toBe(false);
    expect(runnerEventBelongsToStream(event, "run-999")).toBe(true);
  });

  it("rejects malformed raw files instead of streaming normalized defaults", () => {
    expect(() => parseRunnerEventStreamFile(
      "invalid.event",
      "event: chain-complete\nsource: stream-test\nprocessed: FALSE\n",
    )).toThrow(/Invalid runner event file/);
  });
});
