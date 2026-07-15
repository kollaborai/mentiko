#!/usr/bin/env node
import { isAbsolute } from "node:path";
import { runBatch } from "@/lib/runner-v2/batch-runner";

export async function runBatchRunnerCli(
  argv: string[],
  environment: NodeJS.ProcessEnv = process.env,
  write: (line: string) => void = (line) => console.log(line),
): Promise<void> {
  if (argv[0] !== "run") throw new Error("Usage: batch-runner run --batches-dir <path> --batch-id <id> --runs-dir <path> --chain-runner <path> --cwd <path>");
  const values = parseValues(argv.slice(1));
  const batchesDir = required(values, "--batches-dir");
  const batchId = required(values, "--batch-id");
  const runsDir = required(values, "--runs-dir");
  const chainRunnerPath = required(values, "--chain-runner");
  const cwd = required(values, "--cwd");
  for (const path of [batchesDir, runsDir, chainRunnerPath, cwd]) if (!isAbsolute(path)) throw new Error("Batch runner paths must be absolute.");
  const result = await runBatch({ batchesDir, batchId, runsDir, chainRunnerPath, cwd, env: environment });
  write(JSON.stringify({ id: result.id, status: result.status }));
  if (result.status !== "complete") process.exitCode = 1;
}

function parseValues(argv: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || values.has(key)) throw new Error("Invalid batch runner arguments.");
    values.set(key, value);
  }
  return values;
}

function required(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (!value) throw new Error(`Missing ${key}.`);
  return value;
}

if (require.main === module) {
  runBatchRunnerCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
