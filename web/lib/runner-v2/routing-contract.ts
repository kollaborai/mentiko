import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { decodeRawChainDefinition } from "@/lib/runner-v2/chain-contract";

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as RecordValue;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function integerValue(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return fallback;
}

function requireChainPath(chainPath: string, chainDir: string): void {
  const configuredRoot = resolve(chainDir);
  if (lstatSync(configuredRoot).isSymbolicLink()) throw new Error(`Configured chains directory must not be a symbolic link: ${chainDir}`);
  const candidate = resolve(chainPath);
  if (!candidate.startsWith(`${configuredRoot}${sep}`)) throw new Error(`Chain path escapes configured chains directory: ${chainPath}`);
  if (lstatSync(candidate).isSymbolicLink()) throw new Error(`Chain definition must not be a symbolic link: ${chainPath}`);
  const root = realpathSync(configuredRoot);
  const canonical = realpathSync(candidate);
  if (!canonical.startsWith(`${root}${sep}`)) throw new Error(`Chain definition resolves outside configured chains directory: ${chainPath}`);
}

function readRoutingChain(chainPath: string, chainDir: string): RecordValue {
  requireChainPath(chainPath, chainDir);
  readFileSync(chainPath, "utf8");
  return decodeRawChainDefinition(chainPath);
}

function agents(chain: RecordValue): RecordValue[] {
  if (!Array.isArray(chain.agents)) throw new Error("chain.agents must be an array");
  return chain.agents.map((agent, index) => asRecord(agent, `chain.agents[${index}]`));
}

function agentFor(chain: RecordValue, agentId: string): RecordValue {
  const agent = agents(chain).find((candidate) => candidate.id === agentId);
  if (!agent) throw new Error(`Agent not found: ${agentId}`);
  return agent;
}

function routingFor(chain: RecordValue): RecordValue {
  if (chain.routing === undefined) return {};
  return asRecord(chain.routing, "chain.routing");
}

export function retryDelay(attempt: number, strategy = "exponential", initialDelay = 5, maxDelay = 300, multiplier = 2): number {
  if (![attempt, initialDelay, maxDelay, multiplier].every(Number.isFinite) || attempt < 0 || initialDelay < 0 || maxDelay < 0) {
    throw new Error("Retry inputs must be finite non-negative numbers");
  }
  let delay = initialDelay;
  if (strategy === "exponential") delay = initialDelay * (multiplier ** attempt);
  else if (strategy === "linear") delay = initialDelay * (attempt + 1);
  return Math.min(Math.trunc(delay), Math.trunc(maxDelay));
}

export function branchParseLine(branchJson: string): string {
  let value: unknown;
  try {
    value = JSON.parse(branchJson);
  } catch {
    throw new Error("Branch definition must be valid JSON");
  }
  if (typeof value === "string") return `simple:${value}`;
  if (Array.isArray(value)) {
    if (!value.every((agent) => typeof agent === "string")) throw new Error("Parallel branch targets must be strings");
    return `parallel:${value.join(" ")}`;
  }
  if (!value || typeof value !== "object") return "unknown:";
  const branch = value as RecordValue;
  if (branch.fan_out !== undefined) {
    if (!Array.isArray(branch.fan_out) || !branch.fan_out.every((agent) => typeof agent === "string")) throw new Error("fan_out must be an array of agent ids");
    const fanIn = stringValue(branch.fan_in);
    const waitFor = stringValue(branch.wait_for, "all");
    const quorum = integerValue(branch.quorum, 0);
    const onError = stringValue(branch.on_error);
    return `fanout:${branch.fan_out.join(" ")}|${fanIn}|${waitFor}|${quorum}|${onError}`;
  }
  if (branch.conditions !== undefined) {
    if (!Array.isArray(branch.conditions) || !branch.conditions.every((condition) => {
      if (!condition || typeof condition !== "object" || Array.isArray(condition)) return false;
      const record = condition as RecordValue;
      return typeof record.if === "string" && typeof record.then === "string";
    })) throw new Error("conditions must be an array of {if, then} records");
    return `conditional:${stringValue(branch.default)}`;
  }
  return "unknown:";
}

export function errorHandlerFor(chainPath: string, chainDir: string, agentId: string, errorType: "error" | "timeout" = "error"): string {
  const chain = readRoutingChain(chainPath, chainDir);
  const agent = agentFor(chain, agentId);
  const routing = routingFor(chain);
  if (errorType === "timeout" && stringValue(agent.on_timeout)) return stringValue(agent.on_timeout);
  if (stringValue(agent.on_error)) return stringValue(agent.on_error);
  if (errorType === "timeout") return stringValue(routing.timeout_agent) || stringValue(routing.timeout_handler);
  return stringValue(routing.error_handler);
}

export function timeoutConfigFor(chainPath: string, chainDir: string, agentId: string): { timeout: number; sessionPrefix: string } {
  const chain = readRoutingChain(chainPath, chainDir);
  const agent = agentFor(chain, agentId);
  const routing = routingFor(chain);
  const config = chain.config === undefined ? {} : asRecord(chain.config, "chain.config");
  const configured = integerValue(agent.timeout, 0);
  const timeout = configured === -1 ? integerValue(routing.default_timeout, 0) : configured;
  const agentPrefix = stringValue(agent.session_prefix);
  const chainPrefix = stringValue(config.session_prefix);
  return { timeout, sessionPrefix: agentPrefix || (chainPrefix ? `${chainPrefix}-${agentId}` : agentId) };
}

export function timeoutExceeded(chainPath: string, chainDir: string, agentId: string, startedAt: string, nowMs = Date.now()): boolean {
  const { timeout } = timeoutConfigFor(chainPath, chainDir, agentId);
  if (timeout <= 0) return false;
  const startedMs = Date.parse(startedAt);
  if (!Number.isFinite(startedMs) || !Number.isFinite(nowMs)) return false;
  return nowMs - startedMs > timeout * 1000;
}
