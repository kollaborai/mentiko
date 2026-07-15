import { planCompletionEventSideEffects } from "@/lib/runner-v2/event-side-effects";
import { parseRunnerEvent, serializeRunnerEvent } from "@/lib/runner-v2/events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function event(input: { event: string; source: string; runId: string; path?: string }) {
  const content = serializeRunnerEvent({
    event: input.event,
    source: input.source,
    runId: input.runId,
    timestamp: "2026-07-14T12:00:00.000Z",
    data: "",
  });
  return { ...parseRunnerEvent(content), path: input.path };
}

function physicalEvent(input: { event: string; source: string; runId: string; filename?: string }) {
  const eventsDir = join(mkdtempSync(join(tmpdir(), "runner-event-side-effects-")), "events");
  mkdirSync(eventsDir);
  const path = join(eventsDir, input.filename || "trigger.event");
  const content = serializeRunnerEvent({
    event: input.event,
    source: input.source,
    runId: input.runId,
    timestamp: "2026-07-14T12:00:00.000Z",
    data: "",
  });
  writeFileSync(path, content);
  return { eventsDir, path, event: { ...parseRunnerEvent(content), path } };
}

describe("runner-v2 completion event side effects", () => {
  it("plans only the verified physical trigger and carries the full identity set", () => {
    const physical = physicalEvent({
      event: "done",
      source: "writer-run-1",
      runId: "run-1",
    });
    const triggered = physical.event;
    const owned = event({
      event: "note",
      source: "writer-helper",
      runId: "run-1",
      path: "/events/owned.event",
    });

    expect(planCompletionEventSideEffects(
      triggered,
      [triggered, owned],
      ["writer", "reviewer"],
    )).toEqual({
      markProcessed: triggered,
      triggeredPath: physical.path,
      allAgentIds: ["writer", "reviewer"],
      acceptedTrigger: expect.objectContaining({
        version: 1,
        sourceFilename: "trigger.event",
        occurrenceToken: expect.stringMatching(/^[a-f0-9]{64}$/),
        rawContentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        normalizedRecordSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    });
  });

  it("does not grant a physical claim to a same-path record with different body fields", () => {
    const physical = physicalEvent({
      event: "done",
      source: "writer",
      runId: "run-1",
    });
    const triggered = physical.event;
    const forged = event({
      event: "done",
      source: "reviewer",
      runId: "run-1",
      path: physical.path,
    });

    expect(planCompletionEventSideEffects(triggered, [forged], ["writer", "reviewer"])).toEqual({
      markProcessed: triggered,
      triggeredPath: undefined,
      allAgentIds: ["writer", "reviewer"],
    });
  });

  it("keeps pathless and synthetic completion records as filesystem no-ops", () => {
    const pathless = event({ event: "done", source: "writer", runId: "run-1" });
    const synthetic = event({
      event: "done",
      source: "writer",
      runId: "run-1",
      path: "/runs/run-1/artifacts/writer-summary.json",
    });

    expect(planCompletionEventSideEffects(pathless, [pathless], ["writer"]).triggeredPath).toBeUndefined();
    expect(planCompletionEventSideEffects(synthetic, [synthetic], ["writer"]).triggeredPath).toBeUndefined();
  });

  it("carries a trimmed, deduplicated full identity set into lifecycle execution", () => {
    const triggered = event({ event: "done", source: "writer-run-1", runId: "run-1" });

    expect(planCompletionEventSideEffects(
      triggered,
      [triggered],
      [" writer ", "reviewer", "writer", ""],
    ).allAgentIds).toEqual(["writer", "reviewer"]);
  });
});
