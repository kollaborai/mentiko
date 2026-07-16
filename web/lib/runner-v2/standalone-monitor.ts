import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import config from "@/lib/config";
import { createRunRecord, updateRunAgent, updateRunStatus } from "@/lib/runner-v2/run-state";
import { createRunRecordFile, type RunRecordPaths } from "@/lib/runs/run-record";

export interface StandaloneAgentSpec {
  name: string;
  role: string;
  sessionPrefix: string;
}

export interface StandaloneMonitorRun {
  runId: string;
  runDir: string;
  runJsonPath: string;
  chainPath: string;
  monitorStateDir: string;
  agent: StandaloneAgentSpec;
}

export interface CreateStandaloneMonitorRunInput {
  sessionName: string;
  specPath: string;
  interval: number;
  workspacePath?: string;
  runsDir?: string;
}

export interface StandaloneMonitorDependencies {
  /** Injectable only so the publication failure invariant has a deterministic regression test. */
  writeChainSnapshot?: (path: string, content: string) => void;
}

const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

/**
 * The former standalone launcher consumed only these top-level spec fields.
 * Keep that deliberately-small contract typed and explicit instead of treating
 * an arbitrary YAML document as a shell grep input.
 */
export function readStandaloneAgentSpec(specPath: string): StandaloneAgentSpec {
  const absolute = resolve(specPath);
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch {
    throw new Error(`standalone agent spec not found: ${absolute}`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`standalone agent spec must be a non-symlink regular file: ${absolute}`);
  }

  const fields = new Map<string, string>();
  for (const line of readFileSync(absolute, "utf8").split(/\r?\n/)) {
    const match = line.match(/^(name|role|session-prefix):[ \t]*(.*)$/);
    if (!match || fields.has(match[1])) continue;
    const value = unquoteScalar(match[2].trim());
    if (value) fields.set(match[1], value);
  }

  const sessionPrefix = fields.get("session-prefix") || "";
  if (!AGENT_ID_PATTERN.test(sessionPrefix)) {
    throw new Error("standalone agent spec requires a safe top-level session-prefix");
  }
  return {
    name: fields.get("name") || sessionPrefix,
    role: fields.get("role") || "standalone agent",
    sessionPrefix,
  };
}

/**
 * Gives a legacy spec-launched session the same durable identity as every
 * typed monitor: an exclusive run record plus a run-local chain snapshot.
 * The monitor state is intentionally run-local, never ~/.mentiko_monitor.
 */
export function createStandaloneMonitorRun(
  input: CreateStandaloneMonitorRunInput,
  dependencies: StandaloneMonitorDependencies = {},
): StandaloneMonitorRun {
  if (!input.sessionName || input.sessionName.trim().length > 240) {
    throw new Error("standalone monitor requires a session name up to 240 characters");
  }
  if (!Number.isInteger(input.interval) || input.interval <= 0) {
    throw new Error("standalone monitor interval must be a positive integer");
  }

  const agent = readStandaloneAgentSpec(input.specPath);
  const workspacePath = input.workspacePath ? resolve(input.workspacePath) : undefined;
  const chainName = `Standalone: ${agent.name}`;
  const record = {
    ...createRunRecord({ chainName, goal: `Monitor standalone agent ${agent.name}`, workspacePath }),
    chainId: `standalone-${agent.sessionPrefix}`,
    status: "running" as const,
    type: "standalone-agent",
    sessions: [input.sessionName],
    agents: [{
      id: agent.sessionPrefix,
      name: agent.name,
      session: input.sessionName,
      status: "running" as const,
      started: new Date().toISOString(),
    }],
    metadata: {
      launchMode: "standalone-spec",
      specFile: basename(resolve(input.specPath)),
      role: agent.role,
    },
  };
  const paths = createRunRecordFile(input.runsDir || config.runsDir, record);
  const chainPath = join(paths.runDir, "chain.json");
  try {
    const content = `${JSON.stringify(standaloneChain({ agent, workspacePath, interval: input.interval }), null, 2)}\n`;
    if (dependencies.writeChainSnapshot) dependencies.writeChainSnapshot(chainPath, content);
    else writeFileSync(chainPath, content, { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    const reason = `standalone monitor chain snapshot could not be published: ${error instanceof Error ? error.message : String(error)}`;
    // The run directory is already exclusively published. Preserve that evidence,
    // but make it terminal so the watcher/UI cannot mistake it for live work.
    try {
      updateRunAgent(paths.runJsonPath, agent.sessionPrefix, "blocked");
      updateRunStatus(paths.runJsonPath, "blocked", reason);
    } catch {
      // The original publication error remains the actionable failure. A second
      // filesystem fault is not a reason to invent a successful launch.
    }
    throw new Error(`standalone monitor run ${record.id} was blocked: ${reason}`);
  }
  return monitorRun(paths, record.id, chainPath, agent);
}

function monitorRun(paths: RunRecordPaths, runId: string, chainPath: string, agent: StandaloneAgentSpec): StandaloneMonitorRun {
  return {
    runId,
    runDir: paths.runDir,
    runJsonPath: paths.runJsonPath,
    chainPath,
    monitorStateDir: join(paths.runDir, "monitor"),
    agent,
  };
}

function standaloneChain(input: {
  agent: StandaloneAgentSpec;
  workspacePath?: string;
  interval: number;
}): Record<string, unknown> {
  return {
    id: `standalone-${input.agent.sessionPrefix}`,
    name: `Standalone: ${input.agent.name}`,
    description: "Typed monitor snapshot for a legacy standalone agent-spec launch.",
    config: {
      monitor: true,
      monitor_interval: input.interval,
      max_stale_count: 5,
      on_complete: "stop",
      ...(input.workspacePath ? { project_root: input.workspacePath } : {}),
    },
    agents: [{
      id: input.agent.sessionPrefix,
      name: input.agent.name,
      role: input.agent.role,
      session_prefix: input.agent.sessionPrefix,
      monitor: true,
      monitor_interval: input.interval,
      max_stale_count: 5,
      triggers: ["manual-start"],
      emits: "standalone-complete",
    }],
  };
}

function unquoteScalar(value: string): string {
  if (value.length >= 2 && ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1).trim();
  }
  return value.replace(/\s+#.*$/, "").trim();
}
