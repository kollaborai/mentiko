// process-manager.ts -- mentiko platform supervisor
// runs as PID 2 under tini. spawns and manages all platform processes.
// zero external dependencies. node built-ins only.

import { spawn, execSync, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import * as http from 'http';
import * as os from 'os';
import * as crypto from 'crypto';
import type {
  ProcessConfig, ProcessesFile, ReadinessConfig,
  IPCRequest,
} from './pm-types';
import { getKollabMentikoMcpServerEnv } from './kollabor-mcp-server-env';

interface ManagedProcess {
  config: ProcessConfig;
  child: ChildProcess | null;
  pid: number;
  status: string;
  restarts: number;
  startedAt: number;
  lastExit: number | null;
  lastExitCode: number | null;
  restartTimer: ReturnType<typeof setTimeout> | null;
  stoppedByUser: boolean;
}

interface McpSettings {
  servers?: Record<string, unknown>;
  mcpServers?: Record<string, unknown>;
}

const ENV_WHITELIST = [
  'PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TERM',
  'SHELL', 'HOSTNAME', 'TZ', 'NODE_ENV', 'PORT',
  'NODE_PATH', 'NPM_CONFIG_PREFIX',
  // platform auth + runtime config -- must be passed to next.js
  'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'AUTH_SECRET',
  'DATABASE_URL', 'MENTIKO_ROOT', 'MENTIKO_GLOBAL_ROOT',
  'MENTIKO_CODE_ROOT', 'STORAGE_BUCKET',
  'CONTROL_PLANE_URL', 'ADMIN_EMAILS',
  'MARKETPLACE_AUTO_SYNC', 'MARKETPLACE_SYNC_INTERVAL',
  // tenant isolation — child processes need tier context
  'NAMESPACE_ID', 'ORG_ID',
  'MENTIKO_NAMESPACE_ROOT', 'MENTIKO_ORG_ROOT',
  'MENTIKO_TIER', 'ENV_SCHEMA_VERSION',
  // mentiko-mcp subprocess reads these to reach the platform inbox
  'MENTIKO_INBOX_KEY', 'MENTIKO_WEB_URL',
  'MENTIKO_NAMESPACE_ID', 'MENTIKO_ORG_ID',
  'MENTIKO_DEFAULT_NAMESPACE_ID', 'MENTIKO_DEFAULT_ORG_ID',
  // optional override for the platform's server-side engine proxy
  'KOLLABOR_ENGINE_URL',
  // optional override for local/bundled PTY manager binary selection
  'PTY_MGR_BIN', 'MENTIKO_PTY_MGR_BIN',
  // internal service auth — used by engine->web refresh-token calls
  'INTERNAL_SERVICE_SECRET',
  // SaaS signup gate — auth-deployment.ts + auth-server.ts read these
  // to lock public signup and accept the control-plane bootstrap token.
  'MENTIKO_DISABLE_PUBLIC_SIGNUP', 'MENTIKO_PROVISIONING_TOKEN',
  'MENTIKO_OWNER_EMAIL',
  // version-skew protection: next.js encrypts server-action closures with this
  // key at build time. the runtime container needs the SAME key to decrypt
  // actions invoked by clients. without it, every deploy invalidates in-flight
  // actions with "Failed to find Server Action". must match value passed to
  // `npm run build` in cp's tag-watcher.sh.
  'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY',
];
const IPC_MAX_MSG = 512 * 1024;
const IPC_MAX_CONNS = 10;
const isDev = process.env.NODE_ENV !== 'production';
const SIGTERM_WAIT = isDev ? 1500 : 5000;
const SIGKILL_WAIT = isDev ? 500 : 2000;
const POLL_INTERVAL = 250;
const CONFIG_PATHS = [
  // CLI override
  ...(process.env.PROCESS_MANAGER_CONFIG ? [process.env.PROCESS_MANAGER_CONFIG] : []),
  // dev config (only checked outside production)
  ...(isDev ? [path.join(process.cwd(), 'processes.dev.json')] : []),
  // production configs
  path.join(process.cwd(), 'lib', 'processes.json'),
  path.join(process.cwd(), 'processes.json'),
  '/opt/mentiko/processes.json',
  '/opt/mentiko/lib/processes.json',
];

const managed: Map<string, ManagedProcess> = new Map();
let startupOrder: string[] = [];
let shuttingDown = false;
let exitCode = 0;
let ipcServer: net.Server | null = null;
let ipcConns = 0;
let configPath = '';
let bootTime = Date.now();

function log(msg: string) { process.stdout.write(`[pm] ${msg}\n`); }
function logErr(msg: string) { process.stderr.write(`[pm] ${msg}\n`); }
function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }
function expandEnv(s: string) { return s.replace(/\$([A-Z_][A-Z0-9_]*)/g, (_, n) => process.env[n] || ''); }
function errorMessage(err: unknown, fallback = 'internal error') {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return fallback;
}

