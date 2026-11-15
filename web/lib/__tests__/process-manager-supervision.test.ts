// issue #136: the process manager must never leave a restart-enabled service
// in a permanent off state, and must never report a dead service as "ready".
//
// This spawns the real process manager (lib/process-manager.ts) as a child
// process with HOME pointed at a temp directory, so its IPC socket, pid files
// and kollab settings never touch the developer's real ~/.mentiko-pm state.
// Cleanup is unconditional in afterAll: shutdown over IPC, then SIGKILL.

import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";

const webRoot = path.join(__dirname, "..", "..");
const PM_POLL_MS = 150;
const PM_BOOT_TIMEOUT_MS = 30_000;

jest.setTimeout(120_000);

interface ProcStatus {
  name: string;
  pid: number | null;
  status: string;
  restarts: number;
  lastExitCode: number | null;
}

let tmpHome: string;
let pm: ChildProcess | null = null;
let sockPath: string;

function writeConfig(fp: string) {
  const config = {
    version: 1,
    processes: [
      {
        name: "crasher",
        cmd: process.execPath,
        args: ["-e", "process.exit(3)"],
        env: {},
        cwd: tmpHome,
        readiness: { type: "none" },
        restart: { enabled: true, maxRestarts: 2, baseDelay: 30, maxDelay: 120, resetAfter: 600_000 },
        critical: false,
        order: 1,
      },
      {
        // exits cleanly ~80ms in, while its 700ms timer readiness probe is still
        // waiting — the exact race that used to leave status "ready" with pid 0.
        name: "quickdie",
        cmd: process.execPath,
        args: ["-e", "setTimeout(() => process.exit(0), 80)"],
        env: {},
        cwd: tmpHome,
        readiness: { type: "timer", timeout: 700 },
        restart: { enabled: true, maxRestarts: 50, baseDelay: 30, maxDelay: 120, resetAfter: 600_000 },
        critical: false,
        order: 2,
      },
    ],
  };
  fs.writeFileSync(fp, JSON.stringify(config, null, 2));
}

function pmStatusOnce(): Promise<ProcStatus[]> {
  return new Promise((resolve, reject) => {
    const conn = net.createConnection(sockPath);
    const timer = setTimeout(() => {
      conn.destroy();
      reject(new Error("pm status timeout"));
    }, 5000);
    let buf = "";
    conn.on("connect", () => {
      conn.write(JSON.stringify({ id: "t", cmd: "status" }) + "\n");
    });
    conn.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      clearTimeout(timer);
      conn.destroy();
      try {
        const resp = JSON.parse(buf.slice(0, nl));
        if (resp.ok !== true) return reject(new Error(resp.error || "pm status failed"));
        resolve(resp.data.processes as ProcStatus[]);
      } catch (err) {
        reject(err as Error);
      }
    });
    conn.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

async function pmStatusUntil(
  predicate: (procs: ProcStatus[]) => boolean,
  timeoutMs: number,
  onPoll?: (procs: ProcStatus[]) => void,
): Promise<ProcStatus[]> {
  const deadline = Date.now() + timeoutMs;
  let last: ProcStatus[] = [];
  while (Date.now() < deadline) {
    try {
      last = await pmStatusOnce();
      onPoll?.(last);
      if (predicate(last)) return last;
    } catch {
      // pm not accepting connections yet — retry
    }
    await new Promise((r) => setTimeout(r, PM_POLL_MS));
  }
  return last;
}

async function waitSocket(deadlineMs: number): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const probe = net.createConnection(sockPath);
      probe.once("connect", () => { probe.destroy(); resolve(true); });
      probe.once("error", () => resolve(false));
      setTimeout(() => { try { probe.destroy(); } catch {} resolve(false); }, 250);
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`pm socket never came up at ${sockPath}`);
}

