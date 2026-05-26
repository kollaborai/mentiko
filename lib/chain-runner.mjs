#!/usr/bin/env node
/**
 * chain-runner.mjs - JavaScript chain runner (coexists with bash version)
 *
 * Native async/await replacement for chain-runner.sh.
 * Uses PtyManager directly -- no sleep loops, native async.
 *
 * Features:
 *   - reads chain.json, resolves triggers, spawns agents
 *   - waitFor completion patterns instead of polling
 *   - JSONL session logging for replay
 *   - writes run.json + state files (same format as bash)
 *   - supports sequential + parallel agent execution
 *
 * Usage:
 *   node lib/chain-runner.mjs <chain-path> [--task <id>] [--goal "text"] [--dry-run]
 *
 * Environment:
 *   MENTIKO_GLOBAL_ROOT  data root (~/.mentiko)
 *   NAMESPACE_ID         namespace (default: "default")
 *   ORG_ID               org id (default: "default")
 *   MENTIKO_PROJECT_ROOT project data dir (auto-resolved from org)
 *   AGENT_CHAIN_RUN_ID   reuse existing run-id
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { PtyManager } from "./pty-manager.mjs";
import { buildPtyAiGatewayAgentEnv } from "./ai-gateway-agent-env.mjs";

import { homedir } from "node:os";

// 3-tier data hierarchy: global > namespace > org > project
// env vars set by web app; fallback to defaults for CLI use
const MENTIKO_GLOBAL_ROOT = process.env.MENTIKO_GLOBAL_ROOT || process.env.MENTIKO_ROOT || join(homedir(), '.mentiko');
const NAMESPACE_ID = process.env.NAMESPACE_ID || 'default';
const ORG_ID = process.env.ORG_ID || 'default';

// Collapse logic: default org collapses into namespace root
// If MENTIKO_ORG_ROOT is provided, it's already collapsed by the caller
let ORG_ROOT = process.env.MENTIKO_ORG_ROOT;
if (!ORG_ROOT) {
  const namespaceRoot = join(MENTIKO_GLOBAL_ROOT, 'namespaces', NAMESPACE_ID);
  if (ORG_ID === 'default') {
    // default org collapses into namespace root
    ORG_ROOT = namespaceRoot;
  } else {
    ORG_ROOT = join(namespaceRoot, 'orgs', ORG_ID);
  }
}

// Collapse logic: default project (code root) collapses into org root
// If MENTIKO_PROJECT_ROOT is provided, it's already collapsed by the caller
const codeRoot = resolve(fileURLToPath(import.meta.url), '..');
let PROJECT_ROOT = process.env.MENTIKO_PROJECT_ROOT;
if (!PROJECT_ROOT) {
  // For CLI use, project root = code root (this git checkout)
  // This collapses into org root
  PROJECT_ROOT = ORG_ROOT;
}

// ─── paths ──────────────────────────────────────────────────────────

function paths() {
  // org-level: shared chains, agents, profiles across org
  const chainsDir = join(ORG_ROOT, 'chains');
  const agentsDir = join(ORG_ROOT, 'agents');
  const profilesDir = join(ORG_ROOT, 'agent-profiles');

  // project-level: runs, events, state, logs specific to this project
  const runsDir = join(PROJECT_ROOT, 'runs');
  const eventsDir = join(PROJECT_ROOT, 'events');
  const stateDir = join(PROJECT_ROOT, 'state');
  const logsDir = join(PROJECT_ROOT, 'logs');

  return {
    // backward compat alias (used by some functions)
    root: PROJECT_ROOT,
    // dirs
    runsDir,
    eventsDir,
    stateDir,
    logsDir,
    profilesDir,
    chainsDir,
    agentsDir,
  };
}

// ─── chain.json loader ──────────────────────────────────────────────

function loadChain(chainPath) {
  const raw = readFileSync(chainPath, "utf-8");
  return JSON.parse(raw);
}

// ─── agent profile resolver ─────────────────────────────────────────

function agentProfilePath(profileId) {
  if (!profileId || typeof profileId !== "string") return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(profileId)) return null;
  const p = paths();
  return join(p.profilesDir, `${profileId}.json`);
}

function loadAgentProfile(profileId) {
  const file = agentProfilePath(profileId);
  if (!file) return null;
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf-8"));
}

function agentProfileExists(profileId) {
  if (!profileId) return false;
  return loadAgentProfile(profileId) !== null;
}

function findWorkspaceProfile(workspacePath) {
  if (!workspacePath) return null;
  const file = join(ORG_ROOT, "workspaces.json");
  if (!existsSync(file)) return null;
  try {
    const workspaces = JSON.parse(readFileSync(file, "utf-8"));
    const match = Array.isArray(workspaces)
      ? workspaces.find((workspace) => workspace?.path === workspacePath)
      : null;
    return match?.default_agent_profile || null;
  } catch {
    return null;
  }
}

function findDefaultProfile() {
  const p = paths();
  const dir = p.profilesDir;
  if (!existsSync(dir)) return null;
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      const profile = JSON.parse(readFileSync(join(dir, f), "utf-8"));
      if (profile.isDefault) return profile.id || f.replace(".json", "");
    }
  } catch {}
  return null;
}

/**
 * build the CLI command from an agent profile JSON.
 * returns { cmd, args, env } ready for PtyManager.spawn().
 */
