/**
 * retry policy types
 */

export type BackoffStrategy =
  | "fixed"
  | "linear"
  | "exponential"
  | "exponential_with_jitter";

export interface RetryPolicy {
  enabled: boolean;
  maxAttempts: number;
  backoffStrategy: BackoffStrategy;
  baseDelayMs: number;
  maxDelayMs?: number;
  retryableErrors?: string[]; // error patterns that are retryable
}

export interface CircuitBreakerConfig {
  enabled: boolean;
  failureThreshold: number;
  timeoutSeconds: number;
  halfOpenAttempts?: number; // attempts to allow in half-open state
}

export interface RollbackConfig {
  enabled: boolean;
  strategy: "git" | "snapshot" | "none";
  gitCommitOnSuccess?: boolean;
}

export interface AgentRetryConfig {
  agentName: string;
  retry: RetryPolicy;
  circuitBreaker?: CircuitBreakerConfig;
  rollback?: RollbackConfig;
  timeoutSeconds?: number;
}

export interface ChainRetryConfig {
  defaultPolicy: RetryPolicy;
  agents: Record<string, AgentRetryConfig>;
  stopOnFirstError: boolean;
}

export interface RetryAttempt {
  attemptNumber: number;
  timestamp: string;
  error?: string;
  delayMs: number;
  success: boolean;
}

export interface CircuitState {
  state: "closed" | "open" | "half_open";
  failureCount: number;
  lastFailure: number;
  openUntil: number;
  threshold: number;
}

export interface RetryState {
  chainId: string;
  runId: string;
  agentName: string;
  attempts: RetryAttempt[];
  currentAttempt: number;
  status: "running" | "success" | "failed" | "retrying";
  circuitTripped: boolean;
}

// defaults
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  enabled: false,
  maxAttempts: 3,
  backoffStrategy: "exponential",
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  retryableErrors: ["timeout", "network", "rate_limit", "temporary"],
};

export const DEFAULT_CIRCUIT_BREAKER: CircuitBreakerConfig = {
  enabled: false,
  failureThreshold: 5,
  timeoutSeconds: 300,
  halfOpenAttempts: 1,
};

export const DEFAULT_ROLLBACK: RollbackConfig = {
  enabled: false,
  strategy: "git",
  gitCommitOnSuccess: true,
};
