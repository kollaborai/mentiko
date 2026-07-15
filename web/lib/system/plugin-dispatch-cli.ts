#!/usr/bin/env node
import { dispatchPlugins } from "@/lib/system/plugin-dispatch";

export function runPluginDispatchCli(argv: string[], write: (line: string) => void = (line) => console.log(line)): void {
  const [command, ...rest] = argv;
  if (command !== "dispatch") throw new Error(usage());
  const flags = parseFlags(rest);
  for (const key of flags.keys()) if (!new Set(["--namespace-id", "--org-id", "--event", "--chain-id", "--run-id", "--agent-id", "--data-json"]).has(key)) throw new Error(`${key} is not valid for plugin dispatch`);
  const dataJson = flags.get("--data-json") ?? "{}";
  let data: unknown;
  try { data = JSON.parse(dataJson); } catch { throw new Error("--data-json must be a JSON object"); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("--data-json must be a JSON object");
  write(JSON.stringify(dispatchPlugins({
    namespaceId: required(flags, "--namespace-id"),
    orgId: required(flags, "--org-id"),
    event: required(flags, "--event"),
    chainId: flags.get("--chain-id"),
    runId: flags.get("--run-id"),
    agentId: flags.get("--agent-id"),
    data: data as Record<string, unknown>,
  })));
}

function parseFlags(argv: string[]): Map<string, string> { const flags = new Map<string, string>(); for (let index = 0; index < argv.length; index += 2) { const key = argv[index]; const value = argv[index + 1]; if (!key?.startsWith("--") || value === undefined || flags.has(key)) throw new Error(usage()); flags.set(key, value); } return flags; }
function required(flags: Map<string, string>, key: string): string { const value = flags.get(key); if (!value) throw new Error(`${key} is required`); return value; }
function usage(): string { return "usage: runner-plugin-dispatch dispatch --namespace-id <id> --org-id <id> --event <event> [--chain-id <id> --run-id <id> --agent-id <id> --data-json <json>]"; }

if (require.main === module) {
  try { runPluginDispatchCli(process.argv.slice(2)); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
