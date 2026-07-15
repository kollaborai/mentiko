import { assessImplementationContractBinding, assessRunnerV2SwitchReadiness } from "@/lib/runner-v2/switch-readiness";
import type { RunnerV2Contract } from "@/lib/runner-v2/types";

jest.mock("@/lib/config", () => ({
  __esModule: true,
  config: {
    binDir: "/repo/bin",
    codeRoot: "/repo",
    globalRoot: "/tmp/mentiko-global",
    projectRoot: "/repo",
    orgRoot: "/tmp/org",
    namespaceRoot: "/tmp/ns",
    namespaceId: "default",
    orgId: "default",
    ptyDaemonName: "test",
    ptyManagerDir: "/tmp/pty",
  },
  default: {
    binDir: "/repo/bin",
    codeRoot: "/repo",
  },
}));

jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn((path: string) => (
    (
      path.endsWith("external-effects.ts")
    || path.endsWith("probe.ts")
    || path.endsWith("chain-run-service.ts")
    || path.endsWith("completion-entrypoint.ts")
    || path.endsWith("complete-cli.ts")
    || path.endsWith("agent-bootstrap-plan.ts")
    || path.endsWith("adapters.ts")
    || path.endsWith("completion-runner.ts")
    || path.endsWith("executor.ts")
    || path.endsWith("bootstrap-executor.ts")
    || path.endsWith("controller.ts")
    || path.endsWith("agent-functions.sh")
    || path.endsWith("agent-profile.sh")
    || path.endsWith("secrets-resolve.mjs")
    || path.endsWith("chain-runner.sh")
    || path.endsWith("Dockerfile")
    || path.endsWith("launch-plan.ts")
    || path.endsWith("loop-state.ts")
    || path.endsWith("task-outcome-audit.ts")
    || path.endsWith("completion-audit-apply.ts")
    || path.endsWith("task-store.ts")
    || path.endsWith("run-outcome-evidence.ts")
    || path.endsWith("chain-generation-required-rules.ts")
    || path.endsWith("background-worker.ts")
    || path.endsWith("runner-v2-runtime-proof.json")
    || path.endsWith("runner-v2-watched-proof.json")
    || path.endsWith(".contract.json")
    )
  )),
  readFileSync: jest.fn((path: string) => {
    if (path.endsWith("runner-v2-watched-proof.json")) {
      return JSON.stringify({
        schema_version: "runner-v2-watched-proof/v1",
        status: "passed",
        checks: [
          { id: "launch-supported", status: "pass" },
          { id: "run-completed", status: "pass" },
          { id: "agent-complete", status: "pass" },
          { id: "attempt-completed", status: "pass" },
          { id: "attempt-terminal-reason", status: "pass" },
          { id: "attempt-process-evidence", status: "pass" },
          { id: "event-written", status: "pass" },
          { id: "completion-session", status: "pass" },
        ],
      });
    }
    if (path.endsWith("runner-v2-runtime-proof.json")) {
      return JSON.stringify({
        schema_version: "runner-v2-runtime-proof/v1",
        status: "passed",
        flag: "MENTIKO_RUNNER_V2",
        mode: "live",
        checks: [
          { id: "typed-bootstrap-session", status: "pass" },
          { id: "typed-bootstrap-no-shell-start", status: "pass" },
          { id: "typed-bootstrap-no-secret-env", status: "pass" },
          { id: "typed-bootstrap-instructions-written", status: "pass" },
          { id: "typed-bootstrap-state-written", status: "pass" },
          { id: "typed-bootstrap-monitor-started", status: "pass" },
          { id: "typed-bootstrap-start-before-pointer", status: "pass" },
        ],
      });
    }
    if (path.endsWith("agent-functions.sh")) {
      return "MENTIKO_RUNNER_V2_COMPLETION runner-v2-completion-launch.js";
    }
    if (path.endsWith("agent-profile.sh")) {
      return "jq select((.value | test(\"^\\\\{secret:[^}]+\\\\}$\")) | not)";
    }
    if (path.endsWith("secrets-resolve.mjs")) {
      return "console.error('# unresolved secret reference skipped')";
    }
    if (path.endsWith("chain-runner.sh")) {
      return 'export MENTIKO_RUNNER_V2="${MENTIKO_RUNNER_V2:-}"\nexport MENTIKO_RUNNER_V2_COMPLETION="1"\nexport MENTIKO_MONITOR_V2="${MENTIKO_MONITOR_V2:-1}"';
    }
    if (path.endsWith("Dockerfile")) {
      return "runner-v2-complete.js runner-v2-completion-launch.js monitor-v2.js";
    }
    if (path.endsWith("launch-plan.ts")) {
      return 'const CHAIN_RUNNER = "chain-runner.sh"; MENTIKO_RUNNER_V2_MODE: "typed-plan"; args.push("--start")';
    }
    if (path.endsWith("controller.ts")) {
      return "import { startRunnerV2Bootstrap } from '@/lib/runner-v2/bootstrap-executor'; startRunnerV2Bootstrap(context);";
    }
    if (path.endsWith("completion-entrypoint.ts")) {
      return "const generation = generationImportPlan(run, runDir, env); shellLoopStatePath(runDir); return { decision: 'already-completed' };";
    }
    if (path.endsWith("loop-state.ts")) {
      return "export function shellLoopStatePath() { return 'chain_loop_tracker.txt'; }";
    }
    if (path.endsWith("task-outcome-audit.ts")) {
      return "const key = 'task_outcome_summary_run_fingerprint'; task_outcome_summary: undefined";
    }
    if (path.endsWith("completion-audit-apply.ts")) {
      return "const key = 'completion_audit_claimed_run_id';";
    }
    if (path.endsWith("task-store.ts")) {
      return "closed_at = NULL";
    }
    if (path.endsWith("run-outcome-evidence.ts")) {
      return "function listArtifactFiles() {}";
    }
    if (path.endsWith("chain-generation-required-rules.ts")) {
      return "DYNAMIC_PORT_RUNTIME_PROOF";
    }
    if (path.endsWith("adapters.ts")) {
      return "function applyGenerationImport() { return true; } function applyRetryState() {}";
    }
    if (path.endsWith("completion-runner.ts")) {
      return 'return { action: "generation-terminal" };';
    }
    if (path.endsWith("agent-bootstrap-plan.ts")) {
      return "Core generation handoff uses generation-result.json. MENTIKO_MONITOR_V2";
    }
    if (path.endsWith("bootstrap-executor.ts")) {
      return "import { classifyCliReadiness } from '@/lib/runner-v2/readiness-policy'; export async function executeLocalBootstrap() { await executor.spawn('name'); classifyCliReadiness({ output: '' }); await waitForBootstrapReadiness(); await startMonitorSession(); }";
    }
    if (path.endsWith("executor.ts")) {
      return 'case "generation-import": return effect; function buildRetryLaunchCommand() {} const env = { MENTIKO_RETRY_ATTEMPT: "1" };';
    }
    if (path.endsWith("background-worker.ts")) {
      return "import { drainRunnerV2ExternalEffects } from '../lib/runner-v2/external-effects'; setInterval(() => drainRunnerV2ExternalEffects(), 15_000);";
    }
    if (path.endsWith("external-effects.ts")) {
      return "taskMergeMeta(context.orgId, operation.taskId, fields, context.namespaceId); function runPluginsViaShell() {}";
    }
    if (path.endsWith("chain-runner.contract.json")) {
      return JSON.stringify({ owns: ["mock chain-runner own"], invariants: ["mock chain-runner invariant"] });
    }
    if (path.endsWith("completion-entrypoint.contract.json")) {
      return JSON.stringify({ invariants: ["mock complete invariant"] });
    }
    if (path.endsWith("monitor.contract.json")) {
      return JSON.stringify({ invariants: ["mock monitor invariant"] });
    }
    if (path.endsWith("run-event.contract.json")) {
      return JSON.stringify({ invariants: ["mock run-event invariant"] });
    }
    if (path.endsWith("watcher-watchdog.contract.json")) {
      return JSON.stringify({ invariants: ["mock watcher invariant"] });
    }
    if (path.endsWith("monitor-v2.contract.json")) {
      return JSON.stringify({
        owns: ["mock monitor-v2 own"],
        invariants: ["mock monitor-v2 invariant", "mock monitor-v2 late-event recovery"],
      });
    }
    return JSON.stringify({
      schema_version: "runner-contract/v1",
      migration_mode: "side-by-side",
      default_runner: "shell",
      flag: { name: "MENTIKO_RUNNER_V2", enabled_values: ["1"], default: "off", scope: "initial" },
      completion_flag: { name: "MENTIKO_RUNNER_V2_COMPLETION", enabled_values: ["1"], default: "on", scope: "completion" },
      generation_completion_contract: {
        no_emit_salvage: "typed completion imports generation payload before failing no-emit generation completion",
        import_effect: "typed executor includes generation-import",
        prompt_policy: "core generation prompts do not require mandatory emit",
      },
      external_effects: {
        outbox: "typed completion adapters queue external side effects to <stateDir>/external-effects.jsonl",
        live_drain: "background worker drains outboxes via drainRunnerV2ExternalEffects",
        handled_operations: ["notification", "webhook", "metadata-webhooks", "task-status", "plugin", "legacy-webhook"],
      },
      entrypoints: {
        completion_reentry: { v2: "lib/agent-functions.sh -> compiled /opt/mentiko/lib/runner-v2-complete.js when MENTIKO_RUNNER_V2_COMPLETION is enabled" },
      },
      invariants: ["completion re-entry is typed-only and fail-closed when MENTIKO_RUNNER_V2_COMPLETION is enabled"],
      implementation_coverage: {
        "chain-runner.contract.json": {
          "owns:mock chain-runner own": { status: "covered", evidence: "mock" },
          "invariant:mock chain-runner invariant": { status: "covered", evidence: "mock" },
        },
        "completion-entrypoint.contract.json": {
          "invariant:mock complete invariant": { status: "covered", evidence: "mock" },
        },
        "monitor.contract.json": {
          "invariant:mock monitor invariant": { status: "covered", evidence: "mock" },
        },
        "run-event.contract.json": {
          "invariant:mock run-event invariant": { status: "covered", evidence: "mock" },
        },
        "watcher-watchdog.contract.json": {
          "invariant:mock watcher invariant": { status: "covered", evidence: "mock" },
        },
        "monitor-v2.contract.json": {
          "owns:mock monitor-v2 own": { status: "covered", evidence: "mock" },
          "invariant:mock monitor-v2 invariant": { status: "covered", evidence: "mock" },
          "invariant:mock monitor-v2 late-event recovery": { status: "covered", evidence: "mock" },
        },
      },
    });
  }),
}));