function normalizePermissionArgs(cli, permissionFlag) {
  if (cli === "claude" && permissionFlag === "--dangerously-skip-permissions") {
    return ["--allow-dangerously-skip-permissions", "--permission-mode", "bypassPermissions"];
  }
  return permissionFlag ? String(permissionFlag).trim().split(/\s+/).filter(Boolean) : [];
}

function buildProfileCommand(profile) {
  const cli = profile.cli || "claude";
  const cmdParts = [cli];

  if (profile.pipe_flag) cmdParts.push(profile.pipe_flag);
  cmdParts.push(...normalizePermissionArgs(cli, profile.permission_flag));
  if (profile.model) cmdParts.push("--model", profile.model);
  if (profile.extra_args) cmdParts.push(...profile.extra_args);

  // env from profile
  const env = {};
  if (profile.env) {
    for (const [k, v] of Object.entries(profile.env)) {
      env[k] = String(v);
    }
  }

  return {
    cmd: cmdParts[0],
    args: cmdParts.slice(1),
    env,
    preExec: profile.pre_exec || null,
  };
}

/**
 * resolve which agent profile to use for an agent.
 * priority: agent.agent_profile > chain.default_agent_profile > workspace > namespace default
 */
function resolveAgentProfile(agent, chain, workspacePath = null) {
  const candidates = [
    agent.agent_profile || null,
    chain.default_agent_profile || null,
    findWorkspaceProfile(workspacePath),
    findDefaultProfile(),
  ];

  for (const profileId of candidates) {
    if (agentProfileExists(profileId)) {
      return profileId;
    }
  }

  // 4. legacy fallback: use chain.config.cli
  return null;
}

// ─── run management ─────────────────────────────────────────────────

function createRun(chain, goal, chainPath, taskId = null, workspacePath = null) {
  const p = paths();
  const runId = `run-${Date.now()}`;
  const runDir = join(p.runsDir, runId);
  mkdirSync(runDir, { recursive: true });

  // create artifacts dir
  mkdirSync(join(runDir, "artifacts"), { recursive: true });

  // copy chain.json into run dir for reference
  const chainCopy = join(runDir, "chain.json");
  writeFileSync(chainCopy, readFileSync(chainPath, "utf-8"));

  const runData = {
    id: runId,
    chain: chain.name,
    goal: goal || chain.description || chain.name,
    started: new Date().toISOString(),
    status: "running",
    sessions: [],
    agents: [],
    artifacts: [],
    runner: "js",
    ...(taskId && { taskId }),
    ...(workspacePath && { workspacePath }),
  };

  writeFileSync(join(runDir, "run.json"), JSON.stringify(runData, null, 2));
  return { runId, runDir, runData };
}

function updateRunStatus(runId, status, message) {
  const p = paths();
  const runFile = join(p.runsDir, runId, "run.json");
  if (!existsSync(runFile)) return;

  const data = JSON.parse(readFileSync(runFile, "utf-8"));
  data.status = status;
  if (status !== "running" && !data.completed) {
    data.completed = new Date().toISOString();
  }
  if (message) data.status_message = message;
  writeFileSync(runFile, JSON.stringify(data, null, 2));
}

function addRunSession(runId, sessionName, agentId) {
  const p = paths();
  const runFile = join(p.runsDir, runId, "run.json");
  if (!existsSync(runFile)) return;

  const data = JSON.parse(readFileSync(runFile, "utf-8"));
  data.sessions.push(sessionName);

  const existing = data.agents.find((a) => a.id === agentId);
  if (existing) {
    existing.session = sessionName;
    existing.status = "running";
  } else {
    data.agents.push({ id: agentId, session: sessionName, status: "running" });
  }
  writeFileSync(runFile, JSON.stringify(data, null, 2));
}

function updateRunAgent(runId, agentId, status) {
  const p = paths();
  const runFile = join(p.runsDir, runId, "run.json");
  if (!existsSync(runFile)) return;

  const data = JSON.parse(readFileSync(runFile, "utf-8"));
  const agent = data.agents.find((a) => a.id === agentId);
  if (agent) {
    agent.status = status;
    if (status === "completed" || status === "failed") {
      agent.completedAt = new Date().toISOString();
    }
  }
  writeFileSync(runFile, JSON.stringify(data, null, 2));
}

/** add artifact to run.json */
function addArtifact(runId, agentId, type, path) {
  const p = paths();
  const runFile = join(p.runsDir, runId, "run.json");
  if (!existsSync(runFile)) return;

  const data = JSON.parse(readFileSync(runFile, "utf-8"));
  if (!data.artifacts) data.artifacts = [];

  // avoid duplicate artifacts for same agent+type
  const exists = data.artifacts.some(
    (a) => a.agentId === agentId && a.type === type
  );
  if (!exists) {
    data.artifacts.push({
      agentId,
      type,
      path,
      timestamp: new Date().toISOString(),
    });
  }
  writeFileSync(runFile, JSON.stringify(data, null, 2));
}

