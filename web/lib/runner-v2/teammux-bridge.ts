import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

/**
 * Typed boundary for the small interoperability contract between Mentiko and
 * team-mux.  The bridge's shell predecessor parsed these records with jq and
 * assembled JSON through heredocs.  This module owns the records and leaves
 * the shell entrypoint as an invocation-only process boundary.
 */

export type TeamMuxMemoryType = "working" | "semantic" | "episodic" | "all";

export interface TeamMuxAgentSpec {
  name?: unknown;
  agent_name?: unknown;
  agent_id?: unknown;
  role?: unknown;
  description?: unknown;
  level?: unknown;
  department?: unknown;
  [key: string]: unknown;
}

export interface TeamMuxMemoryRecord {
  timestamp?: unknown;
  activity_summary?: unknown;
  summary?: unknown;
  [key: string]: unknown;
}

export interface TeamMuxBridgeDependencies {
  env?: Partial<NodeJS.ProcessEnv>;
  now?: () => Date;
  writeFile?: (path: string, data: string) => void;
}

const MEMORY_TYPES: Array<Exclude<TeamMuxMemoryType, "all">> = ["working", "semantic", "episodic"];
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function stringValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function readJson(path: string, label: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`Unable to read ${label} ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${label} ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) throw new Error(`${label} ${path} must contain a JSON object`);
  return parsed;
}

function assertDirectory(path: string, label: string): void {
  let info;
  try {
    info = lstatSync(path);
  } catch {
    throw new Error(`${label} not found: ${path}`);
  }
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${label} must be a directory: ${path}`);
}

function assertRegularFile(path: string, label: string): void {
  let info;
  try {
    info = lstatSync(path);
  } catch {
    throw new Error(`${label} not found: ${path}`);
  }
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`${label} must be a regular file: ${path}`);
}

function safeId(value: string, label: string): string {
  if (!SAFE_ID.test(value)) throw new Error(`${label} is not a safe id: ${value}`);
  return value;
}

function safeChildPath(root: string, child: string, label: string): string {
  const rootPath = resolve(root);
  const candidate = resolve(rootPath, child);
  if (candidate !== rootPath && !candidate.startsWith(`${rootPath}${sep}`)) {
    throw new Error(`${label} escapes its root: ${child}`);
  }
  return candidate;
}

function ensureDirectory(path: string, label: string): void {
  if (existsSync(path)) {
    assertDirectory(path, label);
    return;
  }
  mkdirSync(path, { recursive: true, mode: 0o700 });
  assertDirectory(path, label);
}

function atomicWrite(path: string, data: string, mode: number, dependencies: TeamMuxBridgeDependencies): void {
  const directory = dirname(path);
  ensureDirectory(directory, "atomic write directory");
  const temp = join(directory, `.${basename(path)}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`);
  try {
    writeFileSync(temp, data, { encoding: "utf8", mode });
    renameSync(temp, path);
  } finally {
    try { rmSync(temp, { force: true }); } catch { /* best-effort cleanup of a private temp file */ }
  }
  dependencies.writeFile?.(path, data);
}

function readmeMetadata(readme: string): { name: string; role: string } {
  const heading = readme.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();
  const role = readme.match(/^\*\*Role\*\*:\s*(.*?)\s*$/m)?.[1]?.trim()
    ?? readme.match(/^Role:\s*(.*?)\s*$/m)?.[1]?.trim();
  return { name: heading || "", role: role || "" };
}

export function chainAgentFromSpec(agentPath: string): Record<string, unknown> {
  assertDirectory(agentPath, "agent path");
  const agentId = safeId(basename(resolve(agentPath)), "agent id");
  const agentConfig = join(agentPath, "configurations", "agent-spec.json");
  const readme = join(agentPath, "README.md");
  let name = agentId;
  let role = "";
  let level = "team";
  let department = "";
  let readFirst: string[] = [];

  if (existsSync(agentConfig)) {
    assertRegularFile(agentConfig, "agent spec");
    const spec = readJson(agentConfig, "agent spec") as TeamMuxAgentSpec;
    name = stringValue(spec.name ?? spec.agent_name, agentId);
    role = stringValue(spec.role ?? spec.description);
    level = stringValue(spec.level, "team");
    department = stringValue(spec.department);
    if (existsSync(readme)) {
      assertRegularFile(readme, "agent README");
      readFirst = [readme];
    }
  } else if (existsSync(readme)) {
    assertRegularFile(readme, "agent README");
    const metadata = readmeMetadata(readFileSync(readme, "utf8"));
    name = metadata.name || agentId;
    role = metadata.role;
    readFirst = [readme];
  } else {
    throw new Error(`No agent-spec.json or README.md found in ${agentPath}`);
  }

  const fullSpecPath = agentPath.endsWith(sep) ? agentPath : `${agentPath}${sep}`;
  const workspace = `workspace/${agentId}/`;
  return {
    id: agentId,
    name,
    role,
    triggers: ["manual-start"],
    emits: "complete",
    context: { read_first: readFirst.length ? readFirst : [`${agentPath}/README.md`], workspace },
    prompt: `You are ${name}, a ${level}-level agent in the ${department} department.\n\nRead your full spec at: ${fullSpecPath}\n\nFollow your procedures and playbooks from the README.md file.\n\nWhen complete, write your event file and output AGENT_COMPLETE.`,
    authorities: { can: ["read project files", `write to ${workspace}`], needs_approval: [] },
  };
}

