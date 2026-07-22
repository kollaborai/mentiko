#!/usr/bin/env node

/**
 * Typed owner for the legacy `mentiko generate` contract.
 *
 * The external model CLI remains a process boundary. Everything around that
 * boundary — prompt construction, raw output decoding, normalized chain
 * validation, and chain/spec materialization — is deliberately typed here so
 * the shell entrypoint cannot become a second JSON parser or writer.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { assertValidGeneratedChainDeliveryContract } from "@/lib/chains/generated-chain-delivery-contract";

export interface ChainGeneratorOptions {
  prompt: string;
  outputDir: string;
  templateFile?: string;
  jsonOutput: boolean;
  rawOutput: boolean;
  cli?: string;
  schemaPath?: string;
}

export interface ChainGeneratorResult {
  chain: GeneratedChain;
  chainPath: string;
  agentCount: number;
  cli: string;
  generationPrompt: string;
}

export interface GeneratedAgent {
  id: string;
  name: string;
  triggers: string[];
  emits: string;
  [key: string]: unknown;
}

export interface GeneratedChain {
  name: string;
  agents: GeneratedAgent[];
  [key: string]: unknown;
}

export interface ChainGeneratorDependencies {
  runExternalCli?: (cli: string, prompt: string, environment: NodeJS.ProcessEnv) => string;
}

const DEFAULT_DEPENDENCIES: ChainGeneratorDependencies = {
  runExternalCli: runExternalCli,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Decode a JSON object from model output without line-oriented shell filters. */
export function extractGeneratedJson(output: string): unknown {
  const text = output.trim();
  if (!text) throw new Error("generated output was empty");

  // A model may wrap the object in a fenced block or a short explanation.
  // Scan balanced object candidates instead of truncating at the first `}`;
  // prompts and nested config values commonly contain braces.
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === "{") depth += 1;
      if (character !== "}") continue;
      depth -= 1;
      if (depth !== 0) continue;
      const candidate = text.slice(start, index + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        break;
      }
    }
  }

  throw new Error("generated output was not a valid JSON object");
}

/** Normalized-record gate for generated chain definitions. */
export function validateGeneratedChain(value: unknown): GeneratedChain {
  if (!isRecord(value)) throw new Error("generated chain must be a JSON object");
  if (!nonEmptyString(value.name)) throw new Error("missing required field: name");
  if (!Array.isArray(value.agents) || value.agents.length === 0) {
    throw new Error("chain must have at least 1 agent");
  }

  const agents: GeneratedAgent[] = [];
  const ids = new Set<string>();
  for (const candidate of value.agents) {
    if (!isRecord(candidate)) {
      throw new Error("agent must be an object with id, name, triggers, and emits");
    }
    if (!nonEmptyString(candidate.id) || !nonEmptyString(candidate.name)
      || !Array.isArray(candidate.triggers)
      || !candidate.triggers.every(nonEmptyString)
      || !nonEmptyString(candidate.emits)) {
      const id = nonEmptyString(candidate.id) ? candidate.id : "unnamed";
      throw new Error(`agent ${id} is missing required fields (id, name, triggers, emits)`);
    }
    if (ids.has(candidate.id)) throw new Error(`duplicate agent id: ${candidate.id}`);
    ids.add(candidate.id);
    agents.push({
      ...candidate,
      id: candidate.id,
      name: candidate.name,
      triggers: [...candidate.triggers],
      emits: candidate.emits,
    });
  }

  assertValidGeneratedChainDeliveryContract(value);

  return { ...value, name: value.name, agents };
}

function parseArguments(argv: string[]): ChainGeneratorOptions {
  const prompt = argv[0];
  if (prompt === undefined) throw new Error(usage());

  const options: ChainGeneratorOptions = {
    prompt,
    outputDir: ".",
    jsonOutput: false,
    rawOutput: false,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--output":
        options.outputDir = argv[++index] ?? (() => { throw new Error("--output requires a directory"); })();
        break;
      case "--template":
        options.templateFile = argv[++index] ?? (() => { throw new Error("--template requires a file"); })();
        break;
      case "--json":
        options.jsonOutput = true;
        break;
      case "--raw":
        options.rawOutput = true;
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }
  return options;
}

function readOptionalText(path: string | undefined): string {
  if (!path || !existsSync(path)) return "";
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`reference file must be a non-symlink regular file: ${path}`);
  return readFileSync(path, "utf8");
}