// ─── state file management ──────────────────────────────────────────

function writeAgentState(agentId, sessionName, agentConfig, round, _runId) {
  const p = paths();
  mkdirSync(p.stateDir, { recursive: true });
  const stateId = agentId.replace(/-/g, "_");
  const statePath = join(p.stateDir, `${stateId}.state`);

  const lines = [
    `status: running`,
    `session: ${sessionName}`,
    `agent_id: ${agentId}`,
    `round: ${round}`,
    `started: ${new Date().toISOString()}`,
    `chain: ${agentConfig._chainName || "unknown"}`,
    `emits: ${agentConfig.emits || ""}`,
    `workspace: local`,
    `timeout: ${agentConfig.timeout || 0}`,
    `retry_max: ${agentConfig.retry?.max_retries || 0}`,
    `retry_attempt: 0`,
    `runner: js`,
  ];

  writeFileSync(statePath, lines.join("\n") + "\n");
}

function updateAgentState(agentId, updates) {
  const p = paths();
  const stateId = agentId.replace(/-/g, "_");
  const statePath = join(p.stateDir, `${stateId}.state`);
  if (!existsSync(statePath)) return;

  let content = readFileSync(statePath, "utf-8");
  for (const [key, value] of Object.entries(updates)) {
    const re = new RegExp(`^${key}:.*$`, "m");
    if (re.test(content)) {
      content = content.replace(re, `${key}: ${value}`);
    } else {
      content += `${key}: ${value}\n`;
    }
  }
  writeFileSync(statePath, content);
}

// ─── event file management ──────────────────────────────────────────

function emitEvent(eventName, sourceAgent, data) {
  const p = paths();
  mkdirSync(p.eventsDir, { recursive: true });
  const ts = new Date();
  const tsStr = ts.toISOString().replace(/[:.]/g, "").slice(0, 15);
  const fileName = `${sourceAgent}-${eventName}.event`;
  const filePath = join(p.eventsDir, fileName);

  const content = [
    `event: ${eventName}`,
    `source: ${sourceAgent}`,
    `timestamp: ${ts.toISOString()}`,
    `processed: false`,
    data ? `data: ${data}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  writeFileSync(filePath, content + "\n");
  return filePath;
}

function checkEvent(eventName) {
  const p = paths();
  if (!existsSync(p.eventsDir)) return false;

  let files;
  try {
    files = readdirSync(p.eventsDir);
  } catch {
    return false;
  }

  for (const f of files) {
    if (!f.endsWith(".event")) continue;
    const content = readFileSync(join(p.eventsDir, f), "utf-8");
    const eventMatch = content.match(/^event:\s*(.+)$/m);
    const processedMatch = content.match(/^processed:\s*(.+)$/m);
    if (
      eventMatch &&
      eventMatch[1].trim().toLowerCase() === eventName.toLowerCase() &&
      processedMatch &&
      processedMatch[1].trim() === "false"
    ) {
      return { file: f, path: join(p.eventsDir, f) };
    }
  }
  return false;
}

function markEventProcessed(eventPath) {
  if (!existsSync(eventPath)) return;
  let content = readFileSync(eventPath, "utf-8");
  content = content.replace(/^processed:\s*false$/m, "processed: true");
  writeFileSync(eventPath, content);
}

// ─── agent instruction builder ──────────────────────────────────────

function buildInstructions(agent, chain, round, maxRounds) {
  const p = paths();
  const sessionPrefix = agent.id;
  const emits = agent.emits || "";

  if (agent.spec) {
    return `You are an autonomous AI agent.

Your spec is at: ${join(p.root, agent.spec)}

Read your spec file first, then follow your playbooks step by step.
Write your deliverables to the paths specified in your spec.
When complete, write an event file to ${p.eventsDir}/ with:
  event: ${emits}
  source: ${sessionPrefix}
  timestamp: (ISO timestamp)
  processed: false
Then output AGENT_COMPLETE.

Working directory: ${p.root}`;
  }

  if (agent.prompt) {
    let instructions = `You are: ${agent.name}
Role: ${agent.role || ""}
Round: ${round} of ${maxRounds}

TASK:
${agent.prompt}`;

    // context files
    const readFirst = agent.context?.read_first || agent.read_first || [];
    if (readFirst.length > 0) {
      instructions += `\n\nREAD THESE FILES FIRST:\n${readFirst.map((f) => `- ${f}`).join("\n")}`;
    }

    // authorities
    const canDo = agent.authorities?.can || [];
    if (canDo.length > 0) {
      instructions += `\n\nAUTHORITIES:\n${canDo.map((a) => `- ${a}`).join("\n")}`;
    }

    // workspace
    const workspace = agent.context?.workspace || "";
    if (workspace) {
      instructions += `\n\nWrite output to: ${workspace}`;
    }

    instructions += `\n\nWHEN COMPLETE:
Write an event file to ${p.eventsDir}/ named ${sessionPrefix}-${emits}.event with:
  event: ${emits}
  source: ${sessionPrefix}
  timestamp: (current ISO timestamp)
  processed: false
Then output the text AGENT_COMPLETE on its own line.

Working directory: ${p.root}`;

    return instructions;
  }

  throw new Error(`agent ${agent.id} has no spec or prompt`);
}

// ─── task context loader ─────────────────────────────────────────────

/**
 * load task context from task store API
 * returns object with id, title, description, type, priority, context, comments
 */
function loadTaskContext(taskId) {
  if (!taskId) return null;

  const apiBase = `http://localhost:${process.env.WEB_PORT || 3000}`;
  const authHeader = `Bearer ${process.env.BETTER_AUTH_SECRET || ""}`;

  try {
    const output = execSync(
      `curl -sf -H "Authorization: ${authHeader}" "${apiBase}/api/tasks/${taskId}"`,
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }
    );

    const resp = JSON.parse(output);
    const task = resp?.data?.issue;
    if (!task) return null;

    const title = task.title || "";
    const description = task.description || "";
    const type = task.issue_type || "";
    const priority = task.priority ?? "";

    // fetch comments from API
    let commentsBlock = "";
    try {
      const commentsOut = execSync(
        `curl -sf -H "Authorization: ${authHeader}" "${apiBase}/api/tasks/${taskId}/comments"`,
        { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }
      );
      const commentsResp = JSON.parse(commentsOut);
      const comments = commentsResp?.data?.comments;
      if (Array.isArray(comments) && comments.length > 0) {
        commentsBlock = comments
          .map((c) => `  [${c.created_at || "unknown"} ${c.author || "unknown"}] ${c.text || ""}`)
          .join("\n");
      }
    } catch { /* no comments or API unavailable */ }

    // build full context block
    const contextBlock = `TASK ID: ${taskId}
TITLE: ${title}
TYPE: ${type}
PRIORITY: ${priority}
DESCRIPTION: ${description}` +
        (commentsBlock ? `\n\nCOMMENTS:\n${commentsBlock}` : "");

    return {
      id: taskId,
      title,
      description,
      type,
      priority,
      context: contextBlock,
      comments: commentsBlock,
    };
  } catch (err) {
    log(`warning: failed to load task ${taskId}: ${err.message}`);
    return null;
  }
}

