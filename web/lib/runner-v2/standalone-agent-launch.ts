import { existsSync, lstatSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import config, { ptyDaemonEnv } from "@/lib/config";
import { pty } from "@/lib/pty/pty-client";
import {
  createRunnerAgentState,
  runnerAgentStatePath,
  transitionRunnerAgentState,
} from "@/lib/runner-v2/agent-state";
import { readStandaloneAgentSpec, type StandaloneAgentSpec } from "@/lib/runner-v2/standalone-monitor";
import { writeLog } from "@/lib/system/system-logger";

export interface StandaloneAgentLaunchInput {
  specPath: string;
  monitor?: boolean;
  workspacePath?: string;
  cli?: string;
  monitorInterval?: number;
}

export interface StandaloneAgentLaunchResult {
  agent: StandaloneAgentSpec;
  sessionName: string;
  statePath: string;
  pid: number;
  monitorSession?: string;
}

export interface StandaloneAgentLaunchDependencies {
  pty: Pick<typeof pty, "spawn" | "sendKeys" | "sendRaw" | "remove">;
  now: () => Date;
  delay: (milliseconds: number) => Promise<void>;
  writeState: typeof createRunnerAgentState;
  transitionState: typeof transitionRunnerAgentState;
  writeLog: typeof writeLog;
  exists: (path: string) => boolean;
  lstat: typeof lstatSync;
  config: typeof config;
}

const defaultDependencies: StandaloneAgentLaunchDependencies = {
  pty,
  now: () => new Date(),
  delay: (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)),
  writeState: createRunnerAgentState,
  transitionState: transitionRunnerAgentState,
  writeLog,
  exists: existsSync,
  lstat: lstatSync,
  config,
};

/**
 * Launch a standalone agent spec without handing spec parsing, session naming,
 * prompt construction, state mutation, or monitor startup to shell. The only
 * process boundary left is the configured interactive agent CLI and the typed
 * monitor process itself, both intentionally hosted by pty-manager.
 */
export async function launchStandaloneAgent(
  input: StandaloneAgentLaunchInput,
  overrides: Partial<StandaloneAgentLaunchDependencies> = {},
): Promise<StandaloneAgentLaunchResult> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const specPath = resolve(input.specPath);
  const agent = readStandaloneAgentSpec(specPath);
  const workspacePath = resolve(input.workspacePath || dependencies.config.globalRoot);
  const cli = resolveStandaloneCli(input.cli, dependencies.config.cliBin);
  const sessionName = standaloneSessionName(dependencies.config.globalRoot, agent.sessionPrefix, dependencies.now());
  const statePath = runnerAgentStatePath(dependencies.config.stateDir, agent.sessionPrefix);

  const spawned = await dependencies.pty.spawn(sessionName, cli, [], {
    cwd: workspacePath,
    env: runtimePathEnv(dependencies.config),
  });
  const pid = spawned.pid;

  try {
    dependencies.writeState(statePath, {
      session: sessionName,
      agent_id: agent.sessionPrefix,
      pid: String(pid),
      workspace: "local",
      started: dependencies.now().toISOString(),
    });
  } catch (error) {
    await dependencies.pty.remove(sessionName);
    throw new Error(`standalone agent state could not be published: ${errorMessage(error)}`);
  }

  dependencies.writeLog(
    dependencies.config.namespaceId,
    dependencies.config.orgId,
    "info",
    "launch-agent",
    `session created: ${sessionName}`,
    `agent: ${agent.name}, cli: ${cli}`,
  );

  try {
    await dependencies.delay(3_000);
    await dependencies.pty.sendKeys(sessionName, standaloneAgentInstruction({ agent, specPath, workspacePath }));
    await dependencies.pty.sendRaw(sessionName, "\r");
    await dependencies.delay(1_000);
  } catch (error) {
    await rollbackStandaloneLaunch({ dependencies, statePath, sessionName, reason: `prompt delivery failed: ${errorMessage(error)}` });
    throw new Error(`standalone agent prompt could not be delivered: ${errorMessage(error)}`);
  }

  dependencies.writeLog(
    dependencies.config.namespaceId,
    dependencies.config.orgId,
    "info",
    "launch-agent",
    `prompt injected: ${sessionName}`,
    `agent: ${agent.name}, spec: ${specPath}`,
  );

  let monitorSession: string | undefined;
  if (input.monitor) {
    const interval = positiveInteger(input.monitorInterval ?? process.env.MENTIKO_MONITOR_INTERVAL, 60);
    const monitorRuntime = join(dependencies.config.libDir, "runner-v2-standalone-monitor.js");
    assertRegularFile(monitorRuntime, "typed standalone monitor runtime", dependencies.exists, dependencies.lstat);
    monitorSession = `monitor-${sessionName}`;
    try {
      await dependencies.pty.spawn(monitorSession, process.execPath, [
        monitorRuntime,
        "--session", sessionName,
        "--spec", specPath,
        "--interval", String(interval),
        "--workspace", workspacePath,
      ], {
        cwd: dependencies.config.codeRoot,
        env: runtimePathEnv(dependencies.config),
      });
    } catch (error) {
      await rollbackStandaloneLaunch({ dependencies, statePath, sessionName, reason: `monitor startup failed: ${errorMessage(error)}` });
      throw new Error(`standalone monitor could not be started: ${errorMessage(error)}`);
    }
  }

  return { agent, sessionName, statePath, pid, ...(monitorSession ? { monitorSession } : {}) };
}

