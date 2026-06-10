/**
 * session-owners: cross-process registry mapping a pty-manager session name
 * to the user id that spawned it.
 *
 * Written by the interactive terminal spawn route; read by every route and the
 * standalone ws-terminal bridge that attaches to / captures / sends input to /
 * removes a session. Persisted as JSON in PTY_MANAGER_DIR (the same directory
 * the ws-token lives in) so the Next.js server process and the separate
 * ws-terminal process share one source of truth.
 *
 * Policy:
 *  - A session WITH a recorded owner may only be accessed by that owner.
 *  - A session with NO recorded owner (agent/run sessions created by the bash
 *    orchestrator via `bin/p create`, or sessions predating this registry) is
 *    treated as org-shared and stays accessible to any authenticated user,
 *    matching how runs/conversations are already org-visible. Interactive
 *    terminals always record an owner, so this only grandfathers agent
 *    sessions and avoids breaking live sessions on deploy.
 *
 * NOTE: no Next.js imports here on purpose — esbuild bundles this module into
 * the standalone ws-terminal process, which must stay free of server-only deps.
 */
import { homedir } from "os";
import { join } from "path";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";

type OwnerMap = Record<string, string>;

function ptyDir(): string {
  // identical computation to ws-terminal.ts so both processes agree
  return process.env.PTY_MANAGER_DIR || join(homedir(), ".pty-manager");
}

function registryPath(): string {
  return join(ptyDir(), "session-owners.json");
}

function readMap(): OwnerMap {
  try {
    const parsed = JSON.parse(readFileSync(registryPath(), "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as OwnerMap) : {};
  } catch {
    return {};
  }
}

function writeMap(map: OwnerMap): void {
  const dir = ptyDir();
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* already exists */
  }
  // atomic replace so concurrent readers never see a partial file
  const tmp = join(dir, `session-owners.${process.pid}.tmp`);
  writeFileSync(tmp, JSON.stringify(map), { mode: 0o600 });
  renameSync(tmp, registryPath());
}

/** Record (or update) the owner of a session. Best-effort; never throws. */
export function recordSessionOwner(name: string, userId: string): void {
  if (!name || !userId) return;
  const map = readMap();
  if (map[name] === userId) return;
  map[name] = userId;
  try {
    writeMap(map);
  } catch {
    /* best-effort: a missing registry just falls back to org-shared */
  }
}

export function getSessionOwner(name: string): string | null {
  return readMap()[name] ?? null;
}

/** Drop a session's owner entry (call when a session is removed). */
export function removeSessionOwner(name: string): void {
  const map = readMap();
  if (name in map) {
    delete map[name];
    try {
      writeMap(map);
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Whether `userId` may access session `name`.
 * Owned sessions: only the owner. Un-owned (agent/legacy): any authed user.
 */
export function canAccessSession(
  name: string,
  userId: string | null | undefined,
): boolean {
  const owner = getSessionOwner(name);
  if (!owner) return true; // agent/legacy session, org-shared
  return !!userId && owner === userId;
}

/** Keep only the session names `userId` is allowed to see. */
export function filterAccessibleSessions(
  names: string[],
  userId: string | null | undefined,
): string[] {
  const map = readMap();
  return names.filter((n) => {
    const owner = map[n];
    return !owner || (!!userId && owner === userId);
  });
}