// ─── chain runner class ─────────────────────────────────────────────

export class ChainRunner {
  constructor(chainPath, opts = {}) {
    this.chainPath = resolve(chainPath);
    this.chain = loadChain(this.chainPath);
    this.mgr = new PtyManager();
    this.opts = opts;
    this.workspace = opts.workspace ? resolve(opts.workspace) : null;
    this.runId = opts.runId || null;
    this.runDir = null;
    this.goal = opts.goal || this.chain.description || this.chain.name;
    this.taskId = opts.task || null;
    this.taskContext = null;

    // load full task context if taskId provided
    if (this.taskId) {
      this.taskContext = loadTaskContext(this.taskId);
      if (this.taskContext) {
        log(`task context loaded: ${this.taskId}`);
        log(`  title: ${this.taskContext.title}`);
        log(`  type: ${this.taskContext.type}`);
        log(`  priority: ${this.taskContext.priority}`);
      }
    }

    this.maxRounds = this.chain.config?.max_rounds || 3;
    this.sessionPrefix = this.chain.config?.session_prefix || "";
    this.completionTimeout = opts.completionTimeout || 30 * 60 * 1000; // 30 min
    this.agentSessions = new Map(); // agentId -> sessionName
    this._aborted = false;
  }

  /** substitute {TASK_*}, {GOAL}, {CHAIN_NAME} in prompt text */
  _substitute(text) {
    if (!text) return text;

    // backward compat: {TASK} -> task description or goal
    const taskDesc = this.taskContext?.description || this.goal || "";
    let result = text.replace(/\{TASK\}/g, taskDesc);

    // full task context block
    result = result.replace(/\{TASK_CONTEXT\}/g, this.taskContext?.context || "");

    // individual task fields
    result = result.replace(/\{TASK_ID\}/g, this.taskContext?.id || "");
    result = result.replace(/\{TASK_TITLE\}/g, this.taskContext?.title || "");
    result = result.replace(/\{TASK_DESCRIPTION\}/g, this.taskContext?.description || "");
    result = result.replace(/\{TASK_TYPE\}/g, this.taskContext?.type || "");
    result = result.replace(/\{TASK_PRIORITY\}/g, this.taskContext?.priority || "");
    result = result.replace(/\{TASK_COMMENTS\}/g, this.taskContext?.comments || "");

    // chain/goal placeholders
    result = result.replace(/\{GOAL\}/g, this.goal || "");
    result = result.replace(/\{CHAIN_NAME\}/g, this.chain.name || "");

    return result;
  }

  /** find which agent handles a given trigger event */
  _findAgentByTrigger(eventName) {
    return this.chain.agents.find((a) =>
      (a.triggers || []).some(
        (t) => t.toLowerCase() === eventName.toLowerCase()
      )
    );
  }

  /** find the first agent (manual-start trigger or index 0) */
  _findFirstAgent() {
    const manual = this.chain.agents.find((a) =>
      (a.triggers || []).includes("manual-start")
    );
    return manual || this.chain.agents[0];
  }

