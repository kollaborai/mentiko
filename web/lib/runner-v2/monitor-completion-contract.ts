import { existsSync } from "node:fs";
import {
  agentField,
  chainRuntimeField,
  loadNormalizedChainDefinition,
  type ChainRecord,
} from "@/lib/runner-v2/chain-contract";
import { findRunnerCompletionEvent } from "@/lib/runner-v2/event-lifecycle";

export interface MonitorCompletionContractInput {
  chainPath: string;
  agentsDir: string;
  configProfilesDir: string;
  sessionName: string;
  configuredAgentId?: string;
}

export interface MonitorCompletionLookupInput extends MonitorCompletionContractInput {
  eventsDir: string;
  runId: string;
  agentId?: string;
}

function agentIds(chain: ChainRecord): string[] {
  return chain.agents.flatMap((agent) => typeof agent.id === "string" && agent.id ? [agent.id] : []);
}

function configuredAgent(chain: ChainRecord, configuredAgentId: string | undefined): string | undefined {
  if (!configuredAgentId) return undefined;
  const count = agentIds(chain).filter((id) => id === configuredAgentId).length;
  if (count !== 1) throw new Error(`Configured agent id '${configuredAgentId}' is not unique in chain definition`);
  return configuredAgentId;
}

/**
 * Resolve the monitored session to exactly one normalized chain agent. This is
 * deliberately a contract operation: shell callers do not read agent ids,
 * session prefixes, or chain config to make completion decisions.
 */
export function resolveMonitorCompletionAgent(input: MonitorCompletionContractInput): string {
  if (!existsSync(input.chainPath)) return "";
  const chain = loadNormalizedChainDefinition(input.chainPath, input.agentsDir);
  const explicit = configuredAgent(chain, input.configuredAgentId);
  if (explicit) return explicit;

  const chainPrefix = chainRuntimeField(chain, input.configProfilesDir, "session_prefix");
  const candidates = [input.sessionName];
  if (chainPrefix && input.sessionName.startsWith(`${chainPrefix}-`)) {
    candidates.push(input.sessionName.slice(chainPrefix.length + 1));
  }

  const exactMatches = agentIds(chain).filter((agentId) => {
    const sessionPrefix = agentField(chain, agentId, "session_prefix");
    return candidates.some((candidate) => candidate === agentId || (sessionPrefix !== "" && candidate === sessionPrefix));
  });
  const uniqueExact = [...new Set(exactMatches)];
  if (uniqueExact.length === 1) return uniqueExact[0];
  if (uniqueExact.length > 1) {
    throw new Error(`Session '${input.sessionName}' has ambiguous exact agent matches: ${uniqueExact.join(", ")}`);
  }

  const tokenMatches = agentIds(chain).filter((agentId) =>
    [input.sessionName, ...candidates].some((candidate) => `-${candidate}-`.includes(`-${agentId}-`)),
  );
  const uniqueToken = [...new Set(tokenMatches)];
  if (uniqueToken.length === 1) return uniqueToken[0];
  if (uniqueToken.length > 1) {
    throw new Error(`Session '${input.sessionName}' ambiguously matches agent ids: ${uniqueToken.join(", ")}`);
  }
  throw new Error(`Session '${input.sessionName}' does not uniquely identify a chain agent`);
}

export function monitorCompletionExpectedEvent(input: MonitorCompletionContractInput & { agentId?: string }): string {
  if (!existsSync(input.chainPath)) return "";
  const chain = loadNormalizedChainDefinition(input.chainPath, input.agentsDir);
  const agentId = input.agentId || resolveMonitorCompletionAgent(input);
  return agentField(chain, agentId, "emits");
}

/** Returns an absolute event path, or an empty string when no completion handoff exists. */
export function findMonitorCompletionEvent(input: MonitorCompletionLookupInput): string {
  if (!existsSync(input.chainPath)) return "";
  const chain = loadNormalizedChainDefinition(input.chainPath, input.agentsDir);
  const agentId = input.agentId || resolveMonitorCompletionAgent(input);
  const expectedEvent = agentField(chain, agentId, "emits");
  if (!expectedEvent) return "";
  return findRunnerCompletionEvent({
    eventsDir: input.eventsDir,
    runId: input.runId,
    expectedEvent,
    agentId,
    sessionName: input.sessionName,
    allAgentIds: agentIds(chain),
  }).match?.path || "";
}
