import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";
import { spawn, type ChildProcess } from "child_process";
import config from "@/lib/config";
import { shellEscape } from "@/lib/api/audit-exec";
import type { TypedExecutorEffect, TypedExecutorPlan } from "@/lib/runner-v2/executor";
import { serializeRunnerEvent, type RunnerEventRecord } from "@/lib/runner-v2/events";
import { writeFanGroup } from "@/lib/runner-v2/fan-group-store";
import type { RoutedLaunchPlan } from "@/lib/runner-v2/routed-launch-plan";
import { updateRunStatus } from "@/lib/runner-v2/run-state";

export type AdapterOperation =
  | { type: "task-status"; status: string; taskId?: string }
  | { type: "schedule-mark"; status: string; chainPath?: string }
  | { type: "webhook"; event: string; chainPath?: string }
  | { type: "event"; event: string; source: string; data: string }
  | { type: "plugin"; event: string; chainName: string; runId: string; agentId?: string }
  | { type: "notification"; event: string; chainName: string; runId: string; agentId?: string; reason?: string }
  | { type: "hook"; event: string; runId: string; details: Record<string, string> }
  | { type: "metadata-webhooks"; event: string; chainPath?: string; chainName: string; runId: string }
  | { type: "legacy-webhook"; url: string; payload: Record<string, string> }
  | { type: "session-policy"; policy: string; sessions?: string[] }
  | { type: "next-chain"; chainName: string; parentRunId: string }
  | { type: "retry-state"; action: string; agentId: string }
  | { type: "circuit-breaker"; action: string; chainName: string; agentId: string; threshold: number; timeout: number }
  | { type: "rollback"; action: string; agentId: string; startSha?: string };

export interface AdapterContext {
  runJsonPath: string;
  stateDir: string;
  eventsArchiveDir?: string;
  eventsDir?: string;
  hooksDir?: string;
  chainsDir?: string;
  sharedChainsDir?: string;
  schedulesDir?: string;
  retryDir?: string;
  dryRun?: boolean;
}

export interface AdapterResult {
  effectsApplied: string[];
  operations: AdapterOperation[];
  launchesStarted: Array<{ command: string; pid?: number }>;
}

export function applyTypedExecutorPlan(plan: TypedExecutorPlan, context: AdapterContext): AdapterResult {
  const result: AdapterResult = { effectsApplied: [], operations: [], launchesStarted: [] };

  for (const effect of plan.effects) {
    const applied = applyEffect(effect, context);
    result.operations.push(...applied.operations);
    result.launchesStarted.push(...applied.launchesStarted);
    result.effectsApplied.push(effect.type);
  }

  for (const launch of plan.launches) {
    const child = startLaunch(launch, context);
    result.launchesStarted.push({ command: launch.command, pid: child?.pid });
  }

  return result;
}

interface AppliedEffect {
  operations: AdapterOperation[];
  launchesStarted: Array<{ command: string; pid?: number }>;
}

export function applyEffect(effect: TypedExecutorEffect, context: AdapterContext): AppliedEffect {
  const operations = plannedOperations(effect);
  const launchesStarted: Array<{ command: string; pid?: number }> = [];
  if (context.dryRun) return { operations, launchesStarted };

  if (effect.type === "event-side-effects") {
    applyEventSideEffects(effect.plan.markProcessed, effect.plan.archiveOwned, context);
  } else if (effect.type === "fan-group-create") {
    writeFanGroup(context.stateDir, effect.group);
  } else if (effect.type === "run-terminal") {
    updateRunStatus(context.runJsonPath, effect.status, effect.reason);
  } else if (effect.type === "terminal") {
    for (const step of effect.plan.steps) {
      if (step.type === "run-status") {
        updateRunStatus(context.runJsonPath, step.status);
      } else {
        launchesStarted.push(...applyOperation(step, context));
      }
    }
  } else if (effect.type === "retry" && effect.plan.action === "exhausted") {
    for (const step of effect.plan.steps) {
      if (step.type === "run-status") {
        updateRunStatus(context.runJsonPath, step.status, step.reason);
      } else {
        launchesStarted.push(...applyOperation(step, context));
      }
    }
  }
  return { operations, launchesStarted };
}

