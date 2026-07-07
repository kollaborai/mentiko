import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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
 * monitor_completion_event_file: an unprocessed event whose run id matches and
 * whose source contains the agent id (never a diagnostic monitor/watchdog event).
 * Returns the filename, or "" if none. This is the "event exists" signal that
 * makes an eventless-but-alive agent distinguishable from one that handed off.
 */
export function findCompletionEventFile(input: {
  eventsDir: string;
  runId: string;
  agentId: string;
}): string {
  if (!input.eventsDir || !existsSync(input.eventsDir)) return "";
  let files: string[];
  try {
    files = readdirSync(input.eventsDir).filter((f) => f.endsWith(".event"));
  } catch {
    return "";
  }
  const agent = input.agentId.toLowerCase();
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
    const source = (fields.source ?? "").toLowerCase();
    if (DIAGNOSTIC_SOURCES.has(source)) continue;
    if (agent && !source.includes(agent) && !(fields.agent ?? "").toLowerCase().includes(agent)) continue;
    return file;
  }
  return "";
}

const DIAGNOSTIC_SOURCES = new Set(["monitor", "watchdog", "chain-runner-complete"]);

function parseEventFields(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && !(key in out)) out[key] = value;
  }
  return out;
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