// -- config --

function findConfig(): string {
  for (const p of CONFIG_PATHS) if (fs.existsSync(p)) return p;
  throw new Error('processes.json not found in: ' + CONFIG_PATHS.join(', '));
}

function loadConfig(fp: string): ProcessesFile {
  const parsed = JSON.parse(fs.readFileSync(fp, 'utf-8')) as ProcessesFile;
  if (!parsed.version || !Array.isArray(parsed.processes))
    throw new Error('invalid processes.json: missing version or processes array');
  return parsed;
}

function saveConfig(fp: string, config: ProcessesFile) {
  const tmp = fp + '.tmp.' + crypto.randomBytes(4).toString('hex');
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, fp);
}

// -- topological sort (kahn's) --

function topoSort(procs: ProcessConfig[]): string[] {
  const names = new Set(procs.map(p => p.name));
  const inDeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const p of procs) { inDeg.set(p.name, 0); adj.set(p.name, []); }

  for (const p of procs) {
    for (const dep of p.dependsOn || []) {
      if (!names.has(dep)) throw new Error(`"${p.name}" depends on unknown "${dep}"`);
      adj.get(dep)!.push(p.name);
      inDeg.set(p.name, (inDeg.get(p.name) || 0) + 1);
    }
  }

  const byOrder = (a: string, b: string) =>
    (procs.find(p => p.name === a)!.order ?? 999) - (procs.find(p => p.name === b)!.order ?? 999);
  const queue: string[] = procs.filter(p => inDeg.get(p.name) === 0).map(p => p.name).sort(byOrder);
  const result: string[] = [];

  while (queue.length) {
    const name = queue.shift()!;
    result.push(name);
    for (const next of adj.get(name) || []) {
      const d = inDeg.get(next)! - 1;
      inDeg.set(next, d);
      if (d === 0) { queue.push(next); queue.sort(byOrder); }
    }
  }
  if (result.length !== procs.length) throw new Error('circular dependency in processes.json');
  return result;
}

// -- env building --

function buildEnv(procEnv?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of ENV_WHITELIST) if (process.env[k]) env[k] = process.env[k]!;
  if (procEnv) for (const [k, v] of Object.entries(procEnv)) env[k] = expandEnv(v);
  return env;
}

// -- readiness probes --

function checkSocket(sockPath: string): Promise<boolean> {
  const p = expandEnv(sockPath);
  return new Promise(resolve => {
    fs.access(p, fs.constants.F_OK, err => {
      if (err) return resolve(false);
      const c = net.createConnection(p);
      c.on('connect', () => { c.destroy(); resolve(true); });
      c.on('error', () => { c.destroy(); resolve(false); });
      c.setTimeout(1000, () => { c.destroy(); resolve(false); });
    });
  });
}

