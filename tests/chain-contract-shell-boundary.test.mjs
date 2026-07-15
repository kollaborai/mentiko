#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const runner = readFileSync(join(root, "lib", "chain-runner.sh"), "utf8");
const config = readFileSync(join(root, "lib", "config.sh"), "utf8");
const launchAgent = readFileSync(join(root, "lib", "launch-agent.sh"), "utf8");
const agentFunctions = readFileSync(join(root, "lib", "agent-functions.sh"), "utf8");
const monitorCompletion = readFileSync(join(root, "lib", "monitor-completion.sh"), "utf8");
const sessionLogResolver = readFileSync(join(root, "lib", "session-log-resolver.sh"), "utf8");

const directChainReads = [
  /jq(?! -nc)[^\n]*\$CHAIN_FILE/,
  /grep[^\n]*\$chain_file/,
  /resolve_chain_agent_refs/,
  /GATEWAYS_JSON/,
  /jq -n[\s\S]*profile_id/,
  /agent_profile_advisor_json/,
  /jq[^\n]*(advisor_json|monitor_advisor_json)/,
];
const shellContractConsumers = [runner, config, launchAgent, agentFunctions, monitorCompletion, sessionLogResolver];
for (const pattern of directChainReads) {
  if (shellContractConsumers.some((source) => pattern.test(source))) {
    throw new Error(`shell must not parse chain/config-profile data contracts: ${pattern}`);
  }
}
for (const pattern of [/agent_profile_(advisor|select|transcript)_json/, /jq[^\n]*(advisor_profile_json|profile_json)/]) {
  if (shellContractConsumers.some((source) => pattern.test(source))) {
    throw new Error(`shell must consume typed profile primitives instead of parsing profile JSON: ${pattern}`);
  }
}
if (!runner.includes('chain_contract_resolve "$CHAIN_FILE" "$AGENTS_DIR" "$CONFIG_PROFILES_DIR"')) throw new Error("runner must normalize through typed chain contract");
if (!config.includes("chain_contract_raw_field")) throw new Error("config.sh must delegate legacy chain_config to the typed boundary");
console.log("PASS: shell chain/profile boundary owns no chain JSON parsing");
