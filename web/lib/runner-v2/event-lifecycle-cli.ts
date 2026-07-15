#!/usr/bin/env node
import { isAbsolute, resolve } from "node:path";
import {
  captureRunnerEventAcceptedTrigger,
  consumeRunnerEvents,
  findRunnerCompletionEvent,
  markRunnerEventProcessed,
  scanRunnerEventFiles,
  type ArchiveRunnerEventResult,
  type InvalidRunnerEventFile,
  type RunnerEventFile,
} from "@/lib/runner-v2/event-lifecycle";

type Command = "list" | "find" | "mark" | "consume";
type OutputMode = "text" | "json";

interface ParsedCli {
  command: Command;
  values: Map<string, string[]>;
  unprocessed: boolean;
}

function main(): void {
  const parsed = parseCli(process.argv.slice(2));
  const eventsDir = configuredEventsDir(parsed.values);
  const output = outputMode(single(parsed.values, "--output", false));

  if (parsed.command === "list") {
    rejectUnexpected(parsed, new Set(["--events-dir", "--output"]));
    const scan = scanRunnerEventFiles(eventsDir);
    const valid = parsed.unprocessed
      ? scan.valid.filter(({ event }) => !event.processed)
      : scan.valid;
    if (output === "json") {
      printJson({ valid: valid.map(eventJson), invalid: scan.invalid.map(invalidJson) });
    } else {
      for (const file of valid) {
        console.log(`${file.event.processed ? "x" : "o"} ${file.filename}\t${file.event.event}\t${file.event.source}\t${file.event.timestamp}`);
      }
      for (const file of scan.invalid) {
        console.log(`! ${file.filename}\tinvalid\t${file.issues.map((issue) => issue.code).join(",")}`);
      }
    }
    return;
  }

  if (parsed.unprocessed) throw new Error("--unprocessed is valid only for list.");

  if (parsed.command === "find") {
    rejectUnexpected(parsed, new Set([
      "--events-dir", "--run-id", "--expected-event", "--agent-id",
      "--session-name", "--all-agent-id", "--output",
    ]));
    const result = findRunnerCompletionEvent({
      eventsDir,
      runId: requiredSingle(parsed.values, "--run-id"),
      expectedEvent: single(parsed.values, "--expected-event", false),
      agentId: requiredSingle(parsed.values, "--agent-id"),
      sessionName: single(parsed.values, "--session-name", false),
      allAgentIds: parsed.values.get("--all-agent-id"),
    });
    if (!result.match) {
      process.exitCode = 3;
      return;
    }
    if (output === "json") {
      printJson(eventJson(result.match));
    } else {
      console.log(result.match.path);
    }
    return;
  }

  if (parsed.command === "mark") {
    rejectUnexpected(parsed, new Set(["--events-dir", "--file", "--output"]));
    const result = markRunnerEventProcessed({
      eventsDir,
      file: requiredSingle(parsed.values, "--file"),
    });
    if (output === "json") printJson(result);
    else console.log(`${result.status}: ${result.path}`);
    return;
  }

  rejectUnexpected(parsed, new Set([
    "--events-dir", "--run-id", "--source", "--triggered", "--expected-event", "--session-name",
    "--all-agent-id", "--output",
  ]));
  const triggered = requiredSingle(parsed.values, "--triggered");
  const acceptedTrigger = captureRunnerEventAcceptedTrigger({
    eventsDir,
    file: triggered,
  });
  const result = consumeRunnerEvents({
    eventsDir,
    runId: requiredSingle(parsed.values, "--run-id"),
    source: requiredSingle(parsed.values, "--source"),
    triggered,
    expectedEvent: single(parsed.values, "--expected-event", false),
    sessionName: single(parsed.values, "--session-name", false),
    allAgentIds: parsed.values.get("--all-agent-id"),
    acceptedTrigger,
  });
  if (output === "json") {
    printJson({
      triggered: archiveJson(result.triggered),
      archived: result.archived.map(archiveJson),
      invalid: result.invalid.map(invalidJson),
    });
  } else {
    console.log(`${result.triggered.status}: ${result.triggered.destination}`);
    for (const archived of result.archived) {
      console.log(`${archived.status}: ${archived.destination}`);
    }
  }
}

function parseCli(argv: string[]): ParsedCli {
  const command = argv[0];
  if (command !== "list" && command !== "find" && command !== "mark" && command !== "consume") {
    throw new Error("usage: runner-event-lifecycle <list|find|mark|consume> [options]");
  }
  const values = new Map<string, string[]>();
  let unprocessed = false;

  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--unprocessed") {
      if (unprocessed) throw new Error("Duplicate runner event lifecycle argument: --unprocessed");
      unprocessed = true;
      continue;
    }
    if (!flag.startsWith("--")) throw new Error(`Unexpected positional argument: ${flag}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for runner event lifecycle argument: ${flag}`);
    }
    const prior = values.get(flag) || [];
    if (flag !== "--all-agent-id" && prior.length > 0) {
      throw new Error(`Duplicate runner event lifecycle argument: ${flag}`);
    }
    values.set(flag, [...prior, value]);
    index += 1;
  }

  return { command, values, unprocessed };
}

function configuredEventsDir(values: Map<string, string[]>): string {
  const flagValue = single(values, "--events-dir", false)?.trim();
  const environmentValue = process.env.EVENTS_DIR?.trim();
  if (!flagValue && !environmentValue) {
    throw new Error("Configured event root required: pass --events-dir or set EVENTS_DIR.");
  }
  if (flagValue && environmentValue && resolve(flagValue) !== resolve(environmentValue)) {
    throw new Error("--events-dir and EVENTS_DIR resolve to different event roots.");
  }
  const value = flagValue || environmentValue!;
  if (!isAbsolute(value)) throw new Error("Configured event root must be absolute.");
  return resolve(value);
}

function rejectUnexpected(parsed: ParsedCli, allowed: Set<string>): void {
  for (const flag of parsed.values.keys()) {
    if (!allowed.has(flag)) throw new Error(`${flag} is not valid for ${parsed.command}.`);
  }
}

function requiredSingle(values: Map<string, string[]>, flag: string): string {
  const value = single(values, flag, true)!;
  if (!value) throw new Error(`Runner event lifecycle argument must not be empty: ${flag}`);
  return value;
}

function single(values: Map<string, string[]>, flag: string, required: boolean): string | undefined {
  const found = values.get(flag);
  if (!found || found.length === 0) {
    if (required) throw new Error(`Missing required runner event lifecycle argument: ${flag}`);
    return undefined;
  }
  if (found.length !== 1) throw new Error(`Expected one value for runner event lifecycle argument: ${flag}`);
  return found[0];
}

function outputMode(value: string | undefined): OutputMode {
  if (value === undefined || value === "text") return "text";
  if (value === "json") return "json";
  throw new Error("Runner event lifecycle --output must be text or json.");
}

function eventJson(file: RunnerEventFile) {
  return { path: file.path, filename: file.filename, event: file.event };
}

function invalidJson(file: InvalidRunnerEventFile) {
  return { path: file.path, filename: file.filename, issues: file.issues };
}

function archiveJson(result: ArchiveRunnerEventResult) {
  return {
    path: result.path,
    filename: result.filename,
    destination: result.destination,
    status: result.status,
    event: result.event,
  };
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value));
}

try {
  main();
} catch (error) {
  console.error(`runner event lifecycle failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
