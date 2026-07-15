export type RunnerContractUsage = "runner-v2" | "shared" | "legacy-shell";
export type RunnerSurfaceOwner = "runner-v2" | "legacy-shell";

export interface RunnerMigrationSurface {
  id: string;
  label: string;
  owner: RunnerSurfaceOwner;
  paths: string[];
}

export interface RunnerLegacyEquivalent {
  summary: string;
  paths: string[];
}

export interface RunnerContractLineage {
  /** Which runner currently reads or writes this persisted shape. */
  usage: RunnerContractUsage;
  /** Logical lifecycle surfaces used as the denominator for typed coverage. */
  surfaces: RunnerMigrationSurface[];
  /** The shell-era behavior or contract that preceded the typed shape. */
  legacyEquivalent?: RunnerLegacyEquivalent;
  /** Most-specific field-path ownership overrides. Unmatched fields inherit usage. */
  fieldRules?: RunnerFieldRule[];
}

export interface RunnerFieldRule {
  /** Exact path or object/array prefix, using catalog paths such as runnerV2.attempts[].phase. */
  path: string;
  usage: RunnerContractUsage;
}

export function runnerFieldUsage(
  lineage: RunnerContractLineage | undefined,
  fieldPath: string,
): RunnerContractUsage | undefined {
  if (!lineage) return undefined;
  const matching = (lineage.fieldRules || [])
    .filter((rule) => fieldPath === rule.path || fieldPath.startsWith(`${rule.path}.`) || fieldPath.startsWith(`${rule.path}[]`))
    .sort((left, right) => right.path.length - left.path.length)[0];
  return matching?.usage || lineage.usage;
}

export interface RunnerMigrationCoverage {
  typed: number;
  legacy: number;
  total: number;
  typedPercent: number;
  state: "typed" | "shared" | "legacy-shell";
}

export function runnerMigrationCoverage(lineage: RunnerContractLineage): RunnerMigrationCoverage {
  const typed = lineage.surfaces.filter((surface) => surface.owner === "runner-v2").length;
  const legacy = lineage.surfaces.filter((surface) => surface.owner === "legacy-shell").length;
  const total = typed + legacy;
  return {
    typed,
    legacy,
    total,
    typedPercent: total === 0 ? 0 : Math.round((typed / total) * 100),
    state: typed === 0 ? "legacy-shell" : legacy === 0 ? "typed" : "shared",
  };
}

/**
 * Runner lineage is intentionally explicit. Coverage counts logical execution
 * surfaces, not source files, artifacts, or lines of code. Paths are evidence
 * for each surface and are existence-checked by the catalog test suite.
 */