export function importAgent(agentPath: string, write: (line: string) => void = console.log): void {
  write(JSON.stringify(chainAgentFromSpec(agentPath), null, 2));
}

function chainAgents(chainPath: string): Array<Record<string, unknown>> {
  assertRegularFile(chainPath, "chain file");
  const chain = readJson(chainPath, "chain file");
  if (!Array.isArray(chain.agents)) throw new Error("chain.agents must be an array");
  return chain.agents.map((agent, index) => {
    if (!isRecord(agent)) throw new Error(`chain.agents[${index}] must be an object`);
    return agent;
  });
}

function exportedReadme(agent: Record<string, unknown>): string {
  const name = stringValue(agent.name, stringValue(agent.id, "Unnamed agent"));
  const role = stringValue(agent.role);
  const prompt = stringValue(agent.prompt);
  return `# ${name}\n\n**Agent ID**: ${stringValue(agent.id)}\n**Role**: ${role}\n\n## Task\n${prompt}\n\n## Chain Context\nThis agent was exported from an mentiko definition.\n\n## Memory Structure\n- \`memory/working/\` - Current session memories\n- \`memory/semantic/\` - Learned knowledge and procedures\n- \`memory/episodic/\` - Historical events and outcomes\n\n## Working Directories\n- \`projects/active/\` - Current projects\n- \`projects/completed/\` - Finished work\n- \`projects/planned/\` - Planned projects\n- \`knowledge/\` - Reference materials\n- \`reports/\` - Output and deliverables\n`;
}

function exportedAgentSpec(agent: Record<string, unknown>, chainPath: string, dependencies: TeamMuxBridgeDependencies): string {
  const now = (dependencies.now || (() => new Date()))().toISOString();
  return `${JSON.stringify({
    name: stringValue(agent.name, stringValue(agent.id)),
    agent_id: stringValue(agent.id),
    role: stringValue(agent.role),
    level: "team",
    department: "chain-exported",
    created: now,
    source_chain: basename(chainPath),
  }, null, 2)}\n`;
}

export function exportChain(chainPath: string, outputDir = "./teammux-export", write: (line: string) => void = console.log, dependencies: TeamMuxBridgeDependencies = {}): void {
  const agents = chainAgents(resolve(chainPath));
  const destination = resolve(outputDir);
  ensureDirectory(destination, "team-mux export directory");
  write(`  exporting ${agents.length} agents to ${outputDir}`);
  write("");
  for (const agent of agents) {
    const id = safeId(requiredString(agent.id, "agent id"), "agent id");
    const agentDir = safeChildPath(destination, id, "agent export path");
    const directories = [
      "memory/working", "memory/semantic", "memory/episodic", "projects/active",
      "projects/completed", "projects/planned", "knowledge", "reports", "inbox",
      "configurations", "documentation",
    ];
    ensureDirectory(agentDir, "agent export directory");
    for (const directory of directories) ensureDirectory(safeChildPath(agentDir, directory, "agent export directory"), "agent export directory");
    atomicWrite(join(agentDir, "README.md"), exportedReadme(agent), 0o600, dependencies);
    atomicWrite(join(agentDir, "configurations", "agent-spec.json"), exportedAgentSpec(agent, resolve(chainPath), dependencies), 0o600, dependencies);
    write(`  exported: ${id}`);
  }
  write("");
  write("  done. import to team-mux with:");
  write(`    cp -r ${outputDir}/* ~/.team_mux/agents/team/`);
}

