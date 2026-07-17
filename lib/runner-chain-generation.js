#!/usr/bin/env node
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
  const text = output.trim();
  if (!text) throw new Error("generated output was empty");
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
3. All agents must have: id, name, triggers (array), emits (string)
4. triggers can include: manual-start, or event names from other agents' emits
5. Create a sensible flow: agent A emits X, agent B triggers on X, emits Y, etc.
6. For review loops: make the reviewer emit either 'approved' or 'needs-revision'
   and make the first agent also trigger on 'needs-revision'
7. Default cli should be '\${DEFAULT_CLI}' (or user can override per agent)
8. Include inline prompts for each agent - keep them clear and actionable
9. Set max_rounds to 3 for chains with review loops
10. Set session_prefix to something short and descriptive

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
