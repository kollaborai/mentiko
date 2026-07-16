import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditRawRunnerEvents,
  serializeRawEventAuditReport,
} from "@/lib/runner-v2/raw-event-audit";

const FIXTURES = join(process.cwd(), "lib", "runner-v2", "__fixtures__", "raw-event-audit");

function eventsDir(): string {
  const root = mkdtempSync(join(tmpdir(), "raw-event-audit-"));
  const events = join(root, "events");
  mkdirSync(events);
  return events;
}

function copyFixture(events: string, name: string): string {
  const target = join(events, name);
  cpSync(join(FIXTURES, name), target);
  return target;
}

describe("raw runner event audit", () => {
  it("classifies valid files, malformed shell diagnostics, legacy records, and direct JSON/YAML writes without mutating them", () => {
    const events = eventsDir();
    const valid = copyFixture(events, "canonical.event");
    const shellDiagnostic = copyFixture(events, "old-shell-diagnostic.event");
    const legacy = copyFixture(events, "legacy-equals.event");
    const directJson = copyFixture(events, "unsafe-direct-json.event");
    const directYaml = copyFixture(events, "unsafe-direct-yaml.event");
    const before = new Map([
      [valid, readFileSync(valid, "utf8")],
      [shellDiagnostic, readFileSync(shellDiagnostic, "utf8")],
      [legacy, readFileSync(legacy, "utf8")],
      [directJson, readFileSync(directJson, "utf8")],
      [directYaml, readFileSync(directYaml, "utf8")],
    ]);

    const report = auditRawRunnerEvents(events, { now: () => new Date("2026-07-15T18:00:00.000Z") });

    expect(report.entries.map((entry) => entry.classification)).toEqual([
      "canonical-valid",
      "unsupported-legacy",
      "malformed",
      "unsafe-direct-write",
      "unsafe-direct-write",
    ]);
    expect(report.entries.every((entry) => entry.candidateId.startsWith("event-audit-"))).toBe(true);
    expect(report.counts).toEqual({
      "canonical-valid": 1,
      malformed: 1,
      "unsupported-legacy": 1,
      "unsafe-direct-write": 2,
    });
    expect(report.manifest).toEqual(expect.objectContaining({
      version: 1,
      mode: "read-only",
      mutations: [],
      candidates: expect.arrayContaining([
        expect.objectContaining({ classification: "malformed", recommendedAction: "preserve-and-review" }),
        expect.objectContaining({ classification: "unsafe-direct-write" }),
      ]),
    }));
    const serialized = serializeRawEventAuditReport(report);
    expect(serialized).toContain('"mode": "read-only"');
    expect(serialized).not.toContain(readFileSync(directJson, "utf8"));
    for (const privateValue of [events, valid, shellDiagnostic, legacy, directJson, directYaml, "run_id"]) {
      expect(serialized).not.toContain(privateValue);
    }
    for (const [path, content] of before) expect(readFileSync(path, "utf8")).toBe(content);
  });

  it("scans only direct regular event files and rejects symlinked roots", () => {
    const events = eventsDir();
    copyFixture(events, "canonical.event");
    writeFileSync(join(events, "ignored.json"), "{}");
    symlinkSync(join(events, "canonical.event"), join(events, "linked.event"));

    expect(auditRawRunnerEvents(events).entries.map((entry) => entry.classification)).toEqual(["canonical-valid"]);
    expect(() => auditRawRunnerEvents(" ")).toThrow(/configured events root/);
    const rootLink = join(events, "..", "events-link");
    symlinkSync(events, rootLink);
    expect(() => auditRawRunnerEvents(rootLink)).toThrow(/physical directory/);
  });

  it("re-lstats each candidate after enumeration and rejects a TOCTOU symlink replacement before reading it", () => {
    const events = eventsDir();
    const candidate = copyFixture(events, "canonical.event");
    const replacement = join(events, "replacement.event");
    writeFileSync(replacement, "not an event");

    expect(() => auditRawRunnerEvents(events, {
      beforeCandidateRead: (path) => {
        if (path !== candidate) return;
        renameSync(candidate, join(events, "renamed.event"));
        symlinkSync(replacement, candidate);
      },
    })).toThrow(/no longer a direct regular file/);
  });

  it("does not serialize normalized parser error text", () => {
    const events = eventsDir();
    copyFixture(events, "canonical.event");
    const injected = "run_id: private-run; value: private-value";

    const report = auditRawRunnerEvents(events, {
      parseCandidate: () => {
        throw new Error(injected);
      },
    });

    expect(report.entries).toEqual([expect.objectContaining({
      classification: "malformed",
      reason: "Normalized runner event validation failed.",
      rawIssueCodes: [],
    })]);
    expect(serializeRawEventAuditReport(report)).not.toContain(injected);
    expect(serializeRawEventAuditReport(report)).not.toContain("run_id");
  });
});