function checkPort(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const c = net.createConnection({ host: '127.0.0.1', port });
    c.on('connect', () => { c.destroy(); resolve(true); });
    c.on('error', () => { c.destroy(); resolve(false); });
    c.setTimeout(1000, () => { c.destroy(); resolve(false); });
  });
}

function checkHttp(url: string): Promise<boolean> {
  return new Promise(resolve => {
    const r = http.get(url, res => {
      res.resume();
      resolve(!!res.statusCode && res.statusCode >= 200 && res.statusCode < 300);
    });
    r.on('error', () => resolve(false));
    r.setTimeout(2000, () => { r.destroy(); resolve(false); });
  });
}

async function waitReady(_name: string, r: ReadinessConfig | undefined): Promise<boolean> {
  if (!r || r.type === 'none') return true;
  if (r.type === 'timer') { await sleep(r.timeout || 1000); return true; }
  const deadline = Date.now() + (r.timeout || 10000);
  const interval = r.interval || POLL_INTERVAL;
  while (Date.now() < deadline) {
    if (shuttingDown) return false;
    let ok = false;
    if (r.type === 'socket' && r.path) ok = await checkSocket(r.path);
    else if (r.type === 'port' && r.port) ok = await checkPort(r.port);
    else if (r.type === 'http' && r.url) ok = await checkHttp(r.url);
    if (ok) return true;
    await sleep(interval);
  }
  return false;
}

// -- process lifecycle --

function spawnChild(config: ProcessConfig): ManagedProcess {
  const env = buildEnv(config.env);
  const child: ChildProcess = spawn(config.cmd, config.args || [], {
    env: env as unknown as NodeJS.ProcessEnv,
    cwd: config.cwd || process.cwd(),
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
  });
  const m: ManagedProcess = {
    config, child, pid: child.pid || 0, status: 'starting',
    restarts: 0, startedAt: Date.now(),
    lastExit: null, lastExitCode: null,
    restartTimer: null, stoppedByUser: false,
  };
  child.on('exit', (code: number | null, signal: string | null) => handleExit(m, code, signal));
  child.on('error', (err: Error) => {
    logErr(`${config.name} spawn error: ${err.message}`);
    m.status = 'crashed';
    scheduleRestart(m);
  });
  return m;
}

function handleExit(m: ManagedProcess, code: number | null, signal: string | null) {
  const name = m.config.name;
  m.lastExit = Date.now();
  m.lastExitCode = code;
  m.child = null;
  if (shuttingDown) { m.status = 'stopped'; return; }
  m.pid = 0;
  if (m.stoppedByUser) { m.status = 'stopped'; log(`${name} stopped`); return; }

  const uptime = m.lastExit - m.startedAt;
  const desc = signal ? `signal ${signal}` : `code ${code}`;

  // daemon fork pattern: parent exits 0 after readiness probe passed.
  // the real daemon (forked child) is still running. don't restart.
  // find the forked daemon's PID so we can kill it on shutdown.
  if (code === 0 && m.status === 'ready') {
    const daemonPid = findDaemonPid(m.config);
    if (daemonPid) { m.pid = daemonPid; log(`${name} parent exited, daemon pid ${daemonPid}`); }
    else { log(`${name} parent exited (${desc}), daemon forked -- keeping ready`); }
    return;
  }

  // daemon fork pattern: parent exits 0 while readiness is still being checked.
  // the daemon child may be starting up. let waitReady() in startOne() handle it
  // rather than racing with a restart.
  if (code === 0 && m.status === 'starting') {
    log(`${name} parent exited (${desc}), waiting for daemon readiness...`);
    return;
  }

  m.status = 'crashed';
  if (uptime >= (m.config.restart?.resetAfter ?? 60000)) m.restarts = 0;
  if (code === 0 && !(m.config.restart?.enabled ?? true)) {
    m.status = 'stopped'; log(`${name} exited cleanly (${desc})`); return;
  }
  log(`${name} crashed (${desc}), uptime ${Math.round(uptime / 1000)}s`);
  scheduleRestart(m);
}