function buildGenerationPrompt(prompt: string, template: string, schema: string): string {
  const templateContext = template
    ? `\nREFERENCE TEMPLATE (use as pattern, adapt for new use case):\n${template}`
    : "";
  const schemaContext = schema
    ? `\nJSON SCHEMA (your output MUST match this structure):\n${schema}`
    : "";
  return `You are an AI chain generator. Generate a valid mentiko chain.json file from the user's request.

USER REQUEST:
${prompt}
${templateContext}
${schemaContext}

REQUIREMENTS:
1. Output ONLY a valid JSON object. No markdown, no explanation, no code blocks.
2. The JSON must be valid according to the schema above.
3. All agents must have: id, name, triggers (array), emits (one string), deliverable (concrete output), and verification (repeatable check)
4. triggers can include: manual-start, or event names from other agents' emits
5. Create a sensible flow: agent A emits X, agent B triggers on X, emits Y, etc.
6. Each agent declares exactly one emitted event. Do not invent multi-outcome events
   in prompt prose or branches. A verifier emits its declared success event only
   when evidence passes; otherwise it fails with repair guidance.
7. Default cli should be '\${DEFAULT_CLI}' (or user can override per agent)
8. Include inline prompts for each agent - keep them clear and actionable
9. Keep max_rounds at 1 unless a runtime-supported repeat pattern is explicitly required
10. Set session_prefix to something short and descriptive
11. Generate a reusable mechanism. Read target IDs, paths, commands, and criteria from runtime task context; never persist current task IDs, absolute workspace paths, fixed ports, or one-run artifact paths as constants.
12. Include metadata.generated_chain_contract exactly as {"version":1,"mode":"delivery"|"operations"|"research","acceptance_criteria":"..."}. Use delivery for workspace file/code changes (requires edit_files), operations for command/API/MCP state mutations (requires run_commands), and research for evidence-only work. Running tests does not turn a code-writing task into operations.
13. The last agent must be a final verifier with final_verifier: true, verifies_acceptance_criteria: true, and a success_assertion tied to metadata.generated_chain_contract.acceptance_criteria. It must verify evidence, not merely report that agents ran.

OUTPUT FORMAT:
Raw JSON only. No backticks, no 'json' label, nothing but the JSON object.`;
}

