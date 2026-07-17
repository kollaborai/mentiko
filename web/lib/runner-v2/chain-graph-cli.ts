#!/usr/bin/env node

/**
 * Typed owner for `mentiko graph`. It accepts the same JSON5 input gate as
 * validation, resolves agent references, and renders a graph without creating
 * a run or entering the legacy chain-runner process.
 */
import config from "@/lib/config";
import { normalizeChainDefinition, validateNormalizedChainDefinition } from "@/lib/runner-v2/chain-contract";
import { readRawChainFile, validateNormalizedChain } from "@/lib/runner-v2/chain-validation-cli";

function usage(): string {
  return "usage: mentiko graph <chain.json>";
}

export function renderChainGraph(chainPath: string): string[] {
  const raw = readRawChainFile(chainPath);
  const validation = validateNormalizedChain(raw.value, true);
  if (validation.errors.length > 0) throw new Error(validation.errors.join("\n"));
  const chain = normalizeChainDefinition(raw.value, config.agentsDir);
  validateNormalizedChainDefinition(chain);
  const name = typeof chain.name === "string" && chain.name.trim() ? chain.name : "unnamed";
  const agents = chain.agents;
  const lines = ["", `  chain: ${name}`, `  agents: ${agents.length}`, "  graph:", "  ---"];
  for (const agent of agents) {
    const id = typeof agent.id === "string" && agent.id ? agent.id : "unnamed";
    const agentName = typeof agent.name === "string" && agent.name ? agent.name : id;
    const triggers = Array.isArray(agent.triggers) ? agent.triggers.filter((value): value is string => typeof value === "string") : [];
    const emits = typeof agent.emits === "string" ? agent.emits : "";
    lines.push(`  [${id}] ${agentName}`);
    lines.push(`    triggers: ${triggers.join(", ")}`);
    lines.push(`    emits:    ${emits}`);
    lines.push("");
  }
  return lines;
}

export function runChainGraphCli(argv: string[], write: (line: string) => void = (line) => console.log(line)): void {
  if (argv.length !== 1 || !argv[0] || argv[0].startsWith("--")) throw new Error(usage());
  for (const line of renderChainGraph(argv[0])) write(line);
}

if (require.main === module) {
  try {
    runChainGraphCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
