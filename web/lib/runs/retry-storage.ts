/**
 * retry state storage
 * file-based persistence for retry attempts and circuit breaker state
 */

import { promises as fs } from "fs";
import { join } from "path";
import { orgPath } from "../config";
import type {
  ChainRetryConfig,
  RetryState,
  CircuitState,
  RetryAttempt,
} from "./retry-types";

const RETRY_DIR = "retry";

function getRetryDir(namespaceId: string, orgId: string): string {
  return orgPath(namespaceId, orgId, RETRY_DIR);
}

function getChainRetryConfigPath(namespaceId: string, orgId: string, chainId: string): string {
  return join(getRetryDir(namespaceId, orgId), `${chainId}-config.json`);
}

function getRetryStatePath(namespaceId: string, orgId: string, runId: string): string {
  return join(getRetryDir(namespaceId, orgId), `${runId}-state.json`);
}

function getCircuitStatePath(namespaceId: string, orgId: string, chainId: string, agentName: string): string {
  const safeName = agentName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(getRetryDir(namespaceId, orgId), `circuit-${chainId}-${safeName}.json`);
}

async function ensureDir(namespaceId: string, orgId: string): Promise<void> {
  const dir = getRetryDir(namespaceId, orgId);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // ignore
  }
}

// chain retry config
export async function getChainRetryConfig(
  namespaceId: string,
  orgId: string,
  chainId: string
): Promise<ChainRetryConfig | null> {
  const path = getChainRetryConfigPath(namespaceId, orgId, chainId);

  try {
    const data = await fs.readFile(path, "utf-8");
    return JSON.parse(data) as ChainRetryConfig;
  } catch {
    return null;
  }
}

export async function saveChainRetryConfig(
  namespaceId: string,
  orgId: string,
  chainId: string,
  config: ChainRetryConfig
): Promise<void> {
  await ensureDir(namespaceId, orgId);
  const path = getChainRetryConfigPath(namespaceId, orgId, chainId);
  await fs.writeFile(path, JSON.stringify(config, null, 2));
}

export async function deleteChainRetryConfig(
  namespaceId: string,
  orgId: string,
  chainId: string
): Promise<void> {
  const path = getChainRetryConfigPath(namespaceId, orgId, chainId);
  try {
    await fs.unlink(path);
  } catch {
    // ignore
  }
}

// retry state
export async function getRetryState(
  namespaceId: string,
  orgId: string,
  runId: string
): Promise<RetryState | null> {
  const path = getRetryStatePath(namespaceId, orgId, runId);

  try {
    const data = await fs.readFile(path, "utf-8");
    return JSON.parse(data) as RetryState;
  } catch {
    return null;
  }
}

export async function saveRetryState(
  namespaceId: string,
  orgId: string,
  state: RetryState
): Promise<void> {
  await ensureDir(namespaceId, orgId);
  const path = getRetryStatePath(namespaceId, orgId, state.runId);
  await fs.writeFile(path, JSON.stringify(state, null, 2));
}

export async function addRetryAttempt(
  namespaceId: string,
  orgId: string,
  runId: string,
  attempt: RetryAttempt
): Promise<void> {
  const state = await getRetryState(namespaceId, orgId, runId);

  if (!state) {
    return;
  }

  state.attempts.push(attempt);
  state.currentAttempt = attempt.attemptNumber;

  await saveRetryState(namespaceId, orgId, state);
}

export async function deleteRetryState(
  namespaceId: string,
  orgId: string,
  runId: string
): Promise<void> {
  const path = getRetryStatePath(namespaceId, orgId, runId);
  try {
    await fs.unlink(path);
  } catch {
    // ignore
  }
}

// circuit breaker state
export async function getCircuitState(
  namespaceId: string,
  orgId: string,
  chainId: string,
  agentName: string
): Promise<CircuitState> {
  const path = getCircuitStatePath(namespaceId, orgId, chainId, agentName);

  try {
    const data = await fs.readFile(path, "utf-8");
    const state = JSON.parse(data) as CircuitState;

    // auto-reset if timeout passed
    const now = Math.floor(Date.now() / 1000);
    if (state.state === "open" && now > state.openUntil) {
      // reset to half-open
      const resetState: CircuitState = {
        state: "half_open",
        failureCount: 0,
        lastFailure: 0,
        openUntil: 0,
        threshold: state.threshold,
      };
      await saveCircuitState(namespaceId, orgId, chainId, agentName, resetState);
      return resetState;
    }

    return state;
  } catch {
    // default to closed
    return {
      state: "closed",
      failureCount: 0,
      lastFailure: 0,
      openUntil: 0,
      threshold: 5,
    };
  }
}

export async function saveCircuitState(
  namespaceId: string,
  orgId: string,
  chainId: string,
  agentName: string,
  state: CircuitState
): Promise<void> {
  await ensureDir(namespaceId, orgId);
  const path = getCircuitStatePath(namespaceId, orgId, chainId, agentName);
  await fs.writeFile(path, JSON.stringify(state, null, 2));
}

export async function incrementCircuitFailure(
  namespaceId: string,
  orgId: string,
  chainId: string,
  agentName: string,
  threshold: number = 5,
  timeoutSeconds: number = 300
): Promise<CircuitState> {
  const current = await getCircuitState(namespaceId, orgId, chainId, agentName);
  const now = Math.floor(Date.now() / 1000);

  const failureCount = current.failureCount + 1;
  const newState: CircuitState = {
    ...current,
    failureCount,
    lastFailure: now,
    state: failureCount >= threshold ? "open" : current.state,
    openUntil: failureCount >= threshold ? now + timeoutSeconds : 0,
    threshold,
  };

  await saveCircuitState(namespaceId, orgId, chainId, agentName, newState);
  return newState;
}

export async function resetCircuitState(
  namespaceId: string,
  orgId: string,
  chainId: string,
  agentName: string
): Promise<void> {
  const path = getCircuitStatePath(namespaceId, orgId, chainId, agentName);
  try {
    await fs.unlink(path);
  } catch {
    // ignore
  }
}

// list retry states for a chain
export async function listRetryStates(
  namespaceId: string,
  orgId: string,
  chainId: string
): Promise<RetryState[]> {
  const dir = getRetryDir(namespaceId, orgId);

  try {
    const files = await fs.readdir(dir);
    const stateFiles = files.filter((f) => f.endsWith("-state.json"));

    const states: RetryState[] = [];
    for (const file of stateFiles) {
      try {
        const data = await fs.readFile(join(dir, file), "utf-8");
        const state = JSON.parse(data) as RetryState;
        if (state.chainId === chainId) {
          states.push(state);
        }
      } catch {
        // skip malformed
      }
    }

    return states.sort((a, b) =>
      a.attempts[0]?.timestamp.localeCompare(b.attempts[0]?.timestamp || "")
    );
  } catch {
    return [];
  }
}
