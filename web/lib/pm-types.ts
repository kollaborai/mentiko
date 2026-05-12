// pm-types.ts -- shared types for process-manager and pm-client
// no dependencies, no classes, just shapes

// --- readiness probes ---

export interface SocketReadiness {
  type: 'socket';
  path: string;
  timeout: number;
  interval?: number;
}

export interface PortReadiness {
  type: 'port';
  port: number;
  timeout: number;
  interval?: number;
}

export interface HttpReadiness {
  type: 'http';
  url: string;
  timeout: number;
  interval?: number;
}

export interface TimerReadiness {
  type: 'timer';
  timeout: number;
}

export interface NoneReadiness {
  type: 'none';
}

export type ReadinessConfig =
  | SocketReadiness
  | PortReadiness
  | HttpReadiness
  | TimerReadiness
  | NoneReadiness;

// --- restart ---

export interface RestartConfig {
  enabled: boolean;
  maxRestarts: number;
  baseDelay: number;
  maxDelay: number;
  resetAfter: number;
  jitter?: boolean;
}

// --- process config (shape of each entry in processes.json) ---

export interface ProcessConfig {
  name: string;
  cmd: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  dependsOn?: string[];
  readiness: ReadinessConfig;
  restart: RestartConfig;
  critical: boolean;
  order: number;
}

// --- top-level processes.json ---

export interface PMConfig {
  version: number;
  processes: ProcessConfig[];
}

export type ProcessesFile = PMConfig;

// --- runtime state ---

export type ProcessStatus =
  | 'starting'
  | 'ready'
  | 'stopping'
  | 'stopped'
  | 'crashed'
  | 'failed';

export interface ProcessInfo {
  name: string;
  pid: number | null;
  status: ProcessStatus;
  restarts: number;
  uptime: number;
  lastExit: number | null;
  lastExitCode: number | null;
}

// --- IPC commands ---

export type IPCCommand = 'status' | 'start' | 'stop' | 'remove' | 'restart' | 'list' | 'shutdown';

// --- per-command data payloads ---

export type StatusData = Record<string, never>;

export interface StartData {
  name: string;
  cmd: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  readiness?: ReadinessConfig;
  restart?: Partial<RestartConfig>;
  critical?: boolean;
  order?: number;
}

export interface StopData {
  name: string;
}

export interface RemoveData {
  name: string;
}

export interface RestartData {
  name: string;
}

export type ListData = Record<string, never>;
export type ShutdownData = Record<string, never>;

// --- IPC request (client -> pm) ---

export type IPCRequest =
  | { id: string; cmd: 'status'; data?: StatusData }
  | { id: string; cmd: 'start'; data: StartData }
  | { id: string; cmd: 'stop'; data: StopData }
  | { id: string; cmd: 'remove'; data: RemoveData }
  | { id: string; cmd: 'restart'; data: RestartData }
  | { id: string; cmd: 'list'; data?: ListData }
  | { id: string; cmd: 'shutdown'; data?: ShutdownData };

// --- IPC response (pm -> client) ---

export type IPCResponse =
  | { id: string; ok: true; data: Record<string, unknown> }
  | { id: string; ok: false; error: string };

// --- runtime managed process (internal to process-manager) ---

export interface ManagedProcess {
  config: ProcessConfig;
  child: import('child_process').ChildProcess | null;
  pid: number;
  status: ProcessStatus;
  restarts: number;
  startedAt: number;
  lastExit: number | null;
  lastExitCode: number | null;
  restartTimer: ReturnType<typeof setTimeout> | null;
  stoppedByUser: boolean;
}