function scheduleRestart(m: ManagedProcess) {
  if (shuttingDown) return;
  const r = m.config.restart ?? { enabled: true, maxRestarts: 10, baseDelay: 1000, maxDelay: 30000, resetAfter: 60000, jitter: true };
  if (!r.enabled) { m.status = 'stopped'; return; }
  const max = r.maxRestarts ?? 10;
  if (m.restarts >= max) {
    m.status = 'failed';
    logErr(`${m.config.name} exceeded max restarts (${max}/${max}), giving up`);
    if (m.config.critical) { logErr(`critical process ${m.config.name} failed, shutting down`); exitCode = 1; shutdown(); }
    return;
  }
  const base = r.baseDelay ?? 1000;
  let delay = Math.min(base * Math.pow(2, m.restarts), r.maxDelay ?? 30000);
  if (r.jitter ?? true) delay = Math.round(delay * (0.85 + Math.random() * 0.3));
  m.restarts++;
  log(`${m.config.name} restarting in ${delay}ms (attempt ${m.restarts}/${max})`);
  m.restartTimer = setTimeout(async () => {
    m.restartTimer = null;
    if (!shuttingDown) await startOne(m.config);
  }, delay);
}

async function startOne(config: ProcessConfig): Promise<ManagedProcess> {
  const prev = managed.get(config.name);
  const m = spawnChild(config);
  m.restarts = prev?.restarts ?? 0;
  m.stoppedByUser = prev?.stoppedByUser ?? false;
  managed.set(config.name, m);
  const ready = await waitReady(config.name, config.readiness);
  if (ready) {
    m.status = 'ready';
    const r = config.readiness;
    const detail = !r ? '' : r.type === 'socket' && r.path ? ` (socket at ${expandEnv(r.path)})`
      : r.type === 'port' && r.port ? ` (port ${r.port})`
      : r.type === 'http' && r.url ? ` (${r.url})` : '';
    log(`${config.name} ready${detail}`);
    // if parent process exited (daemon fork), find the real daemon PID
    if (!m.child && !m.pid) {
      const daemonPid = findDaemonPid(config);
      if (daemonPid) { m.pid = daemonPid; log(`${config.name} daemon pid ${daemonPid}`); }
    }
  } else if (!shuttingDown) {
    logErr(`${config.name} readiness timeout, killing`);
    await killProc(m);
    m.status = 'crashed';
    scheduleRestart(m);
  }
  return m;
}

// -- process control --

function findDaemonPid(config: ProcessConfig): number | null {
  try {
    const cmd = config.cmd;
    const pids = execSync(`pgrep -f "${cmd}.*${(config.args || [])[0] || ''}" 2>/dev/null`, { encoding: 'utf-8' }).trim();
    if (pids) {
      for (const p of pids.split('\n').filter(Boolean)) {
        const pid = Number(p);
        if (pid !== process.pid) return pid;
      }
    }
  } catch {}
  return null;
}

function killTree(pid: number, signal: NodeJS.Signals) {
  // kill the entire process group (detached children are group leaders)
  try { process.kill(-pid, signal); } catch {}
  // also kill the process directly in case it's not a group leader
  try { process.kill(pid, signal); } catch {}
}

async function killProc(m: ManagedProcess) {
  if (m.restartTimer) { clearTimeout(m.restartTimer); m.restartTimer = null; }
  if (!m.pid) return;
  m.status = 'stopping';
  killTree(m.pid, 'SIGTERM');
  if (m.child) {
    if (!await waitExit(m, SIGTERM_WAIT) && m.child) {
      killTree(m.pid, 'SIGKILL');
      await waitExit(m, SIGKILL_WAIT);
    }
  } else {
    // daemon fork: no child handle, just wait for pid to die
    await sleep(SIGTERM_WAIT);
    try { process.kill(m.pid, 0); killTree(m.pid, 'SIGKILL'); await sleep(SIGKILL_WAIT); } catch {}
  }
}

