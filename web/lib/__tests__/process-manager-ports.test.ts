import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawn, execSync, type ChildProcess } from 'child_process';
import {
  pmStateDir,
  pidFilePath,
  portHolderPids,
  pidCommandLine,
  describePortHolders,
  portHeldByOthers,
  writePidFile,
  removePidFile,
  readPidFiles,
  pidAlive,
  recordedPidStillOurs,
} from '../process-manager-ports';

// every helper listens on a throwaway high port (50000+) and is killed in afterEach
const HIGH_PORT_BASE = 50123;
let portCursor = 0;
function nextPort(): number {
  portCursor += 1;
  return HIGH_PORT_BASE + portCursor;
}

let helpers: ChildProcess[] = [];
function startHolder(port: number): ChildProcess {
  const child = spawn(process.execPath, [
    '-e',
    `require('net').createServer().listen(${port}, '127.0.0.1', () => { process.stdout.write('listening ' + process.pid + '\\n'); setInterval(() => {}, 1000); })`,
  ], { stdio: ['ignore', 'pipe', 'inherit'] });
  helpers.push(child);
  // wait until the port is actually held
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (portHolderPids(port).includes(child.pid!)) return child;
    if (child.exitCode !== null) throw new Error('holder helper exited early');
    execSync('sleep 0.05');
  }
  throw new Error(`helper did not hold port ${port}`);
}

afterEach(() => {
  for (const h of helpers) {
    try { process.kill(h.pid!, 'SIGKILL'); } catch {}
  }
  helpers = [];
});

// First stdout chunk of a helper; rejects if it exits or stays silent, so the
// caller's finally always runs and kills its helpers.
function firstLine(child: ChildProcess, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('helper produced no output')), timeoutMs);
    child.stdout!.once('data', (d) => { clearTimeout(timer); resolve(String(d)); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`helper exited (${code})`)); });
  });
}

describe('process-manager-ports', () => {
  it('describes a foreign port holder and never lists it as ours', () => {
    const port = nextPort();
    const holder = startHolder(port);

    const holders = describePortHolders(port);
    expect(holders.length).toBeGreaterThanOrEqual(1);
    expect(holders.map(h => h.pid)).toContain(holder.pid);
    const found = holders.find(h => h.pid === holder.pid)!;
    expect(found.command).toContain(process.execPath);

    // with the holder's pid marked as ours, nothing is reported as foreign
    expect(portHeldByOthers(port, new Set([holder.pid!, process.pid]))).toEqual([]);
    // with no owned pids, the holder is reported
    const foreign = portHeldByOthers(port, new Set([process.pid]));
    expect(foreign.map(h => h.pid)).toContain(holder.pid);
  });

  it('reports only the listener as the port holder, never a connected client', async () => {
    const children: ChildProcess[] = [];
    try {
      const listener = spawn(process.execPath, ['-e', "const s=require('net').createServer(c=>{}).listen(0,'127.0.0.1',()=>console.log(s.address().port))"]);
      children.push(listener);
      const port = Number(String(await firstLine(listener)).trim());
      const client = spawn(process.execPath, ['-e', `const c=require('net').connect(${port},'127.0.0.1',()=>console.log('up'));setInterval(()=>{},1000)`]);
      children.push(client);
      await firstLine(client);
      const holders = portHolderPids(port);
      expect(holders).toContain(listener.pid);
      expect(holders).not.toContain(client.pid);
    } finally {
      for (const child of children) child.kill('SIGKILL');
    }
  });

  it('pid files round-trip and only recorded pids we can verify are "ours"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pm-ports-'));
    try {
      const holder = startHolder(nextPort());
      writePidFile(dir, { name: 'test-proc', pid: holder.pid!, cmd: process.execPath });
      writePidFile(dir, { name: 'dead-proc', pid: 999999, cmd: process.execPath });

      const entries = readPidFiles(dir).sort((a, b) => a.name.localeCompare(b.name));
      expect(entries.map(e => e.name)).toEqual(['dead-proc', 'test-proc']);

      expect(pidAlive(holder.pid!)).toBe(true);
      expect(recordedPidStillOurs({ name: 'test-proc', pid: holder.pid!, cmd: process.execPath })).toBe(true);
      // same pid recorded with a command it is NOT running -> not ours
      expect(recordedPidStillOurs({ name: 'fake', pid: holder.pid!, cmd: '/nonexistent/binary' })).toBe(false);
      expect(recordedPidStillOurs({ name: 'dead', pid: 999999, cmd: process.execPath })).toBe(false);

      removePidFile(dir, 'test-proc');
      expect(existsSync(pidFilePath(dir, 'test-proc'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('state dir lives under the pm home', () => {
    expect(pmStateDir('/home/tester')).toBe('/home/tester/.mentiko-pm/state');
  });

  it('pidCommandLine returns null for dead pids', () => {
    expect(pidCommandLine(999999)).toBeNull();
  });
});

// end-to-end: the real process-manager must leave a foreign holder alone,
// report it, and still stop its own child on shutdown (issue #105).
describe('process-manager foreign holder behavior', () => {
  jest.setTimeout(30000);

  it('leaves an unrelated port holder alive, reports it, and stops its own child', async () => {
    const webRoot = process.cwd();
    const home = mkdtempSync(join(tmpdir(), 'pm-e2e-home-'));
    const cfgDir = mkdtempSync(join(tmpdir(), 'pm-e2e-cfg-'));
    const foreignPort = nextPort();
    const ownPort = nextPort();
    const cfgPath = join(cfgDir, 'processes.dev.json');

    const holder = startHolder(foreignPort);

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

    const pm = spawn('npx', [
      '--no-install', 'tsx',
      join(webRoot, 'lib', 'process-manager.ts'),
    ], {
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
    pm.stdout!.on('data', d => { out += d.toString(); });
    let err = '';
    pm.stderr!.on('data', d => { err += d.toString(); });

    const exited = new Promise<number | null>(resolve => pm.once('exit', resolve));
    // critical process cannot start -> pm exits on its own; fail after 20s
    const code = await Promise.race([
      exited,
      new Promise<null>(r => setTimeout(() => r(null), 20000)),
    ]);

    // foreign holder must still be alive and still hold the port
    expect(pidAlive(holder.pid!)).toBe(true);
    expect(portHolderPids(foreignPort)).toContain(holder.pid!);
    // pm reported why it refused
    const combined = out + err;
    expect(combined).toContain(`port ${foreignPort} is held by`);
    expect(combined).toContain(`pid ${holder.pid}`);
    expect(combined).toContain('stop it or change the port');
    // the child the manager started must be gone (stopped on shutdown)
    expect(portHolderPids(ownPort)).toEqual([]);
    expect(code).toBe(1);

    if (code === null) { pm.kill('SIGKILL'); }

    rmSync(home, { recursive: true, force: true });
    rmSync(cfgDir, { recursive: true, force: true });
  });
});
