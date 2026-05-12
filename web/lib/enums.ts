// status values for tasks, agents, operations
export enum Status {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETE = 'complete',
  FAILED = 'failed',
  ERROR = 'error',
  PAUSED = 'paused',
  CANCELLED = 'cancelled',
}

export const STATUS_VALUES = Object.values(Status) as Status[];

// execution mode for multi-agent chains
export enum ChainMode {
  PARALLEL = 'parallel',
  SEQUENTIAL = 'sequential',
}

export const CHAIN_MODE_VALUES = Object.values(ChainMode) as ChainMode[];

// logging levels
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

export const LOG_LEVEL_VALUES = Object.values(LogLevel) as LogLevel[];

// export/import formats
export enum ExportFormat {
  JSON = 'json',
  MARKDOWN = 'markdown',
  YAML = 'yaml',
}

export const EXPORT_FORMAT_VALUES = Object.values(ExportFormat) as ExportFormat[];

// workspace connection types
export enum WorkspaceType {
  LOCAL = 'local',
  SSH = 'ssh',
  DOCKER = 'docker',
}

export const WORKSPACE_TYPE_VALUES = Object.values(WorkspaceType) as WorkspaceType[];
