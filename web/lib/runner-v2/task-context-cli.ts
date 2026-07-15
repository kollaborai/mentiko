#!/usr/bin/env node

import { loadTaskContext, writeTaskContextEnv } from "@/lib/runner-v2/task-context";

const FLAGS = new Set([
  "--task-id",
  "--api-base",
  "--auth-token",
  "--namespace-id",
  "--org-id",
  "--env-file",
]);

interface ParsedArguments {
  command: "load";
  values: Map<string, string>;
}

function parseArguments(argv: string[]): ParsedArguments {
  if (argv[0] !== "load") throw new Error(usage());
  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || !FLAGS.has(flag) || value === undefined || values.has(flag)) throw new Error(usage());
    values.set(flag, value);
  }
  return { command: "load", values };
}

function required(values: Map<string, string>, flag: string): string {
  const value = values.get(flag);
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

function optional(values: Map<string, string>, flag: string, fallback = ""): string {
  return values.get(flag) || fallback;
}

export async function runRunnerTaskContextCli(
  argv: string[],
  write: (line: string) => void = (line) => console.log(line),
): Promise<void> {
  const parsed = parseArguments(argv);
  const result = await loadTaskContext({
    taskId: required(parsed.values, "--task-id"),
    apiBase: required(parsed.values, "--api-base"),
    authToken: optional(parsed.values, "--auth-token") || undefined,
    namespaceId: optional(parsed.values, "--namespace-id", "default"),
    orgId: optional(parsed.values, "--org-id", "default"),
  });
  writeTaskContextEnv(required(parsed.values, "--env-file"), result);
  write(JSON.stringify({ taskId: result.task.id, commentCount: result.comments.length }));
}

function usage(): string {
  return "usage: runner-task-context load --task-id <id> --api-base <url> --env-file <absolute-path> [--auth-token <token>] [--namespace-id <id>] [--org-id <id>]";
}

if (require.main === module) {
  runRunnerTaskContextCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(`runner task context failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