function waitExit(m: ManagedProcess, timeout: number): Promise<boolean> {
  return new Promise(resolve => {
    if (!m.child) return resolve(true);
    const t = setTimeout(() => resolve(false), timeout);
    m.child.once('exit', () => { clearTimeout(t); resolve(true); });
  });
}

// -- graceful shutdown --

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  // ignore further signals so we can finish cleanup
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');
  process.on('SIGTERM', () => {});
  process.on('SIGINT', () => { log('shutdown in progress, please wait...'); });

  // hard timeout: if cleanup takes too long, force exit
  const hardTimeout = setTimeout(() => {
    logErr('shutdown timed out, force exiting');
    managed.forEach(m => { if (m.pid) { try { killTree(m.pid, 'SIGKILL'); } catch {} } });
    process.exit(1);
  }, isDev ? 10000 : 15000);

  log('shutting down...');
  managed.forEach(m => { if (m.restartTimer) { clearTimeout(m.restartTimer); m.restartTimer = null; } });
  if (ipcServer) { ipcServer.close(); ipcServer = null; }
  // kill all processes in parallel for faster shutdown
  const killPromises = [...managed.entries()]
    .filter(([, m]) => m.child || m.pid)
    .map(async ([name, m]) => {
      log(`stopping ${name} (pid ${m.pid})...`);
      await killProc(m);
      m.status = 'stopped';
      log(`${name} stopped`);
    });
  await Promise.all(killPromises);
  clearTimeout(hardTimeout);
  log('all processes stopped, exiting');
  process.exit(exitCode);
}

// -- IPC server --

function startIpc() {
  const sockDir = path.join(os.homedir(), '.mentiko-pm');
  const sockPath = path.join(sockDir, 'pm.sock');
  fs.mkdirSync(sockDir, { recursive: true, mode: 0o700 });
  if (fs.existsSync(sockPath)) fs.unlinkSync(sockPath);

  ipcServer = net.createServer(conn => {
    if (ipcConns >= IPC_MAX_CONNS) {
      conn.write(JSON.stringify({ id: '', ok: false, error: 'max connections' }) + '\n');
      conn.destroy(); return;
    }
    ipcConns++;
    let buf = '';
    conn.on('data', (data: Buffer) => {
      buf += data.toString();
      if (buf.length > IPC_MAX_MSG) {
        conn.write(JSON.stringify({ id: '', ok: false, error: 'message too large' }) + '\n');
        conn.destroy(); return;
      }
      let idx: number;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
        handleIpc(line, conn);
      }
    });
    conn.on('close', () => ipcConns--);
    conn.on('error', () => ipcConns--);
  });

  ipcServer.listen(sockPath, () => { fs.chmodSync(sockPath, 0o600); log(`IPC listening at ${sockPath}`); });
}

