#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync } from "node:fs";
import JSON5 from "json5";

type JsonRecord = Record<string, unknown>;

export interface RawChainFile {
  path: string;
  text: string;
  value: JsonRecord;
}

export interface ChainValidationReport {
  errors: string[];
  warnings: string[];
  lines: string[];
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Raw-file gate: rejects missing, linked, non-file, malformed, and non-object input. */
export function readRawChainFile(path: string): RawChainFile {
  if (!existsSync(path)) throw new Error(`file not found: ${path}`);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`chain file must be a non-symlink regular file: ${path}`);
  }

  const text = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    // validate.sh historically accepted JSON5 comments and trailing commas.
    parsed = JSON5.parse(text);
  } catch {
    throw new Error(`invalid JSON syntax in ${path}`);
  }
  if (!isRecord(parsed)) throw new Error(`chain definition must be an object: ${path}`);
  return { path, text, value: parsed };
}

function agentIds(agents: JsonRecord[]): string[] {
  return agents.flatMap((agent) => nonEmptyString(agent.id) ? [agent.id] : []);
}

function duplicateValues(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value).sort();
}

function agentHasRequiredFields(agent: unknown): agent is JsonRecord {
  return isRecord(agent)
    && nonEmptyString(agent.id)
    && nonEmptyString(agent.name)
    && Array.isArray(agent.triggers)
    && agent.triggers.every(nonEmptyString)
    && nonEmptyString(agent.emits);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(nonEmptyString) : [];
}

function objectAt(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

/** Normalized-record gate: only receives the raw parser's object result. */
export function validateNormalizedChain(raw: JsonRecord, strict: boolean): ChainValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!nonEmptyString(raw.name)) errors.push("missing required field: name");
  if (!Array.isArray(raw.agents) || raw.agents.length === 0) errors.push("no agents defined");

  const agents = Array.isArray(raw.agents) ? raw.agents.filter(isRecord) : [];
  const duplicateIds = duplicateValues(agentIds(agents));
  if (duplicateIds.length > 0) {
    errors.push(`duplicate agent IDs found:\n${duplicateIds.map((id) => `      ${id}`).join("\n")}`);
  }

  const invalidAgents = Array.isArray(raw.agents)
    ? raw.agents.filter((agent) => !agentHasRequiredFields(agent))
    : [];
  if (invalidAgents.length > 0) {
    const names = invalidAgents.map((agent) => isRecord(agent) && nonEmptyString(agent.id) ? agent.id : "unnamed");
    errors.push(`agents missing required fields (id, name, triggers, emits):\n${names.map((name) => `      ${name}`).join("\n")}`);
  }

  if (errors.length > 0) return { errors, warnings, lines: [] };

  const normalizedAgents = raw.agents as JsonRecord[];
  const lines = [
    "",
    "  schema valid",
    `  chain: ${raw.name}`,
    `    version: ${nonEmptyString(raw.version) ? raw.version : "1.0"}`,
    `    agents: ${normalizedAgents.length}`,
  ];
  if (nonEmptyString(raw.description)) lines.push(`    description: ${raw.description}`);

  if (!strict) return { errors, warnings, lines };

  const emitted = normalizedAgents.map((agent) => agent.emits as string);
  const triggers = normalizedAgents.flatMap((agent) => stringArray(agent.triggers));
  const unresolved = [...new Set(triggers.filter((trigger) => trigger !== "manual-start" && !emitted.includes(trigger)))].sort();
  const unused = [...new Set(emitted.filter((emit) => !triggers.includes(emit)))].sort();

  lines.push("", "running strict validation...");
  if (unresolved.length > 0) {
    warnings.push(`warning: triggers with no matching emits:\n${unresolved.map((trigger) => `      ${trigger}`).join("\n")}`);
  }
  if (unused.length > 0) {
    warnings.push(`warning: emits with no matching triggers:\n${unused.map((emit) => `      ${emit}`).join("\n")}`);
  }
  if (unresolved.length === 0 && unused.length === 0) lines.push("  all triggers resolved");

  lines.push("", "checking agent configuration...");
  const noPrompt = normalizedAgents
    .filter((agent) => !nonEmptyString(agent.prompt) && !nonEmptyString(agent.spec))
    .map((agent) => agent.id as string);
  if (noPrompt.length > 0) {
    warnings.push(`warning: agents without prompt or spec:\n${noPrompt.map((id) => `      ${id}`).join("\n")}`);
  }

  const config = objectAt(raw.config);
  const webhooks = objectAt(config?.webhooks);
  if (webhooks?.enabled === true && stringArray(webhooks.urls).length === 0) {
    warnings.push("warning: webhooks enabled but no URLs configured");
  }

  const workspace = objectAt(config?.workspace);
  if (workspace?.type === "ssh") {
    const ssh = objectAt(workspace.ssh);
    if (!nonEmptyString(ssh?.host) || !nonEmptyString(ssh?.user) || !nonEmptyString(ssh?.path)) {
      errors.push("ssh workspace requires host, user, and path");
    } else {
      lines.push("  ssh workspace config valid");
    }
  }
  if (workspace?.type === "docker") {
    const docker = objectAt(workspace.docker);
    if (!nonEmptyString(docker?.container) || !nonEmptyString(docker?.path)) {
      errors.push("docker workspace requires container and path");
    } else {
      lines.push("  docker workspace config valid");
    }
  }
  return { errors, warnings, lines };
}

export function validateChainFile(path: string, strict: boolean): ChainValidationReport {
  return validateNormalizedChain(readRawChainFile(path).value, strict);
}

export function runChainValidationCli(argv: string[], write: (line: string) => void = (line) => console.log(line)): void {
  const [path, strictFlag] = argv;
  if (!path) throw new Error("no chain file specified\n\nusage: mentiko validate <chain.json> [--strict]");
  const report = validateChainFile(path, strictFlag === "--strict");
  if (report.errors.length > 0) throw new Error(report.errors.join("\n"));
  write(`validating ${path}...`);
  report.lines.forEach(write);
  report.warnings.forEach(write);
  write("");
  write("validation complete");
}

if (require.main === module) {
  try {
    runChainValidationCli(process.argv.slice(2));
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