export function standaloneSessionName(globalRoot: string, sessionPrefix: string, now: Date): string {
  const projectName = basename(resolve(globalRoot));
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  const time = [String(now.getHours()).padStart(2, "0"), String(now.getMinutes()).padStart(2, "0")].join("");
  return `${projectName}-${sessionPrefix}-${date}-${time}`;
}

export function standaloneAgentInstruction(input: {
  agent: StandaloneAgentSpec;
  specPath: string;
  workspacePath: string;
}): string {
  return [
    `You are an autonomous AI agent working for ${basename(input.workspacePath)}.`,
    "",
    `Your agent spec is at: ${input.specPath}`,
    "",
    "INSTRUCTIONS:",
    "1. Read your spec file first. It contains your identity, ownership, authorities, tools, playbooks, and success metrics.",
    "2. Read ALL files listed in your spec's 'read-first' context section.",
    "3. Follow your playbooks step by step.",
    "4. Write your deliverables to the exact file paths specified in your spec.",
    "5. When you complete all deliverables, follow your emit-completion-event playbook.",
    "6. If you hit a blocker, follow your escalation rules.",
    "",
    "IMPORTANT:",
    "- Stay within your authorities. Do not do things listed under needs-approval without flagging them.",
    "- Write deliverables as clean, professional documents.",
    `- You are working from: ${input.workspacePath}`,
    "",
    "Begin now. Read your spec and start working.",
  ].join("\n");
}

function runtimePathEnv(runtimeConfig: typeof config): Record<string, string> {
  return {
    ...ptyDaemonEnv(),
    MENTIKO_GLOBAL_ROOT: runtimeConfig.globalRoot,
    MENTIKO_CODE_ROOT: runtimeConfig.codeRoot,
    MENTIKO_NAMESPACE_ROOT: runtimeConfig.namespaceRoot,
    MENTIKO_ORG_ROOT: runtimeConfig.orgRoot,
    MENTIKO_PROJECT_ROOT: runtimeConfig.projectRoot,
    RUNS_DIR: runtimeConfig.runsDir,
    EVENTS_DIR: runtimeConfig.eventsDir,
    STATE_DIR: runtimeConfig.stateDir,
  };
}

async function rollbackStandaloneLaunch(input: {
  dependencies: StandaloneAgentLaunchDependencies;
  statePath: string;
  sessionName: string;
  reason: string;
}): Promise<void> {
  try {
    input.dependencies.transitionState(input.statePath, "blocked", input.reason);
  } catch {
    // The PTY must still be removed when durable state is already damaged.
  }
  await input.dependencies.pty.remove(input.sessionName);
}

function resolveStandaloneCli(value: string | undefined, configuredDefault: string): string {
  const cli = value || process.env.MENTIKO_CLI || process.env.DEFAULT_CLI || configuredDefault;
  if (!cli || /[\r\n\0]/.test(cli)) throw new Error("standalone agent CLI must be a non-empty executable path or command name");
  return cli;
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function assertRegularFile(
  path: string,
  label: string,
  exists: (candidate: string) => boolean,
  lstat: typeof lstatSync,
): void {
  if (!exists(path)) throw new Error(`${label} missing: ${path}`);
  const stat = lstat(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a non-symlink regular file: ${path}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
