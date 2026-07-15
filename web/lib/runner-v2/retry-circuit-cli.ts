#!/usr/bin/env node
import {
  calculateBackoff,
  circuitStatePath,
  formatCircuitState,
  getCircuitState,
  isCircuitOpen,
  recordCircuitFailure,
  resetCircuit,
  shouldRetry,
} from "@/lib/runner-v2/retry-circuit";

const COMMANDS = ["backoff", "should-retry", "state-file", "is-open", "record-failure", "reset", "state", "format-backoff", "format-state"] as const;
type Command = (typeof COMMANDS)[number];

export function runRetryCircuitCli(argv: string[], write: (line: string) => void = console.log): void {
  const command = argv[0] as Command;
  if (!COMMANDS.includes(command)) throw new Error(`usage: runner-retry-circuit <${COMMANDS.join("|")}> [options]`);
  const values = parseValues(argv.slice(1));
  if (command === "backoff" || command === "format-backoff") {
    allow(values, new Set(["--attempt", "--strategy", "--base-ms", "--max-ms"]));
    const delay = calculateBackoff(integer(values, "--attempt"), required(values, "--strategy"), integer(values, "--base-ms"), optionalInteger(values, "--max-ms"));
    write(command === "format-backoff" ? `${delay} ms (${(delay / 1000).toFixed(2)}s)` : String(delay));
    return;
  }
  if (command === "should-retry") {
    allow(values, new Set(["--attempt", "--max-retries"]));
    write(String(shouldRetry(integer(values, "--attempt"), integer(values, "--max-retries"))));
    return;
  }
  const stateDir = required(values, "--state-dir");
  const chainId = required(values, "--chain-id");
  const agentName = required(values, "--agent-name");
  if (command === "state-file") {
    allow(values, new Set(["--state-dir", "--chain-id", "--agent-name"]));
    write(circuitStatePath(stateDir, chainId, agentName));
  } else if (command === "is-open") {
    allow(values, new Set(["--state-dir", "--chain-id", "--agent-name"]));
    write(String(isCircuitOpen(stateDir, chainId, agentName)));
  } else if (command === "record-failure") {
    allow(values, new Set(["--state-dir", "--chain-id", "--agent-name", "--threshold", "--timeout"]));
    recordCircuitFailure({ stateDir, chainId, agentName, threshold: optionalInteger(values, "--threshold"), timeout: optionalInteger(values, "--timeout") });
  } else if (command === "reset") {
    allow(values, new Set(["--state-dir", "--chain-id", "--agent-name"]));
    resetCircuit(stateDir, chainId, agentName);
    write("circuit reset");
  } else if (command === "format-state") {
    allow(values, new Set(["--state-dir", "--chain-id", "--agent-name"]));
    write(formatCircuitState(getCircuitState(stateDir, chainId, agentName)));
  } else {
    allow(values, new Set(["--state-dir", "--chain-id", "--agent-name"]));
    const state = getCircuitState(stateDir, chainId, agentName);
    write(JSON.stringify(state, null, "threshold" in state ? 2 : undefined));
  }
}

function parseValues(argv: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]; const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--") || values.has(flag)) throw new Error(`Invalid retry circuit argument: ${flag || ""}`);
    values.set(flag, value);
  }
  return values;
}
function allow(values: Map<string, string>, allowed: Set<string>): void { for (const key of values.keys()) if (!allowed.has(key)) throw new Error(`${key} is not valid for retry circuit command.`); }
function required(values: Map<string, string>, flag: string): string { const value = values.get(flag); if (!value?.trim()) throw new Error(`Missing required retry circuit argument: ${flag}`); return value; }
function integer(values: Map<string, string>, flag: string): number { const value = required(values, flag); if (!/^\d+$/.test(value)) throw new Error(`${flag} must be a non-negative integer.`); return Number(value); }
function optionalInteger(values: Map<string, string>, flag: string): number | undefined { return values.has(flag) ? integer(values, flag) : undefined; }

if (typeof require !== "undefined" && require.main === module) {
  try { runRetryCircuitCli(process.argv.slice(2)); } catch (error) { console.error(`runner retry circuit failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
}