function runExternalCli(cli: string, prompt: string, environment: NodeJS.ProcessEnv): string {
  if (!cli) throw new Error("DEFAULT_CLI is required; configure the external generation CLI");
  const result = spawnSync(cli, ["-p", prompt], {
    env: environment,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw new Error(`generation CLI failed: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = typeof result.stderr === "string" ? result.stderr.trim() : "";
    throw new Error(`generation CLI exited with status ${result.status}${detail ? `: ${detail}` : ""}`);
  }
  return typeof result.stdout === "string" ? result.stdout : "";
}

function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`output path must be a non-symlink directory: ${path}`);
}

function containedPath(root: string, child: string): string {
  if (isAbsolute(child)) throw new Error(`agent spec path must stay within output directory: ${child}`);
  const candidate = resolve(root, child);
  const relativePath = relative(resolve(root), candidate);
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    throw new Error(`agent spec path must stay within output directory: ${child}`);
  }
  return candidate;
}

function writeChainArtifacts(outputDir: string, chain: GeneratedChain): string {
  ensureDirectory(outputDir);
  const specsDir = join(outputDir, "specs");
  ensureDirectory(specsDir);
  const chainPath = join(outputDir, "chain.json");
  if (existsSync(chainPath) && lstatSync(chainPath).isSymbolicLink()) {
    throw new Error(`chain output must be a non-symlink file: ${chainPath}`);
  }
  const tempPath = `${chainPath}.${process.pid}.tmp`;
  if (existsSync(tempPath) && lstatSync(tempPath).isSymbolicLink()) {
    throw new Error(`chain temporary output must be a non-symlink file: ${tempPath}`);
  }
  writeFileSync(tempPath, `${JSON.stringify(chain, null, 2)}\n`, { mode: 0o600 });
  renameSync(tempPath, chainPath);

  for (const agent of chain.agents) {
    if (!nonEmptyString(agent.spec)) continue;
    const specPath = containedPath(outputDir, agent.spec);
    if (existsSync(specPath)) {
      if (lstatSync(specPath).isSymbolicLink()) throw new Error(`agent spec must be a non-symlink file: ${specPath}`);
      continue;
    }
    ensureDirectory(dirname(specPath));
    const spec = `# ${agent.name}\n\nsession-prefix: ${agent.id}\n\n## Role\n${typeof agent.role === "string" ? agent.role : ""}\n\n## Task\n${typeof agent.prompt === "string" ? agent.prompt : ""}\n\n## Playbooks\n\n### Deliverables\nWrite your outputs to the workspace specified in your chain config.\n\n### Completion\nWhen complete, emit your event and write AGENT_COMPLETE\n`;
    writeFileSync(specPath, spec, { mode: 0o600 });
  }
  return chainPath;
}

export function generateChain(
  options: ChainGeneratorOptions,
  dependencies: ChainGeneratorDependencies = DEFAULT_DEPENDENCIES,
  environment: NodeJS.ProcessEnv = process.env,
): ChainGeneratorResult {
  if (!options.prompt) throw new Error("prompt required");
  const cli = options.cli || environment.DEFAULT_CLI || "";
  if (!cli) throw new Error("DEFAULT_CLI is required; configure the external generation CLI");
  const schemaPath = options.schemaPath || join(__dirname, "schemas", "chain.schema.json");
  const template = readOptionalText(options.templateFile);
  const schema = readOptionalText(schemaPath);
  const generationPrompt = buildGenerationPrompt(options.prompt, template, schema);
  const runCli = dependencies.runExternalCli || runExternalCli;
  const childEnvironment = { ...environment };
  delete childEnvironment.CLAUDECODE;
  const rawOutput = runCli(cli, generationPrompt, childEnvironment);
  const chain = validateGeneratedChain(extractGeneratedJson(rawOutput));
  const chainPath = writeChainArtifacts(options.outputDir, chain);
  return { chain, chainPath, agentCount: chain.agents.length, cli, generationPrompt };
}

export function renderResult(result: ChainGeneratorResult, options: Pick<ChainGeneratorOptions, "jsonOutput" | "rawOutput">, write: (line: string) => void): void {
  const serialized = JSON.stringify(result.chain, null, 2);
  if (options.rawOutput) {
    write(serialized);
    return;
  }
  if (options.jsonOutput) {
    write(serialized);
    return;
  }
  write(`  chain generated: ${result.chain.name}`);
  write(`  agents: ${result.agentCount}`);
  write(`  file: ${result.chainPath}`);
  write("");
  write("  chain graph:");
  write("  ---");
  for (const agent of result.chain.agents) {
    write(`  [${agent.id}] ${agent.name}`);
    write(`    triggers: ${agent.triggers.join(", ")}`);
    write(`    emits:    ${agent.emits}`);
    write("");
  }
  write(`  next: mentiko validate ${result.chainPath}`);
  write(`       mentiko run ${result.chainPath}`);
}

export function runChainGenerationCli(
  argv: string[],
  write: (line: string) => void = (line) => console.log(line),
  error: (line: string) => void = (line) => console.error(line)
): void {
  let options: ChainGeneratorOptions;
  try {
    options = parseArguments(argv);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    if (argv.includes("--json")) write(JSON.stringify({ error: message, usage: usage() }));
    else if (argv.length === 0) write(message);
    else error(message);
    process.exitCode = 1;
    return;
  }
  if (!options.prompt) {
    const payload = { error: "prompt required", usage: usage() };
    if (options.jsonOutput) write(JSON.stringify(payload));
    else error(usage());
    process.exitCode = 1;
    return;
  }
  if (options.jsonOutput && !options.rawOutput) write(JSON.stringify({ status: "generating", prompt: options.prompt }));
  else if (!options.rawOutput && !options.jsonOutput) {
    write("  generating chain from prompt...");
    write(`  prompt: ${options.prompt}`);
    write(`  cli: ${options.cli || process.env.DEFAULT_CLI || ""}`);
    write("");
  }
  try {
    const result = generateChain(options);
    renderResult(result, options, write);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    if (options.jsonOutput) write(JSON.stringify({ error: message }));
    else error(`  error: ${message}`);
    process.exitCode = 1;
  }
}

function usage(): string {
  return 'usage: chain-generator.sh "<prompt>" [--output dir] [--template file] [--json] [--raw]';
}

if (require.main === module) runChainGenerationCli(process.argv.slice(2));
