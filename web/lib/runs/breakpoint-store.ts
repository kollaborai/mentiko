import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import config from "../config";

const BREAKPOINT_DIR = config.debugDir;

export interface Breakpoint {
  agentId: string;
  enabled: boolean;
  condition?: string; // future: conditional breakpoints
  hitCount?: number;
}

export interface BreakpointState {
  chainId: string;
  breakpoints: Breakpoint[];
  pausedAt?: string; // agentId where execution is paused
  pausedAtTimestamp?: string;
  resumeRequested: boolean;
  lastUpdated: string;
}

// get breakpoint file path for a chain
function getBreakpointPath(chainId: string): string {
  return join(BREAKPOINT_DIR, chainId, "breakpoints.json");
}

// ensure directory exists
function ensureDir(chainId: string) {
  const dir = join(BREAKPOINT_DIR, chainId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// load breakpoints for a chain
export function loadBreakpoints(chainId: string): BreakpointState {
  const path = getBreakpointPath(chainId);

  if (!existsSync(path)) {
    return {
      chainId,
      breakpoints: [],
      resumeRequested: false,
      lastUpdated: new Date().toISOString(),
    };
  }

  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return data;
  } catch {
    return {
      chainId,
      breakpoints: [],
      resumeRequested: false,
      lastUpdated: new Date().toISOString(),
    };
  }
}

// save breakpoints for a chain
export function saveBreakpoints(state: BreakpointState): void {
  ensureDir(state.chainId);
  state.lastUpdated = new Date().toISOString();
  writeFileSync(getBreakpointPath(state.chainId), JSON.stringify(state, null, 2));
}

// set or update a breakpoint
export function setBreakpoint(chainId: string, agentId: string, enabled: boolean = true): BreakpointState {
  const state = loadBreakpoints(chainId);
  const existing = state.breakpoints.find((b) => b.agentId === agentId);

  if (existing) {
    existing.enabled = enabled;
  } else {
    state.breakpoints.push({ agentId, enabled, hitCount: 0 });
  }

  saveBreakpoints(state);
  return state;
}

// clear a breakpoint
export function clearBreakpoint(chainId: string, agentId: string): BreakpointState {
  const state = loadBreakpoints(chainId);
  state.breakpoints = state.breakpoints.filter((b) => b.agentId !== agentId);
  saveBreakpoints(state);
  return state;
}

// clear all breakpoints for a chain
export function clearAllBreakpoints(chainId: string): BreakpointState {
  const state = loadBreakpoints(chainId);
  state.breakpoints = [];
  state.pausedAt = undefined;
  state.resumeRequested = false;
  saveBreakpoints(state);
  return state;
}

// check if execution should pause at an agent
export function shouldPause(chainId: string, agentId: string): boolean {
  const state = loadBreakpoints(chainId);
  const bp = state.breakpoints.find((b) => b.agentId === agentId);
  return bp?.enabled ?? false;
}

// pause execution at an agent
export function pauseAt(chainId: string, agentId: string): BreakpointState {
  const state = loadBreakpoints(chainId);
  state.pausedAt = agentId;
  state.pausedAtTimestamp = new Date().toISOString();
  state.resumeRequested = false;

  // increment hit count
  const bp = state.breakpoints.find((b) => b.agentId === agentId);
  if (bp) {
    bp.hitCount = (bp.hitCount || 0) + 1;
  }

  saveBreakpoints(state);
  return state;
}

// request resume from breakpoint
export function requestResume(chainId: string): BreakpointState {
  const state = loadBreakpoints(chainId);
  state.resumeRequested = true;
  saveBreakpoints(state);
  return state;
}

// check if resume was requested (called by execution engine)
export function isResumeRequested(chainId: string): boolean {
  const state = loadBreakpoints(chainId);
  return state.resumeRequested;
}

// clear pause state (called by execution engine after resume)
export function clearPause(chainId: string): BreakpointState {
  const state = loadBreakpoints(chainId);
  state.pausedAt = undefined;
  state.pausedAtTimestamp = undefined;
  state.resumeRequested = false;
  saveBreakpoints(state);
  return state;
}

// list all chains with breakpoints
export function listBreakpointChains(): string[] {
  if (!existsSync(BREAKPOINT_DIR)) {
    return [];
  }

  try {
    const entries = readdirSync(BREAKPOINT_DIR, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => existsSync(join(BREAKPOINT_DIR, name, "breakpoints.json")));
  } catch {
    return [];
  }
}
