#!/usr/bin/env node
import { admitChain, blockAgentForInvalidAdmission, canAdmitAgent, waitForAgentAdmission, waitForChainAdmission } from "@/lib/runner-v2/concurrency-admission";
import { ExclusiveFileClaimBusyError } from "@/lib/runner-v2/file-claim";

export function runConcurrencyAdmissionCli(argv: string[], write: (line: string) => void = console.log): void {
  const command = argv[0];
  const values = parseValues(argv.slice(1));
  if (command === "admit-chain") {
    allow(values, new Set(["--runs-dir", "--run-id", "--cap", "--queued"]));
    try {
      write(admitChain({
        runsDir: required(values, "--runs-dir"),
        runId: required(values, "--run-id"),
        cap: integer(values, "--cap"),
        queued: required(values, "--queued") === "1",
      }));
    } catch (error) {
      if (error instanceof ExclusiveFileClaimBusyError) { write("queued"); return; }
      throw error;
    }
    return;
  }
  if (command === "wait-chain") {
    allow(values, new Set(["--runs-dir", "--run-id", "--cap", "--max-wait-secs", "--poll-secs", "--poll-max-secs"]));
    write(waitForChainAdmission({ runsDir: required(values,"--runs-dir"), runId: required(values,"--run-id"), cap: integer(values,"--cap"), maxWaitSecs: integer(values,"--max-wait-secs"), pollSecs: integer(values,"--poll-secs"), pollMaxSecs: integer(values,"--poll-max-secs") })); return;
  }
  if (command === "wait-agent") { allow(values,new Set(["--runs-dir","--cap","--max-wait-secs","--poll-secs","--poll-max-secs","--pty-cmd"])); write(waitForAgentAdmission({runsDir:required(values,"--runs-dir"),cap:integer(values,"--cap"),maxWaitSecs:integer(values,"--max-wait-secs"),pollSecs:integer(values,"--poll-secs"),pollMaxSecs:integer(values,"--poll-max-secs"),ptyCmd:required(values,"--pty-cmd")})); return; }
  if (command === "block-agent") {
    allow(values, new Set(["--runs-dir", "--run-id", "--agent-id"]));
    blockAgentForInvalidAdmission({
      runsDir: required(values, "--runs-dir"),
      runId: required(values, "--run-id"),
      agentId: required(values, "--agent-id"),
    });
    write("blocked");
    return;
  }
  if (command === "admit-agent") {
    allow(values, new Set(["--runs-dir", "--active", "--cap"]));
    try {
      write(canAdmitAgent({
        runsDir: required(values, "--runs-dir"),
        active: integer(values, "--active"),
        cap: integer(values, "--cap"),
      }) ? "admitted" : "queued");
    } catch (error) {
      if (error instanceof ExclusiveFileClaimBusyError) { write("queued"); return; }
      throw error;
    }
    return;
  }
  throw new Error("usage: runner-concurrency-admission <admit-chain|wait-chain|wait-agent|admit-agent|block-agent> [options]");
}

function parseValues(argv: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]; const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--") || values.has(flag)) throw new Error(`Invalid concurrency argument: ${flag || ""}`);
    values.set(flag, value);
  }
  return values;
}
function allow(values: Map<string, string>, allowed: Set<string>): void { for (const key of values.keys()) if (!allowed.has(key)) throw new Error(`${key} is not valid for concurrency command.`); }
function required(values: Map<string, string>, flag: string): string { const value = values.get(flag); if (!value?.trim()) throw new Error(`Missing required concurrency argument: ${flag}`); return value; }
function integer(values: Map<string, string>, flag: string): number { const value = required(values, flag); if (!/^-?\d+$/.test(value)) throw new Error(`${flag} must be an integer.`); const parsed = Number(value); if (!Number.isSafeInteger(parsed)) throw new Error(`${flag} must be a safe integer.`); return parsed; }

if (typeof require !== "undefined" && require.main === module) {
  try { runConcurrencyAdmissionCli(process.argv.slice(2)); } catch (error) { console.error(`runner concurrency admission failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
}
