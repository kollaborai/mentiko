#!/usr/bin/env node
import { buildTypedCompletionContract } from "@/lib/runner-v2/completion-contract";

const FLAGS = new Set(["--agent-id", "--artifacts-dir", "--events-dir", "--run-id", "--emits", "--core-generation-chain"]);

export function runCompletionContractCli(
  argv: string[],
  write: (line: string) => void = (line) => console.log(line),
): void {
  if (argv[0] !== "build") throw new Error(usage());
  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || !value || !FLAGS.has(flag) || values.has(flag)) throw new Error(usage());
    values.set(flag, value);
  }

  const agentId = required(values, "--agent-id");
  const artifactsDir = required(values, "--artifacts-dir");
  const eventsDir = required(values, "--events-dir");
  write(buildTypedCompletionContract({
    agentId,
    artifactsDir,
    eventsDir,
    ...(values.get("--run-id") ? { runId: values.get("--run-id") } : {}),
    ...(values.get("--emits") ? { emits: values.get("--emits") } : {}),
    ...(values.get("--core-generation-chain") === "true" ? { coreGenerationChain: true } : {}),
  }));
}

function required(values: Map<string, string>, flag: string): string {
  const value = values.get(flag);
  if (!value) throw new Error(`${flag} is required.`);
  return value;
}

function usage(): string {
  return "usage: runner-completion-contract build --agent-id <id> --artifacts-dir <absolute-dir> --events-dir <absolute-dir> [--run-id <id>] [--emits <event>] [--core-generation-chain true|false]";
}

if (require.main === module) {
  try {
    runCompletionContractCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