function configuredTeamMuxRoot(dependencies: TeamMuxBridgeDependencies = {}): string {
  const env = dependencies.env || process.env;
  const explicit = env.TEAMMUX_LOCAL?.trim();
  if (explicit) {
    const root = resolve(explicit);
    assertDirectory(root, "TEAMMUX_LOCAL");
    return root;
  }
  const globalRoot = resolve(env.MENTIKO_GLOBAL_ROOT?.trim() || join(env.HOME || "", ".mentiko"));
  const local = join(globalRoot, ".team_mux");
  if (existsSync(local)) {
    assertDirectory(local, "project team-mux directory");
    return local;
  }
  const global = resolve(env.TEAMMUX_GLOBAL?.trim() || join(env.HOME || "", ".team_mux"));
  assertDirectory(global, "team-mux directory");
  return global;
}

function findAgentDirectory(base: string, agentId: string): string {
  const agentsRoot = join(base, "agents");
  assertDirectory(agentsRoot, "team-mux agents directory");
  const categories = readdirSync(agentsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const category of categories) {
    const candidate = join(agentsRoot, category.name, agentId);
    if (!existsSync(candidate)) continue;
    try {
      assertDirectory(candidate, "team-mux agent directory");
      return candidate;
    } catch {
      // A malformed category entry must not be used as a contract source.
    }
  }
  throw new Error(`Agent '${agentId}' not found in team-mux`);
}

function memorySummary(record: TeamMuxMemoryRecord): { timestamp: string; summary: string } {
  return {
    timestamp: stringValue(record.timestamp, "?"),
    summary: stringValue(record.activity_summary ?? record.summary, "no summary"),
  };
}

export function dumpMemory(memoryPath: string, label: string, write: (line: string) => void = console.log): void {
  if (!existsSync(memoryPath)) {
    write(`  ${label}: (not found)`);
    write("");
    return;
  }
  assertDirectory(memoryPath, `${label} directory`);
  write(`  ${label}:`);
  write("  ---");
  const memoryFiles = readdirSync(memoryPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  if (memoryFiles.length === 0) write("  (empty)");
  for (const file of memoryFiles) {
    const path = join(memoryPath, file);
    let summary: { timestamp: string; summary: string };
    try {
      summary = memorySummary(readJson(path, "memory record") as TeamMuxMemoryRecord);
    } catch {
      summary = { timestamp: "?", summary: "error reading" };
    }
    write(`  [${summary.timestamp}] ${summary.summary}`);
  }
  write("");
}

export function readMemory(agentId: string, memoryType: TeamMuxMemoryType = "all", write: (line: string) => void = console.log, dependencies: TeamMuxBridgeDependencies = {}): void {
  const id = safeId(requiredString(agentId, "agent id"), "agent id");
  if (!["working", "semantic", "episodic", "all"].includes(memoryType)) {
    throw new Error("memory_type must be: working, semantic, episodic, or all");
  }
  const agentDirectory = findAgentDirectory(configuredTeamMuxRoot(dependencies), id);
  const memoryRoot = join(agentDirectory, "memory");
  if (!existsSync(memoryRoot)) {
    write(`  no memory directory found for ${id}`);
    return;
  }
  assertDirectory(memoryRoot, "memory directory");
  write(`  reading memory for: ${id}`);
  write("");
  const selected = memoryType === "all" ? MEMORY_TYPES : [memoryType];
  for (const type of selected) dumpMemory(join(memoryRoot, type), `${type[0].toUpperCase()}${type.slice(1)} Memory`, write);
}

export function showHelp(write: (line: string) => void = console.log): void {
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

export function runTeamMuxBridgeCli(
  argv: string[],
  write: (line: string) => void = console.log,
  dependencies: TeamMuxBridgeDependencies = {},
): void {
  const [command, first, second] = argv;
  switch (command) {
    case "import":
      if (!first || second !== undefined) throw new Error("usage: team-mux-bridge.sh import <agent-path>");
      importAgent(first, write);
      return;
    case "export":
      if (!first || argv.length > 3) throw new Error("usage: team-mux-bridge.sh export <chain.json> [output-dir]");
      exportChain(first, second || "./teammux-export", write, dependencies);
      return;
    case "memory":
      // The historical third project-context argument was informational and
      // never changed the selected memory root. Accept it while keeping root
      // resolution entirely typed and explicit.
      if (!first || argv.length > 4) throw new Error("usage: team-mux-bridge.sh memory <agent-id> [type] [project-context]");
      readMemory(first, (second || "all") as TeamMuxMemoryType, write, dependencies);
      return;
    case "help":
    case "--help":
    case "-h":
    case undefined:
    case "":
      if (argv.length > 1) throw new Error("usage: team-mux-bridge.sh help");
      showHelp(write);
      return;
    default:
      showHelp(write);
      throw new Error(`unknown command: ${command}`);
  }
}
