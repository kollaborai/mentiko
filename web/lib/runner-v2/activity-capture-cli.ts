#!/usr/bin/env node
import { captureAgentActivity } from "@/lib/runner-v2/activity-capture";

type Command = "capture";

export function runActivityCaptureCli(
  argv: string[],
  write: (line: string) => void = (line) => console.log(line),
): void {
  const command = argv[0] as Command | undefined;
  if (command !== "capture") throw new Error("usage: runner-activity-capture capture [options]");
  const values = parseValues(argv.slice(1));
  rejectUnexpected(values, new Set([
    "--agent-id", "--run-id", "--project-root", "--runs-dir", "--report-file",
    "--profile-file", "--namespace-id",
  ]));
  write(JSON.stringify(captureAgentActivity({
    agentId: required(values, "--agent-id"),
    runId: required(values, "--run-id"),
    projectRoot: required(values, "--project-root"),
    runsDir: required(values, "--runs-dir"),
    reportFile: optional(values, "--report-file"),
    profileFile: optional(values, "--profile-file"),
    namespaceId: optional(values, "--namespace-id"),
  })));
}
function parseValues(argv: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || values.has(key)) {
      throw new Error("usage: runner-activity-capture capture [options]");
    }
    values.set(key, value);
  }
  return values;
}

function required(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function optional(values: Map<string, string>, key: string): string | undefined {
  return values.get(key);
}

function rejectUnexpected(values: Map<string, string>, allowed: Set<string>): void {
  for (const key of values.keys()) if (!allowed.has(key)) throw new Error(`${key} is not valid for runner-activity-capture`);
}

if (require.main === module) {
  try {
    runActivityCaptureCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