export function startLaunch(launch: RoutedLaunchPlan, context: AdapterContext): ChildProcess | undefined {
  if (context.dryRun) return undefined;
  const child = spawn("/bin/zsh", ["-lc", launch.command], {
    detached: launch.detached,
    stdio: "ignore",
    env: {
      ...process.env,
      ...launch.env,
    },
  });
  child.unref();
  return child;
}

function applyEventSideEffects(
  triggered: RunnerEventRecord,
  archiveOwned: RunnerEventRecord[],
  context: AdapterContext,
): void {
  if (triggered.path) {
    writeEventFile(triggered.path, { ...triggered, processed: true });
  }

  const archiveDir = context.eventsArchiveDir || (triggered.path ? join(dirname(triggered.path), "archive") : undefined);
  if (!archiveDir) return;

  for (const event of archiveOwned) {
    if (!event.path || event.path === triggered.path) continue;
    mkdirSync(archiveDir, { recursive: true });
    renameSync(event.path, join(archiveDir, event.path.split("/").pop() || "event.event"));
  }
}

function writeEventFile(path: string, event: RunnerEventRecord): void {
  const current = readFileSync(path, "utf8");
  const content = current.includes("processed:")
    ? current.replace(/^processed:\s*.*$/im, "processed: true")
    : serializeRunnerEvent(event);
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

function applyOperation(operation: AdapterOperation, context: AdapterContext): Array<{ command: string; pid?: number }> {
  if (operation.type === "event") {
    emitTypedEvent(operation, context);
  } else if (operation.type === "schedule-mark") {
    markSchedule(operation, context);
  } else if (operation.type === "retry-state" && operation.action === "clear") {
    clearRetryState(operation.agentId, context);
  } else if (operation.type === "circuit-breaker" && operation.action === "record-failure") {
    recordCircuitFailure(operation, context);
  } else if (operation.type === "hook") {
    dispatchWatchdogHooks(operation, context);
  } else if (operation.type === "session-policy") {
    auditSessionPolicy(operation, context);
  } else if (operation.type === "next-chain") {
    const launch = launchNextChain(operation, context);
    return launch ? [launch] : [];
  } else if (isExternalQueuedOperation(operation)) {
    queueExternalEffect(operation, context);
  } else if (operation.type === "rollback") {
    auditRollbackPlan(operation, context);
  }
  return [];
}

function emitTypedEvent(
  operation: Extract<AdapterOperation, { type: "event" }>,
  context: AdapterContext,
): void {
  const runId = readRunId(context.runJsonPath);
  const eventsDir = context.eventsDir || join(context.stateDir, "events");
  const eventPath = join(
    eventsDir,
    `${runId ? `${sanitizeFilePart(runId)}-` : ""}${sanitizeFilePart(operation.source)}-${sanitizeFilePart(operation.event)}.event`,
  );
  mkdirSync(eventsDir, { recursive: true });
  writeFileAtomic(eventPath, [
    `event: ${operation.event}`,
    `source: ${operation.source}`,
    `run_id: ${runId}`,
    `timestamp: ${new Date().toISOString()}`,
    "processed: false",
    `data: ${operation.data}`,
    "",
  ].join("\n"));
}

function markSchedule(
  operation: Extract<AdapterOperation, { type: "schedule-mark" }>,
  context: AdapterContext,
): void {
  if (!operation.chainPath) return;
  const schedulesDir = context.schedulesDir || join(context.stateDir, "schedules");
  const scheduleId = scheduleIdForChain(operation.chainPath);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const statePath = join(schedulesDir, "state.json");
  const historyPath = join(schedulesDir, `${scheduleId}.history`);
  mkdirSync(schedulesDir, { recursive: true });
  const state = readJsonObject(statePath);
  state[scheduleId] = nowSeconds;
  writeJsonAtomic(statePath, state);
  writeFileAtomic(historyPath, `${readOptionalFile(historyPath)}[${new Date().toISOString()}] ${operation.status}\n`);
}

function clearRetryState(agentId: string, context: AdapterContext): void {
  const retryPath = join(retryDir(context), `retry_${sanitizeFilePart(agentId)}.count`);
  if (existsSync(retryPath)) {
    unlinkSync(retryPath);
  }
}

function recordCircuitFailure(
  operation: Extract<AdapterOperation, { type: "circuit-breaker" }>,
  context: AdapterContext,
): void {
  const dir = retryDir(context);
  const path = join(dir, `circuit_${operation.chainName}_${sanitizeFilePart(operation.agentId)}.json`);
  mkdirSync(dir, { recursive: true });
  const current = readJsonObject(path);
  const failureCount = Number(current.failure_count || 0) + 1;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const opened = failureCount >= operation.threshold;
  writeJsonAtomic(path, {
    state: opened ? "open" : String(current.state || "closed"),
    failure_count: failureCount,
    last_failure: nowSeconds,
    open_until: opened ? nowSeconds + operation.timeout : 0,
    threshold: operation.threshold,
    timeout: operation.timeout,
  });
}

function dispatchWatchdogHooks(
  operation: Extract<AdapterOperation, { type: "hook" }>,
  context: AdapterContext,
): void {
  const hooksDir = context.hooksDir || join(context.stateDir, "watchdog-hooks");
  mkdirSync(hooksDir, { recursive: true });
  const hooks = listExecutableHooks(hooksDir);
  const details = JSON.stringify(operation.details);

  for (const hook of hooks) {
    const child = spawn("/bin/bash", [hook, operation.event, operation.runId, details], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }

  appendJsonl(join(hooksDir, "dispatch.jsonl"), {
    event: operation.event,
    runId: operation.runId,
    hookCount: hooks.length,
    details: operation.details,
    timestamp: new Date().toISOString(),
  });
}

function auditSessionPolicy(
  operation: Extract<AdapterOperation, { type: "session-policy" }>,
  context: AdapterContext,
): void {
  appendJsonl(join(context.stateDir, "session-policy.jsonl"), {
    policy: operation.policy,
    sessions: operation.sessions || [],
    applied: false,
    reason: operation.policy === "stop"
      ? "transport session control is legacy-only until typed runtime owns pty transport"
      : "policy recorded for typed runner audit",
    timestamp: new Date().toISOString(),
  });
}

function launchNextChain(
  operation: Extract<AdapterOperation, { type: "next-chain" }>,
  context: AdapterContext,
): { command: string; pid?: number } | undefined {
  const resolved = resolveNextChainPath(operation.chainName, context);
  if (!resolved) {
    appendJsonl(join(context.stateDir, "next-chain.jsonl"), {
      chainName: operation.chainName,
      parentRunId: operation.parentRunId,
      status: "missing",
      searched: searchedNextChainPaths(operation.chainName, context),
      timestamp: new Date().toISOString(),
    });
    return undefined;
  }

  const command = `bash ${shellEscape(join(config.codeRoot, "lib", "chain-runner.sh"))} ${shellEscape(resolved)}`;
  const child = spawn("/bin/zsh", ["-lc", command], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      MENTIKO_PARENT_RUN_ID: operation.parentRunId,
    },
  });
  child.unref();
  appendJsonl(join(context.stateDir, "next-chain.jsonl"), {
    chainName: operation.chainName,
    parentRunId: operation.parentRunId,
    status: "launched",
    chainPath: resolved,
    command,
    pid: child.pid,
    timestamp: new Date().toISOString(),
  });
  return { command, pid: child.pid };
}

