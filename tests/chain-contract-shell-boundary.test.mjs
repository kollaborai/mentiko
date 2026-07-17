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
const routingLib = readFileSync(join(root, "lib", "routing-lib.sh"), "utf8");
const scheduler = readFileSync(join(root, "lib", "scheduler.sh"), "utf8");
const readiness = readFileSync(join(root, "lib", "cli-readiness.sh"), "utf8");
const enhancedReadiness = readFileSync(join(root, "lib", "cli-readiness-enhanced.sh"), "utf8");

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
if (/\bjq\b/.test(monitorCompletion)) throw new Error("monitor completion must consume typed chain/event primitives instead of jq");
if (!monitorCompletion.includes("runner-monitor-completion.js")) throw new Error("monitor completion must invoke the typed completion contract");
if (/chain_contract_|runner-event-lifecycle\.js/.test(monitorCompletion)) throw new Error("monitor completion must not assemble chain or event contract reads in shell");
for (const [name, source] of [["routing-lib", routingLib], ["scheduler", scheduler]]) {
  if (/\bjq\b|STATE_FILE|state\.json|\.status|\.lock|\.pid|\.history/.test(source)) {
    throw new Error(`${name} must delegate contract parsing and mutation to TypeScript`);
  }
}
if (!routingLib.includes("runner-routing-contract.js")) throw new Error("routing-lib must invoke the typed routing contract");
if (!scheduler.includes("runner-schedule-contract.js")) throw new Error("scheduler must invoke the typed schedule contract");
if (scheduler.includes('"$SCRIPT_DIR/chain-runner.sh"')) throw new Error("scheduler must not launch chains or own scheduled lifecycle transitions");
if (!scheduler.includes("typed background worker owns scheduled-chain execution")) throw new Error("scheduler must fail closed instead of restoring shell scheduling");
if (/\bjq\b|JSON\.parse/.test(readiness) || !readiness.includes("runner-readiness.js")) throw new Error("cli readiness must delegate profile parsing to the typed boundary");
if (/\bjq\b|JSON\.parse|grep -q|cli_readiness_json.*\|\|/.test(enhancedReadiness)) throw new Error("enhanced cli readiness must consume typed result fields without shell heuristics or fallbacks");
for (const pattern of [/agent_profile_(advisor|select|transcript)_json/, /jq[^\n]*(advisor_profile_json|profile_json)/]) {
  if (shellContractConsumers.some((source) => pattern.test(source))) {
    throw new Error(`shell must consume typed profile primitives instead of parsing profile JSON: ${pattern}`);
  }
}
if (!runner.includes('chain_contract_resolve "$CHAIN_FILE" "$AGENTS_DIR" "$CONFIG_PROFILES_DIR"')) throw new Error("runner must normalize through typed chain contract");
if (!config.includes("chain_contract_raw_field")) throw new Error("config.sh must delegate legacy chain_config to the typed boundary");
console.log("PASS: shell chain/profile boundary owns no chain JSON parsing");
