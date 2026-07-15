#!/usr/bin/env node
import {
  agentArray,
  agentArtifacts,
  agentAuthorities,
  agentField,
  agentProfileField,
  chainRuntimeField,
  decodeRawChainDefinition,
  firstAgentForEvent,
  gatewayEnv,
  gatewayField,
  loadNormalizedChainDefinition,
  materializeNormalizedChainDefinition,
  rawChainConfigField,
} from "@/lib/runner-v2/chain-contract";

type Command = "resolve" | "raw-field" | "chain-field" | "agent-field" | "agent-array" | "agent-authorities" | "agent-artifacts" | "agent-profile-field" | "gateway-field" | "gateway-env" | "agent-count" | "agent-ids" | "first-agent";

export function runRunnerChainContractCli(argv: string[], write: (line: string) => void = (line) => console.log(line)): void {
  const [command, ...rest] = argv;
  if (!isCommand(command)) throw new Error(usage());
  const values = parseValues(rest);
  const chainPath = required(values, "--chain-path");
  const agentsDir = required(values, "--agents-dir");
  const configProfilesDir = optional(values, "--config-profiles-dir") || "";
  if (command === "resolve") {
    rejectUnexpected(values, new Set(["--chain-path", "--agents-dir", "--config-profiles-dir"]));
    write(materializeNormalizedChainDefinition(chainPath, agentsDir));
    return;
  }
  if (command === "raw-field") {
    rejectUnexpected(values, new Set(["--chain-path", "--agents-dir", "--config-profiles-dir", "--field"]));
    write(rawChainConfigField(chainPath, required(values, "--field")));
    return;
  }
  // Workspace helpers are intentionally usable against a partial chain draft:
  // callers need to discover where to execute before the agent graph exists.
  const field = optional(values, "--field");
  const chain = command === "chain-field" && field?.startsWith("workspace.")
    ? { ...decodeRawChainDefinition(chainPath), agents: [] }
    : loadNormalizedChainDefinition(chainPath, agentsDir);
  switch (command) {
    case "chain-field":
      rejectUnexpected(values, new Set(["--chain-path", "--agents-dir", "--config-profiles-dir", "--field", "--cli-override"]));
      write(chainRuntimeField(chain, configProfilesDir, required(values, "--field"), optional(values, "--cli-override")));
      return;
    case "agent-field":
      rejectUnexpected(values, new Set(["--chain-path", "--agents-dir", "--config-profiles-dir", "--agent-id", "--field", "--default"]));
      write(agentField(chain, required(values, "--agent-id"), required(values, "--field"), optional(values, "--default") || ""));
      return;
    case "agent-array":
      rejectUnexpected(values, new Set(["--chain-path", "--agents-dir", "--config-profiles-dir", "--agent-id", "--field"]));
      agentArray(chain, required(values, "--agent-id"), required(values, "--field")).forEach(write);
      return;
    case "agent-authorities":
      rejectUnexpected(values, new Set(["--chain-path", "--agents-dir", "--config-profiles-dir", "--agent-id"]));
      agentAuthorities(chain, required(values, "--agent-id")).forEach(write);
      return;
    case "agent-artifacts": {
      rejectUnexpected(values, new Set(["--chain-path", "--agents-dir", "--config-profiles-dir", "--agent-id", "--direction"]));
      const direction = required(values, "--direction");
      if (direction !== "produces" && direction !== "consumes") throw new Error("--direction must be produces or consumes");
      agentArtifacts(chain, required(values, "--agent-id"), direction).forEach(write);
      return;
    }
    case "agent-profile-field":
      rejectUnexpected(values, new Set(["--chain-path", "--agents-dir", "--config-profiles-dir", "--agent-id", "--field"]));
      write(agentProfileField(chain, configProfilesDir, required(values, "--agent-id"), required(values, "--field")));
      return;
    case "gateway-field":
      rejectUnexpected(values, new Set(["--chain-path", "--agents-dir", "--config-profiles-dir", "--gateway", "--field"]));
      write(gatewayField(chain, required(values, "--gateway"), required(values, "--field")));
      return;
    case "gateway-env":
      rejectUnexpected(values, new Set(["--chain-path", "--agents-dir", "--config-profiles-dir", "--gateway"]));
      gatewayEnv(chain, required(values, "--gateway")).forEach(write);
      return;
    case "agent-count":
      rejectUnexpected(values, new Set(["--chain-path", "--agents-dir", "--config-profiles-dir"]));
      write(String(chain.agents.length));
      return;
    case "agent-ids":
      rejectUnexpected(values, new Set(["--chain-path", "--agents-dir", "--config-profiles-dir"]));
      chain.agents.map((agent) => stringId(agent)).forEach(write);
      return;
    case "first-agent":
      rejectUnexpected(values, new Set(["--chain-path", "--agents-dir", "--config-profiles-dir", "--event"]));
      write(firstAgentForEvent(chain, optional(values, "--event") || "manual-start") || stringId(chain.agents[0]));
      return;
  }
}

function stringId(agent: Record<string, unknown> | undefined): string {
  return typeof agent?.id === "string" ? agent.id : "";
}
function parseValues(argv: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]; const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || values.has(key)) throw new Error(usage());
    values.set(key, value);
  }
  return values;
}
function required(values: Map<string, string>, key: string): string { const value = values.get(key); if (!value) throw new Error(`${key} is required`); return value; }
function optional(values: Map<string, string>, key: string): string | undefined { return values.get(key); }
function rejectUnexpected(values: Map<string, string>, allowed: Set<string>): void { for (const key of values.keys()) if (!allowed.has(key)) throw new Error(`${key} is not valid for runner-chain-contract`); }
function isCommand(value: string | undefined): value is Command { return ["resolve", "raw-field", "chain-field", "agent-field", "agent-array", "agent-authorities", "agent-artifacts", "agent-profile-field", "gateway-field", "gateway-env", "agent-count", "agent-ids", "first-agent"].includes(value || ""); }
function usage(): string { return "usage: runner-chain-contract <resolve|raw-field|chain-field|agent-field|agent-array|agent-authorities|agent-artifacts|agent-profile-field|gateway-field|gateway-env|agent-count|agent-ids|first-agent> --chain-path <path> --agents-dir <path> [options]"; }

if (require.main === module) {
  try { runRunnerChainContractCli(process.argv.slice(2)); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
