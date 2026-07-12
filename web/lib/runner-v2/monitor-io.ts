import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { agentOwnsEvent, sourceMatchesAgent } from "@/lib/runner-v2/completion";
import type { MonitorState } from "@/lib/runner-v2/monitor-types";

// The verifiable core of the typed monitor's I/O adapter. Everything here is a
// pure function or a plain filesystem operation, so it is unit-tested against a
// temp dir. The LIVE-SYSTEM wrappers (PTY capture, pgrep process-gone arming,
// completion-session spawn) are assembled on top of this in monitor-io-live.ts
// and can only be proven by a real chain run — see monitor-v2-contract.json
// readiness_gate. Ports the state-file + event-scan + latch pieces of
// lib/agent-functions.sh monitor-chain-agent / agent-completion-latched.

export const MONITOR_STATE_DIR = join(homedir(), ".mentiko_monitor");

export interface MonitorStateFiles {
  state: string; // md5 hash
  stale: string; // per-cycle counter
  nudges: string; // durable budget
  complete: string; // latch marker
  armed: string; // process-gone arming
  armedGrace: string; // never-armed grace counter
}

export function monitorStatePaths(session: string, dir: string = MONITOR_STATE_DIR): MonitorStateFiles {
  const base = join(dir, session);
  return {
    state: `${base}_state`,
    stale: `${base}_stale`,
    nudges: `${base}_nudges`,
    complete: `${base}_complete`,
    armed: `${base}_armed`,
    armedGrace: `${base}_armed_grace`,
  };
}

