import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  decodeRawChainDefinition,
  loadNormalizedChainDefinition,
  type ChainRecord,
} from "@/lib/runner-v2/chain-contract";
import {
  incrementRunnerAgentRetry,
  readRunnerAgentState,
  runnerAgentStatePath,
  transitionRunnerAgentState,
} from "@/lib/runner-v2/agent-state";
import { updateRunJson } from "@/lib/runner-v2/run-state";

export type AgentErrorType = "error" | "timeout";
export type ErrorDetectionCode = 0 | 1 | 2;

export interface ErrorHandlingInput {
  agentId: string;
  errorType: AgentErrorType;
  reportFile: string;
  chainFile: string;
  stateDir: string;
  runId: string;
  agentsDir?: string;
}

export interface ErrorHandlingResult {
  code: 0 | 1;
  retryCount: number;
  maxRetries: number;
  handlerAgent?: string;
  action: "retry" | "handler" | "stop";
}

export interface RetryConfig {
  maxRetries: number;
  backoff: string;
  initialDelay: number;
  maxDelay: number;
  multiplier: number;
}

export interface ScheduleLaunch {
  (chainFile: string, agentId: string, delaySeconds: number): void;
}

export function detectAgentError(reportFile: string): ErrorDetectionCode {
  if (!existsSync(reportFile)) return 0;
  assertRegularFile(reportFile, "Agent report");
  const text = readFileSync(reportFile, "utf8");
  if (/timeout|timed out|time limit exceeded|deadline exceeded/i.test(text)) return 2;
  const lines = text.split(/\r?\n/).filter((line) => /error|failed|exception|traceback|fatal/i.test(line));
  const meaningful = lines.find((line) => !/no error|zero errors|0 errors/i.test(line));
  return meaningful ? 1 : 0;
}

export function calculateRetryDelay(
  attempt: number,
  backoff = "exponential",
  initialDelay = 5,
  maxDelay = 300,
  multiplier = 2,
): number {
  assertNonNegativeFinite(attempt, "attempt");
  assertNonNegativeFinite(initialDelay, "initial delay");
  assertNonNegativeFinite(maxDelay, "max delay");
  assertNonNegativeFinite(multiplier, "multiplier");
  let delay = initialDelay;
  if (backoff === "linear") delay = initialDelay * (Math.trunc(attempt) + 1);
  else if (backoff === "exponential") delay = initialDelay * (multiplier ** Math.trunc(attempt));
  if (!Number.isFinite(delay)) delay = maxDelay;
  return Math.min(Math.round(delay), Math.trunc(maxDelay));
}

export function getAgentRetryCount(stateDir: string, sessionPrefix: string, runId: string): number {
  const state = readRunnerAgentState(runnerAgentStatePath(stateDir, sessionPrefix, runId));
  const attempt = Number.parseInt(state?.retry_attempt || "0", 10);
  return Number.isSafeInteger(attempt) && attempt >= 0 ? attempt : 0;
}

export function incrementAgentRetryCount(stateDir: string, sessionPrefix: string, runId: string): number {
  return Number(incrementRunnerAgentRetry(runnerAgentStatePath(stateDir, sessionPrefix, runId)).retry_attempt || "0");
}