async function handleIpc(raw: string, conn: net.Socket) {
  let req: IPCRequest;
  try { req = JSON.parse(raw); } catch {
    conn.write(JSON.stringify({ id: '', ok: false, error: 'invalid json' }) + '\n'); return;
  }
  const ok = (data: unknown) => conn.write(JSON.stringify({ id: req.id, ok: true, data }) + '\n');
  const fail = (error: string) => conn.write(JSON.stringify({ id: req.id, ok: false, error }) + '\n');

  try {
    switch (req.cmd) {
      case 'status': {
        const procs = Array.from(managed.values()).map(m => ({
          name: m.config.name, pid: m.pid, status: m.status, restarts: m.restarts,
          uptime: m.status === 'ready' ? Date.now() - m.startedAt : 0,
          lastExit: m.lastExit, lastExitCode: m.lastExitCode,
        }));
        ok({ processes: procs, uptime: Date.now() - bootTime, version: 1 });
        break;
      }
      case 'list': {
        ok({ processes: Array.from(managed.values()).map(m => ({
          name: m.config.name, status: m.status, pid: m.pid,
          uptime: m.status === 'ready' ? Date.now() - m.startedAt : 0, restarts: m.restarts,
        }))});
        break;
      }
      case 'stop': {
        const { name } = req.data || {};
        if (!name) return fail('missing name');
        const m = managed.get(name);
        if (!m) return fail('process not found');
        m.stoppedByUser = true;
        await killProc(m);
        m.status = 'stopped';
        ok({ name, status: 'stopped' });
        break;
      }
      case 'start': {
        const d = req.data;
        if (!d?.name || !d?.cmd) return fail('missing name or cmd');
        const ex = managed.get(d.name);
        if (ex?.child) return fail('process already running');
        const cfg: ProcessConfig = {
          name: d.name, cmd: d.cmd, args: d.args || [], env: d.env || {},
          cwd: d.cwd || process.cwd(),
          readiness: d.readiness || { type: 'none' as const },
          restart: {
            enabled: true, maxRestarts: 5, baseDelay: 1000,
            maxDelay: 30000, resetAfter: 60000, ...d.restart,
          },
          critical: d.critical ?? false, order: 999,
        };
        const file = loadConfig(configPath);
        const idx = file.processes.findIndex((p: ProcessConfig) => p.name === cfg.name);
        if (idx >= 0) file.processes[idx] = cfg; else file.processes.push(cfg);
        saveConfig(configPath, file);
        const m = await startOne(cfg);
        if (!startupOrder.includes(cfg.name)) startupOrder.push(cfg.name);
        ok({ name: cfg.name, pid: m.pid, status: m.status });
        break;
      }
      case 'remove': {
        const { name } = req.data || {};
        if (!name) return fail('missing name');
        const m = managed.get(name);
        if (!m) return fail('process not found');
        if (m.config.critical) return fail('cannot remove critical process');
        if (m.child) { m.stoppedByUser = true; await killProc(m); }
        managed.delete(name);
        startupOrder = startupOrder.filter(n => n !== name);
        const file = loadConfig(configPath);
        file.processes = file.processes.filter((p: ProcessConfig) => p.name !== name);
        saveConfig(configPath, file);
        ok({ name, removed: true });
        break;
      }
      case 'restart': {
        const { name } = req.data || {};
        if (!name) return fail('missing name');
        const m = managed.get(name);
        if (!m) return fail('process not found');
        if (m.child) { m.stoppedByUser = true; await killProc(m); }
        m.stoppedByUser = false;
        m.restarts = 0;
        const restarted = await startOne(m.config);
        ok({ name, pid: restarted.pid, status: restarted.status });
        break;
      }
      case 'shutdown': {
        ok({ shutting_down: true });
        setTimeout(() => shutdown(), 100);
        break;
      }
      default: fail('unknown command');
    }
  } catch (err: unknown) { fail(errorMessage(err)); }
}

// -- housekeeping --