  /** build session name for an agent */
  _sessionName(agentId) {
    const projectName = basename(PROJECT_ROOT);
    const prefix = this.sessionPrefix
      ? `${this.sessionPrefix}-${agentId}`
      : agentId;
    const runSuffix = this.runId || `${Date.now()}`;
    return `${projectName}-${prefix}-${runSuffix}`;
  }

  /** launch a single agent */
  async launchAgent(agent, round = 1) {
    const agentId = agent.id;
    const sessionName = this._sessionName(agentId);
    const p = paths();

    log(`launching: ${agent.name} (${agentId})`);
    log(`  session:  ${sessionName}`);
    log(`  emits:    ${agent.emits}`);
    log(`  round:    ${round}/${this.maxRounds}`);

    // resolve profile and build command
    let cmd = "";
    let cmdArgs = [];
    let env = {};

    const requestedProfileId = agent.agent_profile || this.chain.default_agent_profile || null;
    const profileId = resolveAgentProfile(agent, this.chain, this.workspace || PROJECT_ROOT);
    if (profileId) {
      const profile = loadAgentProfile(profileId);
      if (profile) {
        const built = buildProfileCommand(profile);
        cmd = built.cmd;
        cmdArgs = built.args;
        env = built.env;
        if (requestedProfileId && requestedProfileId !== profileId) {
          log(`  warning: profile '${requestedProfileId}' not found, using '${profileId}'`);
        }
        log(`  profile:  ${profileId}`);
      }
    }

    // legacy fallback
    if (!profileId) {
      if (requestedProfileId) {
        throw new Error(
          `requested agent profile '${requestedProfileId}' was not found and no valid fallback profile exists`
        );
      }
      const chainCli = this.chain.config?.cli || "";
      if (!chainCli) {
        throw new Error(`no agent profile resolved for agent '${agentId}'. Set up a default profile.`);
      }
      const chainArgs = this.chain.config?.cli_args || [];
      cmd = chainCli;
      cmdArgs = chainArgs.length > 0 ? chainArgs : ["--print"];
      log(`  cli:      ${cmd} ${cmdArgs.join(" ")}`);
    }

    // build instructions with substitution
    const rawInstructions = buildInstructions(
      agent,
      this.chain,
      round,
      this.maxRounds
    );
    const instructions = this._substitute(rawInstructions);

    // spawn session (--workspace overrides project root)
    // merge tier env vars with profile env vars
    const codeRootEnv = process.env.MENTIKO_CODE_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..");
    const tierEnv = {
      PATH: `${codeRootEnv}/bin:${process.env.PATH || ""}`,
      MENTIKO_GLOBAL_ROOT,
      MENTIKO_CODE_ROOT: codeRootEnv,
      MENTIKO_PROJECT_ROOT: PROJECT_ROOT,
      MENTIKO_ORG_ROOT: ORG_ROOT,
      MENTIKO_NAMESPACE_ROOT: join(MENTIKO_GLOBAL_ROOT, "namespaces", NAMESPACE_ID),
      NAMESPACE_ID,
      ORG_ID,
      MENTIKO_RUN_ID: this.runId || "",
      RUN_ID: this.runId || "",
      MENTIKO_AGENT_ID: agentId,
      MENTIKO_AGENT_EMITS: agent.emits || "",
      EVENTS_DIR: p.eventsDir,
      ARTIFACTS_DIR: this.runId ? join(p.runsDir, this.runId, "artifacts") : "",
      MENTIKO_DECISION_IMPORT_TOKEN: process.env.MENTIKO_DECISION_IMPORT_TOKEN || "",
      MENTIKO_DECISION_ID: process.env.MENTIKO_DECISION_ID || "",
      MENTIKO_DECISION_PHASE: process.env.MENTIKO_DECISION_PHASE || "",
      MENTIKO_DECISION_SELECTED_OPTION_ID: process.env.MENTIKO_DECISION_SELECTED_OPTION_ID || "",
      MENTIKO_DECISION_WORKSPACE_PATH: process.env.MENTIKO_DECISION_WORKSPACE_PATH || "",
    };
    const agentEnv = buildPtyAiGatewayAgentEnv(tierEnv, env);
    this.mgr.spawn(sessionName, cmd, cmdArgs, {
      cwd: this.workspace || p.root,
      env: agentEnv,
    });

    // enable JSONL logging for replay
    mkdirSync(p.logsDir, { recursive: true });
    const logPath = join(p.logsDir, `${sessionName}.jsonl`);
    this.mgr.get(sessionName).startLog(logPath, "jsonl");

    this.agentSessions.set(agentId, sessionName);

    // register with run
    if (this.runId) {
      addRunSession(this.runId, sessionName, agentId);
    }

    // write state file
    writeAgentState(agentId, sessionName, { ...agent, _chainName: this.chain.name }, round, this.runId);

    // wait for CLI to be ready, then send instructions
    // for claude --print, it reads from stdin immediately
    // for interactive CLIs, we wait for prompt
    await new Promise((r) => setTimeout(r, 2000));

    // send instructions
    this.mgr.sendKeys(sessionName, instructions + "\r");

    log(`  launched: ${sessionName}`);
    log(`  log:      ${logPath}`);
    sysLog("info", "chain-runner", `agent launched: ${agent.name} (${agentId})`, `run: ${this.runId || "unknown"}, session: ${sessionName}, round: ${round}`);

    return sessionName;
  }

