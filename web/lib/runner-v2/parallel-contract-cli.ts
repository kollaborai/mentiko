#!/usr/bin/env node
import {
  createParallelGroup,
  recordParallelPid,
  recordParallelResult,
  cleanupParallelGroups,
} from "@/lib/runner-v2/parallel-contract";

function flag(values: Map<string, string>, name: string): string {
  const value = values.get(name);
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value;
}

function values(argv: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || result.has(key)) throw new Error("invalid parallel arguments");
    result.set(key, value);
  }
  return result;
}

function main(argv: string[]): void {
  const command = argv[0];
  const parsed = values(argv.slice(1));
  if (command === "create" || command === "create-id") {
    const agents = flag(parsed, "--agents").split(",").map((agent) => agent.trim()).filter(Boolean);
    const group = createParallelGroup(flag(parsed, "--state-dir"), agents);
    console.log(command === "create-id" ? group.id : JSON.stringify(group));
    return;
  }
  if (command === "pid") {
    const updated = recordParallelPid(flag(parsed, "--state-dir"), flag(parsed, "--id"), flag(parsed, "--agent"), safeInteger(flag(parsed, "--pid")));
    console.log(JSON.stringify(updated));
    return;
  }
  if (command === "result") {
    const updated = recordParallelResult(flag(parsed, "--state-dir"), flag(parsed, "--id"), flag(parsed, "--agent"), safeInteger(flag(parsed, "--exit")));
    console.log(JSON.stringify(updated));
    return;
  }
  if (command === "cleanup") {
    console.log(JSON.stringify(cleanupParallelGroups(flag(parsed, "--state-dir"), safeInteger(flag(parsed, "--days")))));
    return;
  }
  throw new Error("usage: runner-parallel-contract <create|create-id|pid|result|cleanup>");
}

function safeInteger(value: string): number {
  if (!/^-?\d+$/.test(value)) throw new Error(`expected integer, got ${value}`);
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(`integer is out of range: ${value}`);
  return result;
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