function resolveNextChainPath(chainName: string, context: AdapterContext): string | undefined {
  return searchedNextChainPaths(chainName, context).find((path) => existsSync(path));
}

function searchedNextChainPaths(chainName: string, context: AdapterContext): string[] {
  return [
    join(context.chainsDir || config.chainsDir, chainName, "chain.json"),
    join(context.sharedChainsDir || join(config.codeRoot, "chains"), chainName, "chain.json"),
  ];
}

function isExternalQueuedOperation(operation: AdapterOperation): operation is Extract<
  AdapterOperation,
  { type: "task-status" | "webhook" | "plugin" | "notification" | "metadata-webhooks" | "legacy-webhook" }
> {
  return operation.type === "task-status"
    || operation.type === "webhook"
    || operation.type === "plugin"
    || operation.type === "notification"
    || operation.type === "metadata-webhooks"
    || operation.type === "legacy-webhook";
}

function queueExternalEffect(operation: AdapterOperation, context: AdapterContext): void {
  appendJsonl(join(context.stateDir, "external-effects.jsonl"), {
    type: operation.type,
    status: "queued",
    operation,
    reason: "typed runner records external side effects for replay/dispatch audit",
    timestamp: new Date().toISOString(),
  });
}

function auditRollbackPlan(
  operation: Extract<AdapterOperation, { type: "rollback" }>,
  context: AdapterContext,
): void {
  appendJsonl(join(context.stateDir, "rollback-plan.jsonl"), {
    agentId: operation.agentId,
    startSha: operation.startSha,
    action: operation.action,
    applied: false,
    reason: "destructive rollback requires explicit operator approval",
    timestamp: new Date().toISOString(),
  });
}

