import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  captureRunnerEventAcceptedTrigger,
  consumeRunnerEvents as consumeRunnerEventsStrict,
  findRunnerCompletionEvent,
  markRunnerEventProcessed,
  scanRunnerEventFiles,
  type ConsumeRunnerEventsInput,
} from "@/lib/runner-v2/event-lifecycle";
import { parseRunnerEvent, serializeRunnerEvent } from "@/lib/runner-v2/events";

function eventsDir(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "runner-event-lifecycle-")), "events");
  mkdirSync(dir);
  return dir;
}

function eventContent(input: {
  event?: string;
  source?: string;
  runId?: string;
  processed?: boolean;
  data?: string;
  extensionFields?: Record<string, string>;
} = {}): string {
  return serializeRunnerEvent({
    event: input.event ?? "draft-ready",
    source: input.source ?? "writer",
    runId: input.runId ?? "run-1",
    timestamp: "2026-07-15T12:00:00.000Z",
    processed: input.processed,
    data: input.data ?? "done",
    extensionFields: input.extensionFields,
  });
}

function writeEvent(dir: string, name: string, input: Parameters<typeof eventContent>[0] = {}): string {
  const path = join(dir, name);
  writeFileSync(path, eventContent(input));
  return path;
}

function acceptedTrigger(dir: string, path: string) {
  return captureRunnerEventAcceptedTrigger({ eventsDir: dir, file: path });
}

function consumeRunnerEvents(
  input: Omit<ConsumeRunnerEventsInput, "acceptedTrigger"> & {
    acceptedTrigger?: ConsumeRunnerEventsInput["acceptedTrigger"];
  },
) {
  return consumeRunnerEventsStrict({
    ...input,
    acceptedTrigger: input.acceptedTrigger || acceptedTrigger(input.eventsDir, input.triggered),
  });
}