async function housekeep() {
  if (!process.env.PATH?.includes('/opt/mentiko/bin'))
    process.env.PATH = `/opt/mentiko/bin:${process.env.PATH || ''}`;

  // Dev: load web/.env.local into process.env BEFORE any env-sensitive code
  // runs. next.js auto-loads it for its own process, but process-manager runs
  // first and its env (whitelisted) is what children inherit. Without this,
  // values set in .env.local lose to any defaults we generate below.
  if (isDev) {
    const envFile = [
      path.join(process.cwd(), '.env.local'),
      path.join(process.cwd(), 'web', '.env.local'),
    ].find(candidate => fs.existsSync(candidate));
    if (envFile) {
      try {
        const content = fs.readFileSync(envFile, 'utf-8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eq = trimmed.indexOf('=');
          if (eq < 1) continue;
          const key = trimmed.slice(0, eq).trim();
          let value = trimmed.slice(eq + 1).trim();
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }
          if (!process.env[key]) process.env[key] = value;
        }
      } catch {} // non-fatal
    }
  }

  const home = os.homedir();
  const skelDir = '/opt/mentiko/skel';
  if (fs.existsSync(skelDir)) {
    for (const rc of ['.bashrc', '.zshrc']) {
      const target = path.join(home, rc);
      const source = path.join(skelDir, rc);
      if (!fs.existsSync(source)) continue;
      try {
        const content = fs.existsSync(target) ? fs.readFileSync(target, 'utf-8') : '';
        if (!content.includes('/opt/mentiko/bin')) { fs.copyFileSync(source, target); log(`seeded ${rc} from skel/`); }
      } catch {} // non-fatal
    }
  }

  fs.mkdirSync(path.join(home, '.pty-manager'), { recursive: true });

  // namespace dirs: only in container (/app exists) or if MENTIKO_GLOBAL_ROOT/MENTIKO_ROOT is set
  const nsRoot = process.env.MENTIKO_GLOBAL_ROOT || process.env.MENTIKO_ROOT || (fs.existsSync('/app') ? '/app' : null);
  if (nsRoot) {
    const nsId = process.env.NAMESPACE_ID || 'default';
    for (const d of [
      'chains', 'state', 'events', 'workspace', 'workspaces', 'runs',
      'reports', 'agent-profiles', 'jobs', 'schedules', 'decisions',
      'metrics', 'debug', 'runspace', 'watchdog-hooks',
    ]) fs.mkdirSync(path.join(nsRoot, 'namespaces', nsId, d), { recursive: true });
  }

  // startup diagnostic: log resolved namespace identity, warn if "default" in production
  const nsId = process.env.NAMESPACE_ID || 'default';
  const oId = process.env.ORG_ID || 'default';
  const tier = process.env.MENTIKO_TIER;
  log(`namespace: ${nsId}, org: ${oId}, root: ${nsRoot || '(dev)'}, tier: ${tier || '(none)'}`);
  if (nsId === 'default' && tier) {
    logErr(`WARNING: NAMESPACE_ID is "default" in ${tier} tier — possible tenant isolation issue`);
  }
  // mentiko-mcp: generate a shared-secret inbox key on first boot and write
  // the kollabor-engine MCP settings file. In prod this happens automatically
  // on container boot. In dev, .env.local is the source of truth (loaded just
  // above) — we only generate if nothing is set anywhere.
  if (!process.env.MENTIKO_INBOX_KEY) {
    if (isDev) {
      // dev without a key in .env.local — fall back to a predictable value
      // so curl-based smoke tests work; users can override by adding
      // MENTIKO_INBOX_KEY=... to web/.env.local.
      process.env.MENTIKO_INBOX_KEY = 'dev-mcp-smoke-key';
      log(`mentiko-mcp: using default dev inbox key (set MENTIKO_INBOX_KEY in web/.env.local to override)`);
    } else {
      process.env.MENTIKO_INBOX_KEY = crypto.randomBytes(32).toString('hex');
      log(`mentiko-mcp: generated inbox key (len=${process.env.MENTIKO_INBOX_KEY.length})`);
    }
  }
  if (!process.env.INTERNAL_SERVICE_SECRET) {
    process.env.INTERNAL_SERVICE_SECRET = isDev
      ? 'dev-internal-service-secret'
      : crypto.randomBytes(32).toString('hex');
    log(`internal service secret: ${isDev ? 'using dev default' : 'generated'} (len=${process.env.INTERNAL_SERVICE_SECRET.length})`);
  }
  if (!process.env.MENTIKO_WEB_URL) {
    process.env.MENTIKO_WEB_URL = 'http://127.0.0.1:3000';
  }
  if (!process.env.MENTIKO_NAMESPACE_ID) {
    process.env.MENTIKO_NAMESPACE_ID = process.env.NAMESPACE_ID || 'default';
  }
  if (!process.env.MENTIKO_ORG_ID) {
    process.env.MENTIKO_ORG_ID = process.env.ORG_ID || 'default';
  }
  try {
    const mcpDir = path.join(os.homedir(), ".kollab", "mcp");
    fs.mkdirSync(mcpDir, { recursive: true });
    const settingsPath = path.join(mcpDir, 'mcp_settings.json');
    let existing: McpSettings = {};
    if (fs.existsSync(settingsPath)) {
      try { existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch {}
    }
    existing.servers = {
      ...(existing.mcpServers || {}),
      ...(existing.servers || {}),
    };
    delete existing.mcpServers;
    // Prefer the bundled binary in prod, repo shim in dev
    const mcpBin = fs.existsSync('/opt/mentiko/bin/mentiko-mcp')
      ? '/opt/mentiko/bin/mentiko-mcp'
      : path.join(process.cwd(), 'bin', 'mentiko-mcp');
    const cmd = mcpBin;
    existing.servers.mentiko = {
      type: 'stdio',
      command: cmd,
      args: [],
      env: getKollabMentikoMcpServerEnv(),
      enabled: true,
    };
    fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2));
    log(`mentiko-mcp: registered at ${settingsPath} (cmd=${cmd})`);
  } catch (e: unknown) {
    logErr(`mentiko-mcp settings write failed: ${errorMessage(e)}`);
  }

  // dev mode: kill stale processes on ports we need, then wait for ports to free
  if (isDev) {
    for (const port of [3000, 3099, 7433]) {
      try {
        const pids = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: 'utf-8' }).trim();
        if (!pids) continue;
        const pidList = pids.split('\n').filter(Boolean).map(Number);
        for (const pid of pidList) {
          try { process.kill(pid, 'SIGTERM'); log(`killed stale pid ${pid} on port ${port}`); } catch {}
        }
        // wait up to 2s for port to free, then SIGKILL
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline) {
          await sleep(100);
          try {
            const still = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: 'utf-8' }).trim();
            if (!still) break;
          } catch { break; }
        }
        // force-kill anything still holding the port
        try {
          const stuck = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: 'utf-8' }).trim();
          if (stuck) {
            for (const pid of stuck.split('\n').filter(Boolean).map(Number)) {
              try { process.kill(pid, 'SIGKILL'); log(`force-killed stale pid ${pid} on port ${port}`); } catch {}
            }
            await sleep(200);
          }
        } catch {}
      } catch {} // no stale processes
    }
  }

  log('housekeeping done');
}

