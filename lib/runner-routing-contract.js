#!/usr/bin/env node
// GENERATED FROM web/lib/runner-v2/routing-contract-cli.ts - DO NOT EDIT. Rebuild: node scripts/build-runner-bundles.mjs
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// lib/runner-v2/routing-contract-cli.ts
var routing_contract_cli_exports = {};
__export(routing_contract_cli_exports, {
  runRoutingContractCli: () => runRoutingContractCli
});
module.exports = __toCommonJS(routing_contract_cli_exports);

// lib/runner-v2/routing-contract.ts
var import_node_fs2 = require("node:fs");
var import_node_path = require("node:path");

// lib/runner-v2/chain-contract.ts
var import_node_fs = require("node:fs");
function asRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}
function readJson(path) {
  try {
    return JSON.parse((0, import_node_fs.readFileSync)(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read JSON ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function decodeRawChainDefinition(chainPath) {
  return asRecord(readJson(chainPath), "chain");
}

// lib/runner-v2/routing-contract.ts
function asRecord2(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}
function stringValue(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}
function integerValue(value, fallback = 0) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return fallback;
}
function requireChainPath(chainPath, chainDir) {
  const configuredRoot = (0, import_node_path.resolve)(chainDir);
  if ((0, import_node_fs2.lstatSync)(configuredRoot).isSymbolicLink()) throw new Error(`Configured chains directory must not be a symbolic link: ${chainDir}`);
  const candidate = (0, import_node_path.resolve)(chainPath);
  if (!candidate.startsWith(`${configuredRoot}${import_node_path.sep}`)) throw new Error(`Chain path escapes configured chains directory: ${chainPath}`);
  if ((0, import_node_fs2.lstatSync)(candidate).isSymbolicLink()) throw new Error(`Chain definition must not be a symbolic link: ${chainPath}`);
  const root = (0, import_node_fs2.realpathSync)(configuredRoot);
  const canonical = (0, import_node_fs2.realpathSync)(candidate);
  if (!canonical.startsWith(`${root}${import_node_path.sep}`)) throw new Error(`Chain definition resolves outside configured chains directory: ${chainPath}`);
}
function readRoutingChain(chainPath, chainDir) {
  requireChainPath(chainPath, chainDir);
  (0, import_node_fs2.readFileSync)(chainPath, "utf8");
  return decodeRawChainDefinition(chainPath);
}
function agents(chain) {
  if (!Array.isArray(chain.agents)) throw new Error("chain.agents must be an array");
  return chain.agents.map((agent, index) => asRecord2(agent, `chain.agents[${index}]`));
}
function agentFor(chain, agentId) {
  const agent = agents(chain).find((candidate) => candidate.id === agentId);
  if (!agent) throw new Error(`Agent not found: ${agentId}`);
  return agent;
}
function routingFor(chain) {
  if (chain.routing === void 0) return {};
  return asRecord2(chain.routing, "chain.routing");
}
function retryDelay(attempt, strategy = "exponential", initialDelay = 5, maxDelay = 300, multiplier = 2) {
  if (![attempt, initialDelay, maxDelay, multiplier].every(Number.isFinite) || attempt < 0 || initialDelay < 0 || maxDelay < 0) {
    throw new Error("Retry inputs must be finite non-negative numbers");
  }
  let delay = initialDelay;
  if (strategy === "exponential") delay = initialDelay * multiplier ** attempt;
  else if (strategy === "linear") delay = initialDelay * (attempt + 1);
  return Math.min(Math.trunc(delay), Math.trunc(maxDelay));
}
function branchParseLine(branchJson) {
  let value;
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
  const branch = value;
  if (branch.fan_out !== void 0) {
    if (!Array.isArray(branch.fan_out) || !branch.fan_out.every((agent) => typeof agent === "string")) throw new Error("fan_out must be an array of agent ids");
    const fanIn = stringValue(branch.fan_in);
    const waitFor = stringValue(branch.wait_for, "all");
    const quorum = integerValue(branch.quorum, 0);
    const onError = stringValue(branch.on_error);
    return `fanout:${branch.fan_out.join(" ")}|${fanIn}|${waitFor}|${quorum}|${onError}`;
  }
  if (branch.conditions !== void 0) {
    if (!Array.isArray(branch.conditions) || !branch.conditions.every((condition) => {
      if (!condition || typeof condition !== "object" || Array.isArray(condition)) return false;
      const record = condition;
      return typeof record.if === "string" && typeof record.then === "string";
    })) throw new Error("conditions must be an array of {if, then} records");
    return `conditional:${stringValue(branch.default)}`;
  }
  return "unknown:";
}
function errorHandlerFor(chainPath, chainDir, agentId, errorType = "error") {
  const chain = readRoutingChain(chainPath, chainDir);
  const agent = agentFor(chain, agentId);
  const routing = routingFor(chain);
  if (errorType === "timeout" && stringValue(agent.on_timeout)) return stringValue(agent.on_timeout);
  if (stringValue(agent.on_error)) return stringValue(agent.on_error);
  if (errorType === "timeout") return stringValue(routing.timeout_agent) || stringValue(routing.timeout_handler);
  return stringValue(routing.error_handler);
}
function timeoutConfigFor(chainPath, chainDir, agentId) {
  const chain = readRoutingChain(chainPath, chainDir);
  const agent = agentFor(chain, agentId);
  const routing = routingFor(chain);
  const config = chain.config === void 0 ? {} : asRecord2(chain.config, "chain.config");
  const configured = integerValue(agent.timeout, 0);
  const timeout = configured === -1 ? integerValue(routing.default_timeout, 0) : configured;
  const agentPrefix = stringValue(agent.session_prefix);
  const chainPrefix = stringValue(config.session_prefix);
  return { timeout, sessionPrefix: agentPrefix || (chainPrefix ? `${chainPrefix}-${agentId}` : agentId) };
}
function timeoutExceeded(chainPath, chainDir, agentId, startedAt, nowMs = Date.now()) {
  const { timeout } = timeoutConfigFor(chainPath, chainDir, agentId);
  if (timeout <= 0) return false;
  const startedMs = Date.parse(startedAt);
  if (!Number.isFinite(startedMs) || !Number.isFinite(nowMs)) return false;
  return nowMs - startedMs > timeout * 1e3;
}

// lib/runner-v2/routing-contract-cli.ts
function runRoutingContractCli(argv, write = (line) => console.log(line)) {
  const [command, ...rest] = argv;
  if (!isCommand(command)) throw new Error(usage());
  const values = parseValues(rest);
  switch (command) {
    case "retry-delay":
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--attempt", "--strategy", "--initial-delay", "--max-delay", "--multiplier"]));
      write(String(retryDelay(numberValue(values, "--attempt"), optional(values, "--strategy") || "exponential", numberValue(values, "--initial-delay", 5), numberValue(values, "--max-delay", 300), numberValue(values, "--multiplier", 2))));
      return;
    case "branch-parse":
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--branch-json"]));
      write(branchParseLine(required(values, "--branch-json")));
      return;
    case "error-handler": {
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--chain-path", "--chain-dir", "--agent-id", "--error-type"]));
      const type = optional(values, "--error-type") || "error";
      if (type !== "error" && type !== "timeout") throw new Error("--error-type must be error or timeout");
      write(errorHandlerFor(required(values, "--chain-path"), required(values, "--chain-dir"), required(values, "--agent-id"), type));
      return;
    }
    case "timeout-session-prefix": {
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--chain-path", "--chain-dir", "--agent-id"]));
      write(timeoutConfigFor(required(values, "--chain-path"), required(values, "--chain-dir"), required(values, "--agent-id")).sessionPrefix);
      return;
    }
    case "timeout-check":
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--chain-path", "--chain-dir", "--agent-id", "--started-at", "--now-ms"]));
      write(timeoutExceeded(required(values, "--chain-path"), required(values, "--chain-dir"), required(values, "--agent-id"), required(values, "--started-at"), numberValue(values, "--now-ms", Date.now())) ? "true" : "false");
      return;
  }
}
function parseValues(argv) {
  const values = /* @__PURE__ */ new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!key?.startsWith("--") || value === void 0 || values.has(key)) throw new Error(usage());
    values.set(key, value);
  }
  return values;
}
function required(values, key) {
  const value = values.get(key);
  if (!value) throw new Error(`${key} is required`);
  return value;
}
function optional(values, key) {
  return values.get(key);
}
function numberValue(values, key, fallback) {
  const value = optional(values, key);
  if (value === void 0 && fallback !== void 0) return fallback;
  if (value === void 0 || !/^-?(?:\d+|\d*\.\d+)$/.test(value)) throw new Error(`${key} must be a number`);
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`${key} must be finite`);
  return result;
}
function rejectUnexpected(values, allowed) {
  for (const key of values.keys()) if (!allowed.has(key)) throw new Error(`${key} is not valid for runner-routing-contract`);
}
function isCommand(value) {
  return value === "retry-delay" || value === "branch-parse" || value === "error-handler" || value === "timeout-session-prefix" || value === "timeout-check";
}
function usage() {
  return "usage: runner-routing-contract <retry-delay|branch-parse|error-handler|timeout-session-prefix|timeout-check> [options]";
}
if (require.main === module) {
  try {
    runRoutingContractCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runRoutingContractCli
});
