import { existsSync, readFileSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import { getRunnerV2TypedExecutorSupport } from "@/lib/runner-v2/controller";
import { loadRunnerV2Contract } from "@/lib/runner-v2/contracts";

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
      status: contract.completion_flag?.name === "MENTIKO_RUNNER_V2_COMPLETION" ? "pass" : "fail",
      evidence: `completion_flag=${contract.completion_flag?.name || "unknown"}`,
      blocker: contract.completion_flag?.name === "MENTIKO_RUNNER_V2_COMPLETION"
        ? undefined
        : "completion flag contract missing",
    });
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
    "completion-shell-flag-gate",
    join(config.codeRoot, "lib/agent-functions.sh"),
    "runner-v2-complete.js",
    "shell completion handoff does not gate typed completion behind MENTIKO_RUNNER_V2_COMPLETION",
  ));
  checks.push(sourceContainsCheck(
    "completion-runtime-compile",
    join(config.codeRoot, "Dockerfile"),
    "runner-v2-complete.js",
    "tenant image does not compile the runner-v2 completion bridge",
  ));
  checks.push(sourceContainsCheck(
    "initial-launch-typed",
    join(config.codeRoot, "web/lib/runner-v2/launch-plan.ts"),
    'MENTIKO_RUNNER_V2_MODE: "typed-plan"',
    "initial runner-v2 launch is still shell-compat",
  ));
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
    const required = ["launch-supported", "run-completed", "agent-complete", "event-written", "completion-session"];
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
    && executor.includes("startMonitorSession");
  return {
    id: "typed-bootstrap-execution",
    status: usesTypedExecutor ? "pass" : "fail",
    evidence: usesTypedExecutor
      ? "controller uses bootstrap-executor local PTY path without chain-runner.sh"
      : "typed bootstrap still lacks a local PTY executor",
    blocker: usesTypedExecutor ? undefined : "typed runner-v2 bootstrap must own profile env and instruction delivery before switch",
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
