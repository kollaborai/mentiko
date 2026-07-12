import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pty } from "@/lib/pty/pty-client";
import { shellEscape } from "@/lib/api/audit-exec";
import config from "@/lib/config";
import {
  classifyContextExhaustion,
  classifyDeath,
  classifyStall,
  detectContextExhaustion,
  type MonitorDiagnosticEvent,
} from "@/lib/runner-v2/monitor-diagnostics";
import {
  captureAssertsAgentComplete,
  captureHash,
  clearMonitorState,
  computeLatch,
  crossRunAdoptionAllowed,
  findAgentCompletionEventAnyRun,
  findCompletionEventFile,
  latchExists,
  loadMonitorState,
  monitorStatePaths,
  readDeclaredAgentIds,
  readDeclaredEmits,
  readEventRunAndTimestamp,
  saveMonitorState,
  writeLatch,
} from "@/lib/runner-v2/monitor-io";
import type { MonitorDriverIO } from "@/lib/runner-v2/monitor";
import { readRunJson, updateRunAgent, updateRunStatus, type RunRecord } from "@/lib/runner-v2/run-state";

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
  // A cross-run event is usable only after crossRunAdoptionAllowed accepts its
  // task/predecessor or freshness+chain proof. Preserve that accepted evidence
  // into the typed completion entrypoint; otherwise it re-reads only this run's
  // events and falsely fails the completion it just allowed the monitor to take.
  let acceptedCrossRunCompletionEvent = false;
  return {
    hasSession: (session) => pty.alive(session),
    observe: async (session) => {
      const capture = await pty.capture(session, 20).catch(() => "");
      const expectedEvent = readDeclaredEmits(context.chainPath, context.agentId);
      let eventFile = findCompletionEventFile({
        eventsDir: context.eventsDir,
        runId: context.runId,
        agentId: context.agentId,
        expectedEvent,
        sessionName: context.sessionName,
      }) || findCompletionEventFile({
        eventsDir: join(dirname(context.chainPath), "events"),
        runId: context.runId,
        agentId: context.agentId,
        expectedEvent,
        sessionName: context.sessionName,
      });

      // Cross-run completion recovery: this run has NO completion event of its own,
      // yet the agent has printed a standalone AGENT_COMPLETE AND its declared emit
      // event already exists under ANOTHER run (a duplicate run of work a prior run
      // finished). Gated on the agent asserting completion, so an actively-working
      // run (which has not printed the marker) is never short-circuited; run-scoped
      // isolation above stays the primary signal.
      //
      // Finding the event is not enough to adopt it: a stale event from an
      // unrelated prior run must not complete this run. crossRunAdoptionAllowed
      // requires either a proven predecessor/task relation, or a tight freshness
      // window plus matching chain identity; otherwise this leaves the event for
      // the reconcile late-event recovery (recoverLateCompletionEvents) instead of
      // latching here.
      if (!eventFile && expectedEvent && captureAssertsAgentComplete(capture)) {
        const primaryEventsDir = context.eventsDir;
        const secondaryEventsDir = join(dirname(context.chainPath), "events");
        const allAgentIds = readDeclaredAgentIds(context.chainPath);
        let candidateDir = primaryEventsDir;
        let candidate = findAgentCompletionEventAnyRun({
          eventsDir: primaryEventsDir,
          agentId: context.agentId,
          emitsEvent: expectedEvent,
          allAgentIds,
        });
        if (!candidate) {
          candidate = findAgentCompletionEventAnyRun({
            eventsDir: secondaryEventsDir,
            agentId: context.agentId,
            emitsEvent: expectedEvent,
            allAgentIds,
          });
          candidateDir = secondaryEventsDir;
        }
        if (candidate) {
          const { runId: candidateRunId, timestamp: candidateTimestamp } = readEventRunAndTimestamp(candidateDir, candidate);
          const currentRun = safeReadRunJson(context.runJsonPath);
          const candidateRun = candidateRunId
            ? safeReadRunJson(join(dirname(context.runDir), candidateRunId, "run.json"))
            : null;
          const allowed = Boolean(currentRun) && crossRunAdoptionAllowed({
            candidateRunId,
            candidateTimestamp,
            now: new Date(),
            currentRun: currentRun ?? {},
            candidateRun,
          });
          if (allowed) {
            eventFile = candidate;
            acceptedCrossRunCompletionEvent = true;
            console.log(
              `monitor: ${context.agentId} asserted AGENT_COMPLETE and its '${expectedEvent}' completion event ` +
                `exists under another run (${candidate}, run ${candidateRunId}); completing run ${context.runId} cleanly instead of escalating`,
            );
          } else {
            console.log(
              `monitor: ${context.agentId} asserted AGENT_COMPLETE and a '${expectedEvent}' completion event exists ` +
                `under another run (${candidate}, run ${candidateRunId || "unknown"}), but adoption requires a proven ` +
                `predecessor/task relation or fresh+matching-chain evidence; leaving it for reconcile late-event ` +
                `recovery instead of completing run ${context.runId}`,
            );
          }
        }
      }

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
        // Reuse the same 20-line capture: an agent wedged on a context-window-limit
        // error shows it as its stuck tail every tick. Never override a real latch —
        // the reducer checks latched first, so a completed-then-errored agent still
        // completes.
        contextExhausted: !latched && detectContextExhaustion(capture),
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
        acceptedCompletionEvent: acceptedCrossRunCompletionEvent,
      });
    },
    onDied: async (session) => {
      const expectedEvent = readDeclaredEmits(context.chainPath, context.agentId);
      const hasCompletionEvent = Boolean(findCompletionEventFile({
        eventsDir: context.eventsDir,
        runId: context.runId,
        agentId: context.agentId,
        expectedEvent,
        sessionName: context.sessionName,
      }) || findCompletionEventFile({
        eventsDir: join(dirname(context.chainPath), "events"),
        runId: context.runId,
        agentId: context.agentId,
        expectedEvent,
        sessionName: context.sessionName,
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
    onContextExhausted: async (session) => {
      const verdict = classifyContextExhaustion({
        runId: context.runId,
        agentId: context.agentId,
        reason:
          "monitor: agent CLI exhausted its model context window (repeated context-limit error); " +
          "the run cannot generate output to complete and its wedged session was torn down",
        timestamp: timestamp(),
      });
      // FAILED (not blocked): a context-full agent is unresumable, so surface it in
      // Runs/Activity as failed with a clear reason, not a resumable stall.
      updateRunAgent(context.runJsonPath, context.agentId, verdict.agentStatus);
      updateRunStatus(context.runJsonPath, verdict.runStatus, verdict.diagnostic.reason);
      writeDiagnosticEvent(context.eventsDir, verdict.diagnostic);
      // Tear the session down: a stall leaves the pty for a human to inspect, but a
      // context-exhausted session can never make progress and only holds dead weight.
      await pty.remove(session).catch(() => {});
      console.log(`monitor: torn down context-exhausted session ${session} (run ${context.runId} failed)`);
    },
    sleep: (seconds) => sleepMs(seconds * 1000),
    loadState: loadMonitorState,
    saveState: saveMonitorState,
    clearState: clearMonitorState,
    log: (message) => console.log(message),
  };
}

/** Best-effort run.json read for the cross-run adoption guard -- never throws. */
function safeReadRunJson(path: string): RunRecord | null {
  try {
    return existsSync(path) ? readRunJson(path) : null;
  } catch {
    return null;
  }
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

const TRANSCRIPT_UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Pick a session's transcript JSONL from its screen capture. A capture routinely
 * holds MORE than one UUID-shaped string: the CLI status bar carries the real
 * transcript/session UUID, but the agent's goal or prompt commonly echoes OTHER
 * UUIDs -- a decision_id, a task id -- that appear EARLIER in the scrollback.
 * Matching only the first hit resolves to a decoy UUID with no transcript file,
 * so the durable AGENT_COMPLETE marker is never read and the monitor nudges to a
 * false stall until it escalates the run to blocked (the decision-chain hang:
 * decision_id is always a UUID in the prompt, so it wins the first-match every
 * time). Try every distinct UUID in capture order and accept the first that
 * `resolve` maps to a real file -- decoys resolve to "" and are skipped, never
 * guessed. Pure + injected `resolve` so it is unit-tested without the fs/pty.
 */
export function selectTranscriptFromCapture(
  capture: string,
  resolve: (uuid: string) => string,
): string {
  const uuids = [...new Set((capture.match(TRANSCRIPT_UUID_RE) ?? []).map((u) => u.toLowerCase()))];
  for (const uuid of uuids) {
    const hit = resolve(uuid);
    if (hit) return hit;
  }
  return "";
}

async function resolveTranscriptJsonl(
  sessionName: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Promise<string> {
  const explicit = env.MENTIKO_TRANSCRIPT_JSONL;
  if (explicit && existsSync(explicit)) return explicit;

  const capture = await pty.capture(sessionName, positiveInt(env.MENTIKO_TRANSCRIPT_CAPTURE_LINES, 2000)).catch(() => "");
  const root = transcriptRootFromProfile(env.MENTIKO_AGENT_PROFILE_PATH);
  if (!root) return "";
  return selectTranscriptFromCapture(capture, (uuid) => {
    return findJsonl(root, uuid, 4);
  });
}

export function transcriptRootFromProfile(profilePath: string | undefined): string {
  if (!profilePath || !existsSync(profilePath)) return "";
  try {
    const profile = JSON.parse(readFileSync(profilePath, "utf8")) as { log_path?: unknown };
    if (typeof profile.log_path !== "string" || !profile.log_path.trim()) return "";
    return profile.log_path.trim().replace(/^~(?=\/|$)/, homedir()).replace(/\/$/, "");
  } catch {
    return "";
  }
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
  acceptedCompletionEvent?: boolean;
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
      MENTIKO_MONITOR_COMPLETION_LATCH: monitorCompletionLatch(options) ? "1" : "",
    },
  });
}

// Mirrors bash `[[ "$VALUE" =~ ^(1|true|yes|on)$ ]]` (case-sensitive, same as
// lib/agent-functions.sh:702-703 launch-chain-runner-complete).
const RUNNER_V2_TRUTHY = /^(1|true|yes|on)$/;

function isFlagTruthy(value: string | undefined): boolean {
  return typeof value === "string" && RUNNER_V2_TRUTHY.test(value);
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

  // Mirrors lib/agent-functions.sh launch-chain-runner-complete (:694-706), the
  // shell equivalent of this function: typed completion only engages when BOTH
  // MENTIKO_RUNNER_V2 and MENTIKO_RUNNER_V2_COMPLETION are truthy. When disabled,
  // run ONLY the shell completion path -- no node invocation at all. When
  // enabled, run whichever typed script exists and exit with EXACTLY its exit
  // code (including 64) -- fail CLOSED, never fall through to
  // chain-runner-complete.sh. The old "_s=$?; if -ne 64" chain let a
  // declining/unsupported typed script (64, RunnerV2CompletionUnsupportedError)
  // cascade all the way into the shell path even with the flag on, mixing typed
  // + shell ownership for the same completion (see b34fd72).
  const typedCompletionEnabled = isFlagTruthy(context.env.MENTIKO_RUNNER_V2)
    && isFlagTruthy(context.env.MENTIKO_RUNNER_V2_COMPLETION);
  const completion = typedCompletionEnabled
    ? [
        "if ! command -v node >/dev/null 2>&1; then",
        "echo 'runner-v2 completion failed closed: node unavailable' >&2; exit 64;",
        "fi;",
        `if [[ -f ${shellEscape(compiled)} ]]; then node ${shellEscape(compiled)} ${session} ${chain}; exit "$?"; fi;`,
        `if [[ -f ${shellEscape(devScript)} ]]; then node ${shellEscape(devScript)} ${session} ${chain}; exit "$?"; fi;`,
        "echo 'runner-v2 completion failed closed: typed completion entrypoint missing' >&2; exit 64;",
      ].join(" ")
    : shell;
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
    MENTIKO_MONITOR_COMPLETION_LATCH: monitorCompletionLatch(options) ? "1" : "",
  };
  const envArgs = Object.entries(env).map(([key, value]) => `${key}=${shellEscape(String(value))}`).join(" ");
  return `env ${envArgs} bash -lc ${shellEscape(completion)}`;
}

function monitorCompletionLatch(options: CompletionLaunchOptions): boolean {
  return Boolean(options.agentCompleteMarker || options.acceptedCompletionEvent);
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
  // Single shell-string form (no args array) so this does not trip Node's DEP0190
  // "args + shell:true" deprecation. `command -v` is a shell builtin, so shell:true
  // is required; there are no args to escape here.
  return spawnSync("command -v pgrep", { shell: true, stdio: "ignore" }).status === 0;
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
