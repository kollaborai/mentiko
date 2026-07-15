import { existsSync, readFileSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import { getRunnerV2TypedExecutorSupport } from "@/lib/runner-v2/controller";
import { loadImplementationContracts, loadRunnerV2Contract } from "@/lib/runner-v2/contracts";
import type { RunnerV2Contract } from "@/lib/runner-v2/types";

export type SwitchReadinessStatus = "ready" | "blocked";

export interface SwitchReadinessCheck {
  id: string;
  status: "pass" | "fail";
  evidence: string;
  blocker?: string;
}

export interface SwitchReadinessReport {
  status: SwitchReadinessStatus;
  checks: SwitchReadinessCheck[];
  blockers: string[];
}

export function assessRunnerV2SwitchReadiness(): SwitchReadinessReport {
  const checks: SwitchReadinessCheck[] = [];

  try {
    const contract = loadRunnerV2Contract();
    checks.push({
      id: "contract-side-by-side",
      status: contract.migration_mode === "side-by-side" && contract.default_runner === "shell" ? "pass" : "fail",
      evidence: `migration_mode=${contract.migration_mode}; default_runner=${contract.default_runner}`,
      blocker: contract.default_runner === "shell" ? undefined : "contract default runner changed before readiness gate",
    });
    checks.push({
      id: "completion-typed-bridge",
      status: contract.entrypoints?.completion_reentry?.v2?.includes("runner-v2-complete.js") ? "pass" : "fail",
      evidence: `completion_reentry.v2=${contract.entrypoints?.completion_reentry?.v2 || "unknown"}`,
      blocker: contract.entrypoints?.completion_reentry?.v2?.includes("runner-v2-complete.js")
        ? undefined
        : "compiled typed completion re-entry bridge is not documented in the contract",
    });
    checks.push({
      id: "completion-flag-contract",
      status: contract.completion_flag?.name === "MENTIKO_RUNNER_V2_COMPLETION"
        && contract.completion_flag.default === "on" ? "pass" : "fail",
      evidence: `completion_flag=${contract.completion_flag?.name || "unknown"}; default=${contract.completion_flag?.default || "unknown"}`,
      blocker: contract.completion_flag?.name === "MENTIKO_RUNNER_V2_COMPLETION"
        && contract.completion_flag.default === "on"
        ? undefined
        : "completion compatibility marker must be documented as forced on",
    });
    checks.push({
      id: "generation-completion-contract",
      status: hasGenerationCompletionContract(contract) ? "pass" : "fail",
      evidence: hasGenerationCompletionContract(contract)
        ? "contract defines generation_completion_contract.no_emit_salvage/import_effect/prompt_policy"
        : "contract missing generation_completion_contract coverage for no-emit generation salvage",
      blocker: hasGenerationCompletionContract(contract)
        ? undefined
        : "runner-v2 contract must cover no-emit generation salvage before switch readiness",
    });
    checks.push({
      id: "external-effects-contract",
      status: hasExternalEffectsContract(contract) ? "pass" : "fail",
      evidence: hasExternalEffectsContract(contract)
        ? "contract documents external_effects outbox + live drain + handled operations"
        : "contract missing external_effects outbox/drain coverage",
      blocker: hasExternalEffectsContract(contract)
        ? undefined
        : "runner-v2 contract must document external effects outbox and live drain before switch readiness",
    });
    checks.push(...implementationContractBindingChecks(contract));
  } catch (error) {
    checks.push({
      id: "contract-load",
      status: "fail",
      evidence: error instanceof Error ? error.message : "contract load failed",
      blocker: "runner-v2 contract must load before switch",
    });
  }

  const typedSupport = getRunnerV2TypedExecutorSupport();
  checks.push({
    id: "typed-executor-supported",
    status: typedSupport.support === "supported" ? "pass" : "fail",
    evidence: typedSupport.support === "supported" ? `mode=${typedSupport.mode}` : typedSupport.reason || "unsupported",
    blocker: typedSupport.support === "supported" ? undefined : typedSupport.reason || "typed executor unsupported",
  });

  checks.push(fileCheck("external-dispatcher", join(config.codeRoot, "web/lib/runner-v2/external-effects.ts")));
  checks.push(fileCheck("probe-dispatch-path", join(config.codeRoot, "web/lib/runner-v2/probe.ts")));
  checks.push(fileCheck("service-flag-gate", join(config.codeRoot, "web/lib/runs/chain-run-service.ts")));
  checks.push(fileCheck("completion-entrypoint", join(config.codeRoot, "web/lib/runner-v2/completion-entrypoint.ts")));
  checks.push(fileCheck("completion-cli-source", join(config.codeRoot, "web/lib/runner-v2/complete-cli.ts")));
  checks.push(fileCheck("agent-bootstrap-planner", join(config.codeRoot, "web/lib/runner-v2/agent-bootstrap-plan.ts")));
  checks.push(fileCheck("typed-bootstrap-executor", join(config.codeRoot, "web/lib/runner-v2/bootstrap-executor.ts")));
  checks.push(sourceContainsCheck(
    "completion-typed-launcher",
    join(config.codeRoot, "lib/agent-functions.sh"),
    "runner-v2-completion-launch.js",
    "shell monitor handoff does not invoke the unconditional typed completion launcher",
  ));
  checks.push(sourceContainsCheck(
    "routed-monitor-flag-carry",
    join(config.codeRoot, "lib/chain-runner.sh"),
    'export MENTIKO_RUNNER_V2_COMPLETION="1"',
    "shell chain-runner monitors do not carry runner-v2 completion flags, so routed/relaunched agents always complete through the v1 handler",
  ));
  checks.push(sourceContainsCheck(
    "external-drain-wired",
    join(config.codeRoot, "web/server/background-worker.ts"),
    "drainRunnerV2ExternalEffects",
    "background worker does not drain the runner-v2 external-effects outbox",
  ));
  checks.push(sourceContainsCheck(
    "external-dispatch-task-status",
    join(config.codeRoot, "web/lib/runner-v2/external-effects.ts"),
    "taskMergeMeta",
    "typed external dispatcher does not update linked task status",
  ));
  checks.push(sourceContainsCheck(
    "external-dispatch-plugins",
    join(config.codeRoot, "web/lib/runner-v2/external-effects.ts"),
    "runPluginsViaShell",
    "typed external dispatcher does not deliver plugin events",
  ));
  checks.push(sourceContainsCheck(
    "completion-runtime-compile",
    join(config.codeRoot, "Dockerfile"),
    "runner-v2-complete.js",
    "tenant image does not compile the runner-v2 completion bridge",
  ));
  checks.push(sourceContainsCheck(
    "completion-launcher-runtime-compile",
    join(config.codeRoot, "Dockerfile"),
    "runner-v2-completion-launch.js",
    "tenant image does not compile the typed completion PTY launcher",
  ));
  checks.push(sourceContainsCheck(
    "monitor-runtime-compile",
    join(config.codeRoot, "Dockerfile"),
    "monitor-v2.js",
    "tenant image does not compile the runner-v2 monitor bridge",
  ));
  checks.push(sourceContainsCheck(
    "typed-bootstrap-monitor-gate",
    join(config.codeRoot, "web/lib/runner-v2/agent-bootstrap-plan.ts"),
    "MENTIKO_MONITOR_V2",
    "typed bootstrap monitor command does not gate monitor-v2 behind MENTIKO_MONITOR_V2",
  ));
  checks.push(sourceContainsCheck(
    "routed-monitor-v2-default-on",
    join(config.codeRoot, "lib/chain-runner.sh"),
    'export MENTIKO_MONITOR_V2="${MENTIKO_MONITOR_V2:-1}"',
    "shell chain-runner monitors do not default MENTIKO_MONITOR_V2 on for routed/relaunched agents",
  ));
  checks.push(sourceContainsCheck(
    "typed-profile-secret-filter",
    join(config.codeRoot, "web/lib/runner-v2/agent-profile.ts"),
    "SECRET_REFERENCE",
    "typed agent profile command compiler can export raw {secret:NAME} placeholders",
  ));
  checks.push(sourceContainsCheck(
    "initial-launch-typed",
    join(config.codeRoot, "web/lib/runner-v2/launch-plan.ts"),
    'MENTIKO_RUNNER_V2_MODE: "typed-plan"',
    "initial runner-v2 launch is still shell-compat",
  ));
  checks.push(sourceContainsCheck(
    "generation-import-entrypoint",
    join(config.codeRoot, "web/lib/runner-v2/completion-entrypoint.ts"),
    "generationImportPlan(run, runDir, env)",
    "typed completion entrypoint does not wire generation import planning",
  ));
  checks.push(sourceContainsCheck(
    "generation-import-effect",
    join(config.codeRoot, "web/lib/runner-v2/executor.ts"),
    '"generation-import"',
    "typed completion executor does not include generation-import effect",
  ));
  checks.push(sourceContainsCheck(
    "generation-import-adapter",
    join(config.codeRoot, "web/lib/runner-v2/adapters.ts"),
    "applyGenerationImport",
    "typed completion adapter does not execute generation import",
  ));
  checks.push(sourceContainsCheck(
    "generation-no-emit-salvage",
    join(config.codeRoot, "web/lib/runner-v2/completion-runner.ts"),
    "generation-terminal",
    "typed completion does not salvage no-emit core generation runs",
  ));
  checks.push(sourceContainsCheck(
    "loop-state-shell-typed-interop",
    join(config.codeRoot, "web/lib/runner-v2/loop-state.ts"),
    "chain_loop_tracker.txt",
    "typed loop detection does not read/write the shell chain_loop_tracker.txt state",
  ));
  checks.push(sourceContainsCheck(
    "completion-dry-run-shell-loop-restore",
    join(config.codeRoot, "web/lib/runner-v2/completion-entrypoint.ts"),
    "shellLoopStatePath",
    "typed completion dry-run/failure restore does not cover the shell loop tracker",
  ));
  checks.push(sourceContainsCheck(
    "completion-idempotent-duplicate",
    join(config.codeRoot, "web/lib/runner-v2/completion-entrypoint.ts"),
    "already-completed",
    "typed completion can re-apply effects for an already processed agent completion",
  ));
  checks.push(sourceContainsCheck(
    "task-audit-run-fingerprint",
    join(config.codeRoot, "web/lib/tasks/task-outcome-audit.ts"),
    "task_outcome_summary_run_fingerprint",
    "task outcome audit idempotency is keyed only by run id, so stale partial audits can suppress terminal audits",
  ));
  checks.push(sourceContainsCheck(
    "task-audit-clears-stale-summary",
    join(config.codeRoot, "web/lib/tasks/task-outcome-audit.ts"),
    "task_outcome_summary: undefined",
    "task outcome re-audit does not clear stale summary payloads before marking the newer run fingerprint running",
  ));
  checks.push(sourceContainsCheck(
    "completion-audit-claimed-vs-applied",
    join(config.codeRoot, "web/lib/tasks/completion-audit-apply.ts"),
    "completion_audit_claimed_run_id",
    "completion audit still uses one run id marker for both claim and applied side effects",
  ));
  checks.push(sourceContainsCheck(
    "task-reopen-clears-closed-at",
    join(config.codeRoot, "web/lib/tasks/task-store.ts"),
    "closed_at = NULL",
    "task status can be reopened while closed_at remains populated, splitting UI receipts from dependency readiness",
  ));
  checks.push(sourceContainsCheck(
    "completion-audit-disk-artifacts",
    join(config.codeRoot, "web/lib/tasks/run-outcome-evidence.ts"),
    "listArtifactFiles",
    "completion audit still trusts run.json artifacts without scanning disk artifact evidence",
  ));
  checks.push(sourceContainsCheck(
    "chain-generation-dynamic-port-proof",
    join(config.codeRoot, "web/lib/generation/chain-generation-required-rules.ts"),
    "DYNAMIC_PORT_RUNTIME_PROOF",
    "chain generation prompts can still verify generated apps by accidentally curling Mentiko on port 3000",
  ));
  checks.push(sourceContainsCheck(
    "retry-delay-command",
    join(config.codeRoot, "web/lib/runner-v2/executor.ts"),
    "buildRetryLaunchCommand",
    "typed retry launch does not preserve configured retry delay",
  ));
  checks.push(sourceContainsCheck(
    "retry-attempt-env",
    join(config.codeRoot, "web/lib/runner-v2/executor.ts"),
    "MENTIKO_RETRY_ATTEMPT",
    "typed retry launch does not pass retry attempt state to the relaunched shell/typed path",
  ));
  checks.push(sourceContainsCheck(
    "retry-state-adapter",
    join(config.codeRoot, "web/lib/runner-v2/adapters.ts"),
    "applyRetryState",
    "typed retry effects do not persist/clear shell-compatible retry state",
  ));
  checks.push(coreGenerationEmitPromptCheck(join(config.codeRoot, "web/lib/runner-v2/agent-bootstrap-plan.ts")));
  checks.push(typedBootstrapExecutionCheck({
    controllerPath: join(config.codeRoot, "web/lib/runner-v2/controller.ts"),
    executorPath: join(config.codeRoot, "web/lib/runner-v2/bootstrap-executor.ts"),
  }));

  checks.push(runtimeProofCheck(join(config.codeRoot, "docs/orchestration/contracts/runner-v2-runtime-proof.json")));
  checks.push(watchedProofCheck(join(config.codeRoot, "docs/orchestration/contracts/runner-v2-watched-proof.json")));

  const blockers = checks
    .filter((check) => check.status === "fail")
    .map((check) => check.blocker || check.evidence);

  return {
    status: blockers.length === 0 ? "ready" : "blocked",
    checks,
    blockers,
  };
}

function hasGenerationCompletionContract(contract: unknown): boolean {
  if (!contract || typeof contract !== "object") return false;
  const generation = (contract as { generation_completion_contract?: unknown }).generation_completion_contract;
  if (!generation || typeof generation !== "object") return false;
  const fields = generation as Record<string, unknown>;
  return typeof fields.no_emit_salvage === "string"
    && typeof fields.import_effect === "string"
    && typeof fields.prompt_policy === "string";
}

function hasExternalEffectsContract(contract: unknown): boolean {
  if (!contract || typeof contract !== "object") return false;
  const external = (contract as { external_effects?: unknown }).external_effects;
  if (!external || typeof external !== "object") return false;
  const fields = external as Record<string, unknown>;
  return typeof fields.outbox === "string"
    && typeof fields.live_drain === "string"
    && Array.isArray(fields.handled_operations)
    && fields.handled_operations.includes("task-status")
    && fields.handled_operations.includes("plugin");
}

function watchedProofCheck(path: string): SwitchReadinessCheck {
  if (!existsSync(path)) {
    return {
      id: "watched-pty-proof",
      status: "fail",
      evidence: "no watched PTY proof artifact proving a real MENTIKO_RUNNER_V2=1 run",
      blocker: "watched PTY runner-v2 proof is required before switch readiness",
    };
  }

  try {
    const proof = JSON.parse(readFileSync(path, "utf8")) as {
      schema_version?: string;
      status?: string;
      checks?: Array<{ id?: string; status?: string }>;
    };
    const checks = Array.isArray(proof.checks) ? proof.checks : [];
    const required = [
      "launch-supported",
      "run-completed",
      "agent-complete",
      "attempt-completed",
      "attempt-terminal-reason",
      "attempt-process-evidence",
      "event-written",
      "completion-session",
    ];
    const passed = proof.schema_version === "runner-v2-watched-proof/v1"
      && proof.status === "passed"
      && required.every((id) => checks.find((check) => check.id === id)?.status === "pass");
    return {
      id: "watched-pty-proof",
      status: passed ? "pass" : "fail",
      evidence: path,
      blocker: passed ? undefined : "watched PTY proof artifact did not pass",
    };
  } catch (error) {
    return {
      id: "watched-pty-proof",
      status: "fail",
      evidence: error instanceof Error ? error.message : "watched PTY proof parse failed",
      blocker: "watched PTY proof artifact must parse",
    };
  }
}

function fileCheck(id: string, path: string): SwitchReadinessCheck {
  return existsSync(path)
    ? { id, status: "pass", evidence: path }
    : { id, status: "fail", evidence: `${path} missing`, blocker: `${id} missing` };
}

function sourceContainsCheck(id: string, path: string, needle: string, blocker: string): SwitchReadinessCheck {
  if (!existsSync(path)) {
    return { id, status: "fail", evidence: `${path} missing`, blocker };
  }
  const source = readFileSync(path, "utf8");
  const found = source.includes(needle);
  return {
    id,
    status: found ? "pass" : "fail",
    evidence: found ? `${path} contains ${needle}` : `${path} missing ${needle}`,
    blocker: found ? undefined : blocker,
  };
}

function coreGenerationEmitPromptCheck(path: string): SwitchReadinessCheck {
  if (!existsSync(path)) {
    return {
      id: "core-generation-emit-prompt",
      status: "fail",
      evidence: `${path} missing`,
      blocker: "core generation bootstrap planner missing",
    };
  }
  const source = readFileSync(path, "utf8");
  const hasCoreGenerationPolicy = source.includes("coreGenerationChain")
    || source.includes("Core generation handoff")
    || source.includes("generation-result.json");
  const hasMandatoryEmit = source.includes("run mentiko emit")
    || source.includes("must run mentiko emit")
    || source.includes("signal completion by running");
  const passed = hasCoreGenerationPolicy || !hasMandatoryEmit;
  return {
    id: "core-generation-emit-prompt",
    status: passed ? "pass" : "fail",
    evidence: passed
      ? "core generation bootstrap does not require mandatory mentiko emit"
      : "bootstrap source still contains mandatory mentiko emit wording without core generation exception",
    blocker: passed ? undefined : "core generation prompts must not require mandatory emit before switch",
  };
}

function typedBootstrapExecutionCheck(paths: { controllerPath: string; executorPath: string }): SwitchReadinessCheck {
  if (!existsSync(paths.controllerPath) || !existsSync(paths.executorPath)) {
    return {
      id: "typed-bootstrap-execution",
      status: "fail",
      evidence: "typed bootstrap controller or executor missing",
      blocker: "typed bootstrap execution path is missing",
    };
  }
  const controller = readFileSync(paths.controllerPath, "utf8");
  const executor = readFileSync(paths.executorPath, "utf8");
  const usesTypedExecutor = controller.includes("startRunnerV2Bootstrap")
    && executor.includes("executeLocalBootstrap")
    && executor.includes("executor.spawn")
    && executor.includes("waitForBootstrapReadiness")
    && executor.includes("classifyCliReadiness")
    && executor.includes("startMonitorSession");
  return {
    id: "typed-bootstrap-execution",
    status: usesTypedExecutor ? "pass" : "fail",
    evidence: usesTypedExecutor
      ? "controller uses bootstrap-executor local PTY path with profile readiness policy gate"
      : "typed bootstrap still lacks a local PTY executor or profile readiness policy gate",
    blocker: usesTypedExecutor ? undefined : "typed runner-v2 bootstrap must own profile env, profile readiness, and instruction delivery before switch",
  };
}

function runtimeProofCheck(path: string): SwitchReadinessCheck {
  if (!existsSync(path)) {
    return {
      id: "watched-runtime-proof",
      status: "fail",
      evidence: "no committed runtime evidence artifact proving a watched MENTIKO_RUNNER_V2=1 run",
      blocker: "watched runtime test is required before making runner-v2 default",
    };
  }

  try {
    const proof = JSON.parse(readFileSync(path, "utf8")) as {
      schema_version?: string;
      status?: string;
      flag?: string;
      mode?: string;
      checks?: Array<{ id?: string; status?: string }>;
    };
    const checks = Array.isArray(proof.checks) ? proof.checks : [];
    const required = [
      "typed-bootstrap-session",
      "typed-bootstrap-no-shell-start",
      "typed-bootstrap-no-secret-env",
      "typed-bootstrap-instructions-written",
      "typed-bootstrap-state-written",
      "typed-bootstrap-monitor-started",
      "typed-bootstrap-start-before-pointer",
    ];
    const passed = proof.schema_version === "runner-v2-runtime-proof/v1"
      && proof.status === "passed"
      && proof.flag === "MENTIKO_RUNNER_V2"
      && proof.mode === "live"
      && required.every((id) => checks.find((check) => check.id === id)?.status === "pass");
    return {
      id: "watched-runtime-proof",
      status: passed ? "pass" : "fail",
      evidence: path,
      blocker: passed ? undefined : "runtime proof artifact did not pass",
    };
  } catch (error) {
    return {
      id: "watched-runtime-proof",
      status: "fail",
      evidence: error instanceof Error ? error.message : "runtime proof parse failed",
      blocker: "runtime proof artifact must parse",
    };
  }
}

export interface ImplementationBindingSummary {
  file: string;
  covered: number;
  shellOwned: number;
  gaps: Array<{ key: string; blocker: string }>;
  unbound: string[];
  malformed: string[];
}

/**
 * The binding gate: every owns/invariants line of every per-implementation
 * contract (docs/orchestration/contracts/*.contract.json — the migration
 * source of truth) must be bound in runner-v2-contract.json
 * implementation_coverage as covered-with-evidence, a named gap blocker, or
 * shell-owned-with-reason. Unbound or malformed lines fail the binding check;
 * gap lines become switch blockers. This exists because the readiness gate
 * sat in chain-runner.contract.json for nine days while nothing enforced it.
 */
export function assessImplementationContractBinding(contract?: RunnerV2Contract): ImplementationBindingSummary[] {
  const resolved = contract ?? loadRunnerV2Contract();
  const coverage = resolved.implementation_coverage ?? {};
  return loadImplementationContracts().map(({ file, lines }) => {
    const fileCoverage = coverage[file] ?? {};
    const summary: ImplementationBindingSummary = { file, covered: 0, shellOwned: 0, gaps: [], unbound: [], malformed: [] };
    const lineKeys = new Set(lines.map((line) => line.key));
    for (const line of lines) {
      const entry = fileCoverage[line.key];
      if (!entry) {
        summary.unbound.push(line.key);
        continue;
      }
      if (entry.status === "covered") {
        if (!entry.evidence) summary.malformed.push(`${line.key}: covered without evidence`);
        else summary.covered += 1;
      } else if (entry.status === "gap") {
        if (!entry.blocker) summary.malformed.push(`${line.key}: gap without blocker`);
        else summary.gaps.push({ key: line.key, blocker: entry.blocker });
      } else if (entry.status === "shell-owned") {
        if (!entry.reason) summary.malformed.push(`${line.key}: shell-owned without reason`);
        else summary.shellOwned += 1;
      } else {
        summary.malformed.push(`${line.key}: unknown status ${(entry as { status?: string }).status ?? "missing"}`);
      }
    }
    for (const key of Object.keys(fileCoverage)) {
      if (!lineKeys.has(key)) {
        summary.malformed.push(`${key}: coverage key matches no contract line (stale after a contract edit)`);
      }
    }
    return summary;
  });
}

function implementationContractBindingChecks(contract: RunnerV2Contract): SwitchReadinessCheck[] {
  let summaries: ImplementationBindingSummary[];
  try {
    summaries = assessImplementationContractBinding(contract);
  } catch (error) {
    return [{
      id: "implementation-contract-binding",
      status: "fail",
      evidence: error instanceof Error ? error.message : "implementation contracts failed to load",
      blocker: "per-implementation contracts must load and enumerate before switch",
    }];
  }
  const checks: SwitchReadinessCheck[] = [];
  for (const summary of summaries) {
    const shortName = summary.file.replace(/\.contract\.json$/, "");
    const bound = summary.unbound.length === 0 && summary.malformed.length === 0;
    checks.push({
      id: `contract-binding-${shortName}`,
      status: bound ? "pass" : "fail",
      evidence: `${summary.covered} covered, ${summary.shellOwned} shell-owned, ${summary.gaps.length} gaps; unbound=${summary.unbound.length}, malformed=${summary.malformed.length}`,
      blocker: bound
        ? undefined
        : `unbound or malformed contract lines in ${summary.file}: ${[...summary.unbound, ...summary.malformed].slice(0, 3).join("; ")}`,
    });
    summary.gaps.forEach((gap, index) => {
      checks.push({
        id: `contract-parity-gap-${shortName}-${index + 1}`,
        status: "fail",
        evidence: gap.key,
        blocker: `${summary.file} ${gap.key}: ${gap.blocker}`,
      });
    });
  }
  return checks;
}
