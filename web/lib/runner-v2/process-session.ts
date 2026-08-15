import { spawnSync } from "node:child_process";

const DEFAULT_PROBE_TIMEOUT_MS = 2_000;
const DEFAULT_QUIESCE_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_MS = 50;

export type ProcessSessionProbe = (sessionId: number) => boolean;

function validSessionId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * A PTY child calls setsid(), so its recorded process PID is also the OS
 * session id inherited by the shell, CLI, and every job-control process group
 * below it. PTY removal can delete the registry entry before those descendants
 * finish handling SIGHUP/SIGTERM. Treat only non-zombie members as live work.
 * Probe failure is fail-closed: capacity must stay held when the OS cannot
 * prove the old process session is quiescent.
 */
export function processSessionIsQuiescent(sessionId: number): boolean {
  if (!validSessionId(sessionId)) return false;
  const result = spawnSync("ps", ["-eo", "sess=,stat="], {
    encoding: "utf8",
    timeout: DEFAULT_PROBE_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0 || typeof result.stdout !== "string") return false;

  for (const line of result.stdout.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\S+)/);
    if (!match || Number(match[1]) !== sessionId) continue;
    if (!match[2].startsWith("Z")) return false;
  }
  return true;
}

export function waitForProcessSessionQuiescence(input: {
  sessionId: number;
  timeoutMs?: number;
  pollMs?: number;
  probe?: ProcessSessionProbe;
  now?: () => number;
  sleep?: (milliseconds: number) => void;
}): boolean {
  const timeoutMs = Math.max(0, input.timeoutMs ?? DEFAULT_QUIESCE_TIMEOUT_MS);
  const pollMs = Math.max(1, input.pollMs ?? DEFAULT_POLL_MS);
  const probe = input.probe || processSessionIsQuiescent;
  const now = input.now || (() => Date.now());
  const sleep = input.sleep || ((milliseconds: number) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
  });
  const deadline = now() + timeoutMs;

  while (true) {
    if (probe(input.sessionId)) return true;
    const remaining = deadline - now();
    if (remaining <= 0) return false;
    sleep(Math.min(pollMs, remaining));
  }
}
