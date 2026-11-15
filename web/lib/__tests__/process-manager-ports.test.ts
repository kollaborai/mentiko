import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as net from 'net';
import { spawn, type ChildProcess } from 'child_process';
import {
  pmStateDir,
  pidFilePath,
  portHolderPids,
  pidCommandLine,
  pidStartTime,
  pidIdentityMatches,
  describePortHolders,
  portHeldByOthers,
  writePidFile,
  removePidFile,
  readPidFiles,
  pidAlive,
  recordedPidStillOurs,
  findOwnedDaemonPid,
} from '../process-manager-ports';

// -- helpers: every listener binds port 0 (OS-assigned ephemeral); all spawned
// processes are killed and all temp dirs removed in finally blocks.

const sleepMs = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

interface Holder {
  child: ChildProcess;
  port: number;
}

function trackHolder(child: ChildProcess, port: number, registry: Holder[]): Holder {
  const h = { child, port };
  registry.push(h);
  return h;
}

// node process listening on an OS-assigned ephemeral port; prints "PORT <n>"
function startHolder(registry: Holder[]): Promise<Holder> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', `
      const s = require('net').createServer();
      s.listen(0, '127.0.0.1', () => {
        process.stdout.write('PORT ' + s.address().port + '\\n');
        setInterval(() => {}, 1000);
      });
    `], { stdio: ['ignore', 'pipe', 'inherit'] });
    let buf = '';
    const timer = setTimeout(() => reject(new Error('holder helper did not report a port')), 5000);
    child.stdout!.on('data', d => {
      buf += d.toString();
      const m = buf.match(/PORT (\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(trackHolder(child, Number(m[1]), registry));
      }
    });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('holder helper exited before listening')); });
  });
}

async function killHolders(registry: Holder[]): Promise<void> {
  for (const h of registry) {
    try { process.kill(h.child.pid!, 'SIGKILL'); } catch {}
  }
  for (const h of registry) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && pidAlive(h.child.pid!)) await sleepMs(50);
  }
  registry.length = 0;
}

// grab an OS-assigned ephemeral port by binding and immediately releasing it
// (for configs that must name the port up front)
function freeEphemeralPort(): Promise<number> {
  return new Promise(resolve => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

// bind a foreign listener on a specific port, retrying briefly (the port was
// just freed, so bind should win any race)
async function holdSpecificPort(registry: Holder[], port: number): Promise<Holder> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const h = await new Promise<Holder | null>(resolve => {
      const child = spawn(process.execPath, ['-e', `
        const s = require('net').createServer();
        s.listen(${port}, '127.0.0.1', () => {
          process.stdout.write('PORT ' + s.address().port + '\\n');
          setInterval(() => {}, 1000);
        });
        s.on('error', () => process.exit(3));
      `], { stdio: ['ignore', 'pipe', 'inherit'] });
      let buf = '';
      const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve(null); }, 2000);
      child.stdout!.on('data', d => {
        buf += d.toString();
        if (buf.includes(`PORT ${port}`)) { clearTimeout(t); resolve(trackHolder(child, port, registry)); }
      });
      child.once('exit', () => { clearTimeout(t); resolve(null); });
    });
    if (h) return h;
    if (Date.now() > deadline) throw new Error(`could not hold port ${port}`);
    await sleepMs(100);
  }
}

describe('process-manager-ports', () => {
  let holders: Holder[] = [];
  afterEach(async () => { await killHolders(holders); });

  it('describes a foreign port holder and never lists it as ours', async () => {
    const holder = await startHolder(holders);

    const holdersList = describePortHolders(holder.port);
    expect(holdersList.map(h => h.pid)).toContain(holder.child.pid);
    const found = holdersList.find(h => h.pid === holder.child.pid)!;
    expect(found.command).toContain(process.execPath);

    // with the holder's pid marked as ours, nothing is reported as foreign
    expect(portHeldByOthers(holder.port, new Set([holder.child.pid!, process.pid]))).toEqual([]);
    // with no owned pids, the holder is reported
    const foreign = portHeldByOthers(holder.port, new Set([process.pid]));
    expect(foreign.map(h => h.pid)).toContain(holder.child.pid);
  });

  it('lists only LISTENING sockets — a connected client is not a holder', async () => {
    const holder = await startHolder(holders);
    // open a client connection from this (test) process to the held port
    await new Promise<void>((resolve, reject) => {
      const c = net.connect({ host: '127.0.0.1', port: holder.port });
      c.once('connect', () => { setTimeout(() => { c.destroy(); resolve(); }, 200); });
      c.once('error', reject);
    });
    expect(portHolderPids(holder.port)).not.toContain(process.pid);
    expect(portHolderPids(holder.port)).toContain(holder.child.pid);
  });

  it('fails closed when no port inspection utility exists', () => {
    const oldPath = process.env.PATH;
    try {
      process.env.PATH = '/nonexistent-path-for-pm-test';
      expect(() => portHolderPids(12345)).toThrow(/no port inspection utility/);
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it('pid identity: OS start time match is ownership, anything else is not', async () => {
    const holder = await startHolder(holders);
    const pid = holder.child.pid!;
    const start = pidStartTime(pid);
    expect(start).toBeTruthy();
    // same pid + matching start = ours
    expect(pidIdentityMatches(pid, start)).toBe(true);
    // same pid + wrong start (recycled pid) = not ours
    expect(pidIdentityMatches(pid, 'bogus start time')).toBe(false);
    // no recorded start = identity unprovable = not ours (fail closed)
    expect(pidIdentityMatches(pid, null)).toBe(false);
    expect(pidIdentityMatches(pid, undefined)).toBe(false);
    // dead pid = not ours
    expect(pidIdentityMatches(999999, start)).toBe(false);
    // recordedPidStillOurs follows the same rule
    expect(recordedPidStillOurs({ name: 'x', pid, cmd: process.execPath, start })).toBe(true);
    expect(recordedPidStillOurs({ name: 'x', pid, cmd: process.execPath })).toBe(false);
    expect(recordedPidStillOurs({ name: 'x', pid: 999999, cmd: process.execPath, start })).toBe(false);
  });

  it('pid files round-trip with identity and stale entries are dropped', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pm-ports-'));
    try {
      writePidFile(dir, { name: 'dead-proc', pid: 999999, cmd: process.execPath, start: 'whenever' });
      const entries = readPidFiles(dir);
      expect(entries.map(e => e.name)).toEqual(['dead-proc']);
      // a dead pid is never "ours" even with a recorded identity
      expect(recordedPidStillOurs(entries[0])).toBe(false);
      removePidFile(dir, 'dead-proc');
      expect(existsSync(pidFilePath(dir, 'dead-proc'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('findOwnedDaemonPid accepts only descendants/group members of the spawned parent', async () => {
    const marker = `pm-daemon-marker-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    // group leader (spawned detached, like the PM does) forks a keepalive
    // child in the same process group, prints the child pid, then exits —
    // the daemon-fork pattern.
    const leader = spawn(process.execPath, ['-e', `
      const c = require('child_process').spawn(
        process.execPath,
        ['-e', 'setInterval(() => {}, 1000) /* ${marker} */'],
        { stdio: ['ignore', 'ignore', 'ignore'] },
      );
      process.stdout.write('DAEMONPID ' + c.pid + '\\n');
      setTimeout(() => process.exit(0), 200);
    `], { stdio: ['ignore', 'pipe', 'inherit'], detached: true });
    holders.push({ child: leader, port: 0 });

    let daemonPid = 0;
    const deadline = Date.now() + 5000;
    let buf = '';
    while (Date.now() < deadline && !daemonPid) {
      buf += leader.stdout!.read()?.toString() || '';
      const m = buf.match(/DAEMONPID (\d+)/);
      if (m) daemonPid = Number(m[1]);
      else await sleepMs(50);
    }
    // wait for the leader (the spawned parent) to exit
    while (Date.now() < deadline && leader.exitCode === null) await sleepMs(50);
    expect(daemonPid).toBeGreaterThan(0);
    expect(pidAlive(daemonPid)).toBe(true);
    expect(leader.exitCode).toBe(0);

    // correct parent pid: the daemon shares the dead leader's process group
    expect(findOwnedDaemonPid(marker, leader.pid!, new Set([process.pid]))).toBe(daemonPid);
    // wrong parent pid: some unrelated process's group — nothing is adopted
    expect(findOwnedDaemonPid(marker, process.pid, new Set([process.pid]))).toBeNull();
    // no parent pid at all: nothing is adopted
    expect(findOwnedDaemonPid(marker, 0, new Set())).toBeNull();
    // pattern with no live matches
    expect(findOwnedDaemonPid('no-such-process-marker-xyz', leader.pid!, new Set())).toBeNull();

    try { process.kill(daemonPid, 'SIGKILL'); } catch {}
  });

  it('state dir lives under the pm home', () => {
    expect(pmStateDir('/home/tester')).toBe('/home/tester/.mentiko-pm/state');
  });

  it('pidCommandLine returns null for dead pids', () => {
    expect(pidCommandLine(999999)).toBeNull();
  });
});

