#!/usr/bin/env node
import { branchParseLine, errorHandlerFor, retryDelay, timeoutConfigFor, timeoutExceeded } from "@/lib/runner-v2/routing-contract";

type Command = "retry-delay" | "branch-parse" | "error-handler" | "timeout-session-prefix" | "timeout-check";

export function runRoutingContractCli(argv: string[], write: (line: string) => void = (line) => console.log(line)): void {
  const [command, ...rest] = argv;
  if (!isCommand(command)) throw new Error(usage());
  const values = parseValues(rest);
  switch (command) {
    case "retry-delay":
      rejectUnexpected(values, new Set(["--attempt", "--strategy", "--initial-delay", "--max-delay", "--multiplier"]));
      write(String(retryDelay(numberValue(values, "--attempt"), optional(values, "--strategy") || "exponential", numberValue(values, "--initial-delay", 5), numberValue(values, "--max-delay", 300), numberValue(values, "--multiplier", 2))));
      return;
    case "branch-parse":
      rejectUnexpected(values, new Set(["--branch-json"]));
      write(branchParseLine(required(values, "--branch-json")));
      return;
    case "error-handler": {
      rejectUnexpected(values, new Set(["--chain-path", "--chain-dir", "--agent-id", "--error-type"]));
      const type = optional(values, "--error-type") || "error";
      if (type !== "error" && type !== "timeout") throw new Error("--error-type must be error or timeout");
      write(errorHandlerFor(required(values, "--chain-path"), required(values, "--chain-dir"), required(values, "--agent-id"), type));
      return;
    }
    case "timeout-session-prefix": {
      rejectUnexpected(values, new Set(["--chain-path", "--chain-dir", "--agent-id"]));
      write(timeoutConfigFor(required(values, "--chain-path"), required(values, "--chain-dir"), required(values, "--agent-id")).sessionPrefix);
      return;
    }
    case "timeout-check":
      rejectUnexpected(values, new Set(["--chain-path", "--chain-dir", "--agent-id", "--started-at", "--now-ms"]));
      write(timeoutExceeded(required(values, "--chain-path"), required(values, "--chain-dir"), required(values, "--agent-id"), required(values, "--started-at"), numberValue(values, "--now-ms", Date.now())) ? "true" : "false");
      return;
  }
}

function parseValues(argv: string[]): Map<string, string> { const values = new Map<string, string>(); for (let i = 0; i < argv.length; i += 2) { const key = argv[i], value = argv[i + 1]; if (!key?.startsWith("--") || value === undefined || values.has(key)) throw new Error(usage()); values.set(key, value); } return values; }
function required(values: Map<string, string>, key: string): string { const value = values.get(key); if (!value) throw new Error(`${key} is required`); return value; }
function optional(values: Map<string, string>, key: string): string | undefined { return values.get(key); }
function numberValue(values: Map<string, string>, key: string, fallback?: number): number { const value = optional(values, key); if (value === undefined && fallback !== undefined) return fallback; if (value === undefined || !/^-?(?:\d+|\d*\.\d+)$/.test(value)) throw new Error(`${key} must be a number`); const result = Number(value); if (!Number.isFinite(result)) throw new Error(`${key} must be finite`); return result; }
function rejectUnexpected(values: Map<string, string>, allowed: Set<string>): void { for (const key of values.keys()) if (!allowed.has(key)) throw new Error(`${key} is not valid for runner-routing-contract`); }
function isCommand(value: string | undefined): value is Command { return value === "retry-delay" || value === "branch-parse" || value === "error-handler" || value === "timeout-session-prefix" || value === "timeout-check"; }
function usage(): string { return "usage: runner-routing-contract <retry-delay|branch-parse|error-handler|timeout-session-prefix|timeout-check> [options]"; }

if (require.main === module) { try { runRoutingContractCli(process.argv.slice(2)); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; } }