export function handleAgentError(
  input: ErrorHandlingInput,
  write: (line: string) => void = console.log,
  schedule: ScheduleLaunch = scheduleChainRunner,
): ErrorHandlingResult {
  if (input.errorType !== "error" && input.errorType !== "timeout") throw new Error(`Unsupported agent error type: ${input.errorType}`);
  const chain = loadChain(input.chainFile, input.agentsDir);
  const agent = findAgent(chain, input.agentId);
  const retry = retryConfig(agent);
  const sessionPrefix = sessionPrefixFor(chain, agent, input.agentId);
  const retryCount = getAgentRetryCount(input.stateDir, sessionPrefix, input.runId);
  write("");
  write(`  *** ${input.errorType} detected in agent ${input.agentId}`);
  write(`      retry: ${retryCount} / ${retry.maxRetries}`);

  const agentName = stringValue(agent.name, input.agentId);
  const errorDetails = errorDetailsFromReport(input.reportFile, input.errorType);
  if (retryCount >= retry.maxRetries) notifySlack(chain, input.chainFile, "agent_error", agentName, input.agentId, errorDetails);

  const routing = recordValue(chain.routing);
  const handlerAgent = input.errorType === "timeout"
    ? stringValue(agent.on_timeout) || stringValue(agent.on_error) || stringValue(routing.timeout_agent) || stringValue(routing.timeout_handler)
    : stringValue(agent.on_error) || stringValue(routing.error_handler);

  if (retryCount < retry.maxRetries) {
    const nextCount = retryCount + 1;
    const delay = calculateRetryDelay(retryCount, retry.backoff, retry.initialDelay, retry.maxDelay, retry.multiplier);
    write(`      scheduling retry ${nextCount} in ${delay}s...`);
    incrementAgentRetryCount(input.stateDir, sessionPrefix, input.runId);
    schedule(input.chainFile, input.agentId, delay);
    return { code: 0, retryCount, maxRetries: retry.maxRetries, action: "retry" };
  }

  if (handlerAgent) {
    write(`      max retries reached. routing to error handler: ${handlerAgent}`);
    transitionRunnerAgentState(
      runnerAgentStatePath(input.stateDir, sessionPrefix, input.runId),
      "failed",
      input.errorType,
    );
    schedule(input.chainFile, handlerAgent, 2);
    return { code: 0, retryCount, maxRetries: retry.maxRetries, handlerAgent, action: "handler" };
  }

  write("      no error handler configured. chain stops.");
  notifySlack(chain, input.chainFile, "chain_error", agentName, input.agentId, `${input.errorType} (no handler configured)`);
  return { code: 1, retryCount, maxRetries: retry.maxRetries, action: "stop" };
}

/**
 * Schedule a detached typed dispatch. This module owns delay, argument
 * validation, and process lifecycle rather than asking shell to sleep and fork
 * it. The detached `dispatch` sub-process waits out the backoff, authorizes one
 * fresh typed occurrence, and re-enters the existing run through the typed
 * launch-agent bundle — it never invokes chain-runner.sh --start.
 */