function readIntFile(path: string): number {
  try {
    const raw = readFileSync(path, "utf8").trim();
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function readTextFile(path: string): string {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

/**
 * Load the durable MonitorState from disk. Mirrors how monitor-chain-agent seeds
 * from ${session}_state / ${session}_stale / ${session}_nudges — and, crucially,
 * survives a monitor restart (the durable nudge budget must not reset), which is
 * exactly the restart-idempotency the shell relies on.
 */
export function loadMonitorState(session: string, dir: string = MONITOR_STATE_DIR): MonitorState {
  const p = monitorStatePaths(session, dir);
  return {
    prevHash: readTextFile(p.state),
    staleCount: readIntFile(p.stale),
    nudgeCount: readIntFile(p.nudges),
    // echo grace is a within-run signal; the shell keeps it in a local, so a
    // fresh process starts at 0 (a restart cannot be mid-echo).
    nudgeEchoGrace: 0,
    // context-exhaustion streak is likewise a within-run debounce: a restart
    // re-observes and rebuilds it in a couple of ticks (the wedge is persistent).
    contextExhaustedStreak: 0,
  };
}

export function saveMonitorState(session: string, state: MonitorState, dir: string = MONITOR_STATE_DIR): void {
  mkdirSync(dir, { recursive: true });
  const p = monitorStatePaths(session, dir);
  writeFileSync(p.state, state.prevHash);
  writeFileSync(p.stale, String(state.staleCount));
  writeFileSync(p.nudges, String(state.nudgeCount));
}

export function clearMonitorState(session: string, dir: string = MONITOR_STATE_DIR): void {
  const p = monitorStatePaths(session, dir);
  for (const path of [p.state, p.stale, p.complete, p.armed, p.armedGrace]) {
    try {
      rmSync(path);
    } catch {
      /* best-effort, mirrors the shell rm -f */
    }
  }
}

/** md5 of the last N lines of a capture — the shell's activity/quiescence hash. */
export function captureHash(capture: string, lines = 20): string {
  const tail = capture.split("\n").slice(-lines).join("\n");
  return createHash("md5").update(tail).digest("hex");
}

/**
 * Find the completion event file for this run/agent in the events dir, mirroring
 * monitor_completion_event_file: an unprocessed event whose run id matches, whose
 * event NAME equals the agent's declared `emits` (shell monitor-completion.sh:44,61
 * -- caller must resolve this via readDeclaredEmits and pass it in), and whose
 * source/agent EXACTLY identifies this agent -- agentOwnsEvent, never a
 * substring/prefix match, never a diagnostic monitor/watchdog event. Real events are
 * typically stamped with the session name (agentId + run suffix, e.g.
 * "writer-run-1"), not the bare agent id, so callers should pass sessionName
 * (agentOwnsEvent's third owner candidate) -- without it, only an event stamped
 * with the literal bare agent id (or a configured sessionPrefix) will match, which
 * is intentionally conservative (fail-closed) rather than a silent no-op. Returns
 * the filename, or "" if none, including when the agent has no declared emits event
 * at all (mirrors shell's `-n "$expected_event"` guard: no declared event, no
 * completion file, ever). This is the "event exists" signal that makes an
 * eventless-but-alive agent distinguishable from one that handed off.
 */
export function findCompletionEventFile(input: {
  eventsDir: string;
  runId: string;
  agentId: string;
  expectedEvent: string;
  sessionName?: string;
}): string {
  if (!input.eventsDir || !existsSync(input.eventsDir)) return "";
  if (!input.expectedEvent) return "";
  let files: string[];
  try {
    files = readdirSync(input.eventsDir).filter((f) => f.endsWith(".event"));
  } catch {
    return "";
  }
  const expectedEvent = input.expectedEvent.toLowerCase();
  for (const file of files) {
    let body: string;
    try {
      body = readFileSync(join(input.eventsDir, file), "utf8");
    } catch {
      continue;
    }
    const fields = parseEventFields(body);
    if (fields.processed === "true") continue;
    if (input.runId && fields.run_id && fields.run_id !== input.runId) continue;
    if ((fields.event ?? "").toLowerCase() !== expectedEvent) continue;
    const source = (fields.source ?? "").toLowerCase();
    if (DIAGNOSTIC_SOURCES.has(source)) continue;
    if (!agentOwnsEvent(toOwnershipCandidate(fields), { id: input.agentId }, input.sessionName)) continue;
    return file;
  }
  return "";
}

const DIAGNOSTIC_SOURCES = new Set(["monitor", "watchdog", "chain-runner-complete"]);

/** Shapes a parsed field map into the RunnerEventRecord agentOwnsEvent expects. */
function toOwnershipCandidate(fields: Record<string, string>) {
  return {
    event: fields.event ?? "",
    source: fields.source ?? "",
    runId: fields.run_id ?? "",
    timestamp: fields.timestamp ?? "",
    processed: fields.processed === "true",
    data: fields.data ?? "",
    fields,
  };
}

function parseEventFields(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && !(key in out)) out[key] = value;
  }

  // Shell falls back to whole-body JSON parsing for whichever plain
  // key:value lines are missing (monitor-completion.sh:55-58 for
  // event/source, :66-68 for run_id -- independently guarded): a valid JSON
  // event body (e.g. from `mentiko emit --json`) the shell accepts must not
  // be invisible to the typed monitor, producing a false stall/nudge.
  if ((!out.event && !out.source) || !out.run_id) {
    const json = tryParseJsonObject(body);
    if (json) {
      if (!out.event && !out.source) {
        const event = firstString(json.event, json.event_name);
        const source = firstString(json.source, json.source_agent, json.agent);
        if (event) out.event = event;
        if (source) out.source = source;
      }
      if (!out.run_id) {
        const runId = firstString(json.run_id, json.runId);
        if (runId) out.run_id = runId;
      }
    }
  }
  return out;
}

function tryParseJsonObject(body: string): Record<string, unknown> | null {
  const trimmed = body.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value) return value;
  }
  return "";
}

/**
 * Cross-run completion recovery finder. Like findCompletionEventFile but WITHOUT
 * the run-id filter, and REQUIRING the event name to equal the agent's declared
 * emit -- so it matches ONLY this agent's actual completion event, under any run.
 *
 * Motivating case: a duplicate run of work a prior run already finished. The agent
 * prints AGENT_COMPLETE but emits nothing under the duplicate run (its work + event
 * are stamped the earlier run), so the run-scoped findCompletionEventFile returns
 * "" and the monitor nudges to a false stalled-escalate. The live IO consults this
 * ONLY when the agent has asserted completion AND this run has no event of its own,
 * so run-scoped isolation stays the primary signal for the normal path.
 */
