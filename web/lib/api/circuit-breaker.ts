/**
 * circuit breaker for scheduled chain execution
 *
 * prevents runaway chains by limiting concurrent runs and providing
 * a manual trip/kill-switch mechanism.
 *
 * state file: {globalRoot}/circuit-breaker.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import config from "../config";

const STATE_FILE = join(config.globalRoot, "circuit-breaker.json");

export interface CircuitBreakerState {
  enabled: boolean;
  maxConcurrentRuns: number;
  tripped: boolean;
  tripTime?: string;
  tripReason?: string;
  activeRuns: number;
  totalRunsToday: number;
  lastReset?: string;
}

const DEFAULTS: CircuitBreakerState = {
  enabled: true,
  maxConcurrentRuns: 3,
  tripped: false,
  activeRuns: 0,
  totalRunsToday: 0,
};

function readState(): CircuitBreakerState {
  if (!existsSync(STATE_FILE)) {
    return { ...DEFAULTS };
  }
  try {
    const content = readFileSync(STATE_FILE, "utf-8");
    const parsed = JSON.parse(content);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeState(state: CircuitBreakerState): void {
  const dir = config.globalRoot;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * get current circuit breaker state
 */
export function getCircuitBreakerState(): CircuitBreakerState {
  return readState();
}

/**
 * update circuit breaker with partial state
 */
export function updateCircuitBreaker(partial: Partial<CircuitBreakerState>): CircuitBreakerState {
  const state = readState();
  const updated = { ...state, ...partial };
  writeState(updated);
  return updated;
}

/**
 * trip the circuit breaker (stop new runs)
 */
export function tripCircuitBreaker(reason: string): CircuitBreakerState {
  return updateCircuitBreaker({
    tripped: true,
    tripTime: new Date().toISOString(),
    tripReason: reason,
  });
}

/**
 * reset the circuit breaker (allow new runs)
 */
export function resetCircuitBreaker(): CircuitBreakerState {
  return updateCircuitBreaker({
    tripped: false,
    tripTime: undefined,
    tripReason: undefined,
    activeRuns: 0,
  });
}

/**
 * check if execution is allowed
 */
export function canExecute(): { allowed: boolean; reason?: string } {
  const state = readState();

  if (!state.enabled) {
    return { allowed: false, reason: "circuit breaker disabled" };
  }

  if (state.tripped) {
    return {
      allowed: false,
      reason: state.tripReason || "circuit breaker tripped",
    };
  }

  if (state.activeRuns >= state.maxConcurrentRuns) {
    return {
      allowed: false,
      reason: `max concurrent runs (${state.maxConcurrentRuns}) reached`,
    };
  }

  return { allowed: true };
}

/**
 * increment active run count
 * auto-trips if exceeds max
 */
export function incrementActiveRuns(): CircuitBreakerState {
  const state = readState();
  const newActive = state.activeRuns + 1;
  const updated = {
    ...state,
    activeRuns: newActive,
    totalRunsToday: state.totalRunsToday + 1,
  };

  if (newActive > state.maxConcurrentRuns) {
    updated.tripped = true;
    updated.tripTime = new Date().toISOString();
    updated.tripReason = `exceeded max concurrent runs (${state.maxConcurrentRuns})`;
  }

  writeState(updated);
  return updated;
}

/**
 * decrement active run count
 */
export function decrementActiveRuns(): CircuitBreakerState {
  const state = readState();
  const newActive = Math.max(0, state.activeRuns - 1);
  return updateCircuitBreaker({ activeRuns: newActive });
}

/**
 * kill switch: disable circuit breaker entirely (global stop)
 */
export function killSwitch(): CircuitBreakerState {
  return updateCircuitBreaker({ enabled: false });
}

/**
 * enable circuit breaker (reverse kill switch)
 */
export function enableCircuitBreaker(): CircuitBreakerState {
  return updateCircuitBreaker({ enabled: true });
}
