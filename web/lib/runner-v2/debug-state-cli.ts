#!/usr/bin/env node
import "@/lib/runner-v2/entry-code-root-anchor";
import {
  appendDebugStep,
  clearDebugState,
  emptyDebugState,
  loadDebugState,
  mutateDebugState,
  type DebugAction,
} from "@/lib/runs/debug-state-store";

const COMMANDS = ["write-step", "get", "clear", "action"] as const;
type Command = (typeof COMMANDS)[number];

export function runDebugStateCli(argv: string[], write: (line: string) => void = (line) => console.log(line)): void {
  const { command, values } = parseCli(argv);
  const runId = required(values, "--run-id");
  const debugDir = optional(values, "--debug-dir");

  if (command === "write-step") {
    rejectUnexpected(values, new Set(["--run-id", "--debug-dir", "--agent-id", "--agent-name", "--session", "--round", "--status", "--output"]));
    write(JSON.stringify(appendDebugStep({
      runId,
      agentId: required(values, "--agent-id"),
      agentName: required(values, "--agent-name"),
      session: required(values, "--session"),
      round: nonNegativeInteger(values, "--round"),
      status: required(values, "--status"),
      output: optional(values, "--output") || "",
    }, debugDir)));
    return;
  }

  if (command === "get") {
    rejectUnexpected(values, new Set(["--run-id", "--debug-dir"]));
    write(JSON.stringify(loadDebugState(runId, debugDir) || emptyDebugState()));
    return;
  }

  if (command === "clear") {
    rejectUnexpected(values, new Set(["--run-id", "--debug-dir"]));
    clearDebugState(runId, debugDir);
    write(JSON.stringify({ success: true }));
    return;
  }

  rejectUnexpected(values, new Set(["--run-id", "--debug-dir", "--action", "--step-index", "--breakpoints-json"]));
  const action = required(values, "--action");
  if (!["pause", "continue", "resume", "step", "skip", "retry", "abort", "set_breakpoints"].includes(action)) throw new Error(`Invalid debug action: ${action}`);
  const breakpointsJson = optional(values, "--breakpoints-json");
  let breakpoints: unknown[] | undefined;
  if (breakpointsJson !== undefined) {
    const parsed = JSON.parse(breakpointsJson) as unknown;
    if (!Array.isArray(parsed)) throw new Error("--breakpoints-json must contain an array");
    breakpoints = parsed;
  }
  write(JSON.stringify(mutateDebugState({
    runId,
    action: action as DebugAction,
    stepIndex: optional(values, "--step-index") === undefined ? undefined : nonNegativeInteger(values, "--step-index"),
    breakpoints,
  }, debugDir)));
}

function parseCli(argv: string[]): { command: Command; values: Map<string, string> } {
  const command = argv[0];
  if (!COMMANDS.includes(command as Command)) throw new Error(`usage: runner-debug-state <${COMMANDS.join("|")}> [options]`);
  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || values.has(flag)) throw new Error(`usage: runner-debug-state <${COMMANDS.join("|")}> [options]`);
    values.set(flag, value);
  }
  return { command: command as Command, values };
}
function rejectUnexpected(values: Map<string, string>, allowed: Set<string>): void { for (const flag of values.keys()) if (!allowed.has(flag)) throw new Error(`${flag} is not valid for runner-debug-state.`); }
function required(values: Map<string, string>, flag: string): string { const value = values.get(flag); if (value === undefined || value.trim() === "") throw new Error(`Missing required debug-state argument: ${flag}`); return value; }
function optional(values: Map<string, string>, flag: string): string | undefined { const value = values.get(flag); return value === undefined || value.trim() === "" ? undefined : value; }
function nonNegativeInteger(values: Map<string, string>, flag: string): number { const value = required(values, flag); if (!/^\d+$/.test(value)) throw new Error(`${flag} must be a non-negative integer`); const parsed = Number(value); if (!Number.isSafeInteger(parsed)) throw new Error(`${flag} must be a safe integer`); return parsed; }

if (typeof require !== "undefined" && require.main === module) {
  try { runDebugStateCli(process.argv.slice(2)); } catch (error) { console.error(`runner debug state failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
}
