import type { ChildProcess } from "child_process";

export type RunnerV2LaunchMode = "external-cli" | "typed-plan";
export type RunnerV2Support = "supported" | "unsupported";

export interface RunnerV2LaunchContext {
  chainPath: string;
  runDir: string;
  runId: string;
  chainId: string;
  chainName: string;
  workspacePath?: string;
  taskId?: string;
  debug?: boolean;
  logFd: number;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Exact agent selected by typed routing. Omitted only for initial bootstrap. */
  agentId?: string;
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
    default: "on";
    scope: string;
  };
  entrypoints?: {
    completion_reentry?: {
      v2?: string;
      fallback?: string;
    };
  };
  invariants: string[];
  implementation_coverage?: Record<string, Record<string, ImplementationCoverageEntry>>;
}

/**
 * Binding of one per-implementation contract line (docs/orchestration/contracts/
 * *.contract.json owns[]/invariants[]) to its typed-parity status. Every line
 * must be bound — the switch-readiness binding gate fails on unbound lines so
 * contract behavior can never again be silently skipped during migration.
 */
export interface ImplementationCoverageEntry {
  /** covered: typed parity with evidence; gap: named parity blocker; shell-owned: v1 keeps owning it under side-by-side */
  status: "covered" | "gap" | "shell-owned";
  /** required for covered: file/proof/run evidence */
  evidence?: string;
  /** required for gap: the blocker that must clear before switch */
  blocker?: string;
  /** required for shell-owned: why the shell keeps owning it */
  reason?: string;
}
