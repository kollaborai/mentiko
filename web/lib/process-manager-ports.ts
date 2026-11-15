// process-manager-ports.ts -- port-holder inspection and recorded-pid bookkeeping
// for the process manager. Extracted so it can be unit tested: process-manager.ts
// runs main() on import. Rules this module enforces (issue #105):
//   1. the manager only ever signals pids whose process-instance identity
//      (pid + OS start time) it recorded itself and can re-verify;
//   2. anything else holding a port is reported, never killed;
//   3. if port inspection cannot run, that is a failure, not "port is free".

import { execSync, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface PortHolder {
  pid: number;
  command: string;
}

export interface RecordedPid {
  name: string;
  pid: number;
  cmd: string;
  /** OS start time of the recorded pid (ps lstart), normalized. The identity half. */
  start?: string | null;
}

const COMMAND_SNIPPET_MAX = 120;

export function pmStateDir(home: string): string {
  return path.join(home, '.mentiko-pm', 'state');
}

export function pidFilePath(stateDir: string, name: string): string {
  return path.join(stateDir, `${name.replace(/[^a-zA-Z0-9_-]/g, '-')}.pid.json`);
}

export const PORT_INSPECTION_MISSING = 'port inspection unavailable';

// Lists pids LISTENING on the TCP port. lsof first: macOS fuser has no `-n tcp`
// (Linux-only syntax). Only listening sockets count (-sTCP:LISTEN), so a client
// with an open connection to the port is never mistaken for the server.
// Throws when no inspection utility exists — absence of tooling must not be
// read as "port is free" (fail closed).
export function portHolderPids(port: number): number[] {
  const cmd =
    `if command -v lsof >/dev/null 2>&1; then ` +
    `lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null; ` +
    `elif command -v fuser >/dev/null 2>&1; then ` +
    `fuser -n tcp ${port} 2>/dev/null; ` +
    `else echo "${PORT_INSPECTION_MISSING}" >&2; exit 3; fi`;
  let out: string;
  try {
    out = execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err: unknown) {
    const e = err as { status?: number; stderr?: string };
    if (e.status === 3 || String(e.stderr || '').includes(PORT_INSPECTION_MISSING)) {
      throw new Error(`no port inspection utility (lsof or fuser) available to check port ${port}`);
    }
    // lsof/fuser exit nonzero when nothing matches the port: empty result.
    return [];
  }
  if (!out) return [];
  return out
    .split(/\s+/)
    .map((p) => Number(p))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

export function pidCommandLine(pid: number): string | null {
  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

// OS start time of the pid, normalized for comparison. This plus the pid forms
// the process-instance identity: a recycled pid has a different start time.
export function pidStartTime(pid: number): string | null {
  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    return out ? out.split(/\s+/).join(' ') : null;
  } catch {
    return null;
  }
}

// Ownership proof: the pid must be alive and its current OS start time must
// equal the recorded one. No recorded start, unreadable ps, or mismatch all
// mean NOT ours (fail closed) — a pid alone is never ownership.
export function pidIdentityMatches(pid: number, start: string | null | undefined): boolean {
  if (!pid || !start) return false;
  return pidStartTime(pid) === start;
}

export function describePortHolders(port: number): PortHolder[] {
  return portHolderPids(port)
    .map((pid) => {
      const command = pidCommandLine(pid) ?? `(pid ${pid})`;
      return { pid, command: command.slice(0, COMMAND_SNIPPET_MAX) };
    })
    .map((h) => ({ ...h, command: h.command.split('\n')[0] }));
}

export function portHeldByOthers(port: number, ownPids: Set<number>): PortHolder[] {
  return describePortHolders(port).filter((h) => !ownPids.has(h.pid));
}

// -- recorded pid files (own state dir only) --

export function writePidFile(stateDir: string, entry: RecordedPid): void {
  try {
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const tmp = pidFilePath(stateDir, entry.name) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(entry) + '\n', 'utf-8');
    fs.renameSync(tmp, pidFilePath(stateDir, entry.name));
  } catch {} // non-fatal: cleanup is best-effort
}

export function removePidFile(stateDir: string, name: string): void {
  try { fs.unlinkSync(pidFilePath(stateDir, name)); } catch {}
}

export function readPidFiles(stateDir: string): RecordedPid[] {
  try {
    return fs
      .readdirSync(stateDir)
      .filter((f) => f.endsWith('.pid.json'))
      .map((f) => {
        try {
          const parsed = JSON.parse(fs.readFileSync(path.join(stateDir, f), 'utf-8'));
          if (
            typeof parsed?.name === 'string' &&
            Number.isInteger(parsed?.pid) && parsed.pid > 0 &&
            typeof parsed?.cmd === 'string' && parsed.cmd
          ) return parsed as RecordedPid;
        } catch {}
        return null;
      })
      .filter((e): e is RecordedPid => e !== null);
  } catch {
    return [];
  }
}

export function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// A recorded pid may only be signaled if the process behind it is alive AND
// its OS start time still matches the recorded identity. Anything else — no
// recorded start (legacy file), dead pid, unreadable ps, mismatch — is not
// ours. A command-line substring alone is never ownership.
export function recordedPidStillOurs(entry: RecordedPid): boolean {
  return pidAlive(entry.pid) && pidIdentityMatches(entry.pid, entry.start);
}

// -- daemon discovery (issue #105 P1) --

export function processGroupInfo(pid: number): { pgid: number; ppid: number } | null {
  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'pgid=,ppid='], {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    const parts = out.split(/\s+/).map(Number);
    if (parts.length === 2 && parts.every(Number.isInteger)) return { pgid: parts[0], ppid: parts[1] };
    return null;
  } catch {
    return null;
  }
}

// After a daemonizing parent exits, find the forked daemon among pgrep matches.
// A candidate counts only if it descends from the spawned parent (ppid) or
// shares its process group (the parent is spawned detached, so it was its own
// group leader and its pgid equals its pid — the group survives the parent).
// Anything else is someone else's daemon: record nothing.
export function findOwnedDaemonPid(
  pattern: string,
  parentPid: number,
  excludePids: Set<number>,
): number | null {
  if (!parentPid) return null;
  let pids = '';
  try {
    pids = execSync(`pgrep -f "${pattern}" 2>/dev/null`, { encoding: 'utf-8' }).trim();
  } catch {
    return null; // pgrep exits 1 on no match
  }
  for (const p of pids.split('\n').filter(Boolean)) {
    const pid = Number(p);
    if (!Number.isInteger(pid) || pid <= 0 || excludePids.has(pid)) continue;
    const info = processGroupInfo(pid);
    if (!info) continue;
    if (info.pgid === parentPid || info.ppid === parentPid) return pid;
  }
  return null;
}