export function findAgentCompletionEventAnyRun(input: {
  eventsDir: string;
  agentId: string;
  emitsEvent: string;
  allAgentIds?: string[];
}): string {
  if (!input.eventsDir || !input.emitsEvent || !existsSync(input.eventsDir)) return "";
  let files: string[];
  try {
    files = readdirSync(input.eventsDir).filter((f) => f.endsWith(".event"));
  } catch {
    return "";
  }
  const agent = input.agentId.toLowerCase();
  const emits = input.emitsEvent.toLowerCase();
  for (const file of files) {
    let body: string;
    try {
      body = readFileSync(join(input.eventsDir, file), "utf8");
    } catch {
      continue;
    }
    const fields = parseEventFields(body);
    if (fields.processed === "true") continue;
    // Must be the agent's DECLARED completion event -- tighter than agentId alone,
    // so an unrelated event for the same agent under another run cannot false-latch.
    if ((fields.event ?? "").toLowerCase() !== emits) continue;
    const source = (fields.source ?? "").toLowerCase();
    if (DIAGNOSTIC_SOURCES.has(source)) continue;
    // Cross-run scan: the event is from a DIFFERENT session, so its source is
    // session-shaped ("<agent>-run-<other>"), never the current session name.
    // Reuse completion ownership so a prefix agent ("api") cannot steal a
    // sibling agent's event ("api-reviewer" or "api-reviewer-run-123") when
    // the chain gives us the complete identity set. Legitimate session suffixes
    // for the actual agent still match.
    const fieldAgent = (fields.agent ?? "").toLowerCase();
    const ownsEvent = sourceMatchesAgent(source, { id: agent }, input.allAgentIds)
      || sourceMatchesAgent(fieldAgent, { id: agent }, input.allAgentIds);
    if (agent && !ownsEvent) continue;
    return file;
  }
  return "";
}

/**
 * True if the capture contains a standalone AGENT_COMPLETE line (the agent
 * asserting completion). Strict trim-equality so the monitor's own nudge text
 * ("...output AGENT_COMPLETE on its own line.") -- where the token is mid-line --
 * can never match. This is only a GATE for cross-run recovery, never a standalone
 * latch (durable-transcript / event stay the authoritative marker signals).
 */
export function captureAssertsAgentComplete(capture: string): boolean {
  if (!capture) return false;
  return capture.split(/\r?\n/).some((line) => line.trim() === "AGENT_COMPLETE");
}

/**
 * The declared completion event name (`emits`) for an agent in a chain.json, or ""
 * if the chain / agent / emits can't be resolved. Scopes cross-run completion
 * recovery to the agent's actual completion event. Array-valued emits return ""
 * (no recovery) rather than guessing.
 */
export function readDeclaredEmits(chainPath: string, agentId: string): string {
  try {
    const chain = JSON.parse(readFileSync(chainPath, "utf8")) as { agents?: unknown };
    const agents = Array.isArray(chain.agents) ? chain.agents : [];
    for (const agent of agents) {
      if (agent && typeof agent === "object" && (agent as { id?: unknown }).id === agentId) {
        const emits = (agent as { emits?: unknown }).emits;
        return typeof emits === "string" ? emits : "";
      }
    }
  } catch {
    /* unreadable chain -> no cross-run recovery */
  }
  return "";
}

/** Full chain agent-id set for guarded cross-run source ownership. */
export function readDeclaredAgentIds(chainPath: string): string[] {
  try {
    const chain = JSON.parse(readFileSync(chainPath, "utf8")) as { agents?: unknown };
    if (!Array.isArray(chain.agents)) return [];
    return chain.agents
      .filter((agent): agent is { id: string } => (
        Boolean(agent)
        && typeof agent === "object"
        && typeof (agent as { id?: unknown }).id === "string"
        && Boolean((agent as { id: string }).id.trim())
      ))
      .map((agent) => agent.id);
  } catch {
    return [];
  }
}