function listExecutableHooks(hooksDir: string): string[] {
  try {
    return readdirSync(hooksDir)
      .filter((name) => name.endsWith(".sh"))
      .map((name) => join(hooksDir, name))
      .filter((path) => {
        try {
          const stat = statSync(path);
          return stat.isFile() && (stat.mode & 0o111) !== 0;
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

function retryDir(context: AdapterContext): string {
  return context.retryDir || join(context.stateDir, "retry");
}

function scheduleIdForChain(chainPath: string): string {
  const normalized = chainPath.replace(/\\/g, "/");
  const marker = "/chains/";
  const markerIndex = normalized.indexOf(marker);
  const relative = markerIndex >= 0 ? normalized.slice(markerIndex + marker.length) : basename(normalized);
  return relative.replace(/\//g, "_");
}

function readRunId(runJsonPath: string): string {
  try {
    const run = JSON.parse(readFileSync(runJsonPath, "utf8")) as { id?: string };
    return run.id || "";
  } catch {
    return "";
  }
}

function readJsonObject(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readOptionalFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function writeJsonAtomic(path: string, value: Record<string, unknown>): void {
  writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

function appendJsonl(path: string, value: Record<string, unknown>): void {
  writeFileAtomic(path, `${readOptionalFile(path)}${JSON.stringify(value)}\n`);
}

function writeFileAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

function sanitizeFilePart(value: string): string {
  const sanitized = value.replace(/[\/\x00-\x1F\x7F]/g, "_").replace(/[^A-Za-z0-9._-]/g, "_");
  return sanitized && sanitized !== "." && sanitized !== ".." ? sanitized : "_";
}

function plannedOperations(effect: TypedExecutorEffect): AdapterOperation[] {
  if (effect.type === "terminal") {
    return effect.plan.steps
      .filter((step) => step.type !== "run-status")
      .map((step) => step as AdapterOperation);
  }
  if (effect.type === "retry") {
    if (effect.plan.action === "retry") {
      return effect.plan.steps.map((step) => step as AdapterOperation);
    }
    return effect.plan.steps
      .filter((step) => step.type !== "run-status")
      .map((step) => step as AdapterOperation);
  }
  if (effect.type === "fan-group") {
    return effect.plan.launch
      ? [{ type: "next-chain", chainName: effect.plan.launch.agentId, parentRunId: effect.plan.group.runId || "" }]
      : [];
  }
  return [];
}