  /** wait for an agent to complete (detect AGENT_COMPLETE or exit) */
  async waitForCompletion(agentId) {
    const sessionName = this.agentSessions.get(agentId);
    if (!sessionName) throw new Error(`no session for agent: ${agentId}`);

    const session = this.mgr.get(sessionName);

    log(`waiting for completion: ${agentId} (${sessionName})`);

    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        session.events.off("data", onData);
        session.events.off("exit", onExit);
        reject(new Error(`timeout waiting for agent ${agentId} to complete`));
      }, this.completionTimeout);

      // check for AGENT_COMPLETE in output
      function onData() {
        const screen = session.capture();
        if (screen.includes("AGENT_COMPLETE")) {
          cleanup();
          resolve({ agentId, status: "completed", exitCode: null });
        }
      }

      // check if session exited
      function onExit({ exitCode }) {
        cleanup();
        if (exitCode === 0) {
          resolve({ agentId, status: "completed", exitCode });
        } else {
          resolve({ agentId, status: "failed", exitCode });
        }
      }

      function cleanup() {
        clearTimeout(timeout);
        session.events.off("data", onData);
        session.events.off("exit", onExit);
      }

      // check current state first
      if (session.exited) {
        cleanup();
        resolve({
          agentId,
          status: session.exitCode === 0 ? "completed" : "failed",
          exitCode: session.exitCode,
        });
        return;
      }

      const screen = session.capture();
      if (screen.includes("AGENT_COMPLETE")) {
        cleanup();
        resolve({ agentId, status: "completed", exitCode: null });
        return;
      }

      session.events.on("data", onData);
      session.events.on("exit", onExit);
    });

    await new Promise((r) => setTimeout(r, 100));

    // capture output as artifact
    if (this.runId) {
      const p = paths();
      const artifactsDir = join(p.runsDir, this.runId, "artifacts");
      mkdirSync(artifactsDir, { recursive: true });

      // capture last 50 lines of output
      const screen = session.capture();
      const outputLines = screen.split("\n").slice(-50);
      const outputFile = join(artifactsDir, `${agentId}-output.txt`);
      writeFileSync(outputFile, outputLines.join("\n"));

      // add artifact to run.json
      addArtifact(this.runId, agentId, "output", `namespaces/${NAMESPACE_ID}/runs/${this.runId}/artifacts/${agentId}-output.txt`);

      // track events this agent produced
      const agent = this.chain.agents.find((a) => a.id === agentId);
      const eventFile = join(artifactsDir, `${agentId}-events.json`);
      writeFileSync(eventFile, JSON.stringify({
        agentId,
        agentName: agent?.name || agentId,
        event: agent?.emits || null,
        session: sessionName,
        timestamp: new Date().toISOString(),
      }, null, 2));

      addArtifact(this.runId, agentId, "events", `namespaces/${NAMESPACE_ID}/runs/${this.runId}/artifacts/${agentId}-events.json`);

      // update task with agent completion note
      if (this.taskId) {
        this._updateTaskNote(`Agent ${agent?.name || agentId} (${agentId}) completed. Event: ${agent?.emits || "none"}. Session: ${sessionName}`);
      }

      log(`  artifacts saved: ${outputFile}`);
    }

    return result;
  }

  /** update linked task with a note via task store API */
  _updateTaskNote(note) {
    if (!this.taskId) return;
    const apiBase = `http://localhost:${process.env.WEB_PORT || 3000}`;
    const authHeader = `Bearer ${process.env.BETTER_AUTH_SECRET || ""}`;
    try {
      execSync(
        `curl -sf -X PATCH -H "Authorization: ${authHeader}" -H "Content-Type: application/json" ` +
        `-d '${JSON.stringify({ notes: note })}' "${apiBase}/api/tasks/${this.taskId}"`,
        { stdio: "ignore" }
      );
    } catch (err) {
      log(`  (task update failed: ${err.message})`);
    }
  }

  /** update linked task with final summary */
  _updateTaskSummary(status) {
    if (!this.taskId || !this.runId) return;
    const apiBase = `http://localhost:${process.env.WEB_PORT || 3000}`;
    const authHeader = `Bearer ${process.env.BETTER_AUTH_SECRET || ""}`;
    try {
      const p = paths();
      const runFile = join(p.runsDir, this.runId, "run.json");
      if (!existsSync(runFile)) return;

      const runData = JSON.parse(readFileSync(runFile, "utf-8"));
      const agents = runData.agents || [];
      const artifacts = runData.artifacts || [];

      const agentsSummary = agents.map((a) => `${a.id}:${a.status}`).join(", ");
      const artifactsCount = artifacts.length;

      const summaryNote = `Chain run ${this.runId} ${status}.\nChain: ${runData.chain}\nStarted: ${runData.started}\nCompleted: ${runData.completed || new Date().toISOString()}\nAgents: ${agentsSummary}\nArtifacts: ${artifactsCount} files`;

      // post summary as comment
      execSync(
        `curl -sf -X POST -H "Authorization: ${authHeader}" -H "Content-Type: application/json" ` +
        `-d '${JSON.stringify({ text: summaryNote, author: "chain-runner" })}' "${apiBase}/api/tasks/${this.taskId}/comments"`,
        { stdio: "ignore" }
      );

      // update task metadata with run info
      const metadata = {
        last_run_status: status,
        last_run_id: this.runId,
        last_run_chain: runData.chain,
        last_run_started: runData.started,
        last_run_completed: runData.completed || new Date().toISOString(),
        last_run_agents: agentsSummary,
        last_run_artifacts: artifacts,
      };

      execSync(
        `curl -sf -X PATCH -H "Authorization: ${authHeader}" -H "Content-Type: application/json" ` +
        `-d '${JSON.stringify({ metadata })}' "${apiBase}/api/tasks/${this.taskId}"`,
        { stdio: "ignore" }
      );

      // close task on completion
      if (status === "completed") {
        execSync(
          `curl -sf -X POST -H "Authorization: ${authHeader}" "${apiBase}/api/tasks/${this.taskId}/close"`,
          { stdio: "ignore" }
        );
      }

      log(`  task summary written (${artifactsCount} artifacts)`);
    } catch (err) {
      log(`  (task update failed: ${err.message})`);
    }
  }

  /** run the complete chain */
  async run() {
    const p = paths();

    log("");
    log(`chain: ${this.chain.name}`);
    log(`agents: ${this.chain.agents.length}`);
    log(`max rounds: ${this.maxRounds}`);
    if (this.taskId) log(`task: ${this.taskId}`);
    if (this.goal) log(`goal: ${this.goal}`);
    log("");

    // create run
    if (!this.runId) {
      const run = createRun(this.chain, this.goal, this.chainPath, this.taskId, this.workspace);
      this.runId = run.runId;
      this.runDir = run.runDir;
      log(`run-id: ${this.runId}`);
      sysLog("info", "chain-runner", `run created: ${this.runId}`, `chain: ${this.chain.name}, goal: ${(this.goal || "").slice(0, 100)}`);
    }

    try {
      // find starting agent
      const startAgentId = this.opts.startAgent;
      const firstAgent = startAgentId
        ? this.chain.agents.find((a) => a.id === startAgentId)
        : this._findFirstAgent();

      if (!firstAgent) {
        throw new Error(
          `starting agent not found: ${startAgentId || "(auto)"}`
        );
      }

      // sequential execution: launch agent, wait, check triggers, launch next
      let currentAgent = firstAgent;
      let round = 1;

      while (currentAgent && round <= this.maxRounds && !this._aborted) {
        log(`\n--- round ${round} ---`);

        await this.launchAgent(currentAgent, round);
        const result = await this.waitForCompletion(currentAgent.id);

        log(`agent ${currentAgent.id}: ${result.status}`);
        sysLog("info", "chain-runner", `agent ${result.status}: ${currentAgent.name} (${currentAgent.id})`, `run: ${this.runId}, round: ${round}`);

        // update state
        updateAgentState(currentAgent.id, {
          status: result.status,
          completed: new Date().toISOString(),
        });

        if (this.runId) {
          updateRunAgent(this.runId, currentAgent.id, result.status);
        }

        if (result.status === "failed") {
          log(`agent ${currentAgent.id} failed, stopping chain`);
          sysLog("error", "chain-runner", `agent failed: ${currentAgent.id}`, `run: ${this.runId}, chain stopped`);
          updateRunStatus(this.runId, "failed", `agent ${currentAgent.id} failed`);
          break;
        }

        // emit event for this agent
        const emits = currentAgent.emits;
        if (emits) {
          emitEvent(emits, currentAgent.id, `round=${round}`);
          log(`event emitted: ${emits}`);
        }

        // find next agent triggered by this event
        const nextAgent = emits ? this._findAgentByTrigger(emits) : null;

        if (nextAgent) {
          log(`next agent: ${nextAgent.name} (triggered by ${emits})`);
          sysLog("info", "chain-runner", `routing: ${emits} -> ${nextAgent.name} (${nextAgent.id})`, `run: ${this.runId}`);
          currentAgent = nextAgent;
          // increment round if we're looping back to a previous agent
          if (this.agentSessions.has(nextAgent.id)) {
            round++;
          }
        } else {
          log("no more agents to trigger, chain complete");
          currentAgent = null;
        }
      }

      if (round > this.maxRounds) {
        log(`max rounds (${this.maxRounds}) reached`);
        updateRunStatus(this.runId, "completed", "max rounds reached");
      } else if (!this._aborted) {
        updateRunStatus(this.runId, "completed");
      }

      log(`\nchain ${this._aborted ? "aborted" : "completed"}: ${this.runId}`);
      sysLog("info", "chain-runner", `run ${this._aborted ? "aborted" : "completed"}: ${this.runId}`, `chain: ${this.chain.name}, agents: ${this.chain.agents.length}`);

      // update linked task with final summary
      if (!this._aborted && this.taskId) {
        this._updateTaskSummary("completed");
      }
    } catch (err) {
      log(`chain error: ${err.message}`);
      sysLog("error", "chain-runner", `run failed: ${this.runId || "unknown"}`, `chain: ${this.chain.name}, error: ${err.message}`);
      if (this.runId) {
        updateRunStatus(this.runId, "failed", err.message);
      }
      if (this.taskId) {
        this._updateTaskSummary("failed");
      }
      throw err;
    } finally {
      // don't destroy sessions -- they persist for inspection/replay
      // but stop logging
      for (const [, sessionName] of this.agentSessions) {
        try {
          this.mgr.get(sessionName).stopLog();
        } catch {}
      }
    }
  }

  /** abort the chain */
  abort() {
    this._aborted = true;
    for (const [agentId, sessionName] of this.agentSessions) {
      try {
        this.mgr.kill(sessionName);
        updateAgentState(agentId, { status: "cancelled" });
      } catch {}
    }
    if (this.runId) {
      updateRunStatus(this.runId, "cancelled", "aborted by user");
    }
  }

  /** cleanup all sessions */
  destroy() {
    this.mgr.destroyAll();
  }
}

