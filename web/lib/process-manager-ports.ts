// process-manager-ports.ts -- port-holder inspection and recorded-pid bookkeeping
// for the process manager. Extracted so it can be unit tested: process-manager.ts
// runs main() on import. Rule this module enforces (issue #105): the manager only
// ever signals pids it recorded itself; anything else holding a port is reported,
// never killed.

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
}

const COMMAND_SNIPPET_MAX = 120;

export function pmStateDir(home: string): string {
  return path.join(home, '.mentiko-pm', 'state');
}

export function pidFilePath(stateDir: string, name: string): string {
  return path.join(stateDir, `${name.replace(/[^a-zA-Z0-9_-]/g, '-')}.pid.json`);
}

export function portHolderPids(port: number): number[] {
  try {
    // lsof first: macOS fuser has no `-n tcp` (Linux-only syntax), so a
    // fuser-first chain silently returns nothing on darwin. Only LISTEN
    // sockets count: a program merely connected to the port (e.g. a web UI
    // talking to an engine) is not its holder.
    // ponytail: the fuser fallback cannot filter to listeners; use ss -ltnp
    // if an image ever ships without lsof.
    const cmd =
      `if command -v lsof >/dev/null 2>&1; then ` +
      `lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null; ` +
      `elif command -v fuser >/dev/null 2>&1; then ` +
      `fuser -n tcp ${port} 2>/dev/null; fi`;
    const out = execSync(cmd, { encoding: 'utf-8' }).trim();
    if (!out) return [];
    return out
      .split(/\s+/)
      .map((p) => Number(p))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
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

// A recorded pid may only be signaled if the process behind it still runs the
// command we recorded. A recycled pid running something else is never ours.
export function recordedPidStillOurs(entry: RecordedPid): boolean {
  const cmdline = pidCommandLine(entry.pid);
  return cmdline !== null && cmdline.includes(entry.cmd);
}
