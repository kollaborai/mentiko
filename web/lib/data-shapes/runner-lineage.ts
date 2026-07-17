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
  "kollab-integration-config": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-kollab-mcp-settings",
        label: "Validate, normalize, and atomically publish the Kollab MCP server registration",
        owner: "runner-v2",
        paths: [
          "web/lib/kollabor-mcp-settings.ts",
          "web/lib/runner-v2/kollabor-mcp-settings-cli.ts",
          "web/lib/process-manager.ts",
        ],
      },
    ],
    legacyEquivalent: {
      summary: "Replaces the Docker entrypoint inline Node JSON parser and writer. The entrypoint now only invokes the compiled typed CLI.",
      paths: ["bin/docker-entrypoint.sh"],
    },
  },
  "startup-recovery-decision-log": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-recovery-decision-gate",
        label: "Validate the advisor payload and decide whether a recovery may be auto-applied unattended",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/readiness-cli.ts"],
      },
      {
        id: "typed-recovery-decision-audit",
        label: "Append every considered decision to a private, symlink-rejecting run-scoped log",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/readiness-cli.ts"],
      },
    ],
    legacyEquivalent: {
      summary: "Replaces the advisor-recovery.sh jq contract, which validated .action as any string rather than the five-action enum its own prompt documented, and split validation from the auto-apply policy so a caller could consult either half alone. The typed owner enum-checks the action, requires a reason, and folds validation into the single auto-apply gate, so a decision cannot be applied without passing the contract that describes it.",
      paths: ["web/lib/runner-v2/readiness-cli.ts"],
    },
  },
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
  "system-log": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-system-log-contract",
        label: "Normalize submissions and append validated entries to the system log",
        owner: "runner-v2",
        paths: ["web/lib/system/system-logger.ts", "web/app/api/system/logs/route.ts"],
      },
      {
        id: "typed-system-log-dispatch",
        label: "Own payload construction and dispatch for shell invocation boundaries",
        owner: "runner-v2",
        paths: ["web/lib/system/system-log-cli.ts"],
      },
    ],
    legacyEquivalent: {
      summary: "Replaces the jq payload construction in run-lib.sh's _sys_log, which built the record inline and posted a level the route cast onto the entry without checking it. lib/run-lib.sh now forwards primitive arguments to the compiled CLI and retains no fallback.",
      paths: ["lib/run-lib.sh"],
    },
  },
  "token-usage": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-token-transcript-extraction",
        label: "Parse agent transcript dialects and report the observed model and provider provenance",
        owner: "runner-v2",
        paths: ["web/lib/system/token-usage-extraction.ts"],
      },
      {
        id: "typed-token-record-store",
        label: "Price, atomically persist, and index per-agent token usage records",
        owner: "runner-v2",
        paths: ["web/lib/system/token-store.ts", "web/app/api/tokens/record/route.ts", "web/app/api/runs/[id]/cost/route.ts"],
      },
    ],
    legacyEquivalent: {
      summary: "Replaces token-extractor.sh stdout scraping, whose \"usage\":{[^}]*} regex truncated on the nested server_tool_use object and whose OpenAI branch matched prompt/completion keys codex never emits. The typed owner reads transcript JSONL, sums per-message Claude usage, takes the last cumulative codex token_count, and records only the model a transcript named.",
      paths: ["web/lib/system/token-usage-extraction.ts"],
    },
  },
  "task-generation-payload": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-generation-payload-resolution",
        label: "Resolve and validate task-owned artifact, event, transcript, and output payload candidates; audit only task-kind shared generation-result handoffs",
        owner: "runner-v2",
        paths: ["web/lib/generation/payload-resolver.ts", "web/lib/generation/payload-import-cli.ts", "web/lib/data-shapes/runtime-catalog.ts"],
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
        label: "Decode, expand references, validate, resolve runtime fields, and read routing and monitor completion definitions",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/chain-contract.ts", "web/lib/runner-v2/chain-contract-cli.ts", "web/lib/runner-v2/chain-validation-cli.ts", "web/lib/runner-v2/routing-contract.ts", "web/lib/runner-v2/routing-contract-cli.ts", "web/lib/runner-v2/monitor-completion-contract.ts", "web/lib/runner-v2/monitor-completion-cli.ts"],
      },
      {
        id: "typed-chain-generation",
        label: "Decode external model output, validate generated chain records, and materialize chain/spec artifacts",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/chain-generation-cli.ts", "lib/runner-chain-generation.js"],
      },
      {
        id: "typed-direct-local-snapshot",
        label: "Validate and materialize the direct local execution snapshot before typed bootstrap",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/direct-run.ts", "web/lib/runner-v2/direct-run-cli.ts", "lib/runner-v2-direct-run.js", "bin/mentiko"],
      },
      {
        id: "typed-preallocated-run-snapshot",
        label: "Exclusively publish an immutable run-local chain snapshot before the preallocated run record",
        owner: "runner-v2",
        paths: ["web/lib/runs/run-record.ts"],
      },
      {
        id: "typed-existing-run-snapshot-launch",
        label: "Validate the immutable run-local snapshot, bind its name/id identity to run provenance, and fail closed on mismatch before typed bootstrap of a preallocated run",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/existing-run-launch.ts", "web/lib/runner-v2/existing-run-launch-cli.ts", "lib/runner-v2-existing-run.js"],
      },
    ],
    legacyEquivalent: {
      summary: "Replaces direct shell jq decoding, generation, reference expansion, validation, routing reads, and monitor completion matching; shell callers only invoke typed primitive commands or the required external model process.",
      paths: ["lib/chain-generator.sh", "lib/chain-runner.sh", "lib/validate.sh", "lib/routing-lib.sh", "lib/monitor-completion.sh"],
    },
  },
  "audit-remote-ship": {
    usage: "runner-v2",
    surfaces: [{
      id: "typed-audit-remote-shipper",
      label: "Validate audit JSONL, derive remote object keys, retry rclone, and append failure breadcrumbs",
      owner: "runner-v2",
      paths: ["web/lib/runner-v2/audit-ship.ts", "web/lib/runner-v2/audit-ship-cli.ts", "lib/runner-audit-ship.js"],
    }],
    legacyEquivalent: {
      summary: "Replaces audit-ship.sh jq/date/cut parsing, key derivation, retry orchestration, and failure JSON construction; rclone remains the required external CLI.",
      paths: ["lib/audit-ship.sh"],
    },
  },
  "notification-dispatch-envelope": {
    usage: "runner-v2",
    surfaces: [{
      id: "typed-notification-dispatch",
      label: "Build and validate internal notification dispatch request/response envelopes",
      owner: "runner-v2",
      paths: ["web/lib/runner-v2/notification-dispatcher.ts", "web/lib/runner-v2/notification-dispatcher-cli.ts", "lib/runner-notification-dispatcher.js"],
    }],
    legacyEquivalent: {
      summary: "Replaces notification-dispatcher.sh jq/curl payload and response parsing; the route now separates raw JSON decoding from normalized envelope validation, and HTTP remains the required internal API boundary.",
      paths: ["lib/notification-dispatcher.sh"],
    },
  },
  "chain-version-control": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-chain-version-owner",
        label: "Validate, read, archive, compare, and atomically mutate chain version and metadata records",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/version-control.ts", "web/lib/runner-v2/version-control-cli.ts"],
      },
      {
        id: "typed-chain-version-shell-boundary",
        label: "Forward legacy version-control function calls to the compiled typed owner",
        owner: "runner-v2",
        paths: ["lib/version-control.sh"],
      },
    ],
    legacyEquivalent: {
      summary: "Replaces version-control.sh jq/sed/loop JSON parsing, metadata serialization, path resolution, rollback mutation, and agent comparison with a compiled TypeScript contract; the external diff CLI remains the only child-process product boundary.",
      paths: ["lib/version-control.sh", "tests/version-control.test.mjs"],
    },
  },
  "git-integration-projection": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-git-projection",
        label: "Parse external git status, history, diff, branch, conflict, commit, comparison, and stash output into typed records",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/git-integration.ts", "web/lib/runner-v2/git-integration-cli.ts", "lib/runner-git-integration.js"],
      },
      {
        id: "typed-git-api-readers",
        label: "Expose the typed projection to chain Git status/history/diff and read-only repository readers",
        owner: "runner-v2",
        paths: [
          "web/app/api/chains/[id]/git/status/route.ts",
          "web/app/api/chains/[id]/git/history/route.ts",
          "web/app/api/chains/[id]/git/diff/route.ts",
          "web/app/api/chains/[id]/git/branches/route.ts",
        ],
      },
      {
        id: "shell-git-invocation-boundary",
        label: "Forward legacy git projection calls without parsing or serializing JSON",
        owner: "runner-v2",
        paths: ["lib/git-integration.sh"],
      },
    ],
    legacyEquivalent: {
      summary: "Replaces git-integration.sh jq status/history/diff/branch/conflict/commit/comparison/stash JSON parsing and diff assembly with a compiled typed owner; git remains the external CLI product boundary and no shell fallback remains.",
      paths: ["lib/git-integration.sh"],
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
        label: "Typed strict scan, monitor completion resolution, processed mutation, and archive lifecycle",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/event-lifecycle.ts", "web/lib/runner-v2/event-lifecycle-cli.ts", "web/lib/runner-v2/monitor-completion-contract.ts", "web/lib/runner-v2/monitor-completion-cli.ts"],
      },
      {
        id: "typed-direct-local-bootstrap",
        label: "Start the typed local bootstrap that creates the configured event root before any agent instructions",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/direct-run.ts", "web/lib/runner-v2/bootstrap-executor.ts", "web/lib/runner-v2/direct-run-cli.ts", "lib/runner-v2-direct-run.js", "bin/mentiko"],
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
      { path: "metadata.task_run_scope", usage: "runner-v2" },
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
        id: "typed-run-summary-verdict",
        label: "Read agent summary JSON, derive the conservative run verdict, atomically publish run-summary.json, and link it to run.json",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/run-record-operations.ts", "web/lib/runner-v2/run-record-cli.ts"],
      },
      {
        id: "typed-run-recovery",
        label: "Typed completion recovery and reconciliation",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/completion-recovery.ts", "web/lib/runs/run-reconciler.ts"],
      },
      {
        id: "typed-direct-local-run-create",
        label: "Create a pending direct local run under the locked typed Run Record contract before bootstrap",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/direct-run.ts", "web/lib/runner-v2/direct-run-cli.ts", "lib/runner-v2-direct-run.js", "bin/mentiko"],
      },
      {
        id: "typed-existing-run-preflight",
        label: "Verify existing run identity, path containment, terminal state, and replay evidence, then claim the run for single-flight bootstrap under an owner-bearing file claim released only on pre-launch failure, before typed bootstrap",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/existing-run-launch.ts", "web/lib/runner-v2/existing-run-launch-cli.ts", "lib/runner-v2-existing-run.js"],
      },
      {
        id: "typed-task-run-scope-run-metadata",
        label: "Persist the task's immutable v1 scope claim in run metadata so all task readers resolve the same exact record",
        owner: "runner-v2",
        paths: ["web/lib/tasks/task-run-locator.ts", "web/app/api/chains/run/route.ts", "web/lib/runs/chain-run-service.ts"],
      },
      {
        id: "shell-run-command-boundary",
        label: "Shell command clients forward primitive arguments to the typed Run Record CLI, including summary operations",
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
      {
        id: "typed-completion-evidence-provenance",
        label: "Typed monitor-to-attempt completion evidence provenance",
        owner: "runner-v2",
        paths: [
          "web/lib/runner-v2/monitor-live-io.ts",
          "web/lib/runner-v2/completion-runner.ts",
          "web/lib/runner-v2/agent-attempt.ts",
        ],
      },
      {
        id: "typed-invalid-admission-block",
        label: "Typed invalid-admission run and agent terminal transition",
        owner: "runner-v2",
        paths: [
          "web/lib/runner-v2/concurrency-admission.ts",
          "web/lib/runner-v2/concurrency-admission-cli.ts",
        ],
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
      {
        id: "typed-error-lifecycle-owner",
        label: "Detect report failures, resolve retry policy, mutate retry state, authorize one fresh occurrence (run.resumedAt), and dispatch typed retry/handler relaunches through runner-v2-launch-agent",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/error-handling.ts", "web/lib/runner-v2/error-handling-cli.ts", "lib/runner-v2-launch-agent.js"],
      },
      {
        id: "shell-error-invocation-boundary",
        label: "Forward legacy error helper arguments to the compiled typed owner; retry/handler relaunch reuses the exact run id and re-enters through the typed launch-agent, never chain-runner.sh --start",
        owner: "runner-v2",
        paths: ["lib/error-handling.sh"],
      },
    ],
    legacyEquivalent: {
      summary: "The persisted key-value format remains readable, but shell callers now invoke the compiled TypeScript boundary and do not parse or mutate state records; legacy error handling is now an invocation-only adapter.",
      paths: ["lib/agent-state-client.sh", "web/lib/runner-v2/agent-state-cli.ts"],
    },
  },
  "runner-monitor-state": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-standalone-monitor-state",
        label: "Create a canonical standalone run and own its monitor state, completion, and terminal mutations",
        owner: "runner-v2",
        paths: [
          "web/lib/runner-v2/standalone-monitor.ts",
          "web/lib/runner-v2/standalone-monitor-cli.ts",
          "web/lib/runner-v2/monitor-live-io.ts",
        ],
      },
    ],
    legacyEquivalent: {
      summary: "The active standalone spec launcher routes into the typed run-scoped monitor. It is distinct from the manual profile-aware CLI monitor, which has its own typed global state shape.",
      paths: ["lib/launch-agent.sh"],
    },
  },
  "manual-monitor-state": {
    usage: "runner-v2",
    surfaces: [{
      id: "typed-manual-monitor-owner",
      label: "Validate manual monitor arguments and profiles, own global stale/hash/log records, invoke the configured advisor CLI, and control the attached PTY session",
      owner: "runner-v2",
      paths: ["web/lib/runner-v2/manual-monitor.ts", "web/lib/runner-v2/manual-monitor-cli.ts"],
    }],
    legacyEquivalent: {
      summary: "Replaces the manual mentiko-monitor.sh loop, including profile prompt construction, advisor output sanitization, global state/log mutation, and session cleanup. The shell command now only invokes the compiled typed CLI.",
      paths: ["bin/mentiko", "lib/agent-functions.sh"],
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
        paths: ["web/lib/runner-v2/loop-state.ts", "web/lib/runner-v2/routing.ts", "web/lib/runner-v2/routing-contract.ts"],
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
        label: "Validate registry ownership, invoke user hooks, and route declared built-ins to compiled typed handlers",
        owner: "runner-v2",
        paths: ["web/lib/system/plugin-dispatch.ts", "web/lib/runner-v2/external-effects.ts"],
      },
      {
        id: "typed-custom-webhook-native-handler",
        label: "Filter and deliver typed custom-webhook requests",
        owner: "runner-v2",
        paths: ["web/lib/system/native-plugin-handler-cli.ts"],
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
  "agent-activity-artifacts": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-agent-activity-capture",
        label: "Capture local agent-start provenance plus completion-time activity, validate it, and atomically publish per-agent activity artifacts",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/activity-capture.ts", "web/lib/runner-v2/activity-capture-cli.ts"],
      },
      {
        id: "shell-local-activity-start-invocation",
        label: "Forward local start identity and roots to the typed activity-start owner before CLI startup",
        owner: "runner-v2",
        paths: ["lib/chain-runner.sh", "web/lib/runner-v2/activity-capture-cli.ts"],
      },
      {
        id: "typed-agent-activity-provenance",
        label: "Mutate the run activity manifest from validated artifacts under the typed Run Record lock",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/run-record-operations.ts", "web/lib/runner-v2/run-record-cli.ts"],
      },
    ],
    legacyEquivalent: {
      summary: "Replaces shell jq/awk/date/find/cp artifact capture and hand-built conversation JSON; the shell entrypoint now only forwards arguments to the compiled typed owner.",
      paths: ["lib/agent-activity-capture.sh"],
    },
  },
  "approval-request": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-approval-request-lifecycle",
        label: "Decode, validate, persist, poll, and timeout approval requests",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/approval-gate.ts", "web/lib/runner-v2/approval-gate-cli.ts"],
      },
      {
        id: "shell-approval-command-boundary",
        label: "Forward primitive approval arguments to the typed gate",
        owner: "runner-v2",
        paths: ["lib/approval-gate.sh"],
      },
    ],
    legacyEquivalent: {
      summary: "Replaces shell jq request construction, validation, polling, and timeout mutation; the shell file is now an invocation-only boundary.",
      paths: ["lib/approval-gate.sh"],
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
        id: "typed-task-run-scope-contract",
        label: "Validate and persist the immutable v1 active task-to-run scope during manual and auto task launch, then release it atomically on terminal retry while retaining verified source provenance",
        owner: "runner-v2",
        paths: [
          "web/lib/tasks/task-run-locator.ts",
          "web/app/api/tasks/[id]/run-chain/route.ts",
          "web/app/api/tasks/auto-run/route.ts",
          "web/app/api/chains/run/route.ts",
          "web/app/api/tasks/reconcile/route.ts",
          "web/lib/tasks/completion-audit-apply.ts",
        ],
      },
      {
        id: "typed-task-run-scope-readers",
        label: "Resolve the exact claimed run for attempts, outcome evidence, reconciliation, and auto-run admission without scanning alternate roots",
        owner: "runner-v2",
        paths: [
          "web/lib/tasks/task-run-locator.ts",
          "web/lib/tasks/task-attempts.ts",
          "web/lib/tasks/run-outcome-evidence.ts",
          "web/app/api/tasks/reconcile/route.ts",
          "web/lib/runs/auto-run.ts",
        ],
      },
      {
        id: "typed-run-task-terminal-sync",
        label: "Project terminal run status and exact blocked reason onto the linked task",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/run-task-sync.ts", "web/app/api/tasks/reconcile/route.ts", "web/lib/tasks/task-transforms.ts"],
      },
    ],
    legacyEquivalent: {
      summary: "Tasks without task_run_scope, created before the v1 claim existed, retain their existing single request/config-resolved root read. This is legacy unscoped behavior only; a scoped task must fail closed rather than scan or fall back to another root.",
      paths: ["web/lib/tasks/task-attempts.ts", "web/lib/tasks/run-outcome-evidence.ts", "web/app/api/tasks/reconcile/route.ts", "web/lib/runs/auto-run.ts"],
    },
    fieldRules: [
      {
        path: "metadata.task_run_scope",
        usage: "runner-v2",
      },
      {
        path: "metadata.retry_source_task_run_scope",
        usage: "runner-v2",
      },
    ],
  },
  "task-context-handoff": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-task-context-resolution",
        label: "Validate task API envelopes, normalize task/comment records, and build the prompt context handoff",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/task-context.ts", "web/lib/runner-v2/task-context-cli.ts"],
      },
    ],
    legacyEquivalent: {
      summary: "Replaces chain-runner.sh curl/jq/sed task and comment parsing; the shell caller only invokes the compiled typed handoff writer.",
      paths: ["lib/chain-runner.sh", "lib/runner-task-context.js"],
    },
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
  "legacy-metrics-state": {
    usage: "runner-v2",
    surfaces: [{ id: "typed-legacy-metrics", label: "Validate and atomically mutate counters, gauges, timers, active timers, and webhook aggregates", owner: "runner-v2", paths: ["web/lib/runner-v2/legacy-metrics.ts", "web/lib/runner-v2/legacy-metrics-cli.ts", "web/app/api/metrics/route.ts"] }, { id: "shell-metric-command-boundary", label: "Shell forwards primitive metric operations only", owner: "runner-v2", paths: ["lib/metrics.sh"] }],
    legacyEquivalent: { summary: "Replaces shell jq metric parsing, file initialization, lock ownership, and JSON mutation with a compiled typed metrics owner.", paths: ["lib/metrics.sh"] },
  },
  "parallel-group-state": { usage: "runner-v2", surfaces: [{ id: "typed-parallel-group", label: "Validate and mutate parallel group lifecycle records", owner: "runner-v2", paths: ["web/lib/runner-v2/parallel-contract.ts", "web/lib/runner-v2/parallel-contract-cli.ts"] }, { id: "shell-parallel-process-boundary", label: "Launch and wait for external agent processes", owner: "runner-v2", paths: ["lib/parallel-launcher.sh", "lib/parallel-coordinator.sh", "lib/chain-runner.sh"] }] },
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
  "pty-daemon-session-projection": {
    usage: "shared",
    surfaces: [
      {
        id: "typed-pty-transport-owner",
        label: "Derive daemon identity and project daemon readiness, liveness, registered sessions, and child PID",
        owner: "runner-v2",
        paths: ["web/lib/config.ts", "web/lib/pty/pty-client.ts", "web/lib/pty/pty-transport-cli.ts"],
      },
      {
        id: "shell-pty-command-boundary",
        label: "Forward primitive transport operations and invoke only the required external PTY CLI actions",
        owner: "runner-v2",
        paths: ["lib/session-transport.sh", "lib/agent-functions.sh", "lib/chain-runner.sh"],
      },
    ],
    legacyEquivalent: {
      summary: "Replaces shell daemon-name derivation, readiness polling, session-list parsing, liveness checks, and PID projection with the typed PTY transport client.",
      paths: ["lib/session-transport.sh"],
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
      {
        id: "typed-agent-summary-json-gate",
        label: "Require parseable JSON-object agent summaries before accepting typed completion",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/bootstrap-executor.ts", "web/lib/runner-v2/completion-entrypoint.ts", "web/lib/runner-v2/quality-gate.ts"],
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
        id: "typed-external-workspace-dispatch",
        label: "Dispatch SSH and Docker through the required direct product CLI",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/controller.ts", "web/lib/runner-v2/launch-plan.ts"],
      },
    ],
    legacyEquivalent: {
      summary: "Local bootstrap is typed and fail-closed. SSH and Docker retain only direct mentiko CLI transport dispatch; no shell bridge or fallback owns workspace selection.",
      paths: ["web/lib/runner-v2/launch-plan.ts"],
    },
  },
  "config-profile": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-runtime-path-resolution",
        label: "Resolve namespace, organization, and project roots and provision the contract directory set",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/runtime-paths.ts", "web/lib/runner-v2/runtime-paths-cli.ts"],
      },
      {
        id: "typed-config-profile",
        label: "Decode and resolve execution and model overlays",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/chain-contract.ts", "web/lib/runner-v2/chain-contract-cli.ts"],
      },
    ],
    legacyEquivalent: {
      summary: "Replaces shell path derivation, directory creation, and direct profile-file decoding. lib/config.sh only invokes the typed runtime-path bundle, evaluates its fixed export projection, and forwards profile fields to the typed resolver.",
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
  "debug-run-state": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-debug-state-store",
        label: "Validate raw and normalized debugger state, then atomically read and mutate run records",
        owner: "runner-v2",
        paths: ["web/lib/runs/debug-state-store.ts", "web/lib/runner-v2/debug-state-cli.ts"],
      },
      {
        id: "typed-debug-api",
        label: "Expose debugger state and actions through the typed API route",
        owner: "runner-v2",
        paths: ["web/app/api/chains/[id]/debug/route.ts"],
      },
    ],
  },
  "legacy-chain-webhook-config": {
    usage: "runner-v2",
    surfaces: [{
      id: "typed-legacy-webhook-plan",
      label: "Validate embedded chain webhook configuration and serialize outbound payloads",
      owner: "runner-v2",
      paths: ["web/lib/runner-v2/integration-contract.ts", "web/lib/runner-v2/integration-contract-cli.ts"],
    }],
    legacyEquivalent: {
      summary: "lib/webhook-sender.sh only invokes the typed delivery operation; TypeScript owns planning, retry, and external curl invocation.",
      paths: ["lib/webhook-sender.sh", "lib/integration-contract-client.sh"],
    },
  },
  "legacy-webhook-delivery-state": {
    usage: "runner-v2",
    surfaces: [{
      id: "typed-legacy-webhook-state",
      label: "Validate, lock, atomically mutate, and query direct webhook delivery state",
      owner: "runner-v2",
      paths: ["web/lib/runner-v2/integration-contract.ts", "web/lib/runner-v2/integration-contract-cli.ts"],
    }],
    legacyEquivalent: {
      summary: "Replaces shell jq writes and ~/.mentiko_webhooks path ownership; TypeScript owns mutation and delivery lifecycle.",
      paths: ["lib/webhook-sender.sh", "lib/integration-contract-client.sh"],
    },
  },
  "legacy-chain-email-config": {
    usage: "runner-v2",
    surfaces: [{
      id: "typed-legacy-email-plan",
      label: "Resolve embedded email configuration, run report fields, report paths, and API JSON payloads",
      owner: "runner-v2",
      paths: ["web/lib/runner-v2/integration-contract.ts", "web/lib/runner-v2/integration-contract-cli.ts"],
    }],
    legacyEquivalent: {
      summary: "lib/email-integration.sh invokes the typed report-send operation; TypeScript selects and invokes mail, sendmail, or curl.",
      paths: ["lib/email-integration.sh", "lib/integration-contract-client.sh"],
    },
  },
  "agent-profile": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-profile-resolution",
        label: "Typed profile validation, resolution, command compilation, readiness, and transcript resolution",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/agent-profile.ts", "web/lib/runner-v2/agent-profile-cli.ts", "web/lib/runner-v2/readiness-policy.ts", "web/lib/runner-v2/readiness-cli.ts", "web/lib/runner-v2/agent-bootstrap-plan.ts", "web/lib/runner-v2/monitor-live-io.ts"],
      },
      {
        id: "typed-transcript-provenance",
        label: "Parse external transcript JSONL and bind durable completion evidence to the current run attempt",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/agent-transcript.ts", "web/lib/runner-v2/agent-transcript-cli.ts", "web/lib/runner-v2/monitor-live-io.ts", "lib/agent-transcript-client.sh"],
      },
    ],
  },
  "teammux-agent-spec": {
    usage: "runner-v2",
    surfaces: [{
      id: "typed-teammux-agent-spec-bridge",
      label: "Decode README/spec metadata and atomically export team-mux agent records",
      owner: "runner-v2",
      paths: ["web/lib/runner-v2/teammux-bridge.ts", "web/lib/runner-v2/teammux-bridge-cli.ts", "lib/runner-teammux-bridge.js"],
    }],
    legacyEquivalent: {
      summary: "Replaces team-mux bridge jq/grep/sed parsing and heredoc JSON writes; lib/teammux-bridge.sh now only invokes the compiled typed boundary.",
      paths: ["lib/teammux-bridge.sh"],
    },
  },
  "teammux-memory-record": {
    usage: "runner-v2",
    surfaces: [{
      id: "typed-teammux-memory-reader",
      label: "Resolve team-mux agent directories, validate memory JSON, and render summaries",
      owner: "runner-v2",
      paths: ["web/lib/runner-v2/teammux-bridge.ts", "web/lib/runner-v2/teammux-bridge-cli.ts", "lib/runner-teammux-bridge.js"],
    }],
    legacyEquivalent: {
      summary: "Replaces shell glob/jq memory reads with a typed symlink-safe reader; no shell parser or fallback remains.",
      paths: ["lib/teammux-bridge.sh"],
    },
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
        label: "Read, validate, and atomically update schedule runtime state",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/adapters.ts", "web/lib/schedules/scheduler-service.ts", "web/lib/runner-v2/schedule-contract.ts", "web/lib/runner-v2/schedule-contract-cli.ts"],
      },
      {
        id: "typed-scheduled-direct-launch",
        label: "Resolve a scheduled local workspace and start the compiled typed direct-run lifecycle without a shell runner",
        owner: "runner-v2",
        paths: ["web/lib/schedules/scheduler-service.ts", "web/app/api/schedules/route.ts", "web/lib/runner-v2/direct-run.ts", "lib/runner-v2-direct-run.js"],
      },
    ],
    legacyEquivalent: {
      summary: "The shell scheduler is an invocation-only compatibility boundary over the typed schedule contract; it does not parse or mutate schedule records. Its former check command fails closed so only the supervised TypeScript background worker can admit, transition, and launch a scheduled chain.",
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
  "runner-circuit-breaker-state": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-circuit-record-contract",
        label: "Validate raw and normalized circuit JSON, contain its project path, and atomically mutate it under a typed claim",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/retry-circuit.ts", "web/lib/runner-v2/retry-circuit-cli.ts"],
      },
      {
        id: "shell-circuit-command-boundary",
        label: "Shell forwards retry policy and circuit operations as primitive TypeScript CLI arguments",
        owner: "runner-v2",
        paths: ["lib/retry-utils.sh", "lib/chain-runner.sh"],
      },
    ],
    legacyEquivalent: {
      summary: "Replaces direct shell jq parsing, state-file writes, and deletion with a compiled typed circuit owner; no shell compatibility reader or fallback remains.",
      paths: ["lib/retry-utils.sh"],
    },
  },
  "runner-concurrency-admission-claim": {
    usage: "runner-v2",
    surfaces: [
      {
        id: "typed-concurrency-claim",
        label: "Own owner-bearing cap claim publication, stale-owner retirement, and release fencing",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/file-claim.ts", "web/lib/runner-v2/concurrency-admission.ts"],
      },
      {
        id: "typed-count-and-promote-admission",
        label: "Atomically count validated running records and publish queued, admitted, or blocked run status",
        owner: "runner-v2",
        paths: ["web/lib/runner-v2/concurrency-admission.ts", "web/lib/runner-v2/concurrency-admission-cli.ts"],
      },
      {
        id: "shell-pty-observation-boundary",
        label: "Typed admission invokes the external PTY list CLI; shell only invokes the typed admission command",
        owner: "runner-v2",
        paths: ["lib/concurrency-cap.sh"],
      },
    ],
    legacyEquivalent: {
      summary: "Replaces the shell mkdir/pid cap lock and shell count-and-promote decision with an owner-bearing typed claim; live PTY process listing remains an external command boundary.",
      paths: ["lib/concurrency-cap.sh"],
    },
  },
};
