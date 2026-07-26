#!/usr/bin/env node
// GENERATED FROM web/lib/runner-v2/teammux-bridge-cli.ts - DO NOT EDIT. Rebuild: node scripts/build-runner-bundles.mjs
"use strict";

// lib/runner-v2/teammux-bridge.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var MEMORY_TYPES = ["working", "semantic", "episodic"];
var SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function requiredString(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value;
}
function stringValue(value, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}
function readJson(path, label) {
  let raw;
  try {
    raw = (0, import_node_fs.readFileSync)(path, "utf8");
  } catch (error) {
    throw new Error(`Unable to read ${label} ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${label} ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) throw new Error(`${label} ${path} must contain a JSON object`);
  return parsed;
}
function assertDirectory(path, label) {
  let info;
  try {
    info = (0, import_node_fs.lstatSync)(path);
  } catch {
    throw new Error(`${label} not found: ${path}`);
  }
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${label} must be a directory: ${path}`);
}
function assertRegularFile(path, label) {
  let info;
  try {
    info = (0, import_node_fs.lstatSync)(path);
  } catch {
    throw new Error(`${label} not found: ${path}`);
  }
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`${label} must be a regular file: ${path}`);
}
function safeId(value, label) {
  if (!SAFE_ID.test(value)) throw new Error(`${label} is not a safe id: ${value}`);
  return value;
}
function safeChildPath(root, child, label) {
  const rootPath = (0, import_node_path.resolve)(root);
  const candidate = (0, import_node_path.resolve)(rootPath, child);
  if (candidate !== rootPath && !candidate.startsWith(`${rootPath}${import_node_path.sep}`)) {
    throw new Error(`${label} escapes its root: ${child}`);
  }
  return candidate;
}
function ensureDirectory(path, label) {
  if ((0, import_node_fs.existsSync)(path)) {
    assertDirectory(path, label);
    return;
  }
  (0, import_node_fs.mkdirSync)(path, { recursive: true, mode: 448 });
  assertDirectory(path, label);
}
function atomicWrite(path, data, mode, dependencies) {
  const directory = (0, import_node_path.dirname)(path);
  ensureDirectory(directory, "atomic write directory");
  const temp = (0, import_node_path.join)(directory, `.${(0, import_node_path.basename)(path)}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`);
  try {
    (0, import_node_fs.writeFileSync)(temp, data, { encoding: "utf8", mode });
    (0, import_node_fs.renameSync)(temp, path);
  } finally {
    try {
      (0, import_node_fs.rmSync)(temp, { force: true });
    } catch {
    }
  }
  dependencies.writeFile?.(path, data);
}
function readmeMetadata(readme) {
  const heading = readme.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();
  const role = readme.match(/^\*\*Role\*\*:\s*(.*?)\s*$/m)?.[1]?.trim() ?? readme.match(/^Role:\s*(.*?)\s*$/m)?.[1]?.trim();
  return { name: heading || "", role: role || "" };
}
function chainAgentFromSpec(agentPath) {
  assertDirectory(agentPath, "agent path");
  const agentId = safeId((0, import_node_path.basename)((0, import_node_path.resolve)(agentPath)), "agent id");
  const agentConfig = (0, import_node_path.join)(agentPath, "configurations", "agent-spec.json");
  const readme = (0, import_node_path.join)(agentPath, "README.md");
  let name = agentId;
  let role = "";
  let level = "team";
  let department = "";
  let readFirst = [];
  if ((0, import_node_fs.existsSync)(agentConfig)) {
    assertRegularFile(agentConfig, "agent spec");
    const spec = readJson(agentConfig, "agent spec");
    name = stringValue(spec.name ?? spec.agent_name, agentId);
    role = stringValue(spec.role ?? spec.description);
    level = stringValue(spec.level, "team");
    department = stringValue(spec.department);
    if ((0, import_node_fs.existsSync)(readme)) {
      assertRegularFile(readme, "agent README");
      readFirst = [readme];
    }
  } else if ((0, import_node_fs.existsSync)(readme)) {
    assertRegularFile(readme, "agent README");
    const metadata = readmeMetadata((0, import_node_fs.readFileSync)(readme, "utf8"));
    name = metadata.name || agentId;
    role = metadata.role;
    readFirst = [readme];
  } else {
    throw new Error(`No agent-spec.json or README.md found in ${agentPath}`);
  }
  const fullSpecPath = agentPath.endsWith(import_node_path.sep) ? agentPath : `${agentPath}${import_node_path.sep}`;
  const workspace = `workspace/${agentId}/`;
  return {
    id: agentId,
    name,
    role,
    triggers: ["manual-start"],
    emits: "complete",
    context: { read_first: readFirst.length ? readFirst : [`${agentPath}/README.md`], workspace },
    prompt: `You are ${name}, a ${level}-level agent in the ${department} department.

Read your full spec at: ${fullSpecPath}

Follow your procedures and playbooks from the README.md file.

When complete, write your event file and output AGENT_COMPLETE.`,
    authorities: { can: ["read project files", `write to ${workspace}`], needs_approval: [] }
  };
}
function importAgent(agentPath, write = console.log) {
  write(JSON.stringify(chainAgentFromSpec(agentPath), null, 2));
}
function chainAgents(chainPath) {
  assertRegularFile(chainPath, "chain file");
  const chain = readJson(chainPath, "chain file");
  if (!Array.isArray(chain.agents)) throw new Error("chain.agents must be an array");
  return chain.agents.map((agent, index) => {
    if (!isRecord(agent)) throw new Error(`chain.agents[${index}] must be an object`);
    return agent;
  });
}
function exportedReadme(agent) {
  const name = stringValue(agent.name, stringValue(agent.id, "Unnamed agent"));
  const role = stringValue(agent.role);
  const prompt = stringValue(agent.prompt);
  return `# ${name}

**Agent ID**: ${stringValue(agent.id)}
**Role**: ${role}

## Task
${prompt}

## Chain Context
This agent was exported from an mentiko definition.

## Memory Structure
- \`memory/working/\` - Current session memories
- \`memory/semantic/\` - Learned knowledge and procedures
- \`memory/episodic/\` - Historical events and outcomes

## Working Directories
- \`projects/active/\` - Current projects
- \`projects/completed/\` - Finished work
- \`projects/planned/\` - Planned projects
- \`knowledge/\` - Reference materials
- \`reports/\` - Output and deliverables
`;
}
function exportedAgentSpec(agent, chainPath, dependencies) {
  const now = (dependencies.now || (() => /* @__PURE__ */ new Date()))().toISOString();
  return `${JSON.stringify({
    name: stringValue(agent.name, stringValue(agent.id)),
    agent_id: stringValue(agent.id),
    role: stringValue(agent.role),
    level: "team",
    department: "chain-exported",
    created: now,
    source_chain: (0, import_node_path.basename)(chainPath)
  }, null, 2)}
`;
}
function exportChain(chainPath, outputDir = "./teammux-export", write = console.log, dependencies = {}) {
  const agents = chainAgents((0, import_node_path.resolve)(chainPath));
  const destination = (0, import_node_path.resolve)(outputDir);
  ensureDirectory(destination, "team-mux export directory");
  write(`  exporting ${agents.length} agents to ${outputDir}`);
  write("");
  for (const agent of agents) {
    const id = safeId(requiredString(agent.id, "agent id"), "agent id");
    const agentDir = safeChildPath(destination, id, "agent export path");
    const directories = [
      "memory/working",
      "memory/semantic",
      "memory/episodic",
      "projects/active",
      "projects/completed",
      "projects/planned",
      "knowledge",
      "reports",
      "inbox",
      "configurations",
      "documentation"
    ];
    ensureDirectory(agentDir, "agent export directory");
    for (const directory of directories) ensureDirectory(safeChildPath(agentDir, directory, "agent export directory"), "agent export directory");
    atomicWrite((0, import_node_path.join)(agentDir, "README.md"), exportedReadme(agent), 384, dependencies);
    atomicWrite((0, import_node_path.join)(agentDir, "configurations", "agent-spec.json"), exportedAgentSpec(agent, (0, import_node_path.resolve)(chainPath), dependencies), 384, dependencies);
    write(`  exported: ${id}`);
  }
  write("");
  write("  done. import to team-mux with:");
  write(`    cp -r ${outputDir}/* ~/.team_mux/agents/team/`);
}
function configuredTeamMuxRoot(dependencies = {}) {
  const env = dependencies.env || process.env;
  const explicit = env.TEAMMUX_LOCAL?.trim();
  if (explicit) {
    const root = (0, import_node_path.resolve)(explicit);
    assertDirectory(root, "TEAMMUX_LOCAL");
    return root;
  }
  const globalRoot = (0, import_node_path.resolve)(env.MENTIKO_GLOBAL_ROOT?.trim() || (0, import_node_path.join)(env.HOME || "", ".mentiko"));
  const local = (0, import_node_path.join)(globalRoot, ".team_mux");
  if ((0, import_node_fs.existsSync)(local)) {
    assertDirectory(local, "project team-mux directory");
    return local;
  }
  const global = (0, import_node_path.resolve)(env.TEAMMUX_GLOBAL?.trim() || (0, import_node_path.join)(env.HOME || "", ".team_mux"));
  assertDirectory(global, "team-mux directory");
  return global;
}
function findAgentDirectory(base, agentId) {
  const agentsRoot = (0, import_node_path.join)(base, "agents");
  assertDirectory(agentsRoot, "team-mux agents directory");
  const categories = (0, import_node_fs.readdirSync)(agentsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).sort((left, right) => left.name.localeCompare(right.name));
  for (const category of categories) {
    const candidate = (0, import_node_path.join)(agentsRoot, category.name, agentId);
    if (!(0, import_node_fs.existsSync)(candidate)) continue;
    try {
      assertDirectory(candidate, "team-mux agent directory");
      return candidate;
    } catch {
    }
  }
  throw new Error(`Agent '${agentId}' not found in team-mux`);
}
function memorySummary(record) {
  return {
    timestamp: stringValue(record.timestamp, "?"),
    summary: stringValue(record.activity_summary ?? record.summary, "no summary")
  };
}
function dumpMemory(memoryPath, label, write = console.log) {
  if (!(0, import_node_fs.existsSync)(memoryPath)) {
    write(`  ${label}: (not found)`);
    write("");
    return;
  }
  assertDirectory(memoryPath, `${label} directory`);
  write(`  ${label}:`);
  write("  ---");
  const memoryFiles = (0, import_node_fs.readdirSync)(memoryPath, { withFileTypes: true }).filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith(".json")).map((entry) => entry.name).sort();
  if (memoryFiles.length === 0) write("  (empty)");
  for (const file of memoryFiles) {
    const path = (0, import_node_path.join)(memoryPath, file);
    let summary;
    try {
      summary = memorySummary(readJson(path, "memory record"));
    } catch {
      summary = { timestamp: "?", summary: "error reading" };
    }
    write(`  [${summary.timestamp}] ${summary.summary}`);
  }
  write("");
}
function readMemory(agentId, memoryType = "all", write = console.log, dependencies = {}) {
  const id = safeId(requiredString(agentId, "agent id"), "agent id");
  if (!["working", "semantic", "episodic", "all"].includes(memoryType)) {
    throw new Error("memory_type must be: working, semantic, episodic, or all");
  }
  const agentDirectory = findAgentDirectory(configuredTeamMuxRoot(dependencies), id);
  const memoryRoot = (0, import_node_path.join)(agentDirectory, "memory");
  if (!(0, import_node_fs.existsSync)(memoryRoot)) {
    write(`  no memory directory found for ${id}`);
    return;
  }
  assertDirectory(memoryRoot, "memory directory");
  write(`  reading memory for: ${id}`);
  write("");
  const selected = memoryType === "all" ? MEMORY_TYPES : [memoryType];
  for (const type of selected) dumpMemory((0, import_node_path.join)(memoryRoot, type), `${type[0].toUpperCase()}${type.slice(1)} Memory`, write);
}
function showHelp(write = console.log) {
  write("");
  write("  team-mux-bridge - bridge mentiko and team-mux systems");
  write("");
  write("  commands:");
  write("    import <agent-path>              import team-mux agent as chain.json");
  write("    export <chain.json> [output]      export chain agents as team-mux specs");
  write("    memory <agent-id> [type]          read agent memory (working|semantic|episodic|all)");
  write("");
  write("  examples:");
  write("    team-mux-bridge.sh import .team_mux/agents/c-level/eric-cto");
  write("    team-mux-bridge.sh export examples/robin-engagement/chain.json ./tmux-specs");
  write("    team-mux-bridge.sh memory eric-cto working");
  write("");
}
function runTeamMuxBridgeCli(argv, write = console.log, dependencies = {}) {
  const [command, first, second] = argv;
  switch (command) {
    case "import":
      if (!first || second !== void 0) throw new Error("usage: team-mux-bridge.sh import <agent-path>");
      importAgent(first, write);
      return;
    case "export":
      if (!first || argv.length > 3) throw new Error("usage: team-mux-bridge.sh export <chain.json> [output-dir]");
      exportChain(first, second || "./teammux-export", write, dependencies);
      return;
    case "memory":
      if (!first || argv.length > 4) throw new Error("usage: team-mux-bridge.sh memory <agent-id> [type] [project-context]");
      readMemory(first, second || "all", write, dependencies);
      return;
    case "help":
    case "--help":
    case "-h":
    case void 0:
    case "":
      if (argv.length > 1) throw new Error("usage: team-mux-bridge.sh help");
      showHelp(write);
      return;
    default:
      showHelp(write);
      throw new Error(`unknown command: ${command}`);
  }
}

// lib/runner-v2/teammux-bridge-cli.ts
if (require.main === module) {
  try {
    runTeamMuxBridgeCli(process.argv.slice(2));
  } catch (error) {
    console.error(`team-mux bridge failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
