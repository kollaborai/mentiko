#!/usr/bin/env node
// GENERATED FROM web/lib/runner-v2/chain-generation-cli.ts - DO NOT EDIT. Rebuild: node scripts/build-runner-bundles.mjs
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

// lib/runner-v2/chain-generation-cli.ts
var chain_generation_cli_exports = {};
__export(chain_generation_cli_exports, {
  extractGeneratedJson: () => extractGeneratedJson,
  generateChain: () => generateChain,
  renderResult: () => renderResult,
  runChainGenerationCli: () => runChainGenerationCli,
  validateGeneratedChain: () => validateGeneratedChain
});
module.exports = __toCommonJS(chain_generation_cli_exports);
var import_node_child_process = require("node:child_process");
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");

// lib/chains/generated-chain-delivery-contract.ts
var GENERATED_CHAIN_CONTRACT_SHAPE = '{"version":1,"mode":"delivery"|"operations"|"research","acceptance_criteria":"..."}';
function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function text(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function agentHasAuthority(agent, authority) {
  const authorities = agent.authorities;
  if (Array.isArray(authorities)) return authorities.includes(authority);
  const authorityRecord = record(authorities);
  return Array.isArray(authorityRecord?.can) && authorityRecord.can.includes(authority);
}
function readContract(chain) {
  const raw = record(record(chain.metadata)?.generated_chain_contract);
  if (!raw) {
    return {
      mode: null,
      errors: [`metadata.generated_chain_contract is required: ${GENERATED_CHAIN_CONTRACT_SHAPE}`]
    };
  }
  const errors = [];
  if (raw.version !== 1) {
    errors.push("metadata.generated_chain_contract.version must be 1");
  }
  const mode = raw.mode === "delivery" || raw.mode === "operations" || raw.mode === "research" ? raw.mode : null;
  if (!mode) {
    errors.push('metadata.generated_chain_contract.mode must be "delivery", "operations", or "research"');
  }
  if (!text(raw.acceptance_criteria)) {
    errors.push(
      "metadata.generated_chain_contract.acceptance_criteria must be a non-empty string -- that exact key, not acceptance_assertion or reusable_acceptance_assertion"
    );
  }
  return { mode, errors };
}
function validateGeneratedChainDeliveryContract(chain) {
  const source = record(chain);
  if (!source) return ["generated chain must be an object"];
  const { mode, errors } = readContract(source);
  if (!Array.isArray(source.agents) || source.agents.length === 0) {
    errors.push("generated chain requires at least one agent");
    return errors;
  }
  const agents = source.agents.map(record);
  agents.forEach((agent, index) => {
    if (!agent) {
      errors.push(`agents[${index}] must be an object`);
      return;
    }
    const isRefEntry = typeof agent.$ref === "string" && agent.$ref.trim().length > 0;
    const refHint = isRefEntry ? " alongside its $ref" : "";
    if (!text(agent.deliverable)) {
      errors.push(`agents[${index}].deliverable must name the concrete output this agent hands off${refHint}`);
    }
    if (!text(agent.verification)) {
      errors.push(`agents[${index}].verification must state how that output is checked${refHint}`);
    }
  });
  if (mode === "delivery" && !agents.some((agent) => agent && agentHasAuthority(agent, "edit_files"))) {
    errors.push("delivery generated chains require an agent with edit_files authority");
  }
  if (mode === "operations" && !agents.some((agent) => agent && agentHasAuthority(agent, "run_commands"))) {
    errors.push("operations generated chains require an agent with run_commands authority");
  }
  const finalAgent = agents.at(-1);
  if (!finalAgent || finalAgent.final_verifier !== true) {
    errors.push("the last generated-chain agent must declare final_verifier: true");
  } else {
    if (finalAgent.verifies_acceptance_criteria !== true) {
      errors.push("the final verifier must declare verifies_acceptance_criteria: true");
    }
    if (!text(finalAgent.success_assertion)) {
      errors.push("the final verifier must declare a success_assertion tied to the acceptance criteria");
    }
  }
  return errors;
}
var GeneratedChainContractError = class extends Error {
  constructor(errors) {
    super(`generated chain delivery contract invalid: ${errors.join("; ")}`);
    this.name = "GeneratedChainContractError";
  }
};
function assertValidGeneratedChainDeliveryContract(chain) {
  const errors = validateGeneratedChainDeliveryContract(chain);
  if (errors.length) {
    throw new GeneratedChainContractError(errors);
  }
}

// lib/runner-v2/chain-generation-cli.ts
var DEFAULT_DEPENDENCIES = {
  runExternalCli
};
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function extractGeneratedJson(output) {
  const text2 = output.trim();
  if (!text2) throw new Error("generated output was empty");
  for (let start = text2.indexOf("{"); start >= 0; start = text2.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text2.length; index += 1) {
      const character = text2[index];
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
      const candidate = text2.slice(start, index + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        break;
      }
    }
  }
  throw new Error("generated output was not a valid JSON object");
}
function validateGeneratedChain(value) {
  if (!isRecord(value)) throw new Error("generated chain must be a JSON object");
  if (!nonEmptyString(value.name)) throw new Error("missing required field: name");
  if (!Array.isArray(value.agents) || value.agents.length === 0) {
    throw new Error("chain must have at least 1 agent");
  }
  const agents = [];
  const ids = /* @__PURE__ */ new Set();
  for (const candidate of value.agents) {
    if (!isRecord(candidate)) {
      throw new Error("agent must be an object with id, name, triggers, and emits");
    }
    if (!nonEmptyString(candidate.id) || !nonEmptyString(candidate.name) || !Array.isArray(candidate.triggers) || !candidate.triggers.every(nonEmptyString) || !nonEmptyString(candidate.emits)) {
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
      emits: candidate.emits
    });
  }
  assertValidGeneratedChainDeliveryContract(value);
  return { ...value, name: value.name, agents };
}
function parseArguments(argv) {
  const prompt = argv[0];
  if (prompt === void 0) throw new Error(usage());
  const options = {
    prompt,
    outputDir: ".",
    jsonOutput: false,
    rawOutput: false
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--output":
        options.outputDir = argv[++index] ?? (() => {
          throw new Error("--output requires a directory");
        })();
        break;
      case "--template":
        options.templateFile = argv[++index] ?? (() => {
          throw new Error("--template requires a file");
        })();
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
function readOptionalText(path) {
  if (!path || !(0, import_node_fs.existsSync)(path)) return "";
  const stat = (0, import_node_fs.lstatSync)(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`reference file must be a non-symlink regular file: ${path}`);
  return (0, import_node_fs.readFileSync)(path, "utf8");
}
function buildGenerationPrompt(prompt, template, schema) {
  const templateContext = template ? `
REFERENCE TEMPLATE (use as pattern, adapt for new use case):
${template}` : "";
  const schemaContext = schema ? `
JSON SCHEMA (your output MUST match this structure):
${schema}` : "";
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
12. Include metadata.generated_chain_contract exactly as ${GENERATED_CHAIN_CONTRACT_SHAPE}. The assertion field is named acceptance_criteria; any other name for it is rejected. Use delivery for workspace file/code changes (requires edit_files \u2014 write_artifacts does not count, it only covers an agent's own generation handoff file), operations for command/API/MCP state mutations (requires run_commands), and research for evidence-only work. Running tests does not turn a code-writing task into operations.
13. The last agent must be a final verifier with final_verifier: true, verifies_acceptance_criteria: true, and a success_assertion tied to metadata.generated_chain_contract.acceptance_criteria. It must verify evidence, not merely report that agents ran.
14. Write every agent INLINE and complete: id, name, triggers, emits, prompt, authorities, deliverable, verification. Never emit a {"$ref": "agent-id"} catalog reference here, even if the REFERENCE TEMPLATE above uses one. This generator is standalone and has no agent registry to resolve a $ref against, so a reference would be validated as an agent that declares nothing and the chain would be rejected.

OUTPUT FORMAT:
Raw JSON only. No backticks, no 'json' label, nothing but the JSON object.`;
}
function runExternalCli(cli, prompt, environment) {
  if (!cli) throw new Error("DEFAULT_CLI is required; configure the external generation CLI");
  const result = (0, import_node_child_process.spawnSync)(cli, ["-p", prompt], {
    env: environment,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
  if (result.error) throw new Error(`generation CLI failed: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = typeof result.stderr === "string" ? result.stderr.trim() : "";
    throw new Error(`generation CLI exited with status ${result.status}${detail ? `: ${detail}` : ""}`);
  }
  return typeof result.stdout === "string" ? result.stdout : "";
}
function ensureDirectory(path) {
  (0, import_node_fs.mkdirSync)(path, { recursive: true });
  const stat = (0, import_node_fs.lstatSync)(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`output path must be a non-symlink directory: ${path}`);
}
function containedPath(root, child) {
  if ((0, import_node_path.isAbsolute)(child)) throw new Error(`agent spec path must stay within output directory: ${child}`);
  const candidate = (0, import_node_path.resolve)(root, child);
  const relativePath = (0, import_node_path.relative)((0, import_node_path.resolve)(root), candidate);
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${import_node_path.sep}`)) {
    throw new Error(`agent spec path must stay within output directory: ${child}`);
  }
  return candidate;
}
function writeChainArtifacts(outputDir, chain) {
  ensureDirectory(outputDir);
  const specsDir = (0, import_node_path.join)(outputDir, "specs");
  ensureDirectory(specsDir);
  const chainPath = (0, import_node_path.join)(outputDir, "chain.json");
  if ((0, import_node_fs.existsSync)(chainPath) && (0, import_node_fs.lstatSync)(chainPath).isSymbolicLink()) {
    throw new Error(`chain output must be a non-symlink file: ${chainPath}`);
  }
  const tempPath = `${chainPath}.${process.pid}.tmp`;
  if ((0, import_node_fs.existsSync)(tempPath) && (0, import_node_fs.lstatSync)(tempPath).isSymbolicLink()) {
    throw new Error(`chain temporary output must be a non-symlink file: ${tempPath}`);
  }
  (0, import_node_fs.writeFileSync)(tempPath, `${JSON.stringify(chain, null, 2)}
`, { mode: 384 });
  (0, import_node_fs.renameSync)(tempPath, chainPath);
  for (const agent of chain.agents) {
    if (!nonEmptyString(agent.spec)) continue;
    const specPath = containedPath(outputDir, agent.spec);
    if ((0, import_node_fs.existsSync)(specPath)) {
      if ((0, import_node_fs.lstatSync)(specPath).isSymbolicLink()) throw new Error(`agent spec must be a non-symlink file: ${specPath}`);
      continue;
    }
    ensureDirectory((0, import_node_path.dirname)(specPath));
    const spec = `# ${agent.name}

session-prefix: ${agent.id}

## Role
${typeof agent.role === "string" ? agent.role : ""}

## Task
${typeof agent.prompt === "string" ? agent.prompt : ""}

## Playbooks

### Deliverables
Write your outputs to the workspace specified in your chain config.

### Completion
When complete, emit your event and write AGENT_COMPLETE
`;
    (0, import_node_fs.writeFileSync)(specPath, spec, { mode: 384 });
  }
  return chainPath;
}
function generateChain(options, dependencies = DEFAULT_DEPENDENCIES, environment = process.env) {
  if (!options.prompt) throw new Error("prompt required");
  const cli = options.cli || environment.DEFAULT_CLI || "";
  if (!cli) throw new Error("DEFAULT_CLI is required; configure the external generation CLI");
  const schemaPath = options.schemaPath || (0, import_node_path.join)(__dirname, "schemas", "chain.schema.json");
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
function renderResult(result, options, write) {
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
function runChainGenerationCli(argv, write = (line) => console.log(line), error = (line) => console.error(line)) {
  let options;
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
function usage() {
  return 'usage: chain-generator.sh "<prompt>" [--output dir] [--template file] [--json] [--raw]';
}
if (require.main === module) runChainGenerationCli(process.argv.slice(2));
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  extractGeneratedJson,
  generateChain,
  renderResult,
  runChainGenerationCli,
  validateGeneratedChain
});