describe("typed runner event lifecycle", () => {
  it("scans only deterministic direct regular *.event files and separates strict raw drift", () => {
    const dir = eventsDir();
    writeEvent(dir, "b.event", { event: "second" });
    writeEvent(dir, "a.event", { event: "first" });
    writeFileSync(join(dir, "c.event"), JSON.stringify({
      event: "legacy-json",
      source_agent: "writer",
      runId: "run-1",
    }));
    writeFileSync(join(dir, "missing-data.event"), [
      "event: incomplete",
      "source: writer",
      "run_id: run-1",
      "timestamp: 2026-07-15T12:00:00.000Z",
      "processed: false",
    ].join("\n"));
    writeFileSync(join(dir, "ignored.json"), eventContent());
    mkdirSync(join(dir, "directory.event"));
    symlinkSync(join(dir, "a.event"), join(dir, "symlink.event"));

    const scan = scanRunnerEventFiles(dir);

    expect(scan.valid.map((file) => file.filename)).toEqual(["a.event", "b.event"]);
    expect(scan.invalid.map((file) => file.filename)).toEqual(["c.event", "missing-data.event"]);
    expect(scan.invalid[0].issues.map((issue) => issue.code)).toContain("missing-field");
    expect(scan.invalid[1].issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing-field", field: "data" }),
    ]));
  });

  it("treats only a concurrently vanished scan entry as a normal omission", () => {
    const dir = eventsDir();
    const vanishing = writeEvent(dir, "vanishing.event");
    expect(scanRunnerEventFiles(dir, { readFile: () => {
      unlinkSync(vanishing);
      throw Object.assign(new Error("concurrent unlink"), { code: "ENOENT" });
    } })).toEqual({ valid: [], invalid: [] });

    writeEvent(dir, "denied.event");
    expect(() => scanRunnerEventFiles(dir, { readFile: () => {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    } })).toThrow(/permission denied/);
  });

  it("finds by exact nonempty run, exact optional event, and guarded owner", () => {
    const dir = eventsDir();
    writeEvent(dir, "a-runless.event", { event: "draft-ready", source: "writer", runId: "" });
    writeEvent(dir, "b-wrong-case.event", { event: "DRAFT-READY", source: "writer", runId: "run-1" });
    writeEvent(dir, "c-sibling.event", { event: "draft-ready", source: "api-reviewer-run-1", runId: "run-1" });
    writeEvent(dir, "d-owner.event", { event: "draft-ready", source: "api-run-1", runId: "run-1" });
    writeEvent(dir, "e-processed.event", { event: "draft-ready", source: "api", runId: "run-1", processed: true });
    writeEvent(dir, "f-diagnostic.event", {
      event: "draft-ready",
      source: "monitor",
      runId: "run-1",
      extensionFields: { agent: "api" },
    });
    writeEvent(dir, "g-raw-substring.event", {
      event: "draft-ready",
      source: "notwriter",
      runId: "run-1",
    });

    const exact = findRunnerCompletionEvent({
      eventsDir: dir,
      runId: "run-1",
      expectedEvent: "draft-ready",
      agentId: "api",
      allAgentIds: ["api", "api-reviewer"],
    });
    expect(exact.match?.filename).toBe("d-owner.event");

    const caseSensitive = findRunnerCompletionEvent({
      eventsDir: dir,
      runId: "run-1",
      expectedEvent: "Draft-Ready",
      agentId: "api",
      allAgentIds: ["api", "api-reviewer"],
    });
    expect(caseSensitive.match).toBeUndefined();

    const rawSubstring = findRunnerCompletionEvent({
      eventsDir: dir,
      runId: "run-1",
      expectedEvent: "draft-ready",
      agentId: "writer",
      allAgentIds: ["writer"],
    });
    expect(rawSubstring.match).toBeUndefined();

    expect(() => findRunnerCompletionEvent({
      eventsDir: dir,
      runId: "",
      agentId: "writer",
    })).toThrow(/runId must not be empty/);
  });

  it("supports no-chain discovery without an expected event while retaining exact run ownership", () => {
    const dir = eventsDir();
    writeEvent(dir, "a-other-run.event", { event: "first", source: "writer", runId: "run-2" });
    writeEvent(dir, "b-owned.event", { event: "custom-handoff", source: "writer", runId: "run-1" });
    writeEvent(dir, "c-later.event", { event: "another", source: "writer", runId: "run-1" });

    const result = findRunnerCompletionEvent({
      eventsDir: dir,
      runId: "run-1",
      agentId: "writer",
    });

    expect(result.match?.filename).toBe("b-owned.event");
    expect(result.match?.event.event).toBe("custom-handoff");
  });

  it("marks strict files atomically and idempotently without reserializing their bytes", () => {
    const dir = eventsDir();
    const path = writeEvent(dir, "preserve.event", {
      extensionFields: { reason: "kept exactly", attempt: "2" },
    });
    const before = readFileSync(path, "utf8").replace("processed: false", "processed:\tfalse  ");
    writeFileSync(path, before);

    const first = markRunnerEventProcessed({ eventsDir: dir, file: "preserve.event" });
    const after = readFileSync(path, "utf8");

    expect(first.status).toBe("marked");
    expect(after).toBe(before.replace("processed:\tfalse  ", "processed:\ttrue  "));
    expect(parseRunnerEvent(after).processed).toBe(true);
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(markRunnerEventProcessed({ eventsDir: dir, file: path }).status).toBe("already-processed");
  });

  it("rejects malformed, nested, outside-root, and symlink mutation targets", () => {
    const dir = eventsDir();
    const outside = join(mkdtempSync(join(tmpdir(), "runner-event-outside-")), "outside.event");
    writeFileSync(outside, eventContent());
    writeFileSync(join(dir, "invalid.event"), JSON.stringify({ event: "legacy" }));
    symlinkSync(outside, join(dir, "link.event"));
    mkdirSync(join(dir, "nested"));
    writeFileSync(join(dir, "nested", "nested.event"), eventContent());

    expect(() => markRunnerEventProcessed({ eventsDir: dir, file: "invalid.event" })).toThrow(/Invalid runner event file/);
    expect(() => markRunnerEventProcessed({ eventsDir: dir, file: outside })).toThrow(/direct \*\.event child/);
    expect(() => markRunnerEventProcessed({ eventsDir: dir, file: "nested/nested.event" })).toThrow(/direct \*\.event child/);
    expect(() => markRunnerEventProcessed({ eventsDir: dir, file: "link.event" })).toThrow(/direct regular file/);
  });

  it("consumes the explicit trigger first and only strict exact-run owned siblings", () => {
    const dir = eventsDir();
    const trigger = writeEvent(dir, "trigger.event", {
      event: "draft-ready",
      source: "writer",
      runId: "run-1",
    });
    writeEvent(dir, "owned.event", { event: "note", source: "writer-run-1", runId: "run-1" });
    writeEvent(dir, "diagnostic.event", {
      event: "agent-timeout",
      source: "monitor",
      runId: "run-1",
      extensionFields: { agent: "writer" },
    });
    writeEvent(dir, "conflicting-normal-owner.event", {
      event: "review-ready",
      source: "reviewer",
      runId: "run-1",
      extensionFields: { agent: "writer" },
    });
    writeEvent(dir, "sibling.event", { event: "review-ready", source: "reviewer-run-1", runId: "run-1" });
    writeEvent(dir, "other-run.event", { event: "note", source: "writer-run-2", runId: "run-2" });
    writeEvent(dir, "not-owner.event", { event: "note", source: "notwriter", runId: "run-1" });
    writeEvent(dir, "runless.event", { event: "manual-start", source: "writer", runId: "" });
    writeFileSync(join(dir, "invalid.event"), JSON.stringify({ event: "legacy-json", agent: "writer" }));

    const result = consumeRunnerEvents({
      eventsDir: dir,
      runId: "run-1",
      source: "writer",
      triggered: trigger,
      allAgentIds: ["writer", "reviewer"],
    });

    expect(result.triggered.filename).toBe("trigger.event");
    expect(result.archived.map((event) => event.filename).sort()).toEqual(["diagnostic.event", "owned.event"]);
    expect(result.invalid.map((event) => event.filename)).toEqual(["invalid.event"]);
    expect(readdirSync(join(dir, "archive")).filter((name) => name.endsWith(".event")).sort()).toEqual([
      "diagnostic.event",
      "owned.event",
      "trigger.event",
    ]);
    for (const name of readdirSync(join(dir, "archive")).filter((entry) => entry.endsWith(".event"))) {
      expect(parseRunnerEvent(readFileSync(join(dir, "archive", name), "utf8")).processed).toBe(true);
    }
    expect(readdirSync(dir).filter((name) => name.endsWith(".event")).sort()).toEqual([
      "conflicting-normal-owner.event",
      "invalid.event",
      "not-owner.event",
      "other-run.event",
      "runless.event",
      "sibling.event",
    ]);
  });

  it("keeps the active event unprocessed and discoverable when archive ownership cannot be claimed", () => {
    const dir = eventsDir();
    const archiveDir = join(dir, "archive");
    mkdirSync(archiveDir);
    mkdirSync(join(archiveDir, "trigger.event"));
    const trigger = writeEvent(dir, "trigger.event", {
      extensionFields: { reason: "preserve before claim" },
    });
    const before = readFileSync(trigger, "utf8").replace(
      "processed: false",
      "processed:\tfalse  ",
    );
    writeFileSync(trigger, before);

    expect(() => consumeRunnerEvents({
      eventsDir: dir,
      runId: "run-1",
      source: "writer",
      triggered: trigger,
    })).toThrow(/Archive destination is not a direct regular file/);

    expect(readFileSync(trigger, "utf8")).toBe(before);
    expect(parseRunnerEvent(readFileSync(trigger, "utf8")).processed).toBe(false);
    expect(findRunnerCompletionEvent({
      eventsDir: dir,
      runId: "run-1",
      expectedEvent: "draft-ready",
      agentId: "writer",
    }).match?.path).toBe(trigger);
    expect(readdirSync(archiveDir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("keeps the exact trigger active when owned-sibling cleanup fails before consume-last", () => {
    const dir = eventsDir();
    const archiveDir = join(dir, "archive");
    mkdirSync(archiveDir);
    mkdirSync(join(archiveDir, "sibling.event"));
    const trigger = writeEvent(dir, "trigger.event", { data: "durable retry token" });
    const sibling = writeEvent(dir, "sibling.event", { event: "note", data: "cleanup" });
    const accepted = acceptedTrigger(dir, trigger);
    const triggerBefore = readFileSync(trigger, "utf8");
    const siblingBefore = readFileSync(sibling, "utf8");

    expect(() => consumeRunnerEvents({
      eventsDir: dir,
      runId: "run-1",
      source: "writer",
      triggered: trigger,
      acceptedTrigger: accepted,
    })).toThrow(/Archive destination is not a direct regular file/);

    expect(readFileSync(trigger, "utf8")).toBe(triggerBefore);
    expect(parseRunnerEvent(readFileSync(trigger, "utf8")).processed).toBe(false);
    expect(readFileSync(sibling, "utf8")).toBe(siblingBefore);
    expect(readdirSync(archiveDir).filter((name) => name.startsWith(".event-receipt-"))).toEqual([]);
  });

  it("retries a crash-state duplicate after the processed archive claim and before source unlink", () => {
    const dir = eventsDir();
    const archiveDir = join(dir, "archive");
    mkdirSync(archiveDir);
    const trigger = writeEvent(dir, "trigger.event", {
      extensionFields: { reason: "preserve across retry", attempt: "2" },
    });
    const activeBytes = readFileSync(trigger, "utf8").replace(
      "processed: false",
      "processed:\tfalse  ",
    );
    const archivedBytes = activeBytes.replace("processed:\tfalse  ", "processed:\ttrue  ");
    writeFileSync(trigger, activeBytes);
    writeFileSync(join(archiveDir, "trigger.event"), archivedBytes);

    const retried = consumeRunnerEvents({
      eventsDir: dir,
      runId: "run-1",
      source: "writer",
      triggered: trigger,
    });

    expect(retried.triggered.status).toBe("already-archived");
    expect(retried.triggered.destination).toBe(join(archiveDir, "trigger.event"));
    expect(existsSync(trigger)).toBe(false);
    expect(readFileSync(retried.triggered.destination, "utf8")).toBe(archivedBytes);
    expect(parseRunnerEvent(archivedBytes).processed).toBe(true);
    expect(readdirSync(archiveDir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("never accepts an unrelated processed basename as missing-source archive proof", () => {
    const dir = eventsDir();
    const archiveDir = join(dir, "archive");
    const trigger = writeEvent(dir, "trigger.event");
    const accepted = acceptedTrigger(dir, trigger);
    unlinkSync(trigger);
    mkdirSync(archiveDir);
    writeFileSync(join(archiveDir, "trigger.event"), eventContent({
      event: "older",
      source: "writer",
      runId: "run-1",
      processed: true,
    }));

    expect(() => consumeRunnerEvents({
      eventsDir: dir,
      runId: "run-1",
      source: "writer",
      triggered: trigger,
      acceptedTrigger: accepted,
    })).toThrow(/no archive receipt exists/);
  });

  it("rejects a wrong run, owner, or event before claiming or unlinking an explicit trigger", () => {
    const cases = [
      {
        input: { runId: "run-2", source: "writer", expectedEvent: "draft-ready" },
        error: /run id does not match/,
      },
      {
        input: { runId: "run-1", source: "notwriter", expectedEvent: "draft-ready" },
        error: /owner does not match/,
      },
      {
        input: { runId: "run-1", source: "writer", expectedEvent: "other-event" },
        error: /event does not match/,
      },
    ];

    for (const { input, error } of cases) {
      const dir = eventsDir();
      const trigger = writeEvent(dir, "trigger.event");
      const before = readFileSync(trigger, "utf8");
      expect(() => consumeRunnerEvents({
        eventsDir: dir,
        triggered: trigger,
        ...input,
      })).toThrow(error);
      expect(readFileSync(trigger, "utf8")).toBe(before);
      expect(existsSync(join(dir, "archive"))).toBe(false);
    }
  });

  it("requires the same exact run, owner, and event when proving an already-consumed trigger", () => {
    const dir = eventsDir();
    const trigger = writeEvent(dir, "trigger.event");
    const accepted = acceptedTrigger(dir, trigger);
    consumeRunnerEvents({
      eventsDir: dir,
      runId: "run-1",
      source: "writer",
      expectedEvent: "draft-ready",
      triggered: trigger,
      acceptedTrigger: accepted,
    });

    expect(() => consumeRunnerEvents({
      eventsDir: dir,
      runId: "run-1",
      source: "notwriter",
      expectedEvent: "draft-ready",
      triggered: trigger,
      acceptedTrigger: accepted,
    })).toThrow(/do not prove the requested trigger identity/);
    expect(() => consumeRunnerEvents({
      eventsDir: dir,
      runId: "run-1",
      source: "writer",
      expectedEvent: "other-event",
      triggered: trigger,
      acceptedTrigger: accepted,
    })).toThrow(/do not prove the requested trigger identity/);
  });

  it("keeps consumed triggers undiscoverable while one exact held path remains idempotent", () => {
    const dir = eventsDir();
    const trigger = writeEvent(dir, "trigger.event", {
      event: "draft-ready",
      source: "writer",
    });
    const accepted = acceptedTrigger(dir, trigger);
    writeEvent(dir, "owned-sibling.event", {
      event: "writer-note",
      source: "writer",
    });

    const consumed = consumeRunnerEvents({
      eventsDir: dir,
      runId: "run-1",
      source: "writer",
      triggered: trigger,
      acceptedTrigger: accepted,
    });
    expect(consumed.archived.map(({ filename }) => filename)).toEqual(["owned-sibling.event"]);

    const normalFind = findRunnerCompletionEvent({
      eventsDir: dir,
      runId: "run-1",
      agentId: "writer",
    });
    expect(normalFind.match).toBeUndefined();

    const repeated = consumeRunnerEvents({
      eventsDir: dir,
      runId: "run-1",
      source: "writer",
      expectedEvent: "draft-ready",
      triggered: trigger,
      acceptedTrigger: accepted,
    });
    expect(repeated.triggered).toMatchObject({
      status: "already-archived",
      destination: consumed.triggered.destination,
      event: { event: "draft-ready", processed: true },
    });
  });

  it("does not let replay of archived A consume a later live owned B", () => {
    const dir = eventsDir();
    const trigger = writeEvent(dir, "trigger.event", { data: "occurrence A" });
    const acceptedA = acceptedTrigger(dir, trigger);
    consumeRunnerEvents({
      eventsDir: dir,
      runId: "run-1",
      source: "writer",
      triggered: trigger,
      acceptedTrigger: acceptedA,
    });

    const later = writeEvent(dir, "later.event", {
      event: "writer-note",
      source: "writer",
      data: "occurrence B",
    });
    const laterBytes = readFileSync(later, "utf8");
    const replay = consumeRunnerEvents({
      eventsDir: dir,
      runId: "run-1",
      source: "writer",
      triggered: trigger,
      acceptedTrigger: acceptedA,
    });

    expect(replay.triggered.status).toBe("already-archived");
    expect(replay.archived).toEqual([]);
    expect(readFileSync(later, "utf8")).toBe(laterBytes);
    expect(parseRunnerEvent(readFileSync(later, "utf8")).processed).toBe(false);
    expect(existsSync(join(dir, "archive", "later.event"))).toBe(false);
  });

  it("uses fixed-length receipt and collision names for a near-NAME_MAX event", () => {
    const dir = eventsDir();
    const archiveDir = join(dir, "archive");
    mkdirSync(archiveDir);
    const longFilename = `${"a".repeat(249)}.event`;
    expect(Buffer.byteLength(longFilename, "utf8")).toBe(255);
    writeFileSync(join(archiveDir, longFilename), eventContent({
      event: "older",
      processed: true,
    }));
    const trigger = writeEvent(dir, longFilename, { event: "newer" });
    const accepted = acceptedTrigger(dir, trigger);

    const consumed = consumeRunnerEvents({
      eventsDir: dir,
      runId: "run-1",
      source: "writer",
      triggered: trigger,
      acceptedTrigger: accepted,
    });

    expect(consumed.triggered.status).toBe("collision-archived");
    expect(basename(consumed.triggered.destination)).toMatch(/^event-collision-[a-f0-9]{64}\.event$/);
    const receipts = readdirSync(archiveDir).filter((name) => name.startsWith(".event-receipt-"));
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatch(/^\.event-receipt-[a-f0-9]{64}-[a-f0-9]{64}-[a-f0-9]{64}\.json$/);
    expect(Buffer.byteLength(receipts[0], "utf8")).toBeLessThanOrEqual(255);

    const repeated = consumeRunnerEvents({
      eventsDir: dir,
      runId: "run-1",
      source: "writer",
      triggered: trigger,
      acceptedTrigger: accepted,
    });
    expect(repeated.triggered.destination).toBe(consumed.triggered.destination);
    expect(repeated.triggered.event.event).toBe("newer");
  });

  it("does not let content A's receipt authorize accepted content B after B disappears", () => {
    const dir = eventsDir();
    const trigger = writeEvent(dir, "loop.event", { data: "content A" });
    const acceptedA = acceptedTrigger(dir, trigger);
    consumeRunnerEvents({
      eventsDir: dir,
      runId: "run-1",
      source: "writer",
      expectedEvent: "draft-ready",
      triggered: trigger,
      acceptedTrigger: acceptedA,
    });

    writeEvent(dir, "loop.event", { data: "content B" });
    const acceptedB = acceptedTrigger(dir, trigger);
    expect(acceptedB).not.toEqual(acceptedA);
    // Simulate downstream launch acceptance followed by loss of B before the
    // consume-last phase. A's old receipt must not authorize this occurrence.
    unlinkSync(trigger);
    expect(() => consumeRunnerEvents({
      eventsDir: dir,
      runId: "run-1",
      source: "writer",
      expectedEvent: "draft-ready",
      triggered: trigger,
      acceptedTrigger: acceptedB,
    })).toThrow(/no archive receipt exists/);

    expect(consumeRunnerEvents({
      eventsDir: dir,
      runId: "run-1",
      source: "writer",
      expectedEvent: "draft-ready",
      triggered: trigger,
      acceptedTrigger: acceptedA,
    }).triggered.status).toBe("already-archived");
  });

  it("distinguishes a byte-identical recreated event as a new durable occurrence", () => {
    const dir = eventsDir();
    const trigger = writeEvent(dir, "loop.event", { data: "identical bytes" });
    const originalBytes = readFileSync(trigger, "utf8");
    const acceptedA = acceptedTrigger(dir, trigger);
    const first = consumeRunnerEvents({
      eventsDir: dir,
      runId: "run-1",
      source: "writer",
      expectedEvent: "draft-ready",
      triggered: trigger,
      acceptedTrigger: acceptedA,
    });

    writeFileSync(trigger, originalBytes);
    const acceptedB = acceptedTrigger(dir, trigger);
    expect(acceptedB.rawContentSha256).toBe(acceptedA.rawContentSha256);
    expect(acceptedB.normalizedRecordSha256).toBe(acceptedA.normalizedRecordSha256);
    expect(acceptedB.occurrenceToken).not.toBe(acceptedA.occurrenceToken);
    const second = consumeRunnerEvents({
      eventsDir: dir,
      runId: "run-1",
      source: "writer",
      expectedEvent: "draft-ready",
      triggered: trigger,
      acceptedTrigger: acceptedB,
    });

    // The archived processed bytes may be shared, but the receipts are distinct
    // and each exact accepted occurrence remains independently provable.
    expect(second.triggered.destination).toBe(first.triggered.destination);
    const receipts = readdirSync(join(dir, "archive"))
      .filter((name) => name.startsWith(".event-receipt-"));
    expect(receipts).toHaveLength(2);
    expect(receipts.every((name) => (
      /^\.event-receipt-[a-f0-9]{64}-[a-f0-9]{64}-[a-f0-9]{64}\.json$/.test(name)
    ))).toBe(true);
    const receiptRecords = receipts.map((name) => JSON.parse(
      readFileSync(join(dir, "archive", name), "utf8"),
    ) as { occurrence: number; occurrenceToken: string });
    expect(receiptRecords.map(({ occurrence }) => occurrence).sort()).toEqual([1, 2]);
    expect(new Set(receiptRecords.map(({ occurrenceToken }) => occurrenceToken)).size).toBe(2);
    for (const acceptedTrigger of [acceptedA, acceptedB]) {
      expect(consumeRunnerEvents({
        eventsDir: dir,
        runId: "run-1",
        source: "writer",
        expectedEvent: "draft-ready",
        triggered: trigger,
        acceptedTrigger,
      }).triggered.status).toBe("already-archived");
    }
  });

  it("rejects a byte-identical replacement created after capture and leaves it active", () => {
    const dir = eventsDir();
    const trigger = writeEvent(dir, "replacement.event", { data: "same bytes" });
    const bytes = readFileSync(trigger, "utf8");
    const staleAcceptance = acceptedTrigger(dir, trigger);

    unlinkSync(trigger);
    writeFileSync(trigger, bytes);
    const replacementAcceptance = acceptedTrigger(dir, trigger);
    expect(replacementAcceptance.rawContentSha256).toBe(staleAcceptance.rawContentSha256);
    expect(replacementAcceptance.normalizedRecordSha256).toBe(staleAcceptance.normalizedRecordSha256);
    expect(replacementAcceptance.occurrenceToken).not.toBe(staleAcceptance.occurrenceToken);

    expect(() => consumeRunnerEvents({
      eventsDir: dir,
      runId: "run-1",
      source: "writer",
      expectedEvent: "draft-ready",
      triggered: trigger,
      acceptedTrigger: staleAcceptance,
    })).toThrow(/no longer matches the accepted trigger occurrence/);
    expect(readFileSync(trigger, "utf8")).toBe(bytes);
    expect(parseRunnerEvent(readFileSync(trigger, "utf8")).processed).toBe(false);
    expect(existsSync(join(dir, "archive"))).toBe(false);
  });

  it("rejects noncanonical or drifted archive receipt records", () => {
    const dir = eventsDir();
    const trigger = writeEvent(dir, "trigger.event");
    const accepted = acceptedTrigger(dir, trigger);
    consumeRunnerEvents({
      eventsDir: dir,
      runId: "run-1",
      source: "writer",
      triggered: trigger,
      acceptedTrigger: accepted,
    });
    const archiveDir = join(dir, "archive");
    const receiptName = readdirSync(archiveDir).find((name) => name.startsWith(".event-receipt-"));
    expect(receiptName).toBeDefined();
    const receiptPath = join(archiveDir, receiptName!);
    const canonical = readFileSync(receiptPath, "utf8");
    const receipt = JSON.parse(canonical) as Record<string, unknown>;
    const invalidReceipts = [
      "null\n",
      `${JSON.stringify([receipt])}\n`,
      `${JSON.stringify({ ...receipt, unknown: true })}\n`,
      `${JSON.stringify({ ...receipt, runId: "" })}\n`,
      `${JSON.stringify({ ...receipt, role: "unrelated" })}\n`,
      `${JSON.stringify({ ...receipt, occurrence: 0 })}\n`,
      `${JSON.stringify({ ...receipt, sourceFilename: "../trigger.event" })}\n`,
      `${JSON.stringify({ ...receipt, destinationFilename: "nested/trigger.event" })}\n`,
      `${JSON.stringify({
        ...receipt,
        acceptedContentSha256: String(receipt.acceptedContentSha256).toUpperCase(),
      })}\n`,
      canonical.replace('{"version":2,', '{"version":2,"version":2,'),
    ];

    for (const invalid of invalidReceipts) {
      writeFileSync(receiptPath, invalid);
      expect(() => consumeRunnerEvents({
        eventsDir: dir,
        runId: "run-1",
        source: "writer",
        triggered: trigger,
        acceptedTrigger: accepted,
      })).toThrow(/Archive receipt/);
    }
  });

  it("never clobbers an archive collision and proves a normal repeated consume idempotently", () => {
    const dir = eventsDir();
    const archiveDir = join(dir, "archive");
    mkdirSync(archiveDir);
    const existing = eventContent({ event: "older", source: "writer", processed: true });
    writeFileSync(join(archiveDir, "trigger.event"), existing);
    const trigger = writeEvent(dir, "trigger.event", { event: "newer", source: "writer" });
    const accepted = acceptedTrigger(dir, trigger);

    const result = consumeRunnerEvents({
      eventsDir: dir,
      runId: "run-1",
      source: "writer",
      triggered: trigger,
      acceptedTrigger: accepted,
    });

    expect(result.triggered.status).toBe("collision-archived");
    expect(readFileSync(join(archiveDir, "trigger.event"), "utf8")).toBe(existing);
    expect(result.triggered.destination).toMatch(/trigger-collision-[a-f0-9]{16}\.event$/);
    expect(parseRunnerEvent(readFileSync(result.triggered.destination, "utf8"))).toMatchObject({
      event: "newer",
      processed: true,
    });

    const repeatedCollision = consumeRunnerEvents({
      eventsDir: dir,
      runId: "run-1",
      source: "writer",
      triggered: trigger,
      acceptedTrigger: accepted,
    });
    expect(repeatedCollision.triggered.status).toBe("already-archived");
    expect(repeatedCollision.triggered.destination).toBe(result.triggered.destination);
    expect(repeatedCollision.triggered.event.event).toBe("newer");
    expect(readFileSync(join(archiveDir, "trigger.event"), "utf8")).toBe(existing);

    const secondDir = eventsDir();
    const secondTrigger = writeEvent(secondDir, "same.event", { event: "same" });
    const secondAccepted = acceptedTrigger(secondDir, secondTrigger);
    consumeRunnerEvents({ eventsDir: secondDir, runId: "run-1", source: "writer", triggered: secondTrigger, acceptedTrigger: secondAccepted });
    const repeated = consumeRunnerEvents({ eventsDir: secondDir, runId: "run-1", source: "writer", triggered: secondTrigger, acceptedTrigger: secondAccepted });
    expect(repeated.triggered.status).toBe("already-archived");
    expect(existsSync(repeated.triggered.destination)).toBe(true);
  });

  it("rejects an archive symlink before mutating the explicit trigger", () => {
    const dir = eventsDir();
    const outsideArchive = mkdtempSync(join(tmpdir(), "runner-event-archive-outside-"));
    symlinkSync(outsideArchive, join(dir, "archive"));
    const trigger = writeEvent(dir, "trigger.event");
    const before = readFileSync(trigger, "utf8");

    expect(() => consumeRunnerEvents({
      eventsDir: dir,
      runId: "run-1",
      source: "writer",
      triggered: trigger,
    })).toThrow(/archive is not a direct regular directory/);
    expect(readFileSync(trigger, "utf8")).toBe(before);
    expect(readdirSync(outsideArchive)).toEqual([]);
  });

  it("requires one explicit absolute configured root", () => {
    expect(() => scanRunnerEventFiles("events")).toThrow(/absolute configured path/);
    expect(() => scanRunnerEventFiles(join(tmpdir(), "missing-runner-events"))).toThrow(/not a directory/);
  });
});
