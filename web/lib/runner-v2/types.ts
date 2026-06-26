import type { ChildProcess } from "child_process";

export type RunnerV2LaunchMode = "shell-compat" | "typed-plan";
export type RunnerV2Support = "supported" | "unsupported";

export interface RunnerV2LaunchContext {
  chainPath: string;
  runDir: string;
  runId: string;
  chainName: string;
  workspacePath?: string;
  taskId?: string;
  debug?: boolean;
  logFd: number;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface RunnerV2LaunchUnsupported {
  support: "unsupported";
  reason: string;
  fallbackAllowed?: boolean;
}

export interface RunnerV2LaunchStarted {
  support: "supported";
  mode: RunnerV2LaunchMode;
  child?: ChildProcess;
  sessionName?: string;
}

export type RunnerV2LaunchResult = RunnerV2LaunchUnsupported | RunnerV2LaunchStarted;

export interface RunnerV2Contract {
  schema_version: "runner-contract/v1";
  migration_mode: "side-by-side";
  default_runner: "shell";
  flag: {
    name: "MENTIKO_RUNNER_V2";
    enabled_values: string[];
    default: "off";
    scope: string;
  };
  completion_flag?: {
    name: "MENTIKO_RUNNER_V2_COMPLETION";
    enabled_values: string[];
    default: "off";
    scope: string;
  };
  entrypoints?: {
    completion_reentry?: {
      v2?: string;
      fallback?: string;
    };
  };
  invariants: string[];
}