describe("runner-v2 switch readiness", () => {
  it("reports ready when runner, monitor-v2, and contract-binding checks pass", () => {
    const report = assessRunnerV2SwitchReadiness();

    expect(report.status).toBe("ready");
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "contract-side-by-side", status: "pass" }),
      expect.objectContaining({ id: "typed-executor-supported", status: "pass" }),
      expect.objectContaining({ id: "external-dispatcher", status: "pass" }),
      expect.objectContaining({ id: "completion-typed-bridge", status: "pass" }),
      expect.objectContaining({ id: "completion-typed-launcher", status: "pass" }),
      expect.objectContaining({ id: "routed-monitor-flag-carry", status: "pass" }),
      expect.objectContaining({ id: "generation-completion-contract", status: "pass" }),
      expect.objectContaining({ id: "generation-import-entrypoint", status: "pass" }),
      expect.objectContaining({ id: "generation-import-effect", status: "pass" }),
      expect.objectContaining({ id: "generation-import-adapter", status: "pass" }),
      expect.objectContaining({ id: "generation-no-emit-salvage", status: "pass" }),
      expect.objectContaining({ id: "core-generation-emit-prompt", status: "pass" }),
      expect.objectContaining({ id: "agent-bootstrap-planner", status: "pass" }),
      expect.objectContaining({ id: "typed-bootstrap-executor", status: "pass" }),
      expect.objectContaining({ id: "completion-runtime-compile", status: "pass" }),
      expect.objectContaining({ id: "completion-launcher-runtime-compile", status: "pass" }),
      expect.objectContaining({ id: "monitor-runtime-compile", status: "pass" }),
      expect.objectContaining({ id: "typed-bootstrap-monitor-gate", status: "pass" }),
      expect.objectContaining({ id: "routed-monitor-v2-default-on", status: "pass" }),
      expect.objectContaining({ id: "profile-secret-placeholder-skip", status: "pass" }),
      expect.objectContaining({ id: "profile-fallback-secret-filter", status: "pass" }),
      expect.objectContaining({ id: "loop-state-shell-typed-interop", status: "pass" }),
      expect.objectContaining({ id: "completion-dry-run-shell-loop-restore", status: "pass" }),
      expect.objectContaining({ id: "completion-idempotent-duplicate", status: "pass" }),
      expect.objectContaining({ id: "task-audit-run-fingerprint", status: "pass" }),
      expect.objectContaining({ id: "completion-audit-claimed-vs-applied", status: "pass" }),
      expect.objectContaining({ id: "completion-audit-disk-artifacts", status: "pass" }),
      expect.objectContaining({ id: "chain-generation-dynamic-port-proof", status: "pass" }),
      expect.objectContaining({ id: "retry-delay-command", status: "pass" }),
      expect.objectContaining({ id: "retry-attempt-env", status: "pass" }),
      expect.objectContaining({ id: "retry-state-adapter", status: "pass" }),
      expect.objectContaining({ id: "watched-runtime-proof", status: "pass" }),
      expect.objectContaining({ id: "watched-pty-proof", status: "pass" }),
      expect.objectContaining({ id: "initial-launch-typed", status: "pass" }),
      expect.objectContaining({ id: "typed-bootstrap-execution", status: "pass" }),
      expect.objectContaining({ id: "external-effects-contract", status: "pass" }),
      expect.objectContaining({ id: "external-drain-wired", status: "pass" }),
      expect.objectContaining({ id: "external-dispatch-task-status", status: "pass" }),
      expect.objectContaining({ id: "external-dispatch-plugins", status: "pass" }),
      expect.objectContaining({ id: "contract-binding-chain-runner", status: "pass" }),
      expect.objectContaining({ id: "contract-binding-completion-entrypoint", status: "pass" }),
      expect.objectContaining({ id: "contract-binding-monitor", status: "pass" }),
      expect.objectContaining({ id: "contract-binding-monitor-v2", status: "pass" }),
      expect.objectContaining({ id: "contract-binding-run-event", status: "pass" }),
      expect.objectContaining({ id: "contract-binding-watcher-watchdog", status: "pass" }),
    ]));
    expect(report.blockers).toEqual([]);
  });

  it("reports every contract line as unbound when the coverage map is empty", () => {
    const bareContract = {
      schema_version: "runner-contract/v1",
      migration_mode: "side-by-side",
      default_runner: "shell",
      flag: { name: "MENTIKO_RUNNER_V2", enabled_values: ["1"], default: "off", scope: "initial" },
      completion_flag: { name: "MENTIKO_RUNNER_V2_COMPLETION", enabled_values: ["1"], default: "on", scope: "completion" },
      invariants: ["x"],
      implementation_coverage: {},
    } as unknown as RunnerV2Contract;

    const summaries = assessImplementationContractBinding(bareContract);
    expect(summaries).toHaveLength(6);
    for (const summary of summaries) {
      expect(summary.unbound.length).toBeGreaterThan(0);
      expect(summary.covered).toBe(0);
    }
  });

  it("flags orphaned coverage keys after a contract line is reworded", () => {
    const contractWithOrphan = {
      schema_version: "runner-contract/v1",
      migration_mode: "side-by-side",
      default_runner: "shell",
      flag: { name: "MENTIKO_RUNNER_V2", enabled_values: ["1"], default: "off", scope: "initial" },
      completion_flag: { name: "MENTIKO_RUNNER_V2_COMPLETION", enabled_values: ["1"], default: "on", scope: "completion" },
      invariants: ["x"],
      implementation_coverage: {
        "monitor.contract.json": {
          "invariant:mock monitor invariant": { status: "covered", evidence: "mock" },
          "invariant:an old reworded line": { status: "covered", evidence: "mock" },
        },
      },
    } as unknown as RunnerV2Contract;

    const summaries = assessImplementationContractBinding(contractWithOrphan);
    const monitor = summaries.find((summary) => summary.file === "monitor.contract.json");
    expect(monitor?.malformed).toEqual([
      "invariant:an old reworded line: coverage key matches no contract line (stale after a contract edit)",
    ]);
  });
});
