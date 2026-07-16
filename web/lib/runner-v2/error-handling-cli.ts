#!/usr/bin/env node
import {
  calculateRetryDelay,
  detectAgentError,
  dispatchChainRunner,
  getAgentRetryCount,
  handleAgentError,
  incrementAgentRetryCount,
} from "@/lib/runner-v2/error-handling";

type Command = "detect" | "retry-count" | "increment-retry" | "delay" | "handle" | "dispatch";

export async function runErrorHandlingCli(argv: string[], write: (line: string) => void = console.log): Promise<number> {
  const command = argv[0] as Command | undefined;
  if (!isCommand(command)) throw new Error(usage());
  const values = parseValues(argv.slice(1));
  if (command === "detect") {
    rejectUnexpected(values, new Set(["--report-file"]));
    return detectAgentError(required(values, "--report-file"));
  }
  if (command === "delay") {
    rejectUnexpected(values, new Set(["--attempt", "--backoff", "--initial-delay", "--max-delay", "--multiplier"]));
    write(String(calculateRetryDelay(number(values, "--attempt"), optional(values, "--backoff") || "exponential", number(values, "--initial-delay", 5), number(values, "--max-delay", 300), number(values, "--multiplier", 2))));
    return 0;
  }
  if (command === "retry-count") {
    const stateDir = required(values, "--state-dir");
    const runId = required(values, "--run-id");
    const sessionPrefix = required(values, "--session-prefix");
    rejectUnexpected(values, new Set(["--state-dir", "--run-id", "--session-prefix"]));
    write(String(getAgentRetryCount(stateDir, sessionPrefix, runId)));
    return 0;
  }
  if (command === "increment-retry") {
    const stateDir = required(values, "--state-dir");
    const runId = required(values, "--run-id");
    const sessionPrefix = required(values, "--session-prefix");
    rejectUnexpected(values, new Set(["--state-dir", "--run-id", "--session-prefix"]));
    write(String(incrementAgentRetryCount(stateDir, sessionPrefix, runId)));
    return 0;
  }
  if (command === "dispatch") {
    rejectUnexpected(values, new Set(["--delay-seconds", "--chain-file", "--agent-id"]));
    await dispatchChainRunner(required(values, "--chain-file"), required(values, "--agent-id"), number(values, "--delay-seconds"));
    return 0;
  }
  rejectUnexpected(values, new Set(["--state-dir", "--run-id", "--session-prefix", "--agent-id", "--error-type", "--report-file", "--chain-file", "--agents-dir"]));
  const stateDir = required(values, "--state-dir");
  const runId = required(values, "--run-id");
  const result = handleAgentError({
    agentId: required(values, "--agent-id"),
    errorType: errorType(values),
    reportFile: required(values, "--report-file"),
    chainFile: required(values, "--chain-file"),
    stateDir,
    runId,
    agentsDir: optional(values, "--agents-dir"),
  }, write);
  return result.code;
}

function parseValues(argv: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || values.has(flag)) throw new Error(usage());
    values.set(flag, value);
  }
  return values;
}

function rejectUnexpected(values: Map<string, string>, allowed: Set<string>): void {
  for (const key of values.keys()) if (!allowed.has(key)) throw new Error(`${key} is not valid for runner-error-handling.`);
}

function required(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (!value?.trim()) throw new Error(`${key} is required.`);
  return value;
}

function optional(values: Map<string, string>, key: string): string | undefined { return values.get(key); }

function number(values: Map<string, string>, key: string, fallback?: number): number {
  const value = optional(values, key);
  if (value === undefined && fallback !== undefined) return fallback;
  if (value === undefined || !/^(?:\d+|\d*\.\d+)$/.test(value)) throw new Error(`${key} must be a non-negative number.`);
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`${key} must be finite.`);
  return result;
}

function errorType(values: Map<string, string>): "error" | "timeout" {
  const value = optional(values, "--error-type") || "error";
  if (value !== "error" && value !== "timeout") throw new Error("--error-type must be error or timeout.");
  return value;
}

function isCommand(value: string | undefined): value is Command {
  return value === "detect" || value === "retry-count" || value === "increment-retry" || value === "delay" || value === "handle" || value === "dispatch";
}

function usage(): string { return "usage: runner-error-handling <detect|retry-count|increment-retry|delay|handle|dispatch> [options]"; }

if (require.main === module) {
  runErrorHandlingCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`runner error handling failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