async function shutdownPm(): Promise<void> {
  if (!pm || pm.exitCode !== null || pm.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const conn = net.createConnection(sockPath);
    const done = () => { try { conn.destroy(); } catch {} resolve(); };
    conn.on("connect", () => {
      conn.write(JSON.stringify({ id: "sd", cmd: "shutdown" }) + "\n");
      setTimeout(done, 500);
    });
    conn.on("error", done);
    setTimeout(done, 2000);
  });
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && pm.exitCode === null && pm.signalCode === null) {
    await new Promise((r) => setTimeout(r, 100));
  }
}

beforeAll(async () => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pm-supervision-"));
  sockPath = path.join(tmpHome, ".mentiko-pm", "pm.sock");
  const configPath = path.join(tmpHome, "processes.test.json");
  writeConfig(configPath);

  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  // everything the manager derives from HOME must stay inside tmpHome
  childEnv.HOME = tmpHome;
  childEnv.PROCESS_MANAGER_CONFIG = configPath;
  childEnv.MENTIKO_GLOBAL_ROOT = path.join(tmpHome, "global");
  childEnv.KOLLAB_CONFIG_DIR = path.join(tmpHome, "kollab");
  childEnv.PTY_DAEMON = "pm-supervision-test-daemon";
  delete childEnv.MENTIKO_CODE_ROOT;
  delete childEnv.LIB_DIR;
  delete childEnv.DATABASE_URL;
  delete childEnv.MENTIKO_ROOT;

  const tsNodeRegister = path.join(webRoot, "node_modules", "ts-node", "register", "transpile-only.js");
  pm = spawn(process.execPath, ["-r", tsNodeRegister, "lib/process-manager.ts"], {
    cwd: webRoot,
    env: {
      ...childEnv,
      TS_NODE_COMPILER_OPTIONS: '{"module":"commonjs","moduleResolution":"node"}',
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let pmLog = "";
  pm.stdout!.on("data", (d: Buffer) => { pmLog += d.toString(); });
  pm.stderr!.on("data", (d: Buffer) => { pmLog += d.toString(); });

  await waitSocket(PM_BOOT_TIMEOUT_MS).catch((err) => {
    throw new Error(`process manager failed to boot:\n${pmLog}\n${err.message}`);
  });
});

afterAll(async () => {
  try {
    await shutdownPm();
  } finally {
    if (pm && pm.exitCode === null && pm.signalCode === null) {
      pm.kill("SIGKILL");
      await new Promise((r) => setTimeout(r, 300));
    }
    pm = null;
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}
  }
});

describe("process manager supervision (issue #136)", () => {
  it("keeps retrying a crash-looping service after maxRestarts is reached", async () => {
    // crasher has maxRestarts 2; before the fix the manager gave up at 2 and
    // never tried again. after the fix, attempts keep coming (capped backoff).
    const procs = await pmStatusUntil(
      (list) => {
        const crasher = list.find((p) => p.name === "crasher");
        return !!crasher && crasher.restarts >= 5;
      },
      25_000,
    );
    const crasher = procs.find((p) => p.name === "crasher");
    expect(crasher).toBeDefined();
    expect(crasher!.restarts).toBeGreaterThanOrEqual(5);
    expect(crasher!.status).not.toBe("failed");
  });

  it("never reports a service with no live process as ready", async () => {
    // watch quickdie flap: every observation with pid 0 must not claim "ready".
    let sawDeadService = false;
    let sawQuickdieDead = false;
    let violation: ProcStatus | null = null;
    await pmStatusUntil(
      () => sawQuickdieDead,
      20_000,
      (list) => {
        for (const proc of list) {
          if (proc.pid === 0 || proc.pid === null) {
            sawDeadService = true;
            if (proc.name === "quickdie") sawQuickdieDead = true;
            if (proc.status === "ready") violation = proc;
          }
        }
      },
    );
    expect(sawDeadService).toBe(true);
    expect(sawQuickdieDead).toBe(true);
    expect(violation).toBeNull();
  });
});
