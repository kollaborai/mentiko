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
  "job-record": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-job-record-store",
        label: "Validate, contain, and atomically persist job lifecycle records",
        owner: "runner-v2",
        paths: ["web/lib/runs/job-record.ts", "web/lib/runs/job-store.ts"],
      },
      {
        id: "typed-detached-job-worker",
        label: "Run the detached agent process and persist its terminal job lifecycle",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/job-worker.ts", "web/lib/runs/job-runner-launch.ts"],
      },
    ],
    legacyEquivalent: {
      summary: "Replaces the standalone job-runner.mjs record parser and lifecycle writer with a compiled typed worker; the external agent CLI remains a child-process boundary.",
      paths: ["web/lib/runner-v2/job-worker.ts"],
    },
  },
  "task-generation-payload": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-generation-payload-resolution",
        label: "Resolve and validate run-owned artifact, event, transcript, and output payload candidates",
        owner: "runner-v2",
        paths: ["web/lib/generation/payload-resolver.ts", "web/lib/generation/payload-import-cli.ts"],
      },
    ],
    legacyEquivalent: {
      summary: "Replaces mentiko-cli-generation.mjs payload salvage with a compiled typed command boundary.",
      paths: ["web/lib/generation/payload-import-cli.ts"],
    },
  },
  "chain-definition": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-chain-contract",
        label: "Decode, expand references, validate, and resolve runtime chain fields",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/chain-contract.ts", "web/lib/runner-v2/chain-contract-cli.ts"],
      },
    ],
    legacyEquivalent: {
      summary: "Replaces direct shell jq decoding and reference expansion; the shell remains only as a primitive-argument CLI invocation boundary.",
      paths: ["lib/chain-runner.sh"],
    },
  },
  "agent-definition": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-agent-contract",
        label: "Resolve normalized agent fields, arrays, authorities, artifacts, and trigger selection",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/chain-contract.ts", "web/lib/runner-v2/chain-contract-cli.ts"],
      },
    ],
    legacyEquivalent: {
      summary: "Replaces direct shell jq reads of agent configuration while preserving the external CLI launch boundary.",
      paths: ["lib/chain-runner.sh"],
    },
  },
  "runner-event": {
    usage: "runner-v2",
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
        id: "typed-event-services",
        label: "Typed event-trigger watcher and stalled-run diagnostics",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/chain-watcher-service.ts", "web/lib/runner-v2/watchdog.ts", "web/server/background-worker.ts"],
      },
      {
        id: "typed-event-lifecycle",
        label: "Typed strict scan, completion lookup, processed mutation, and archive lifecycle",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/event-lifecycle.ts", "web/lib/runner-v2/event-lifecycle-cli.ts"],
      },
    ],
  },
  "runner-event-archive-receipt": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-event-archive-receipt",
        label: "Typed pre-launch file-generation identity, exact raw/normalized/archive hash proof, and consume-last crash retry",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/event-lifecycle.ts", "web/lib/runner-v2/event-lifecycle.test.ts"],
      },
    ],
  },
  "run-record": {
    usage: "runner-v2",
    fieldRules: [
      // runnerV2 is an intentionally isolated typed namespace within the
      // canonical TypeScript-owned envelope.
      { path: "runnerV2", usage: "runner-v2" },
    ],
    surfaces: [
      {
        id: "typed-run-mutation",
        label: "Locked typed run.json mutation",
        owner: "runner-v2",
        paths: [
          "web/lib/runs/run-record.ts",
          "web/lib/runner-v2/run-state.ts",
          "web/lib/runner-v2/run-record-operations.ts",
        ],
      },
      {
        id: "typed-run-recovery",
        label: "Typed completion recovery and reconciliation",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/completion-recovery.ts", "web/lib/runs/run-reconciler.ts"],
      },
      {
        id: "shell-run-command-boundary",
        label: "Shell command clients invoke the typed Run Record CLI",
        owner: "runner-v2",
        paths: ["lib/run-lib.sh", "lib/chain-runner.sh"],
      },
    ],
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
        label: "Typed completion-time reuse or pre-cutover routed adoption",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/completion-entrypoint.ts"],
      },
    ],
    legacyEquivalent: {
      summary: "No single persisted predecessor existed; attempt state was implicit across shell .state files, run.json agent fields, and PTY sessions.",
      paths: ["lib/chain-runner.sh", "web/lib/runner-v2/completion-entrypoint.ts"],
    },
  },
  "runner-v2-pending-handoff": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-handoff-cleanup",
        label: "Read and clear pre-cutover pending handoff evidence",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/handoff-liveness.ts", "web/lib/runner-v2/run-state.ts"],
      },
      {
        id: "typed-handoff-reconciliation",
        label: "Reconcile and retire live legacy pending handoffs",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/handoff-liveness.ts", "web/lib/runs/run-reconciler.ts"],
      },
    ],
    legacyEquivalent: {
      summary: "Previous typed completion code wrote these records around detached routed launches. Synchronous typed CLI acceptance now proves delivery through run agent, session, and AgentAttempt state, so no new pending handoff receipt is created.",
      paths: ["web/lib/runner-v2/adapters.ts"],
    },
  },
  "runner-agent-state": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-agent-state-owner",
        label: "Typed parse, path resolution, and locked state transitions",
        owner: "runner-v2",
        paths: [
          "web/lib/runner-v2/agent-state.ts",
          "web/lib/runner-v2/agent-state-cli.ts",
          "web/lib/runner-v2/bootstrap-executor.ts",
        ],
      },
    ],
    legacyEquivalent: {
      summary: "The persisted key-value format remains readable, but shell callers now invoke the compiled TypeScript boundary and do not parse or mutate state records.",
      paths: ["lib/agent-state-client.sh", "web/lib/runner-v2/agent-state-cli.ts"],
    },
  },
  "completion-launch-context": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-completion-context-handoff",
        label: "Write, validate, accept, and clean the private one-shot completion context",
        owner: "runner-v2",
        paths: [
          "web/lib/runner-v2/completion-launch-context.ts",
          "web/lib/runner-v2/completion-launch.ts",
          "web/lib/runner-v2/complete-cli.ts",
        ],
      },
    ],
  },
  "chain-loop-state": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-loop-state",
        label: "Typed loop state and routing decisions",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/loop-state.ts", "web/lib/runner-v2/routing.ts"],
      },
      {
        id: "typed-loop-tracker-compatibility",
        label: "Typed chain_loop_tracker.txt compatibility",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/loop-state.ts"],
      },
    ],
    legacyEquivalent: {
      summary: "chain-loop-state.json is authoritative; the typed owner still mirrors the line-oriented predecessor format while pre-cutover runs may exist.",
      paths: ["web/lib/runner-v2/loop-state.ts"],
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
        id: "typed-plugin-dispatch",
        label: "Validate registry ownership and invoke declared plugin hooks",
        owner: "runner-v2",
        paths: ["web/lib/system/plugin-dispatch.ts", "web/lib/runner-v2/external-effects.ts"],
      },
    ],
  },
  "completion-event-emission-ledger": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-completion-event-emission",
        label: "Claim and emit canonical completion events once per occurrence",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/adapters.ts", "web/lib/runner-v2/event-emitter.ts"],
      },
      {
        id: "typed-completion-event-recovery",
        label: "Recover emission proof from active or archived event bytes",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/adapters.ts", "web/lib/runner-v2/event-lifecycle.ts"],
      },
    ],
    legacyEquivalent: {
      summary: "Replaces overwrite-prone inline terminal event writes with canonical collision-safe emission and durable per-occurrence receipts.",
      paths: ["web/lib/runner-v2/adapters.ts", "web/lib/runner-v2/event-emitter.ts"],
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
      paths: ["web/lib/runner-v2/completion-entrypoint.ts", "web/lib/runner-v2/adapters.ts"],
    },
  },
  "runspace-manifest": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-runspace-manifest",
        label: "Create and validate the per-run artifact manifest",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/runspace-manifest.ts", "web/lib/runner-v2/runspace-manifest-cli.ts"],
      },
      {
        id: "shell-runspace-command-boundary",
        label: "Invoke the typed manifest owner during chain launch",
        owner: "runner-v2",
        paths: ["lib/runspace-manifest-client.sh", "lib/chain-runner.sh"],
      },
    ],
    legacyEquivalent: {
      summary: "The manifest is now created and validated by the typed boundary; shell launch only invokes its named ensure operation.",
      paths: ["web/lib/runner-v2/runspace-manifest.ts", "lib/runspace-manifest-client.sh"],
    },
  },
  "batch-run-record": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-batch-store",
        label: "Validate, persist, and atomically mutate batch lifecycle records",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/batch-run-record.ts"],
      },
      {
        id: "typed-batch-worker",
        label: "Launch batch chains and record aggregate completion through the typed worker",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/batch-runner.ts", "web/lib/runner-v2/batch-runner-cli.ts", "web/app/api/chains/run-batch/route.ts"],
      },
    ],
    legacyEquivalent: {
      summary: "Replaces multi-chain-runner.sh JSON parsing, lifecycle mutation, PID files, and result writes. Shell remains only as the invoked chain runner process boundary.",
      paths: ["web/lib/runner-v2/batch-runner.ts", "lib/chain-runner.sh"],
    },
  },
  "task-database": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-run-task-terminal-sync",
        label: "Project terminal run status and exact blocked reason onto the linked task",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/run-task-sync.ts", "web/app/api/tasks/reconcile/route.ts", "web/lib/tasks/task-transforms.ts"],
      },
    ],
  },
  "runtime-profiler": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-runtime-profiler",
        label: "Validate and atomically mutate per-session profile records",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/runtime-metrics.ts", "web/lib/runner-v2/runtime-metrics-cli.ts"],
      },
      {
        id: "shell-pty-sample-boundary",
        label: "Collect only live PTY and operating-system resource samples",
        owner: "runner-v2",
        paths: ["lib/profiler.sh"],
      },
    ],
  },
  "performance-metrics": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-performance-metrics",
        label: "Own run performance mutation, reports, pricing, and cleanup",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/runtime-metrics.ts", "web/lib/runner-v2/runtime-metrics-cli.ts"],
      },
      {
        id: "shell-pty-resource-boundary",
        label: "Collect only real PTY process resource values",
        owner: "runner-v2",
        paths: ["lib/performance.sh"],
      },
    ],
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
      paths: ["web/lib/runner-v2/terminal-plan.ts", "web/lib/runner-v2/adapters.ts"],
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
      {
        id: "typed-watchdog-hook-delivery",
        label: "Claim, retry, and audit stalled-run hook delivery",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/watchdog.ts", "web/server/background-worker.ts"],
      },
    ],
    legacyEquivalent: {
      summary: "Replaces unaudited inline shell hook dispatch with an append-only typed dispatch record.",
      paths: ["web/lib/runner-v2/adapters.ts", "lib/hooks.sh"],
    },
  },
  "runner-schedule-completion-history": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-schedule-completion-receipt",
        label: "Claim and record terminal schedule marks once per occurrence",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/adapters.ts"],
      },
    ],
    legacyEquivalent: {
      summary: "Typed completion records a stable JSONL receipt and repairs state from the receipt timestamp on replay.",
      paths: ["web/lib/runner-v2/adapters.ts"],
    },
  },
  "rollback-plan-ledger": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-rollback-plan-audit",
        label: "Claim and audit plan-only rollback once per occurrence",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/retry-plan.ts", "web/lib/runner-v2/adapters.ts"],
      },
    ],
    legacyEquivalent: {
      summary: "Typed completion records operator-gated rollback intent without applying a repository mutation.",
      paths: ["web/lib/runner-v2/retry-plan.ts", "web/lib/runner-v2/adapters.ts"],
    },
  },
  "fan-group-state": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-fan-group-state",
        label: "Typed fan-group lock, completion, and fan-in claim",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/fan-group-store.ts", "web/lib/runner-v2/completion-entrypoint.ts"],
      },
    ],
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
      paths: ["web/lib/runner-v2/completion-entrypoint.ts", "web/lib/runner-v2/adapters.ts"],
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
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-config-profile",
        label: "Decode and resolve execution and model overlays",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/chain-contract.ts", "web/lib/runner-v2/chain-contract-cli.ts"],
      },
    ],
    legacyEquivalent: {
      summary: "Replaces direct shell profile-file decoding; shell only invokes the typed field resolver.",
      paths: ["lib/chain-runner.sh", "lib/config.sh"],
    },
  },
  "breakpoints": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-breakpoint-record",
        label: "Validate, lock, and atomically mutate debugger breakpoint state",
        owner: "runner-v2",
        paths: ["web/lib/runs/breakpoint-store.ts", "web/lib/runner-v2/breakpoint-cli.ts"],
      },
    ],
    legacyEquivalent: {
      summary: "Replaces shell jq parsing and unlocked breakpoints.json writes; shell only invokes the compiled typed CLI.",
      paths: ["lib/chain-runner.sh"],
    },
  },
  "agent-profile": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-profile-resolution",
        label: "Typed profile validation, resolution, command compilation, readiness, and transcript resolution",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/agent-profile.ts", "web/lib/runner-v2/agent-profile-cli.ts", "web/lib/runner-v2/agent-bootstrap-plan.ts", "web/lib/runner-v2/monitor-live-io.ts"],
      },
    ],
  },
  "secret-record": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-profile-secret-resolution",
        label: "Resolve profile secret references through the typed secrets store before CLI launch",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/agent-profile.ts", "web/lib/secrets/secrets-store.ts"],
      },
    ],
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
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-watcher-lifecycle",
        label: "Start, stop, and report the typed watcher service",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/chain-watcher-service.ts", "web/server/background-worker.ts"],
      },
      {
        id: "typed-watcher-state",
        label: "Own watcher locks, idempotency markers, and launch logs",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/chain-watcher-service.ts"],
      },
    ],
  },
  "runner-retry-state": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-retry-plan-state",
        label: "Typed retry decision and state application",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/retry-plan.ts", "web/lib/runner-v2/adapters.ts"],
      },
      {
        id: "typed-retry-storage",
        label: "Run-and-agent-scoped JSON retry storage",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/adapters.ts", "web/lib/runner-v2/completion-entrypoint.ts"],
      },
    ],
    legacyEquivalent: {
      summary: "Typed retry storage replaces unscoped numeric counters; retry_{agentId}.count is rejected as ambiguous and is not a compatibility fallback.",
      paths: ["web/lib/runner-v2/adapters.ts"],
    },
  },
};
