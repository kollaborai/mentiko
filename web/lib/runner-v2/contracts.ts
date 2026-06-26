import { readFileSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import type { RunnerV2Contract } from "@/lib/runner-v2/types";

const CONTRACT_PATH = join(config.codeRoot, "docs", "orchestration", "contracts", "runner-v2-contract.json");

export function loadRunnerV2Contract(): RunnerV2Contract {
  const contract = JSON.parse(readFileSync(CONTRACT_PATH, "utf-8")) as RunnerV2Contract;
  validateRunnerV2Contract(contract);
  return contract;
}

export function validateRunnerV2Contract(contract: RunnerV2Contract): void {
  if (contract.schema_version !== "runner-contract/v1") {
    throw new Error("runner-v2 contract schema_version mismatch");
  }
  if (contract.migration_mode !== "side-by-side") {
    throw new Error("runner-v2 contract must stay side-by-side during migration");
  }
  if (contract.default_runner !== "shell") {
    throw new Error("runner-v2 contract cannot change the default runner yet");
  }
  if (contract.flag?.name !== "MENTIKO_RUNNER_V2") {
    throw new Error("runner-v2 contract flag mismatch");
  }
  if (contract.completion_flag?.name !== "MENTIKO_RUNNER_V2_COMPLETION") {
    throw new Error("runner-v2 completion flag mismatch");
  }
  if (!Array.isArray(contract.invariants) || contract.invariants.length === 0) {
    throw new Error("runner-v2 contract must define invariants");
  }
}
