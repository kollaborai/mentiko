import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, type Stats } from "node:fs";
import { join, resolve } from "node:path";
import {
  parseRunnerEvent,
  validateRawRunnerEvent,
  type RunnerEventRawIssueCode,
} from "@/lib/runner-v2/events";

/**
 * Read-only classification for physical event files that are not candidates
 * for runtime processing. This is deliberately diagnostic-only: no category
 * grants lifecycle acceptance and no file is moved, rewritten, or deleted.
 */
export type RawEventAuditClassification =
  | "canonical-valid"
  | "malformed"
  | "unsupported-legacy"
  | "unsafe-direct-write";

export interface RawEventAuditEntry {
  candidateId: string;
  classification: RawEventAuditClassification;
  reason: string;
  rawIssueCodes: RunnerEventRawIssueCode[];
}

export interface RawEventAuditManifestCandidate {
  candidateId: string;
  classification: Exclude<RawEventAuditClassification, "canonical-valid">;
  reason: string;
  recommendedAction: "preserve-and-review";
}

export interface RawEventAuditManifest {
  version: 1;
  mode: "read-only";
  mutations: [];
  candidates: RawEventAuditManifestCandidate[];
}

export interface RawEventAuditReport {
  version: 1;
  eventsRootDigest: string;
  generatedAt: string;
  counts: Record<RawEventAuditClassification, number>;
  entries: RawEventAuditEntry[];
  manifest: RawEventAuditManifest;
}

export interface AuditRawRunnerEventsOptions {
  now?: () => Date;
  readFile?: (path: string) => string;
  /** Test-only hook for exercising a replacement after directory enumeration. */
  beforeCandidateRead?: (path: string) => void;
  /** Test-only hook for asserting report redaction if normalized parsing fails. */
  parseCandidate?: (content: string) => unknown;
}

const EMPTY_COUNTS = (): Record<RawEventAuditClassification, number> => ({
  "canonical-valid": 0,
  malformed: 0,
  "unsupported-legacy": 0,
  "unsafe-direct-write": 0,
});

function requirePhysicalEventsDir(eventsRoot: string): string {
  if (!eventsRoot.trim()) throw new Error("Event audit requires a configured events root.");
  const root = resolve(eventsRoot);
  let stat: Stats;
  try {
    stat = lstatSync(root);
  } catch {
    throw new Error("Event audit root must be an accessible physical directory.");
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("Event audit root must be a physical directory.");
  }
  return root;
}

function opaqueDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function candidateId(root: string, filename: string): string {
  return `event-audit-${opaqueDigest(`${root}\u0000${filename}`).slice(0, 24)}`;
}

function issueCodes(issues: Array<{ code: RunnerEventRawIssueCode }>): RunnerEventRawIssueCode[] {
  return [...new Set(issues.map((issue) => issue.code))].sort();
}

function looksLikeDirectJson(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    // Shell diagnostics commonly start with bracketed prefixes such as
    // `[monitor]`; malformed JSON must not be inferred from that coincidence.
    return false;
  }
}

function looksLikeDirectYaml(content: string): boolean {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  if (lines.some((line) => /^\s*---(?:\s|$)/.test(line))) return true;

  const hasCanonicalEventKey = lines.some((line) =>
    /^\s*(?:event|source|run_id|timestamp|processed|data)\s*:/.test(line),
  );
  const hasYamlOnlyStructure = lines.some((line) =>
    /^\s+\S/.test(line) || /^\s*-\s+/.test(line),
  );
  return hasCanonicalEventKey && hasYamlOnlyStructure;
}

function looksLikeUnsupportedLegacy(content: string): boolean {
  return /(?:^|\n)\s*(?:event|event_type|type|source|source_agent|run_id|runId|timestamp|processed|data)\s*=/.test(content)
    || /(?:^|\n)\s*(?:event_type|source_agent|runId)\s*:/.test(content);
}

function classifyInvalidRawEvent(content: string, rawIssues: RunnerEventRawIssueCode[]): Pick<RawEventAuditEntry, "classification" | "reason"> {
  if (looksLikeDirectJson(content)) {
    return {
      classification: "unsafe-direct-write",
      reason: "Structured JSON was written directly to the event root instead of the canonical line-event emitter.",
    };
  }
  if (looksLikeDirectYaml(content)) {
    return {
      classification: "unsafe-direct-write",
      reason: "Structured YAML was written directly to the event root instead of the canonical line-event emitter.",
    };
  }
  if (looksLikeUnsupportedLegacy(content)) {
    return {
      classification: "unsupported-legacy",
      reason: "Legacy event syntax is not a supported input contract; preserve it for review rather than normalizing it.",
    };
  }
  return {
    classification: "malformed",
    reason: `Raw event contract failed: ${rawIssues.join(", ")}.`,
  };
}

/**
 * Audits direct regular *.event files under a caller-provided root. The report
 * contains no raw event payloads, filesystem names, paths, or raw field names.
 * Its manifest explicitly contains no mutations and is only for review.
 */
export function auditRawRunnerEvents(
  eventsRoot: string,
  options: AuditRawRunnerEventsOptions = {},
): RawEventAuditReport {
  const root = requirePhysicalEventsDir(eventsRoot);
  const entries: RawEventAuditEntry[] = [];
  const counts = EMPTY_COUNTS();

  const files = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".event"))
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const file of files) {
    const path = join(root, file.name);
    options.beforeCandidateRead?.(path);
    let stat: Stats;
    try {
      stat = lstatSync(path);
    } catch {
      throw new Error("Event audit candidate is no longer a direct regular file.");
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error("Event audit candidate is no longer a direct regular file.");
    }
    const content = options.readFile?.(path) ?? readFileSync(path, "utf8");
    const raw = validateRawRunnerEvent(content);
    let entry: RawEventAuditEntry;
    if (!raw.valid) {
      const rawIssueCodes = issueCodes(raw.issues);
      entry = {
        candidateId: candidateId(root, file.name),
        rawIssueCodes,
        ...classifyInvalidRawEvent(content, rawIssueCodes),
      };
    } else {
      try {
        (options.parseCandidate ?? parseRunnerEvent)(content);
        entry = {
          candidateId: candidateId(root, file.name),
          classification: "canonical-valid",
          reason: "Passes canonical raw-file and normalized-record validation.",
          rawIssueCodes: [],
        };
      } catch {
        entry = {
          candidateId: candidateId(root, file.name),
          classification: "malformed",
          reason: "Normalized runner event validation failed.",
          rawIssueCodes: [],
        };
      }
    }
    counts[entry.classification] += 1;
    entries.push(entry);
  }

  const candidates = entries
    .filter((entry): entry is RawEventAuditEntry & { classification: Exclude<RawEventAuditClassification, "canonical-valid"> } =>
      entry.classification !== "canonical-valid",
    )
    .map(({ candidateId, classification, reason }) => ({
      candidateId,
      classification,
      reason,
      recommendedAction: "preserve-and-review" as const,
    }));

  return {
    version: 1,
    eventsRootDigest: opaqueDigest(root),
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    counts,
    entries,
    manifest: {
      version: 1,
      mode: "read-only",
      mutations: [],
      candidates,
    },
  };
}

/** Stable, redacted JSON suitable for attaching to a future quarantine review. */
export function serializeRawEventAuditReport(report: RawEventAuditReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
