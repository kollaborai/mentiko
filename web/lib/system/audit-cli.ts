#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import {
  archiveAuditLog,
  auditCsv,
  clearAuditLog,
  exportAuditLog,
  queryAuditLog,
  summarizeAuditLog,
  writeAuditLog,
} from "@/lib/system/audit-log";

type Command = "write" | "query" | "export-json" | "export-csv" | "summary" | "archive" | "clear";

export function runAuditCli(argv: string[], write: (line: string) => void = (line) => console.log(line)): void {
  const [command, ...rest] = argv;
  if (!isCommand(command)) throw new Error(usage());
  // --meta key=value is the primitive metadata path (repeatable). It is extracted
  // before parseFlags so the strict --key value pair parser never sees it and the
  // shell boundary can forward metadata without building JSON. --metadata-json
  // remains for legacy callers (bin/mentiko); when both are present --meta wins.
  const { record: metaRecord, rest: flagArgs } = parseMetaPairs(rest);
  const flags = parseFlags(flagArgs);
  const namespaceId = optional(flags, "--namespace-id");
  if (command !== "write" && Object.keys(metaRecord).length > 0) throw new Error("--meta is not valid for audit");
  switch (command) {
    case "write": {
      requireOnly(flags, new Set(["--namespace-id", "--event-type", "--description", "--metadata-json", "--source", "--ip"]));
      const metadata = { ...jsonRecord(optional(flags, "--metadata-json") ?? "{}"), ...metaRecord };
      write(JSON.stringify(writeAuditLog({ namespaceId, eventType: required(flags, "--event-type"), description: required(flags, "--description"), metadata, source: optional(flags, "--source"), ip: optional(flags, "--ip") })));
      return;
    }
    case "query": {
      requireOnly(flags, new Set(["--namespace-id", "--filter-type", "--filter-value", "--since", "--limit"]));
      write(JSON.stringify(queryAuditLog({ namespaceId, filterType: (optional(flags, "--filter-type") ?? "all") as never, filterValue: optional(flags, "--filter-value"), since: optional(flags, "--since"), limit: optionalNumber(flags, "--limit") })));
      return;
    }
    case "export-json":
    case "export-csv": {
      requireOnly(flags, new Set(["--namespace-id", "--since", "--event-type", "--output"]));
      const entries = exportAuditLog({ namespaceId, since: optional(flags, "--since"), eventType: optional(flags, "--event-type") });
      const payload = command === "export-json" ? JSON.stringify(entries, null, 2) + "\n" : auditCsv(entries);
      const output = optional(flags, "--output");
      if (output) { writeFileSync(output, payload, { mode: 0o600 }); write(`exported to: ${output}`); } else write(payload);
      return;
    }
    case "summary": {
      requireOnly(flags, new Set(["--namespace-id"]));
      const summary = summarizeAuditLog(namespaceId);
      write(JSON.stringify({ logFile: summary.paths.logFile, indexFile: summary.paths.indexFile, total: summary.entries.length, authCount: summary.authCount, eventCounts: Object.fromEntries(summary.eventCounts), recent: summary.entries.slice(0, 10) }));
      return;
    }
    case "archive": {
      requireOnly(flags, new Set(["--namespace-id", "--days"]));
      write(JSON.stringify(archiveAuditLog({ namespaceId, days: optionalNumber(flags, "--days") ?? 30 })));
      return;
    }
    case "clear": {
      requireOnly(flags, new Set(["--namespace-id", "--confirm"]));
      if (required(flags, "--confirm") !== "true") throw new Error("--confirm true is required");
      clearAuditLog(namespaceId);
      write("cleared");
      return;
    }
  }
}

function parseFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]; const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || flags.has(key)) throw new Error(usage());
    flags.set(key, value);
  }
  return flags;
}
function parseMetaPairs(argv: string[]): { record: Record<string, string>; rest: string[] } {
  const record: Record<string, string> = {};
  const rest: string[] = [];
  for (let index = 0; index < argv.length;) {
    const token = argv[index];
    if (token === "--meta") {
      const pair = argv[index + 1];
      if (pair === undefined) throw new Error("--meta requires a key=value argument");
      const equals = pair.indexOf("=");
      if (equals <= 0) throw new Error("--meta must be key=value");
      record[pair.slice(0, equals)] = pair.slice(equals + 1);
      index += 2;
    } else {
      rest.push(token);
      // Preserve a normal flag's value as an opaque token. In particular, a
      // description may literally be "--meta"; it must not be reinterpreted
      // as the metadata switch for the next token.
      if (token.startsWith("--") && argv[index + 1] !== undefined) {
        rest.push(argv[index + 1]);
        index += 2;
      } else {
        index += 1;
      }
    }
  }
  return { record, rest };
}
function requireOnly(flags: Map<string, string>, allowed: Set<string>): void { for (const key of flags.keys()) if (!allowed.has(key)) throw new Error(`${key} is not valid for audit`); }
function required(flags: Map<string, string>, key: string): string { const value = flags.get(key); if (!value) throw new Error(`${key} is required`); return value; }
function optional(flags: Map<string, string>, key: string): string | undefined { return flags.get(key); }
function optionalNumber(flags: Map<string, string>, key: string): number | undefined { const value = optional(flags, key); if (value === undefined) return undefined; const parsed = Number(value); if (!Number.isInteger(parsed)) throw new Error(`${key} must be an integer`); return parsed; }
function jsonRecord(value: string): Record<string, string | number | boolean | null> { let parsed: unknown; try { parsed = JSON.parse(value); } catch { throw new Error("--metadata-json must be a JSON object"); } if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("--metadata-json must be a JSON object"); return parsed as Record<string, string | number | boolean | null>; }
function isCommand(value: string | undefined): value is Command { return value === "write" || value === "query" || value === "export-json" || value === "export-csv" || value === "summary" || value === "archive" || value === "clear"; }
function usage(): string { return "usage: mentiko-audit <write|query|export-json|export-csv|summary|archive|clear> [flags]"; }

if (require.main === module) {
  try { runAuditCli(process.argv.slice(2)); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
