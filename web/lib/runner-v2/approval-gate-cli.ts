#!/usr/bin/env node
import { waitForApproval } from "@/lib/runner-v2/approval-gate";

export async function runApprovalGateCli(argv: string[], write: (line: string) => void = console.log): Promise<number> {
  const command = argv[0];
  if (command !== "wait") throw new Error("usage: runner-approval-gate wait --approvals-dir <absolute-dir> --chain-id <id> --run-id <id> --agent-name <name> --step-name <name> --action <text> --description <text> [--timeout-minutes <number>]");
  const values = parseValues(argv.slice(1));
  rejectUnexpected(values, new Set(["--approvals-dir", "--chain-id", "--run-id", "--agent-name", "--step-name", "--action", "--description", "--timeout-minutes", "--poll-interval-ms"]));
  const result = await waitForApproval({
    approvalsDir: required(values, "--approvals-dir"),
    chainId: required(values, "--chain-id"),
    runId: required(values, "--run-id"),
    agentName: required(values, "--agent-name"),
    stepName: required(values, "--step-name"),
    action: required(values, "--action"),
    description: required(values, "--description"),
    timeoutMinutes: optionalNumber(values, "--timeout-minutes"),
    pollIntervalMs: optionalNumber(values, "--poll-interval-ms"),
  }, write);
  return result.code;
}

function parseValues(argv: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || values.has(flag)) throw new Error("Invalid runner approval argument list.");
    values.set(flag, value);
  }
  return values;
}

function rejectUnexpected(values: Map<string, string>, allowed: Set<string>): void {
  for (const flag of values.keys()) if (!allowed.has(flag)) throw new Error(`${flag} is not valid for runner-approval-gate.`);
}

function required(values: Map<string, string>, flag: string): string {
  const value = values.get(flag);
  if (!value?.trim()) throw new Error(`${flag} is required.`);
  return value;
}

function optionalNumber(values: Map<string, string>, flag: string): number | undefined {
  const value = values.get(flag);
  if (value === undefined) return undefined;
  if (!/^(?:\d+|\d*\.\d+)$/.test(value)) throw new Error(`${flag} must be a non-negative number.`);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${flag} must be finite.`);
  return number;
}

if (require.main === module) {
  runApprovalGateCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`runner approval gate failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 3;
  });
}
