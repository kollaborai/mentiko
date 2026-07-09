import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pty } from "@/lib/pty/pty-client";
import { shellEscape } from "@/lib/api/audit-exec";
import config from "@/lib/config";
import { classifyDeath, classifyStall, type MonitorDiagnosticEvent } from "@/lib/runner-v2/monitor-diagnostics";
import {
  captureHash,
  clearMonitorState,
  computeLatch,
  findCompletionEventFile,
  latchExists,
  loadMonitorState,
  monitorStatePaths,
  saveMonitorState,
  writeLatch,
} from "@/lib/runner-v2/monitor-io";
import type { MonitorDriverIO } from "@/lib/runner-v2/monitor";
import { updateRunAgent, updateRunStatus } from "@/lib/runner-v2/run-state";

export interface LiveMonitorContext {
  sessionName: string;
  chainPath: string;
  runId: string;
  runDir: string;
  runJsonPath: string;
  agentId: string;
  workspaceType: string;
  eventsDir: string;
  stateDir: string;
  namespaceId: string;
  orgId: string;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

export function createLiveMonitorIO(context: LiveMonitorContext): MonitorDriverIO {
  let completionMarkerLatched = false;
  return {
    hasSession: (session) => pty.alive(session),
    observe: async (session) => {
      const capture = await pty.capture(session, 20).catch(() => "");
      const eventFile = findCompletionEventFile({
        eventsDir: context.eventsDir,
        runId: context.runId,
        agentId: context.agentId,
      }) || findCompletionEventFile({
        eventsDir: join(dirname(context.chainPath), "events"),
        runId: context.runId,
        agentId: context.agentId,
      });
      const markerDurable = await agentCompleteMarkerDurable(session, context.env);
      if (markerDurable) completionMarkerLatched = true;
      const latched = computeLatch({
        alreadyLatched: latchExists(session),
        markerDurable,
        completionEventPresent: Boolean(eventFile),
      });
      if (latched) writeLatch(session);
      return {
        processGone: context.workspaceType === "local"
          ? await monitorAgentProcessGone(session, context.env)
          : false,
        captureHash: captureHash(capture, 20),
        completionEventPresent: Boolean(eventFile),
        latched,
      };
    },
    sendNudge: async (session, message) => {
      await pty.sendRaw(session, message);
      await sleepMs(1000);
      await pty.sendRaw(session, "\r");
      await sleepMs(500);
    },
    onComplete: async (session) => {
      await launchCompletionSession(session, context, {
        agentCompleteMarker: completionMarkerLatched || await agentCompleteMarkerDurable(session, context.env),
      });
    },
    onDied: async (session) => {
      const hasCompletionEvent = Boolean(findCompletionEventFile({
        eventsDir: context.eventsDir,
        runId: context.runId,
        agentId: context.agentId,
      }) || findCompletionEventFile({
        eventsDir: join(dirname(context.chainPath), "events"),
        runId: context.runId,
        agentId: context.agentId,
      }));
      const verdict = classifyDeath({
        hasCompletionEvent,
        runId: context.runId,
        agentId: context.agentId,
        reason: "monitor: agent CLI process exited before producing its completion event",
        timestamp: timestamp(),
      });
      if (verdict.outcome === "complete-normally") {
        await launchCompletionSession(session, context, { agentCompleteMarker: false });
        return;
      }
      updateRunAgent(context.runJsonPath, context.agentId, verdict.agentStatus);
      updateRunStatus(context.runJsonPath, verdict.runStatus, verdict.diagnostic.reason);
      writeDiagnosticEvent(context.eventsDir, verdict.diagnostic);
    },
    onStalled: async (_session, kind, count) => {
      const reason = kind === "escalate"
        ? `monitor: no real progress after ${count} nudges; escalating instead of nudging an unresponsive session indefinitely`
        : `monitor: agent output quiescent for ${count} stale cycles; no AGENT_COMPLETE and no completion event`;
      const verdict = classifyStall({
        runId: context.runId,
        agentId: context.agentId,
        reason,
        staleCount: count,
        timestamp: timestamp(),
      });
      updateRunAgent(context.runJsonPath, context.agentId, verdict.agentStatus);
      updateRunStatus(context.runJsonPath, verdict.runStatus, verdict.diagnostic.reason);
      writeDiagnosticEvent(context.eventsDir, verdict.diagnostic);
    },
    sleep: (seconds) => sleepMs(seconds * 1000),
    loadState: loadMonitorState,
    saveState: saveMonitorState,
    clearState: clearMonitorState,
    log: (message) => console.log(message),
  };
}

async function monitorAgentProcessGone(
  sessionName: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Promise<boolean> {
  const panePid = await pty.pid(sessionName);
  if (!panePid) return false;
  const paths = monitorStatePaths(sessionName);
  const graceMax = positiveInt(env.MENTIKO_MONITOR_NEVER_ARMED_GRACE, 5);

  if (hasPgrep()) {
    if (hasChildProcess(panePid)) {
      mkdirSync(dirname(paths.armed), { recursive: true });
      writeFileSync(paths.armed, "");
      rmSync(paths.armedGrace, { force: true });
      return false;
    }

    if (!existsSync(paths.armed)) {
      const grace = readPositiveIntFile(paths.armedGrace) + 1;
      mkdirSync(dirname(paths.armedGrace), { recursive: true });
      writeFileSync(paths.armedGrace, String(grace));
      if (grace < graceMax) return false;
    }

    await sleepMs(1000);
    if (hasChildProcess(panePid)) {
      writeFileSync(paths.armed, "");
      rmSync(paths.armedGrace, { force: true });
      return false;
    }
    return true;
  }

  return spawnSync("ps", ["-p", String(panePid)], { stdio: "ignore" }).status !== 0;
}

async function agentCompleteMarkerDurable(
  sessionName: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Promise<boolean> {
  const transcript = await resolveTranscriptJsonl(sessionName, env);
  if (!transcript) return false;
  let body = "";
  try {
    body = readFileSync(transcript, "utf8");
  } catch {
    return false;
  }
  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      for (const text of assistantTexts(record)) {
        if (text.split(/\r?\n/).some((part) => part.trim() === "AGENT_COMPLETE")) {
          return true;
        }
      }
    } catch {
      continue;
    }
  }
  return false;
}

async function resolveTranscriptJsonl(
  sessionName: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Promise<string> {
  const explicit = env.MENTIKO_TRANSCRIPT_JSONL;
  if (explicit && existsSync(explicit)) return explicit;

  const capture = await pty.capture(sessionName, positiveInt(env.MENTIKO_TRANSCRIPT_CAPTURE_LINES, 2000)).catch(() => "");
  const uuid = capture.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  if (!uuid) return "";
  const roots = [
    join(homedir(), ".claude", "projects"),
    join(homedir(), ".kollab", "projects"),
    join(homedir(), ".codex", "sessions"),
    join(homedir(), ".config", "opencode"),
    join(homedir(), ".gemini", "antigravity-cli"),
  ];
  for (const root of roots) {
    const hit = findJsonl(root, uuid, 4);
    if (hit) return hit;
  }
  return "";
}

function assistantTexts(record: unknown): string[] {
  if (!record || typeof record !== "object") return [];
  const r = record as Record<string, unknown>;
  const out: string[] = [];
  if (r.type === "assistant" && r.message && typeof r.message === "object") {
    const content = (r.message as { content?: unknown }).content;
    if (Array.isArray(content)) {
      for (const item of content) {
        if (item && typeof item === "object" && (item as Record<string, unknown>).type === "text") {
          const text = (item as Record<string, unknown>).text;
          if (typeof text === "string") out.push(text);
        }
      }
    }
  }
  if ((r.type === "message" || r.type === "response_item") && r.role === "assistant") {
    const content = Array.isArray(r.content)
      ? r.content
      : r.payload && typeof r.payload === "object" && Array.isArray((r.payload as { content?: unknown }).content)
        ? (r.payload as { content: unknown[] }).content
        : [];
    for (const item of content) {
      if (item && typeof item === "object") {
        const text = (item as Record<string, unknown>).text;
        if (typeof text === "string") out.push(text);
      }
    }
  }
  return out;
}

interface CompletionLaunchOptions {
  agentCompleteMarker?: boolean;
}

async function launchCompletionSession(
  sessionName: string,
  context: LiveMonitorContext,
  options: CompletionLaunchOptions = {},
): Promise<void> {
  const completionSession = `complete-${sessionName}-${Math.floor(Date.now() / 1000)}`;
  const shellCommand = buildCompletionCommand(sessionName, context, options);
  await pty.spawn(completionSession, "bash", ["-lc", shellCommand], {
    env: {
      ...stringEnv(context.env),
      MENTIKO_RUN_ID: context.runId,
      RUN_ID: context.runId,
      NAMESPACE_ID: context.namespaceId,
      ORG_ID: context.orgId,
      WORKSPACE_TYPE: context.workspaceType,
      MENTIKO_RUN_DIR: context.runDir,
      MENTIKO_CODE_ROOT: config.codeRoot,
      EVENTS_DIR: context.eventsDir,
      STATE_DIR: context.stateDir,
      MENTIKO_RUNNER_V2: context.env.MENTIKO_RUNNER_V2 || "",
      MENTIKO_RUNNER_V2_COMPLETION: context.env.MENTIKO_RUNNER_V2_COMPLETION || "",
      MENTIKO_MONITOR_COMPLETION_LATCH: options.agentCompleteMarker ? "1" : "",
    },
  });
}

function buildCompletionCommand(
  sessionName: string,
  context: LiveMonitorContext,
  options: CompletionLaunchOptions = {},
): string {
  const completeShell = join(config.codeRoot, "lib", "chain-runner-complete.sh");
  const compiled = join(config.codeRoot, "lib", "runner-v2-complete.js");
  const devScript = join(config.codeRoot, "web", "scripts", "runner-v2-complete.cjs");
  const session = shellEscape(sessionName);
  const chain = shellEscape(context.chainPath);
  const shell = `exec ${shellEscape(completeShell)} ${session} ${chain}`;
  const completion = [
    "if command -v node >/dev/null 2>&1; then",
    `if [[ -f ${shellEscape(compiled)} ]]; then node ${shellEscape(compiled)} ${session} ${chain}; _s=$?; if [[ "$_s" -ne 64 ]]; then exit "$_s"; fi; fi;`,
    `if [[ -f ${shellEscape(devScript)} ]]; then node ${shellEscape(devScript)} ${session} ${chain}; _s=$?; if [[ "$_s" -ne 64 ]]; then exit "$_s"; fi; fi;`,
    "fi;",
    shell,
  ].join(" ");
  const env = {
    MENTIKO_RUN_ID: context.runId,
    RUN_ID: context.runId,
    NAMESPACE_ID: context.namespaceId,
    ORG_ID: context.orgId,
    WORKSPACE_TYPE: context.workspaceType,
    MENTIKO_RUN_DIR: context.runDir,
    MENTIKO_CODE_ROOT: config.codeRoot,
    EVENTS_DIR: context.eventsDir,
    STATE_DIR: context.stateDir,
    MENTIKO_RUNNER_V2: context.env.MENTIKO_RUNNER_V2 || "",
    MENTIKO_RUNNER_V2_COMPLETION: context.env.MENTIKO_RUNNER_V2_COMPLETION || "",
    MENTIKO_MONITOR_COMPLETION_LATCH: options.agentCompleteMarker ? "1" : "",
  };
  const envArgs = Object.entries(env).map(([key, value]) => `${key}=${shellEscape(String(value))}`).join(" ");
  return `env ${envArgs} bash -lc ${shellEscape(completion)}`;
}

function writeDiagnosticEvent(eventsDir: string, event: MonitorDiagnosticEvent): void {
  mkdirSync(eventsDir, { recursive: true });
  const lines = [
    `event: ${event.event}`,
    `source: ${event.source}`,
    `run_id: ${event.runId}`,
    `agent: ${event.agent}`,
    `timestamp: ${new Date().toISOString()}`,
    `reason: ${event.reason}`,
    ...(typeof event.staleCount === "number" ? [`stale_count: ${event.staleCount}`] : []),
    "processed: false",
    "",
  ];
  writeFileSync(join(eventsDir, event.filename), lines.join("\n"));
}

function findJsonl(root: string, uuid: string, depth: number): string {
  if (depth < 0 || !existsSync(root)) return "";
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return "";
  }
  for (const entry of entries) {
    const path = join(root, entry);
    if (entry.includes(uuid) && entry.endsWith(".jsonl")) return path;
    try {
      if (statSync(path).isDirectory()) {
        const nested = findJsonl(path, uuid, depth - 1);
        if (nested) return nested;
      }
    } catch {
      continue;
    }
  }
  return "";
}

function hasPgrep(): boolean {
  return spawnSync("command", ["-v", "pgrep"], { shell: true, stdio: "ignore" }).status === 0;
}

function hasChildProcess(pid: number): boolean {
  return spawnSync("pgrep", ["-P", String(pid)], { stdio: "ignore" }).status === 0;
}

function readPositiveIntFile(path: string): number {
  try {
    return positiveInt(readFileSync(path, "utf8").trim(), 0);
  } catch {
    return 0;
  }
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
}

function stringEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}