// ─── logging ────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`  [${ts}] ${msg}`);
}

/** POST to /api/system/logs (non-blocking, fire-and-forget) */
function sysLog(level, source, message, detail) {
  const port = process.env.WEB_PORT || 3000;
  const body = JSON.stringify({ level, source, message, ...(detail ? { detail } : {}) });
  fetch(`http://localhost:${port}/api/system/logs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.BETTER_AUTH_SECRET || ""}`,
    },
    body,
    signal: AbortSignal.timeout(3000),
  }).catch(() => {}); // fire-and-forget
}

// ─── CLI entry point ────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`
  chain-runner.mjs - JavaScript chain runner

  usage:
    node lib/chain-runner.mjs <chain.json> --workspace <path> [options]

  options:
    --workspace <path>  target project directory (required)
    --task <id>         task id to inject as task placeholders
    --goal "text"       goal text to inject as {GOAL}
    --start <agent>     start from specific agent id
    --dry-run           show chain graph without executing
    --timeout <ms>      agent completion timeout (default: 1800000)

  task placeholders (requires --task):
    {TASK}              alias for {TASK_DESCRIPTION} (backward compat)
    {TASK_ID}           task id
    {TASK_TITLE}        task title
    {TASK_DESCRIPTION}  task description
    {TASK_TYPE}         task type (bug/feature/task/etc)
    {TASK_PRIORITY}     task priority (P0-P4)
    {TASK_COMMENTS}     task comments
    {TASK_CONTEXT}      full task context block (all fields)

  other placeholders:
    {GOAL}              goal text
    {CHAIN_NAME}        chain name

  environment:
    NAMESPACE_ID          namespace scope (default: "default")
    AGENT_CHAIN_RUN_ID    reuse existing run id
