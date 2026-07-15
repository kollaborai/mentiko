#!/usr/bin/env node
import {
  findMonitorCompletionEvent,
  monitorCompletionExpectedEvent,
  resolveMonitorCompletionAgent,
} from "@/lib/runner-v2/monitor-completion-contract";

type Command = "agent-id" | "expected-event" | "find";

export function runMonitorCompletionCli(argv: string[], write: (line: string) => void = (line) => console.log(line)): number {
  const [command, ...rest] = argv;
  if (command !== "agent-id" && command !== "expected-event" && command !== "find") throw new Error(usage());
  const values = parseValues(rest);
  const common = {
    chainPath: required(values, "--chain-path"),
    agentsDir: required(values, "--agents-dir"),
    configProfilesDir: required(values, "--config-profiles-dir"),
    sessionName: required(values, "--session-name"),
    configuredAgentId: optional(values, "--configured-agent-id"),
  };
  const agentId = optional(values, "--agent-id");

  if (command === "agent-id") {
    rejectUnexpected(values, new Set(["--chain-path", "--agents-dir", "--config-profiles-dir", "--session-name", "--configured-agent-id"]));
    write(resolveMonitorCompletionAgent(common));
    return 0;
  }
  if (command === "expected-event") {
    rejectUnexpected(values, new Set(["--chain-path", "--agents-dir", "--config-profiles-dir", "--session-name", "--configured-agent-id", "--agent-id"]));
    write(monitorCompletionExpectedEvent({ ...common, agentId }));
    return 0;
  }

  rejectUnexpected(values, new Set(["--chain-path", "--agents-dir", "--config-profiles-dir", "--session-name", "--configured-agent-id", "--agent-id", "--events-dir", "--run-id"]));
  const result = findMonitorCompletionEvent({
    ...common,
    agentId,
    eventsDir: required(values, "--events-dir"),
    runId: required(values, "--run-id"),
  });
  if (!result) return 3;
  write(result);
  return 0;
}

function parseValues(argv: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]; const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || values.has(key)) throw new Error(usage());
    values.set(key, value);
  }
  return values;
}
function required(values: Map<string, string>, key: string): string { const value = values.get(key); if (!value) throw new Error(`${key} is required`); return value; }
function optional(values: Map<string, string>, key: string): string | undefined { return values.get(key); }
function rejectUnexpected(values: Map<string, string>, allowed: Set<string>): void { for (const key of values.keys()) if (!allowed.has(key)) throw new Error(`${key} is not valid for runner-monitor-completion`); }
function usage(): string { return "usage: runner-monitor-completion <agent-id|expected-event|find> --chain-path <path> --agents-dir <path> --config-profiles-dir <path> --session-name <name> [options]"; }

if (require.main === module) {
  try { process.exitCode = runMonitorCompletionCli(process.argv.slice(2)); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
