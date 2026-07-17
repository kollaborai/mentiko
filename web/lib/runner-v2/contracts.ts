import { readFileSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import type { RunnerV2Contract } from "@/lib/runner-v2/types";

const CONTRACT_PATH = join(config.codeRoot, "docs", "orchestration", "contracts", "runner-v2-contract.json");

/** the per-implementation migration source-of-truth contracts (docs/orchestration/contracts/README.md) */
export const IMPLEMENTATION_CONTRACT_FILES = [
  "chain-runner.contract.json",
  "completion-entrypoint.contract.json",
  "monitor.contract.json",
  "monitor-v2.contract.json",
  "run-event.contract.json",
  "chain-version-control.contract.json",
  "git-integration.contract.json",
  "audit-ship.contract.json",
  "notification-dispatch.contract.json",
  "watcher-watchdog.contract.json",
] as const;

export interface ImplementationContractLines {
  file: string;
  /** key = "owns:<text>" | "invariant:<text>", text verbatim from the contract */
  lines: Array<{ key: string; text: string }>;
}

/**
 * Enumerate every owns/invariants line of every per-implementation contract.
 * These lines are the migration requirements; the switch-readiness binding
 * gate refuses unbound lines so none can be silently dropped again.
 */
export function loadImplementationContracts(): ImplementationContractLines[] {
  return IMPLEMENTATION_CONTRACT_FILES.map((file) => {
    const path = join(config.codeRoot, "docs", "orchestration", "contracts", file);
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as { owns?: unknown; invariants?: unknown };
    const lines: Array<{ key: string; text: string }> = [];
    for (const text of asStringArray(parsed.owns)) lines.push({ key: `owns:${text}`, text });
    for (const text of asStringArray(parsed.invariants)) lines.push({ key: `invariant:${text}`, text });
    if (lines.length === 0) {
      throw new Error(`implementation contract ${file} declares no owns/invariants lines`);
    }
    return { file, lines };
  });
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function loadRunnerV2Contract(): RunnerV2Contract {
  const contract = JSON.parse(readFileSync(CONTRACT_PATH, "utf-8")) as RunnerV2Contract;
  validateRunnerV2Contract(contract);
  return contract;
}

export function validateRunnerV2Contract(contract: RunnerV2Contract): void {
  if (contract.schema_version !== "runner-contract/v1") {
    throw new Error("runner-v2 contract schema_version mismatch");
  }
  if (contract.migration_mode !== "typed") {
    throw new Error("runner-v2 contract must declare typed ownership");
  }
  if (contract.default_runner !== "typed") {
    throw new Error("runner-v2 contract must use the typed default runner");
  }
  if (contract.flag?.name !== "MENTIKO_RUNNER_V2") {
    throw new Error("runner-v2 contract flag mismatch");
  }
  if (contract.completion_flag?.name !== "MENTIKO_RUNNER_V2_COMPLETION") {
    throw new Error("runner-v2 completion flag mismatch");
  }
  if (contract.completion_flag.default !== "on") {
    throw new Error("runner-v2 completion marker must remain forced on after typed cutover");
  }
  if (!Array.isArray(contract.invariants) || contract.invariants.length === 0) {
    throw new Error("runner-v2 contract must define invariants");
  }
}