// -- main --

async function main() {
  log('starting');
  process.on('SIGTERM', () => shutdown());
  process.on('SIGINT', () => shutdown());
  process.on('SIGHUP', () => {});
  // synchronous safety net: if the event loop dies, kill everything
  process.on('exit', () => {
    if (!shuttingDown) return;
    managed.forEach(m => {
      if (m.pid) { try { process.kill(-m.pid, 'SIGKILL'); } catch {} try { process.kill(m.pid, 'SIGKILL'); } catch {} }
    });
  });

  try { await housekeep(); } catch (e: unknown) { logErr(`housekeeping failed: ${errorMessage(e)}`); }

  configPath = findConfig();
  log(`config: ${configPath}`);
  const config = loadConfig(configPath);
  startupOrder = topoSort(config.processes);
  log(`startup order: ${startupOrder.join(' -> ')}`);
  startIpc();

  for (const name of startupOrder) {
    if (shuttingDown) break;
    const pc = config.processes.find((p: ProcessConfig) => p.name === name)!;
    log(`starting ${name}...`);
    await startOne(pc);
    if (shuttingDown) break;
    const m = managed.get(name);
    if (m?.status === 'failed' && m.config.critical) {
      logErr(`critical process ${name} failed during startup`);
      exitCode = 1; await shutdown(); return;
    }
  }
  if (!shuttingDown) { log(`all processes running (${managed.size} total)`); bootTime = Date.now(); }
}

main().catch(err => { logErr(`fatal: ${err.message}`); process.exit(1); });