export const RUNNER_LINEAGE_BY_SHAPE_ID: Record<string, RunnerContractLineage> = {
  "chain-definition": {
    usage: "shared",
    surfaces: [
      {
        id: "typed-chain-planning",
        label: "Typed bootstrap and completion planning",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/agent-bootstrap-plan.ts", "web/lib/runner-v2/completion-entrypoint.ts"],
      },
      {
        id: "shell-chain-planning",
        label: "Shell launch and route planning",
        owner: "legacy-shell",
        paths: ["lib/chain-runner.sh"],
      },
    ],
    legacyEquivalent: {
      summary: "The same chain.json contract remains shared; runner v2 adds a typed consumer rather than replacing the file.",
      paths: ["lib/chain-runner.sh"],
    },
  },
  "agent-definition": {
    usage: "shared",
    surfaces: [
      {
        id: "typed-agent-planning",
        label: "Typed agent/profile bootstrap planning",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/agent-bootstrap-plan.ts"],
      },
      {
        id: "shell-agent-planning",
        label: "Shell agent configuration and launch",
        owner: "legacy-shell",
        paths: ["lib/chain-runner.sh"],
      },
    ],
    legacyEquivalent: {
      summary: "The agent.json contract is still read by both engines while initial local bootstrap migrates to typed planning.",
      paths: ["lib/chain-runner.sh"],
    },
  },
  "runner-event": {
    usage: "shared",
    surfaces: [
      {
        id: "typed-event-resolution",
        label: "Typed parsing and completion matching",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/events.ts", "web/lib/runner-v2/completion-entrypoint.ts"],
      },
      {
        id: "typed-event-side-effects",
        label: "Typed ownership and archive planning",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/event-side-effects.ts", "web/lib/runner-v2/adapters.ts"],
      },
      {
        id: "shell-event-emission",
        label: "Shell event emission and completion handoff",
        owner: "legacy-shell",
        paths: ["lib/event-trigger.sh", "lib/agent-functions.sh"],
      },
      {
        id: "shell-event-watching",
        label: "Shell cross-chain event watcher",
        owner: "legacy-shell",
        paths: ["lib/chain-event-watcher.sh"],
      },
    ],
    legacyEquivalent: {
      summary: "Runner v2 normalizes and routes the existing key-value event contract; shell emitters and the chain watcher still produce or consume it.",
      paths: ["lib/event-trigger.sh", "lib/agent-functions.sh", "lib/chain-event-watcher.sh"],
    },
  },
  "run-record": {
    usage: "shared",
    fieldRules: [
      // runnerV2 is an intentionally isolated typed namespace. The surrounding
      // run envelope remains shared while both engines are active.
      { path: "runnerV2", usage: "runner-v2" },
    ],
    surfaces: [
      {
        id: "typed-run-mutation",
        label: "Locked typed run.json mutation",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/run-state.ts"],
      },
      {
        id: "typed-run-recovery",
        label: "Typed completion recovery and reconciliation",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/completion-recovery.ts", "web/lib/runs/run-reconciler.ts"],
      },
      {
        id: "shell-run-lifecycle",
        label: "Shell run creation and lifecycle mutation",
        owner: "legacy-shell",
        paths: ["lib/run-lib.sh", "lib/chain-runner.sh", "lib/chain-runner-complete.sh"],
      },
    ],
    legacyEquivalent: {
      summary: "Runner v2 writes the same run.json under the shared lock protocol; shell remains an active lifecycle writer during side-by-side migration.",
      paths: ["lib/run-lib.sh", "lib/chain-runner.sh", "lib/chain-runner-complete.sh"],
    },
  },
  "runner-v2-attempt": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-attempt-ledger",
        label: "Typed attempt phase and instruction ledger",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/agent-attempt.ts"],
      },
      {
        id: "typed-attempt-bootstrap",
        label: "Typed local attempt creation",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/bootstrap-executor.ts"],
      },
      {
        id: "typed-routed-adoption",
        label: "Typed completion-time adoption for shell-routed agents",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/completion-entrypoint.ts"],
      },
    ],
    legacyEquivalent: {
      summary: "No single persisted predecessor existed; attempt state was implicit across shell .state files, run.json agent fields, and PTY sessions.",
      paths: ["lib/chain-runner.sh", "lib/chain-runner-complete.sh"],
    },
  },
  "runner-v2-pending-handoff": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-handoff-persistence",
        label: "Persist launch PID and exact target agents",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/adapters.ts", "web/lib/runner-v2/run-state.ts"],
      },
      {
        id: "typed-handoff-reconciliation",
        label: "Reconcile pending handoff liveness",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/handoff-liveness.ts", "web/lib/runs/run-reconciler.ts"],
      },
      {
        id: "shell-routed-launch",
        label: "Launch routed downstream agents",
        owner: "legacy-shell",
        paths: ["web/lib/runner-v2/routed-launch-plan.ts", "lib/chain-runner.sh"],
      },
    ],
    legacyEquivalent: {
      summary: "There was no persisted predecessor. This closes the liveness gap around detached chain-runner.sh --start/--parallel launches; shell still performs the routed launch.",
      paths: ["lib/chain-runner.sh"],
    },
  },
  "runner-agent-state": {
    usage: "shared",
    surfaces: [
      {
        id: "typed-state-overlay",
        label: "Typed bootstrap state overlay",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/bootstrap-executor.ts"],
      },
      {
        id: "shell-agent-state",
        label: "Shell .state lifecycle ownership",
        owner: "legacy-shell",
        paths: ["lib/chain-runner.sh", "lib/chain-runner-complete.sh"],
      },
    ],
    legacyEquivalent: {
      summary: "This is the legacy line-oriented state contract itself; runner v2 currently overlays it for interoperability.",
      paths: ["lib/chain-runner.sh", "lib/chain-runner-complete.sh"],
    },
  },
  "chain-loop-state": {
    usage: "shared",
    surfaces: [
      {
        id: "typed-loop-state",
        label: "Typed loop state and routing decisions",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/loop-state.ts", "web/lib/runner-v2/routing.ts"],
      },
      {
        id: "shell-loop-tracker",
        label: "Shell chain_loop_tracker.txt interoperability",
        owner: "legacy-shell",
        paths: ["lib/chain-runner-complete.sh"],
      },
    ],
    legacyEquivalent: {
      summary: "chain-loop-state.json is the typed contract; runner v2 still mirrors the shell chain_loop_tracker.txt file during migration.",
      paths: ["lib/chain-runner-complete.sh"],
    },
  },
  "external-effects-ledger": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-effect-queue",
        label: "Queue idempotent external effects",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/adapters.ts"],
      },
      {
        id: "typed-effect-dispatch",
        label: "Claim, dispatch, retry, and audit effects",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/external-effects.ts", "web/server/background-worker.ts"],
      },
      {
        id: "shell-plugin-compatibility",
        label: "Execute plugin hooks through the shell compatibility runner",
        owner: "legacy-shell",
        paths: ["lib/plugin-runner.sh"],
      },
    ],
    legacyEquivalent: {
      summary: "External side effects previously ran inline during shell completion; runner v2 queues and audits them, while plugin execution still delegates to the shell plugin runner.",
      paths: ["lib/chain-runner-complete.sh", "lib/plugin-runner.sh"],
    },
  },
  "generation-import-ledger": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-generation-plan",
        label: "Plan generation import from typed completion",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/executor.ts", "web/lib/runner-v2/completion-entrypoint.ts"],
      },
      {
        id: "typed-generation-audit",
        label: "Apply and audit the import command",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/adapters.ts"],
      },
    ],
    legacyEquivalent: {
      summary: "Replaces the unstructured generation backstop embedded in shell completion with a typed plan and append-only outcome ledger.",
      paths: ["lib/chain-runner-complete.sh"],
    },
  },
  "runspace-manifest": {
    usage: "legacy-shell",
    surfaces: [
      {
        id: "shell-runspace-manifest",
        label: "Initialize and read the runspace manifest",
        owner: "legacy-shell",
        paths: ["lib/chain-runner.sh"],
      },
    ],
    legacyEquivalent: {
      summary: "This contract remains shell-owned and has no typed runner-v2 owner yet.",
      paths: ["lib/chain-runner.sh"],
    },
  },
  "session-policy-ledger": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-session-policy-plan",
        label: "Plan keep, archive, or stop session policy",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/terminal-plan.ts"],
      },
      {
        id: "typed-session-policy-audit",
        label: "Apply and audit session policy",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/adapters.ts"],
      },
    ],
    legacyEquivalent: {
      summary: "Replaces implicit shell completion session cleanup with an explicit typed decision ledger.",
      paths: ["lib/chain-runner-complete.sh"],
    },
  },
  "watchdog-hook-dispatch": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-hook-plan",
        label: "Plan terminal and error hook operations",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/terminal-plan.ts"],
      },
      {
        id: "typed-hook-dispatch-audit",
        label: "Dispatch and audit hook execution",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/adapters.ts"],
      },
    ],
    legacyEquivalent: {
      summary: "Replaces unaudited inline shell hook dispatch with an append-only typed dispatch record.",
      paths: ["lib/chain-runner-complete.sh", "lib/hooks.sh"],
    },
  },
  "fan-group-state": {
    usage: "shared",
    surfaces: [
      {
        id: "typed-fan-group-state",
        label: "Typed fan-group lock, completion, and fan-in claim",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/fan-group-store.ts", "web/lib/runner-v2/completion-entrypoint.ts"],
      },
      {
        id: "shell-fan-group-state",
        label: "Legacy .state fan-out and fan-in tracking",
        owner: "legacy-shell",
        paths: ["lib/routing-lib.sh", "lib/chain-runner-complete.sh"],
      },
    ],
    legacyEquivalent: {
      summary: "The typed JSON store replaces the shell .state format, but runner v2 reads both while side-by-side runs remain possible.",
      paths: ["lib/routing-lib.sh", "lib/chain-runner-complete.sh"],
    },
  },
  "run-artifacts": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-artifact-write",
        label: "Write typed completion artifacts",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/adapters.ts"],
      },
      {
        id: "typed-artifact-salvage",
        label: "Use durable handoff artifacts as completion evidence",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/completion-runner.ts"],
      },
    ],
    legacyEquivalent: {
      summary: "The directory predates runner v2 and remains open to agents; runner v2 adds typed handoffs and completion-evidence semantics without closing the format.",
      paths: ["lib/chain-runner-complete.sh"],
    },
  },
  "workspace-registry": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-local-workspace",
        label: "Plan direct local workspace bootstrap",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/agent-bootstrap-plan.ts"],
      },
      {
        id: "shell-remote-workspace",
        label: "Launch SSH and Docker workspaces",
        owner: "legacy-shell",
        paths: ["lib/chain-runner.sh"],
      },
    ],
    legacyEquivalent: {
      summary: "Local bootstrap is typed; SSH and Docker workspace launches still return to the shell runner.",
      paths: ["lib/chain-runner.sh"],
    },
  },
  "config-profile": {
    usage: "legacy-shell",
    surfaces: [
      {
        id: "shell-config-profile",
        label: "Load execution and model overlays",
        owner: "legacy-shell",
        paths: ["lib/chain-runner.sh", "lib/config.sh"],
      },
    ],
    legacyEquivalent: {
      summary: "This is a shell-only compatibility contract; runner v2 uses agent profiles instead.",
      paths: ["lib/chain-runner.sh", "lib/config.sh"],
    },
  },
  "agent-profile": {
    usage: "shared",
    surfaces: [
      {
        id: "typed-profile-resolution",
        label: "Typed profile, readiness, and transcript resolution",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/agent-bootstrap-plan.ts", "web/lib/runner-v2/monitor-live-io.ts"],
      },
      {
        id: "shell-profile-resolution",
        label: "Shell profile resolution and command launch",
        owner: "legacy-shell",
        paths: ["lib/agent-profile.sh", "lib/chain-runner.sh"],
      },
    ],
    legacyEquivalent: {
      summary: "The persisted profile is shared; typed bootstrap and monitoring are replacing the shell profile loader one lifecycle surface at a time.",
      paths: ["lib/agent-profile.sh", "lib/chain-runner.sh"],
    },
  },
  "schedule-runtime-state": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-schedule-state",
        label: "Read and update schedule runtime state",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/adapters.ts", "web/lib/schedules/scheduler-service.ts"],
      },
    ],
    legacyEquivalent: {
      summary: "Runner v2 uses the typed scheduler state rather than introducing a second shell-specific schedule-state format.",
      paths: ["lib/scheduler.sh"],
    },
  },
  "chain-watcher-runtime": {
    usage: "shared",
    surfaces: [
      {
        id: "typed-watcher-singleton-bootstrap",
        label: "Ensure the watcher singleton before typed agent launch",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/bootstrap-executor.ts"],
      },
      {
        id: "shell-watcher-daemon",
        label: "Own the long-running watcher daemon and runtime files",
        owner: "legacy-shell",
        paths: ["lib/chain-event-watcher.sh"],
      },
    ],
    legacyEquivalent: {
      summary: "Runner v2 preserves singleton startup, but the long-running watcher and its runtime state remain shell-owned.",
      paths: ["lib/chain-event-watcher.sh"],
    },
  },
  "runner-retry-state": {
    usage: "shared",
    surfaces: [
      {
        id: "typed-retry-plan-state",
        label: "Typed retry decision and state application",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/retry-plan.ts", "web/lib/runner-v2/adapters.ts"],
      },
      {
        id: "shell-retry-state",
        label: "Shell retry counters, backoff, and circuit handling",
        owner: "legacy-shell",
        paths: ["lib/chain-runner-complete.sh", "lib/retry-utils.sh", "lib/error-handling.sh"],
      },
    ],
    legacyEquivalent: {
      summary: "Typed retry planning writes compatible counters while shell completion and retry utilities remain active owners.",
      paths: ["lib/chain-runner-complete.sh", "lib/retry-utils.sh", "lib/error-handling.sh"],
    },
  },
};