`);
    process.exit(0);
  }

  const chainPath = args[0];
  if (!existsSync(chainPath)) {
    console.error(`  error: chain file not found: ${chainPath}`);
    process.exit(1);
  }

  // parse options
  const opts = {
    runId: process.env.AGENT_CHAIN_RUN_ID || null,
  };

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case "--workspace":
        opts.workspace = args[++i];
        break;
      case "--task":
        opts.task = args[++i];
        break;
      case "--goal":
        opts.goal = args[++i];
        break;
      case "--start":
        opts.startAgent = args[++i];
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--timeout":
        opts.completionTimeout = parseInt(args[++i], 10);
        break;
    }
  }

  // --workspace is required
  if (!opts.workspace && !opts.dryRun) {
    console.error("  error: --workspace <path> is required");
    console.error("");
    console.error("  usage: node lib/chain-runner.mjs <chain.json> --workspace /path/to/project");
    process.exit(1);
  }

  // dry run: just print the chain graph
  if (opts.dryRun) {
    const chain = loadChain(chainPath);
    console.log("");
    console.log(`  chain: ${chain.name}`);
    console.log(`  agents: ${chain.agents.length}`);
    console.log(`  ---`);
    for (const agent of chain.agents) {
      console.log(`  [${agent.id}] ${agent.name}`);
      console.log(`    triggers: ${(agent.triggers || []).join(", ")}`);
      console.log(`    emits:    ${agent.emits || ""}`);
      console.log("");
    }
    process.exit(0);
  }

  const runner = new ChainRunner(chainPath, opts);

  // graceful shutdown
  const shutdown = () => {
    log("shutting down...");
    runner.abort();
    setTimeout(() => {
      runner.destroy();
      process.exit(1);
    }, 3000);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    await runner.run();
    // keep process alive briefly so logs flush
    setTimeout(() => process.exit(0), 1000);
  } catch (err) {
    console.error(`  fatal: ${err.message}`);
    runner.destroy();
    process.exit(1);
  }
}

// only run CLI if this is the entry point
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("chain-runner.mjs") ||
    process.argv[1] === fileURLToPath(import.meta.url));

if (isMain) {
  main();
}
