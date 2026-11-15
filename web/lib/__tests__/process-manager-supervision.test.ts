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
let daemonForkSock: string;
let daemonForkPidFile: string;
let raceCounterFile: string;

// one script, two modes, so the forked daemon keeps the same command line the
// discovery pgrep pattern is built from (cmd + args[0]) — exactly how the real
// pty-mgr daemonizes. "fork" mode spawns the detached "run" mode daemon and
// exits 0 during readiness; "run" mode owns the socket and outlives us.
const FORK_SCRIPT = `
const { spawn } = require("child_process");
const [mode, sock, pidFile] = process.argv.slice(2);
if (mode === "fork") {
  const child = spawn(process.execPath, [__filename, "run", sock, pidFile], { detached: true, stdio: "ignore" });
  child.unref();
  process.exit(0);
}
require("fs").writeFileSync(pidFile, String(process.pid));
try { require("fs").unlinkSync(sock); } catch {}
require("net").createServer(() => {}).listen(sock);
`;

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
      {
        // codex rev2 P1: a daemonizing parent that exits 0 while the readiness
        // probe is still waiting, then the daemon's socket comes up. The
        // manager must discover the daemon and report ready — not treat the
        // parent exit as a crash and relaunch.
        name: "daemonfork",
        cmd: process.execPath,
        args: [path.join(tmpHome, "fork-script.js"), "fork", daemonForkSock, daemonForkPidFile],
        env: {},
        cwd: tmpHome,
        daemonize: true,
        readiness: { type: "socket", path: daemonForkSock, timeout: 8000, interval: 100 },
        restart: { enabled: true, maxRestarts: 3, baseDelay: 100, maxDelay: 200, resetAfter: 600_000 },
        critical: false,
        order: 3,
      },
      {
        // codex rev2 P1: crash interval (50ms + 40ms backoff) far shorter than
        // its 800ms timer readiness. Each generation's stale readiness wait
        // resolves true long after a newer generation replaced it — the stale
        // wait must be fenced off or two generations both spawn children.
        name: "raceloop",
        cmd: process.execPath,
        args: [path.join(tmpHome, "racer.js"), raceCounterFile],
        env: {},
        cwd: tmpHome,
        readiness: { type: "timer", timeout: 800 },
        restart: { enabled: true, maxRestarts: 500, baseDelay: 40, maxDelay: 80, resetAfter: 600_000, jitter: false },
        critical: false,
        order: 4,
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
  daemonForkSock = path.join(tmpHome, "daemonfork.sock");
  daemonForkPidFile = path.join(tmpHome, "daemonfork-daemon.pid");
  raceCounterFile = path.join(tmpHome, "race-counter.txt");
  fs.writeFileSync(path.join(tmpHome, "fork-script.js"), FORK_SCRIPT);
  fs.writeFileSync(
    path.join(tmpHome, "racer.js"),
    'require("fs").appendFileSync(process.argv[2], "x");\n' +
    'setTimeout(() => process.exit(1), 50);\n',
  );
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
    // belt and braces: if pm's cleanup somehow missed the forked daemon, kill
    // it by the pid it wrote so the test never leaks a listener
    try {
      const daemonPid = Number(fs.readFileSync(daemonForkPidFile, "utf8").trim());
      if (daemonPid > 0) { try { process.kill(daemonPid, "SIGKILL"); } catch {} }
    } catch {}
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

  it("discovers a daemonized fork whose parent exits during readiness (codex rev2 P1)", async () => {
    // parent exits 0 while the socket probe is still waiting; the daemon then
    // answers. The manager must report ready with the daemon's pid and must
    // not schedule a restart (the pre-fix code treated this as a crash).
    const procs = await pmStatusUntil((list) => {
      const svc = list.find((p) => p.name === "daemonfork");
      return !!svc && svc.status === "ready" && (svc.pid ?? 0) > 0;
    }, 15_000);
    const svc = procs.find((p) => p.name === "daemonfork")!;
    expect(svc.restarts).toBe(0);
    expect(svc.pid).toBeGreaterThan(0);

    // stays ready, no relaunch, and the reported pid is the daemon's own
    await new Promise((r) => setTimeout(r, 1200));
    const after = await pmStatusOnce();
    const svc2 = after.find((p) => p.name === "daemonfork")!;
    expect(svc2.status).toBe("ready");
    expect(svc2.restarts).toBe(0);
    const daemonPid = Number(fs.readFileSync(daemonForkPidFile, "utf8").trim());
    expect(svc2.pid).toBe(daemonPid);
  });

  it("fences stale readiness waits when a fast crasher restarts before readiness times out (codex rev2 P1)", async () => {
    // raceloop crashes every ~50ms with 40ms backoff while its readiness
    // timer runs 800ms. Without the generation fence, each stale wait that
    // resolves true schedules an extra restart on its obsolete generation and
    // a second spawn chain starts — spawns then outrun the restart counter.
    await new Promise((r) => setTimeout(r, 2500));
    let spawnCount = 0;
    let restarts = 0;
    for (let i = 0; i < 10; i++) {
      // counter first: a spawn landing between the two reads then shows up in
      // neither or only favors the invariant, never falsifies it
      try { spawnCount = fs.readFileSync(raceCounterFile, "utf8").length; } catch { spawnCount = 0; }
      const list = await pmStatusOnce();
      const svc = list.find((p) => p.name === "raceloop");
      expect(svc).toBeDefined();
      restarts = svc!.restarts;
      // one chain: every spawn is accounted for by exactly one scheduled restart
      expect(spawnCount).toBeLessThanOrEqual(restarts + 1);
      await new Promise((r) => setTimeout(r, 150));
    }
    // sanity: the loop actually ran while we watched
    expect(restarts).toBeGreaterThan(3);
    expect(spawnCount).toBeGreaterThan(3);
  });
});
