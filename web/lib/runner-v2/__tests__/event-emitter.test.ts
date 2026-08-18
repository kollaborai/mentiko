import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { emitRunnerEvent } from "@/lib/runner-v2/event-emitter";
import { parseRunnerEvent, serializeRunnerEvent } from "@/lib/runner-v2/events";

describe("typed runner event emitter occurrence identity", () => {
  const input = (eventsDir: string) => ({
    event: "chain-complete",
    source: "chain",
    runId: "run-1",
    scope: "run" as const,
    filenameMode: "canonical" as const,
    eventsDir,
    data: "terminal",
  });

  it("never clobbers existing bytes, dedupes one occurrence, and preserves a later occurrence", () => {
    const eventsDir = mkdtempSync(join(tmpdir(), "runner-event-emitter-occurrence-"));
    const canonicalPath = join(eventsDir, "run-1-chain-chain-complete.event");
    const existing = serializeRunnerEvent({
      event: "chain-complete",
      source: "chain",
      runId: "run-1",
      timestamp: "2026-07-15T12:00:00.000Z",
      data: "preexisting",
    });
    writeFileSync(canonicalPath, existing);

    const emit = (occurrenceId: string, idempotencyKey: string) => emitRunnerEvent({
      event: "chain-complete",
      source: "chain",
      runId: "run-1",
      scope: "run",
      filenameMode: "canonical",
      eventsDir,
      data: "terminal",
      occurrenceId,
      idempotencyKey,
    });

    const first = emit("completion-a", "operation-a");
    const replay = emit("completion-a", "operation-a");
    const later = emit("completion-b", "operation-b");

    expect(readFileSync(canonicalPath, "utf8")).toBe(existing);
    expect(replay.path).toBe(first.path);
    expect(later.path).not.toBe(first.path);
    expect(readdirSync(eventsDir).filter((name) => name.endsWith(".event"))).toHaveLength(3);
    expect(parseRunnerEvent(readFileSync(first.path, "utf8")).fields).toMatchObject({
      idempotency_key: "operation-a",
      completion_occurrence_id: "completion-a",
    });
    expect(parseRunnerEvent(readFileSync(later.path, "utf8")).fields).toMatchObject({
      idempotency_key: "operation-b",
      completion_occurrence_id: "completion-b",
    });
  });

  it("rejects a relative event root before creating any file", () => {
    const unique = basename(mkdtempSync(join(tmpdir(), "runner-event-relative-name-")));
    const relativeRoot = join("tmp", unique);
    const resolvedRoot = resolve(relativeRoot);

    expect(() => emitRunnerEvent(input(relativeRoot))).toThrow(/absolute configured path/);
    expect(existsSync(resolvedRoot)).toBe(false);
  });

  it("rejects a symlinked event root without writing through the link", () => {
    const root = mkdtempSync(join(tmpdir(), "runner-event-symlink-root-"));
    const outside = join(root, "outside");
    const linkedRoot = join(root, "events");
    mkdirSync(outside);
    symlinkSync(outside, linkedRoot);

    expect(() => emitRunnerEvent(input(linkedRoot))).toThrow(/not a directory/);
    expect(readdirSync(outside)).toEqual([]);
  });
});
