#!/usr/bin/env node
import {
  breakpointRecordExists,
  consumeResumeRequest,
  pauseAt,
  shouldPause,
} from "@/lib/runs/breakpoint-store";

type Command = "check" | "pause" | "consume-resume";

/**
 * Minimal process boundary for shell orchestration. Path selection is explicit
 * so local and remote workspace callers use the same record contract.
 */
export function runBreakpointCli(
  argv: string[],
  write: (line: string) => void = (line) => console.log(line),
): void {
  const [command, ...rest] = argv;
  if (!isCommand(command)) throw new Error(usage());
  const values = flags(rest);
  const chainId = required(values, "--chain-id");
  const debugDir = required(values, "--debug-dir");
  rejectUnexpected(values, new Set(["--chain-id", "--debug-dir", "--agent-id"]));
  if (command === "check") {
    write(String(shouldPause(chainId, required(values, "--agent-id"), debugDir)));
    return;
  }
  if (command === "pause") {
    pauseAt(chainId, required(values, "--agent-id"), debugDir);
    return;
  }
  if (!breakpointRecordExists(chainId, debugDir)) { write("missing"); return; }
  write(String(consumeResumeRequest(chainId, debugDir)));
}

function flags(argv: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]; const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || values.has(key)) throw new Error(usage());
    values.set(key, value);
  }
  return values;
}
function required(values: Map<string, string>, key: string): string { const value = values.get(key); if (!value) throw new Error(`${key} is required`); return value; }
function rejectUnexpected(values: Map<string, string>, allowed: Set<string>): void { for (const key of values.keys()) if (!allowed.has(key)) throw new Error(`${key} is not valid for runner-breakpoint`); }
function isCommand(value: string | undefined): value is Command { return value === "check" || value === "pause" || value === "consume-resume"; }
function usage(): string { return "usage: runner-breakpoint <check|pause|consume-resume> --chain-id <id> --debug-dir <absolute-path> [--agent-id <id>]"; }

if (require.main === module) {
  try { runBreakpointCli(process.argv.slice(2)); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
