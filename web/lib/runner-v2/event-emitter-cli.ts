#!/usr/bin/env node
import {
  diagnosticEventData,
  emitRunnerEvent,
  type RunnerEventFilenameMode,
  type RunnerEventScope,
} from "@/lib/runner-v2/event-emitter";

interface ParsedArguments {
  mode: RunnerEventFilenameMode;
  event: string;
  source: string;
  runId: string;
  scope: RunnerEventScope;
  data: string;
  agent?: string;
  staleCount?: number;
  output: "text" | "json";
}

function main(): void {
  const args = parseArguments(process.argv.slice(2));
  const result = emitRunnerEvent({
    event: args.event,
    source: args.source,
    runId: args.runId,
    scope: args.scope,
    filenameMode: args.mode,
    diagnosticAgent: args.agent,
    diagnosticReason: args.mode === "diagnostic" ? args.data : undefined,
    diagnosticStaleCount: args.staleCount,
    data: args.mode === "diagnostic"
      ? diagnosticEventData({ agent: args.agent!, reason: args.data, staleCount: args.staleCount })
      : args.data,
  });

  if (args.output === "json") {
    console.log(JSON.stringify({ path: result.path, filename: result.filename }));
    return;
  }

  if (args.mode === "diagnostic") {
    console.log(`  diagnostic event written: ${result.filename}`);
    return;
  }
  console.log(`  event emitted: ${args.event}`);
  console.log(`  file: ${result.path}`);
}

function parseArguments(argv: string[]): ParsedArguments {
  const command = argv[0];
  const mode = parseMode(command);
  const values = new Map<string, string>();
  const allowed = new Set([
    "--event",
    "--source",
    "--run-id",
    "--scope",
    "--data",
    "--agent",
    "--reason",
    "--stale-count",
    "--output",
  ]);

  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag)) throw new Error(`Unknown runner event emitter argument: ${flag}`);
    if (value === undefined) throw new Error(`Missing value for runner event emitter argument: ${flag}`);
    if (values.has(flag)) throw new Error(`Duplicate runner event emitter argument: ${flag}`);
    values.set(flag, value);
  }

  const event = requireNonEmpty(values, "--event");
  const source = requireNonEmpty(values, "--source");
  const runId = requirePresent(values, "--run-id");
  const scope = parseScope(requireNonEmpty(values, "--scope"));

  if (mode === "diagnostic") {
    rejectPresent(values, "--data", command);
    return {
      mode,
      event,
      source,
      runId,
      scope,
      agent: requireNonEmpty(values, "--agent"),
      data: requireNonEmpty(values, "--reason"),
      staleCount: parseStaleCount(values.get("--stale-count")),
      output: parseOutput(values.get("--output")),
    };
  }

  rejectPresent(values, "--agent", command);
  rejectPresent(values, "--reason", command);
  rejectPresent(values, "--stale-count", command);
  return {
    mode,
    event,
    source,
    runId,
    scope,
    data: requirePresent(values, "--data"),
    output: parseOutput(values.get("--output")),
  };
}

function parseScope(value: string): RunnerEventScope {
  if (value === "run" || value === "ingress") return value;
  throw new Error("Runner event emitter --scope must be run or ingress.");
}

function parseStaleCount(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error("Runner event emitter --stale-count must be a non-negative integer.");
  }
  const count = Number(value);
  if (!Number.isSafeInteger(count)) {
    throw new Error("Runner event emitter --stale-count exceeds the safe integer range.");
  }
  return count;
}

function parseMode(command: string | undefined): RunnerEventFilenameMode {
  if (command === "emit") return "canonical";
  if (command === "diagnostic") return "diagnostic";
  throw new Error(
    "usage: runner-event-emitter <emit|diagnostic> --scope <run|ingress> --event <name> --source <source> --run-id <id>",
  );
}

function requirePresent(values: Map<string, string>, flag: string): string {
  if (!values.has(flag)) throw new Error(`Missing required runner event emitter argument: ${flag}`);
  return values.get(flag)!;
}

function parseOutput(value: string | undefined): "text" | "json" {
  if (value === undefined || value === "text") return "text";
  if (value === "json") return "json";
  throw new Error("Runner event emitter --output must be text or json.");
}

function requireNonEmpty(values: Map<string, string>, flag: string): string {
  const value = requirePresent(values, flag);
  if (!value) throw new Error(`Runner event emitter argument must not be empty: ${flag}`);
  return value;
}

function rejectPresent(values: Map<string, string>, flag: string, command: string): void {
  if (values.has(flag)) throw new Error(`${flag} is not valid for runner event emitter command ${command}.`);
}

try {
  main();
} catch (error) {
  console.error(`runner event emitter failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