export function scheduleChainRunner(chainFile: string, agentId: string, delaySeconds: number): void {
  assertExternalPath(chainFile, "chain file");
  if (!agentId.trim()) throw new Error("agent id must not be empty");
  assertNonNegativeFinite(delaySeconds, "delay seconds");
  const bundle = resolve(process.argv[1] || "");
  if (!bundle || !isAbsolute(bundle)) throw new Error("Typed error-handling bundle path is unavailable for dispatch.");
  const child = spawn(process.execPath, [bundle, "dispatch", "--delay-seconds", String(delaySeconds), "--chain-file", chainFile, "--agent-id", agentId], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.on("error", () => undefined);
  child.unref();
}

/**
 * Wait out the backoff inside this process, then authorize one fresh typed
 * occurrence and spawn the typed launch-agent bundle detached. The launcher
 * reuses the exact run id, the run-local immutable chain snapshot, parent
 * provenance, and terminal attempt history (createAgentAttempt preserves it);
 * the resumedAt authorization is the typed runtime's documented mechanism for a
 * direct bootstrap of an agent whose latest attempt is terminal, mirroring the
 * resume route. Detached + unref'd: the relaunch outlives this process and
 * never blocks the error decision that scheduled it.
 */
export function dispatchChainRunner(chainFile: string, agentId: string, delaySeconds: number): Promise<void> {
  const plan = buildTypedRelaunchPlan(chainFile, agentId);
  assertNonNegativeFinite(delaySeconds, "delay seconds");
  return new Promise((resolveDispatch) => {
    setTimeout(() => {
      authorizeTypedRelaunch(plan.runJsonPath, plan.runId);
      const child = spawn(process.execPath, [plan.launcher, ...plan.args], {
        detached: true,
        stdio: "ignore",
        env: plan.env,
      });
      child.on("error", () => undefined);
      child.unref();
      resolveDispatch();
    }, delaySeconds * 1000);
  });
}

export interface TypedRelaunchPlan {
  launcher: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  runDir: string;
  runId: string;
  runJsonPath: string;
}

/**
 * Resolve the typed relaunch as a pure plan: the sibling launch-agent bundle,
 * the run-local chain snapshot as chainPath, and an environment that pins the
 * exact run id and run directory so the launcher re-enters the existing run
 * rather than creating a new one. Validated eagerly so a missing launcher or run
 * id fails before the backoff wait, not after it.
 */
export function buildTypedRelaunchPlan(chainFile: string, agentId: string, bundlePath: string = resolve(process.argv[1] || "")): TypedRelaunchPlan {
  assertExternalPath(chainFile, "chain file");
  if (!agentId.trim()) throw new Error("agent id must not be empty");
  const runId = process.env.MENTIKO_RUN_ID || process.env.RUN_ID;
  if (!runId) throw new Error("Typed relaunch requires MENTIKO_RUN_ID to preserve the existing run.");
  const runDir = process.env.MENTIKO_RUN_DIR || dirname(chainFile);
  if (!isAbsolute(runDir)) throw new Error(`Typed relaunch run directory must be absolute: ${runDir}`);
  return {
    launcher: resolveTypedLauncher(bundlePath),
    args: [chainFile, agentId],
    env: { ...process.env, MENTIKO_RUN_ID: runId, RUN_ID: runId, MENTIKO_RUN_DIR: runDir },
    runDir,
    runId,
    runJsonPath: join(runDir, "run.json"),
  };
}

/**
 * The typed launch-agent bundle is a sibling of this compiled bundle in lib/.
 * Fails closed when missing so a checkout without the built runtime never leaves
 * a relaunch half-scheduled.
 */
function resolveTypedLauncher(bundlePath: string): string {
  if (!bundlePath || !isAbsolute(bundlePath)) throw new Error("Typed error-handling bundle path is unavailable for typed launch dispatch.");
  const compiled = join(dirname(bundlePath), "runner-v2-launch-agent.js");
  if (!existsSync(compiled) || !statSync(compiled).isFile()) {
    throw new Error(`Typed runner-v2 launch-agent bundle missing: ${compiled}`);
  }
  return compiled;
}

/**
 * Authorize one fresh typed occurrence for a non-terminal run. The typed
 * bootstrap's assertBootstrapLaunchable gate admits a direct relaunch of an
 * agent whose latest attempt is terminal only when run.resumedAt is newer than
 * that attempt's updatedAt; retry/handler relaunches are detached direct
 * bootstraps (not routed-completion replays), so they need this durable
 * authorization rather than an env occurrence claim. Identity-guarded and
 * best-effort: a missing record or write failure never changes the durable
 * retry/handler decision, and a record whose id does not match is left untouched.
 */
export function authorizeTypedRelaunch(runJsonPath: string, runId: string): void {
  if (!existsSync(runJsonPath)) return;
  try {
    updateRunJson(runJsonPath, (current) => {
      if (!current) throw new Error(`run.json not found during relaunch authorization: ${runJsonPath}`);
      if (current.id !== runId) return current; // never authorize a foreign record
      return { ...current, resumedAt: new Date().toISOString() };
    });
  } catch {
    // The launcher's own gate remains authoritative; authorization is best-effort.
  }
}

function loadChain(chainFile: string, agentsDir?: string): ChainRecord {
  assertRegularFile(chainFile, "Chain file");
  const raw = decodeRawChainDefinition(chainFile);
  const agents = Array.isArray(raw.agents) ? raw.agents : [];
  const hasReferences = agents.some((agent) => isRecord(agent) && typeof agent.$ref === "string" && agent.$ref.trim());
  return hasReferences
    ? loadNormalizedChainDefinition(chainFile, requiredAgentsDir(agentsDir))
    : raw as ChainRecord;
}

function retryConfig(agent: Record<string, unknown>): RetryConfig {
  const retry = recordValue(agent.retry);
  return {
    maxRetries: nonNegativeInteger(retry.max_retries, 0),
    backoff: stringValue(retry.backoff, "exponential"),
    initialDelay: nonNegativeNumber(retry.initial_delay, 5),
    maxDelay: nonNegativeNumber(retry.max_delay, 300),
    multiplier: nonNegativeNumber(retry.backoff_multiplier, 2),
  };
}

function sessionPrefixFor(chain: ChainRecord, agent: Record<string, unknown>, agentId: string): string {
  const configuredAgentPrefix = stringValue(agent.session_prefix);
  if (configuredAgentPrefix) return configuredAgentPrefix;
  const config = recordValue(chain.config);
  const chainPrefix = stringValue(config.session_prefix);
  return chainPrefix ? `${chainPrefix}-${agentId}` : agentId;
}

function findAgent(chain: ChainRecord, agentId: string): Record<string, unknown> {
  if (!Array.isArray(chain.agents)) throw new Error("chain.agents must be an array");
  const agent = chain.agents.find((candidate) => stringValue(candidate.id) === agentId);
  if (!agent) throw new Error(`Agent not found: ${agentId}`);
  return agent;
}

function errorDetailsFromReport(reportFile: string, errorType: AgentErrorType): string {
  if (!existsSync(reportFile)) return `Agent ${errorType}`;
  assertRegularFile(reportFile, "Agent report");
  const line = readFileSync(reportFile, "utf8").split(/\r?\n/).find((candidate) => /error|failed|exception/i.test(candidate));
  return line?.trim() || `Agent ${errorType}`;
}

function notifySlack(chain: ChainRecord, chainFile: string, event: "agent_error" | "chain_error", agentName: string, agentId: string, error: string): void {
  try {
    const config = recordValue(chain.config);
    const slack = recordValue(config.slack);
    const webhook = stringValue(process.env.SLACK_WEBHOOK_URL) || stringValue(slack.webhook_url);
    const enabled = slack.enabled === true || Boolean(process.env.SLACK_WEBHOOK_URL);
    if (!enabled || !webhook) return;
    const events = Array.isArray(slack.events) ? slack.events.filter((value): value is string => typeof value === "string") : [];
    if (events.length > 0 && !events.includes(event)) return;
    const chainName = stringValue(chain.name, "unknown");
    const runId = process.env.MENTIKO_RUN_ID || process.env.RUN_ID || "";
    const fields = [
      { title: "Chain", value: chainName, short: true },
      { title: "Agent", value: agentName, short: true },
      { title: "Error", value: error.slice(0, 300), short: false },
    ];
    if (runId) fields.push({ title: "Run ID", value: runId, short: true });
    const payload = {
      username: "Agent Chain",
      icon_emoji: ":robot_face:",
      attachments: [{ color: event === "chain_error" ? "#dc3545" : "#ffc107", footer: "mentiko", ts: Math.floor(Date.now() / 1000), fields }],
    };
    const response = spawnSync("curl", ["-sS", "--max-time", "5", "-X", "POST", webhook, "-H", "Content-Type: application/json", "-d", JSON.stringify(payload)], { encoding: "utf8" });
    if (response.status === 0) console.log(`  slack: sent ${event} notification`);
  } catch {
    // Notifications are an external side effect; failure must not change the
    // already-durable retry/error decision.
  }
  void chainFile;
}

function requiredAgentsDir(path: string | undefined): string {
  if (!path?.trim()) throw new Error("Agent references require an agents directory.");
  return path;
}

function assertExternalPath(path: string, label: string): void {
  if (!path || !isAbsolute(path)) throw new Error(`${label} path must be absolute.`);
}

function assertRegularFile(path: string, label: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular file: ${path}`);
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && /^(?:\d+|\d*\.\d+)$/.test(value)) return Number(value);
  return fallback;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  const number = nonNegativeNumber(value, fallback);
  return Number.isSafeInteger(number) ? number : fallback;
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and non-negative.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
