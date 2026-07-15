#!/usr/bin/env node
import {
  createRunnerAgentState,
  incrementRunnerAgentRetry,
  readRunnerAgentState,
  runnerAgentStatePath,
  transitionRunnerAgentState,
} from "@/lib/runner-v2/agent-state";

const COMMANDS = ["start", "block", "fail", "complete", "increment-retry", "retry-attempt", "started-at", "status", "path"] as const;
type Command = (typeof COMMANDS)[number];

export function runRunnerAgentStateCli(
  argv: string[],
  write: (line: string) => void = (line) => console.log(line),
): void {
  const parsed = parseCli(argv);
  const stateDir = required(parsed.values, "--state-dir");
  const sessionPrefix = required(parsed.values, "--session-prefix");
  const path = runnerAgentStatePath(stateDir, sessionPrefix, optional(parsed.values, "--run-id"));

  if (parsed.command === "path") {
    rejectUnexpected(parsed, new Set(["--state-dir", "--session-prefix", "--run-id"]));
    write(path);
    return;
  }

  if (parsed.command === "start") {
    rejectUnexpected(parsed, new Set([
      "--state-dir", "--session-prefix", "--run-id", "--session", "--agent-id", "--round",
      "--emits", "--chain", "--workspace", "--timeout", "--retry-max", "--on-error",
      "--on-timeout", "--start-sha", "--pid",
    ]));
    const state = createRunnerAgentState(path, {
      session: required(parsed.values, "--session"),
      agent_id: required(parsed.values, "--agent-id"),
      round: optional(parsed.values, "--round"),
      emits: optional(parsed.values, "--emits"),
      chain: optional(parsed.values, "--chain"),
      workspace: optional(parsed.values, "--workspace"),
      timeout: optional(parsed.values, "--timeout"),
      retry_max: optional(parsed.values, "--retry-max"),
      on_error: optional(parsed.values, "--on-error"),
      on_timeout: optional(parsed.values, "--on-timeout"),
      start_sha: optional(parsed.values, "--start-sha"),
      pid: optional(parsed.values, "--pid"),
      started: new Date().toISOString(),
    });
    write(JSON.stringify(state));
    return;
  }

  if (parsed.command === "status") {
    rejectUnexpected(parsed, new Set(["--state-dir", "--session-prefix", "--run-id"]));
    const state = readRunnerAgentState(path);
    if (!state) throw new Error(`Runner agent state does not exist: ${path}`);
    write(state.status);
    return;
  }

  if (parsed.command === "increment-retry") {
    rejectUnexpected(parsed, new Set(["--state-dir", "--session-prefix", "--run-id"]));
    write(incrementRunnerAgentRetry(path).retry_attempt || "0");
    return;
  }

  if (parsed.command === "retry-attempt") {
    rejectUnexpected(parsed, new Set(["--state-dir", "--session-prefix", "--run-id"]));
    const state = readRunnerAgentState(path);
    write(state?.retry_attempt || "0");
    return;
  }

  if (parsed.command === "started-at") {
    rejectUnexpected(parsed, new Set(["--state-dir", "--session-prefix", "--run-id"]));
    const state = readRunnerAgentState(path);
    write(state?.started || "");
    return;
  }

  rejectUnexpected(parsed, new Set(["--state-dir", "--session-prefix", "--run-id", "--reason"]));
  const state = parsed.command === "block"
    ? transitionRunnerAgentState(path, "blocked", required(parsed.values, "--reason"))
    : parsed.command === "fail"
      ? transitionRunnerAgentState(path, "failed", required(parsed.values, "--reason"))
      : transitionRunnerAgentState(path, "completed");
  write(JSON.stringify(state));
}

interface ParsedCli { command: Command; values: Map<string, string>; }

function parseCli(argv: string[]): ParsedCli {
  const command = argv[0] as Command | undefined;
  if (!command || !COMMANDS.includes(command)) throw new Error(usage());
  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || !value || !flag.startsWith("--") || values.has(flag)) throw new Error(usage());
    values.set(flag, value);
  }
  return { command, values };
}

function rejectUnexpected(parsed: ParsedCli, allowed: Set<string>): void {
  for (const key of parsed.values.keys()) {
    if (!allowed.has(key)) throw new Error(`${key} is not valid for ${parsed.command}`);
  }
}

function required(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function optional(values: Map<string, string>, key: string): string | undefined {
  return values.get(key) || undefined;
}

function usage(): string {
  return `usage: runner-agent-state <${COMMANDS.join("|")}> --state-dir <absolute-dir> --session-prefix <prefix> [options]`;
}

if (require.main === module) {
  try {
    runRunnerAgentStateCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
