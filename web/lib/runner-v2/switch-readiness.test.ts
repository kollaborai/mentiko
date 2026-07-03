import { assessRunnerV2SwitchReadiness } from "@/lib/runner-v2/switch-readiness";

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
    || path.endsWith("Dockerfile")
    || path.endsWith("launch-plan.ts")
    || path.endsWith("runner-v2-runtime-proof.json")
    || path.endsWith("runner-v2-watched-proof.json")
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
      return "MENTIKO_RUNNER_V2_COMPLETION runner-v2-complete.js";
    }
    if (path.endsWith("Dockerfile")) {
      return "runner-v2-complete.js";
    }
    if (path.endsWith("launch-plan.ts")) {
      return 'const CHAIN_RUNNER = "chain-runner.sh"; MENTIKO_RUNNER_V2_MODE: "typed-plan"; args.push("--start")';
    }
    if (path.endsWith("controller.ts")) {
      return "import { startRunnerV2Bootstrap } from '@/lib/runner-v2/bootstrap-executor'; startRunnerV2Bootstrap(context);";
    }
    if (path.endsWith("completion-entrypoint.ts")) {
      return "const generation = generationImportPlan(run, runDir, env);";
    }
    if (path.endsWith("adapters.ts")) {
      return "function applyGenerationImport() { return true; }";
    }
    if (path.endsWith("completion-runner.ts")) {
      return 'return { action: "generation-terminal" };';
    }
    if (path.endsWith("agent-bootstrap-plan.ts")) {
      return "Core generation handoff uses generation-result.json.";
    }
    if (path.endsWith("bootstrap-executor.ts")) {
      return "export async function executeLocalBootstrap() { await executor.spawn('name'); await waitForBootstrapReadiness(); await startMonitorSession(); }";
    }
    if (path.endsWith("executor.ts")) {
      return 'case "generation-import": return effect;';
    }
    return JSON.stringify({
      schema_version: "runner-contract/v1",
      migration_mode: "side-by-side",
      default_runner: "shell",
      flag: { name: "MENTIKO_RUNNER_V2", enabled_values: ["1"], default: "off", scope: "initial" },
      completion_flag: { name: "MENTIKO_RUNNER_V2_COMPLETION", enabled_values: ["1"], default: "off", scope: "completion" },
      generation_completion_contract: {
        no_emit_salvage: "typed completion imports generation payload before failing no-emit generation completion",
        import_effect: "typed executor includes generation-import",
        prompt_policy: "core generation prompts do not require mandatory emit",
      },
      entrypoints: {
        completion_reentry: { v2: "lib/agent-functions.sh -> compiled /opt/mentiko/lib/runner-v2-complete.js when MENTIKO_RUNNER_V2_COMPLETION is enabled" },
      },
      invariants: ["completion re-entry remains shell fallback-capable until parity tests cover every branch"],
    });
  }),
}));

describe("runner-v2 switch readiness", () => {
  it("reports ready when typed launch, typed completion, bootstrap executor, and runtime proof are present", () => {
    const report = assessRunnerV2SwitchReadiness();

    expect(report.status).toBe("ready");
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "contract-side-by-side", status: "pass" }),
      expect.objectContaining({ id: "typed-executor-supported", status: "pass" }),
      expect.objectContaining({ id: "external-dispatcher", status: "pass" }),
      expect.objectContaining({ id: "completion-typed-bridge", status: "pass" }),
      expect.objectContaining({ id: "completion-shell-flag-gate", status: "pass" }),
      expect.objectContaining({ id: "generation-completion-contract", status: "pass" }),
      expect.objectContaining({ id: "generation-import-entrypoint", status: "pass" }),
      expect.objectContaining({ id: "generation-import-effect", status: "pass" }),
      expect.objectContaining({ id: "generation-import-adapter", status: "pass" }),
      expect.objectContaining({ id: "generation-no-emit-salvage", status: "pass" }),
      expect.objectContaining({ id: "core-generation-emit-prompt", status: "pass" }),
      expect.objectContaining({ id: "agent-bootstrap-planner", status: "pass" }),
      expect.objectContaining({ id: "typed-bootstrap-executor", status: "pass" }),
      expect.objectContaining({ id: "completion-runtime-compile", status: "pass" }),
      expect.objectContaining({ id: "watched-runtime-proof", status: "pass" }),
      expect.objectContaining({ id: "watched-pty-proof", status: "pass" }),
      expect.objectContaining({ id: "initial-launch-typed", status: "pass" }),
      expect.objectContaining({ id: "typed-bootstrap-execution", status: "pass" }),
    ]));
    expect(report.blockers).toEqual([]);
  });
});