// end-to-end: the real process-manager must leave a foreign holder alone,
// report it (naming the config actually in use), and stop its own children on
// shutdown (issue #105).
describe('process-manager foreign holder behavior', () => {
  jest.setTimeout(60000);

  it('leaves an unrelated port holder alive, reports it, and stops its own child', async () => {
    const holders: Holder[] = [];
    const webRoot = process.cwd();
    const home = mkdtempSync(join(tmpdir(), 'pm-e2e-home-'));
    const cfgDir = mkdtempSync(join(tmpdir(), 'pm-e2e-cfg-'));
    let pm: ChildProcess | null = null;
    try {
      const foreignPort = await freeEphemeralPort();
      const ownPort = await freeEphemeralPort();
      const cfgPath = join(cfgDir, 'processes.dev.json');
      const holder = await holdSpecificPort(holders, foreignPort);

      require('fs').writeFileSync(cfgPath, JSON.stringify({
        version: 1,
        processes: [
          {
            name: 'own-child',
            order: 1,
            cmd: process.execPath,
            args: ['-e', `require('net').createServer().listen(${ownPort}, '127.0.0.1', () => setInterval(() => {}, 1000))`],
            readiness: { type: 'port', port: ownPort },
            restart: { enabled: false },
          },
          {
            name: 'foreign-blocked',
            order: 2,
            cmd: process.execPath,
            args: ['-e', `require('net').createServer().listen(${foreignPort}, '127.0.0.1', () => setInterval(() => {}, 1000))`],
            critical: true,
            readiness: { type: 'port', port: foreignPort },
            restart: { enabled: false },
          },
        ],
      }, null, 2));

      pm = spawn('npx', ['--no-install', 'tsx', join(webRoot, 'lib', 'process-manager.ts')], {
        cwd: webRoot,
        env: {
          ...process.env,
          HOME: home,
          NODE_ENV: 'development',
          PROCESS_MANAGER_CONFIG: cfgPath,
          MENTIKO_GLOBAL_ROOT: join(home, 'mentiko-root'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      let err = '';
      pm.stdout!.on('data', d => { out += d.toString(); });
      pm.stderr!.on('data', d => { err += d.toString(); });

      const exited = new Promise<number | null>(resolve => pm!.once('exit', resolve));
      const code = await Promise.race([
        exited,
        new Promise<null>(r => setTimeout(() => r(null), 30000)),
      ]);

      // foreign holder must still be alive and still hold the port
      expect(pidAlive(holder.child.pid!)).toBe(true);
      expect(portHolderPids(foreignPort)).toContain(holder.child.pid);
      // pm reported why it refused, naming the config actually in use
      const combined = out + err;
      expect(combined).toContain(`port ${foreignPort} is held by`);
      expect(combined).toContain(`pid ${holder.child.pid}`);
      expect(combined).toContain(cfgPath);
      // the child the manager started must be gone (stopped on shutdown)
      expect(portHolderPids(ownPort)).toEqual([]);
      expect(code).toBe(1);
    } finally {
      if (pm && pm.exitCode === null) { try { pm.kill('SIGKILL'); } catch {} }
      await killHolders(holders);
      rmSync(home, { recursive: true, force: true });
      rmSync(cfgDir, { recursive: true, force: true });
    }
  });

  // issue #105 round 2 P1: a critical process that dies after startup and
  // finds its port taken by a foreign process during restart must go through
  // the critical-failure policy (exit nonzero, stop siblings) — not sit
  // failed forever.
  it('exits nonzero when a critical process restart hits a foreign port holder', async () => {
    const holders: Holder[] = [];
    const webRoot = process.cwd();
    const home = mkdtempSync(join(tmpdir(), 'pm-e2e2-home-'));
    const cfgDir = mkdtempSync(join(tmpdir(), 'pm-e2e2-cfg-'));
    let pm: ChildProcess | null = null;
    try {
      const port = await freeEphemeralPort();
      const cfgPath = join(cfgDir, 'processes.dev.json');
      require('fs').writeFileSync(cfgPath, JSON.stringify({
        version: 1,
        processes: [
          {
            name: 'crit-child',
            order: 1,
            cmd: process.execPath,
            args: ['-e', `require('net').createServer().listen(${port}, '127.0.0.1', () => setInterval(() => {}, 1000))`],
            critical: true,
            readiness: { type: 'port', port },
            restart: { enabled: true, baseDelay: 1500, maxRestarts: 3 },
          },
        ],
      }, null, 2));

      pm = spawn('npx', ['--no-install', 'tsx', join(webRoot, 'lib', 'process-manager.ts')], {
        cwd: webRoot,
        env: {
          ...process.env,
          HOME: home,
          NODE_ENV: 'development',
          PROCESS_MANAGER_CONFIG: cfgPath,
          MENTIKO_GLOBAL_ROOT: join(home, 'mentiko-root'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      let err = '';
      pm.stdout!.on('data', d => { out += d.toString(); });
      pm.stderr!.on('data', d => { err += d.toString(); });

      // wait until the manager reports the critical child ready
      const readyDeadline = Date.now() + 30000;
      while (Date.now() < readyDeadline && !out.includes('crit-child ready')) await sleepMs(200);
      expect(out).toContain('crit-child ready');

      // find the child's pid from the manager's own pid file
      const pidFile = join(pmStateDir(home), 'crit-child.pid.json');
      const readPid = (): number => {
        try { return JSON.parse(readFileSync(pidFile, 'utf-8')).pid; } catch { return 0; }
      };
      let childPid = 0;
      while (Date.now() < readyDeadline && !(childPid = readPid())) await sleepMs(100);
      expect(childPid).toBeGreaterThan(0);

      // kill the child, then let a foreign process take the port before the
      // restart (baseDelay 1500ms) fires
      process.kill(childPid, 'SIGKILL');
      const foreign = await holdSpecificPort(holders, port);

      const exited = new Promise<number | null>(resolve => pm!.once('exit', resolve));
      const code = await Promise.race([
        exited,
        new Promise<null>(r => setTimeout(() => r(null), 30000)),
      ]);

      const combined = out + err;
      expect(combined).toContain(`port ${port} is held by`);
      expect(combined).toContain('critical process crit-child cannot start');
      // the foreign holder survives; the manager exited nonzero
      expect(pidAlive(foreign.child.pid!)).toBe(true);
      expect(portHolderPids(port)).toEqual([foreign.child.pid]);
      expect(code).toBe(1);
    } finally {
      if (pm && pm.exitCode === null) { try { pm.kill('SIGKILL'); } catch {} }
      await killHolders(holders);
      rmSync(home, { recursive: true, force: true });
      rmSync(cfgDir, { recursive: true, force: true });
    }
  });
});