/**
 * The sticky latch decision (agent-completion-latched): once latched, stay
 * latched (the marker can scroll off the capture window). Latch on EITHER a
 * durable-transcript AGENT_COMPLETE OR a completion event file. The durable
 * marker (not the rendered screen) is what the caller must supply — resolving it
 * is a live-system step (transcript UUID -> JSONL), deliberately not done here.
 */
export function computeLatch(input: {
  alreadyLatched: boolean;
  markerDurable: boolean;
  completionEventPresent: boolean;
}): boolean {
  return input.alreadyLatched || input.markerDurable || input.completionEventPresent;
}

/** Persist the sticky latch so a later poll still counts it after it scrolls off. */
export function writeLatch(session: string, dir: string = MONITOR_STATE_DIR): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(monitorStatePaths(session, dir).complete, "");
}

export function latchExists(session: string, dir: string = MONITOR_STATE_DIR): boolean {
  return existsSync(monitorStatePaths(session, dir).complete);
}

/**
 * Read the run_id + timestamp fields off one specific event file. For callers
 * (monitor-live-io's cross-run completion recovery) that need adoption
 * evidence beyond "does a matching-name file exist somewhere": which run
 * produced it, and how fresh it is.
 */
export function readEventRunAndTimestamp(eventsDir: string, file: string): { runId: string; timestamp: string } {
  try {
    const fields = parseEventFields(readFileSync(join(eventsDir, file), "utf8"));
    return { runId: fields.run_id ?? "", timestamp: fields.timestamp ?? "" };
  } catch {
    return { runId: "", timestamp: "" };
  }
}

export interface CrossRunAdoptionRunRef {
  taskId?: string;
  chainId?: string;
  chain?: string;
  parent_run_id?: string;
}

// Mirrors the reconcile route's RUN_HANDOFF_GRACE_MS order of magnitude
// (web/app/api/tasks/reconcile/route.ts) for "how long is a stale-but-real
// handoff plausible" -- a tight window, not a blanket allowance.
const CROSS_RUN_ADOPTION_FRESHNESS_MS = 5 * 60 * 1000;

/**
 * Whether a cross-run completion event found under a DIFFERENT run id may be
 * adopted to complete the CURRENT run (monitor-live-io's cross-run recovery).
 * Two independent paths to "yes":
 *
 *  1. a PROVEN predecessor/attempt relation: the candidate run is the current
 *     run's recorded parent (parent_run_id), or both runs are attempts at the
 *     same task (matching taskId) -- a system-recorded relationship, not a
 *     guess. No freshness requirement: the relationship itself is the proof.
 *  2. a TIGHT freshness window on the event's own timestamp PLUS matching
 *     chain identity, for ad-hoc runs with no task linkage.
 *
 * Anything else (unknown candidate run, no relation, stale, or a
 * chain/task mismatch): no adoption. The caller must not latch -- leave it
 * for the reconcile late-event recovery (recoverLateCompletionEvents, which
 * is run-scoped and keys off real attempt state) instead of a stale event
 * from an unrelated prior run silently completing this one.
 */
export function crossRunAdoptionAllowed(input: {
  candidateRunId: string;
  candidateTimestamp: string;
  now: Date;
  currentRun: CrossRunAdoptionRunRef;
  candidateRun: CrossRunAdoptionRunRef | null;
}): boolean {
  if (!input.candidateRunId) return false;

  if (input.currentRun.parent_run_id && input.currentRun.parent_run_id === input.candidateRunId) {
    return true;
  }
  if (input.currentRun.taskId && input.candidateRun?.taskId === input.currentRun.taskId) {
    return true;
  }

  const ageMs = eventAgeMs(input.candidateTimestamp, input.now);
  if (ageMs === null || ageMs > CROSS_RUN_ADOPTION_FRESHNESS_MS) return false;

  const sameChain =
    (Boolean(input.currentRun.chainId) && input.currentRun.chainId === input.candidateRun?.chainId) ||
    (Boolean(input.currentRun.chain) && input.currentRun.chain === input.candidateRun?.chain);
  return sameChain;
}

function eventAgeMs(timestamp: string, now: Date): number | null {
  if (!timestamp) return null;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return null;
  return now.getTime() - parsed;
}
