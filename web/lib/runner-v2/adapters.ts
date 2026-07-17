import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { spawn, spawnSync } from "child_process";
import { createHash } from "crypto";
import config from "@/lib/config";
import { shellEscape } from "@/lib/api/audit-exec";
import { runQualityGateEventArtifact } from "@/lib/event-artifacts/event-artifact-runner";
import type { TypedExecutorEffect, TypedExecutorPlan } from "@/lib/runner-v2/executor";
import type { GenerationImportPlan } from "@/lib/runner-v2/completion-runner";
import { emitRunnerEvent } from "@/lib/runner-v2/event-emitter";
import { parseRunnerEvent } from "@/lib/runner-v2/events";
import { consumeRunnerEvents } from "@/lib/runner-v2/event-lifecycle";
import type { EventSideEffectPlan } from "@/lib/runner-v2/event-side-effects";
import { completeFanGroupMemberLocked, createFanGroupIfAbsent } from "@/lib/runner-v2/fan-group-store";
import type { RoutedLaunchPlan } from "@/lib/runner-v2/routed-launch-plan";
import { readRunJson, updateRunJson, updateRunStatus, type RunAgentRecord, type RunMutationObserver, type RunRecord } from "@/lib/runner-v2/run-state";
import { runnerV2PtyEnv, type RunnerV2Environment } from "@/lib/runner-v2/pty-scope";
import { enqueueExternalEffectsOnce } from "@/lib/runner-v2/external-effects";
import { readRunnerV2AttemptState, type AgentAttemptRecord } from "@/lib/runner-v2/agent-attempt";
import { buildRoutedLaunchPlans } from "@/lib/runner-v2/routed-launch-plan";
import { withExclusiveFileClaim } from "@/lib/runner-v2/file-claim";

type AdapterOperationPayload =
  | { type: "task-status"; status: string; taskId?: string; runId?: string }
  | { type: "schedule-mark"; status: string; chainPath?: string }
  | { type: "webhook"; event: string; chainId?: string; chainPath?: string }
  | { type: "event"; event: string; source: string; data: string }
  | { type: "plugin"; event: string; chainName: string; runId: string; agentId?: string }
  | { type: "notification"; event: string; chainName: string; runId: string; agentId?: string; reason?: string }
  | { type: "hook"; event: string; runId: string; details: Record<string, string> }
  | { type: "metadata-webhooks"; event: string; chainId?: string; chainPath?: string; chainName: string; runId: string }
  | { type: "legacy-webhook"; url: string; payload: Record<string, string> }
  | { type: "session-policy"; policy: string; sessions?: string[] }
  | { type: "next-chain"; chainName: string; parentRunId: string }
  | { type: "retry-state"; action: string; agentId: string; attempt?: number }
  | { type: "event-artifact"; runId: string; status: string; executionId?: string; artifactPath?: string }
  | ({ type: "generation-import" } & GenerationImportPlan)
  | { type: "circuit-breaker"; action: string; chainName: string; agentId: string; threshold: number; timeout: number; failureId?: string }
  | { type: "rollback"; action: string; agentId: string; startSha?: string };

export type AdapterOperation = AdapterOperationPayload & {
  idempotencyKey?: string;
  /** Completion occurrence identity used to distinguish legitimate loop visits. */
  occurrenceId?: string;
};

export interface AdapterContext {
  runJsonPath: string;
  stateDir: string;
  namespaceId?: string;
  orgId?: string;
  eventsArchiveDir?: string;
  eventsDir?: string;
  hooksDir?: string;
  chainsDir?: string;
  sharedChainsDir?: string;
  schedulesDir?: string;
  retryDir?: string;
  runsDir?: string;
  dryRun?: boolean;
  onRunMutation?: RunMutationObserver;
  beforeOperation?: (operation: AdapterOperation) => void;
  /** Stable identity for one completion attempt/event/loop occurrence. */
  completionOccurrenceId?: string;
}

export interface AdapterResult {
  effectsApplied: string[];
  operations: AdapterOperation[];
  launchesStarted: Array<{ command: string; pid?: number }>;
}

export class GenerationImportError extends Error {
  constructor(
    readonly plan: GenerationImportPlan,
    readonly detail: string,
  ) {
    super(`generation import failed for job ${plan.jobId}: ${detail}`);
    this.name = "GenerationImportError";
  }
}

export class RoutedLaunchAcceptanceError extends Error {
  constructor(
    readonly reason: "timeout" | "nonzero_exit" | "spawn_error" | "missing_durable_state" | "acceptance_pending",
    detail: string,
  ) {
    super(`routed launch was not durably accepted (${reason}): ${detail}`);
    this.name = "RoutedLaunchAcceptanceError";
  }
}

export function applyTypedExecutorPlan(plan: TypedExecutorPlan, context: AdapterContext): AdapterResult {
  const result: AdapterResult = { effectsApplied: [], operations: [], launchesStarted: [] };
  const operationContext = plan.occurrenceId
    ? { ...context, completionOccurrenceId: plan.occurrenceId }
    : context;
  const eventEffects = plan.effects.filter((effect) => effect.type === "event-side-effects");
  const launchBeforeEffects = plan.action === "retry";

  // Retry/circuit state describes an accepted retry, not a launch attempt. Start
  // the replacement first so a rejected launch leaves no active retry record.
  if (launchBeforeEffects) {
    for (const launch of plan.launches) {
      const child = startLaunch(launch, operationContext);
      result.launchesStarted.push({ command: launch.command, pid: child?.pid });
    }
  }

  // A completion event is the durable retry token for every effect and routed
  // launch. Keep it active until all synchronous work has been accepted; if an
  // effect or launch throws, the caller can retry from the same strict event
  // instead of observing a consumed handoff with no downstream work.
  for (const effect of plan.effects.filter((candidate) => candidate.type !== "event-side-effects")) {
    const applied = applyEffect(effect, operationContext);
    result.operations.push(...applied.operations);
    result.launchesStarted.push(...applied.launchesStarted);
    result.effectsApplied.push(effect.type);
  }

  if (!launchBeforeEffects) {
    for (const launch of plan.launches) {
      const child = startLaunch(launch, operationContext);
      result.launchesStarted.push({ command: launch.command, pid: child?.pid });
    }
  }

  for (const effect of eventEffects) {
    const applied = applyEffect(effect, operationContext);
    result.operations.push(...applied.operations);
    result.launchesStarted.push(...applied.launchesStarted);
    result.effectsApplied.push(effect.type);
  }

  return result;
}

interface AppliedEffect {
  operations: AdapterOperation[];
  launchesStarted: Array<{ command: string; pid?: number }>;
}

export function applyEffect(effect: TypedExecutorEffect, context: AdapterContext): AppliedEffect {
  const operations = plannedOperations(effect).map((operation) => bindCompletionOperationIdentity(operation, context));
  const launchesStarted: Array<{ command: string; pid?: number }> = [];
  if (context.dryRun) return { operations, launchesStarted };

  if (effect.type === "event-side-effects") {
    applyEventSideEffects(effect.plan, context);
  } else if (effect.type === "event-artifact") {
    runQualityGateEventArtifact(effect.plan);
  } else if (effect.type === "fan-group-create") {
    createFanGroupIfAbsent(context.stateDir, effect.group);
  } else if (effect.type === "fan-group") {
    let acceptedLaunch: { command: string; pid?: number } | undefined;
    completeFanGroupMemberLocked(context.stateDir, {
      groupId: effect.plan.group.id,
      agentId: effect.agentId || "",
      status: effect.status || "complete",
    }, (plan) => {
      if (!plan.launch) return;
      const chainPath = plan.group.chainPath || join(dirname(context.runJsonPath), "chain.json");
      const [launch] = buildRoutedLaunchPlans({
        action: "launch",
        agentIds: [plan.launch.agentId],
        reason: "fan-in claim",
      }, {
        chainPath,
        runDir: dirname(context.runJsonPath),
        fanGroupId: plan.group.id,
        env: {
          ...plan.launch.env,
          MENTIKO_RUN_ID: plan.group.runId || readRunId(context.runJsonPath) || "",
          MENTIKO_COMPLETION_OCCURRENCE_ID: [
            "fan-group",
            plan.group.runId || readRunId(context.runJsonPath) || "unknown-run",
            plan.group.id,
            effect.agentId || "unknown-member",
          ].join(":"),
          AGENT_FAN_GROUP_ID: plan.group.id,
        },
      });
      const receipt = startLaunch(launch, context);
      acceptedLaunch = { command: launch.command, pid: receipt?.pid };
    });
    if (acceptedLaunch) launchesStarted.push(acceptedLaunch);
  } else if (effect.type === "generation-import") {
    applyGenerationImport(effect.plan, context);
  } else if (effect.type === "run-terminal") {
    updateRunStatus(context.runJsonPath, effect.status, effect.reason, undefined, context.onRunMutation);
  } else if (effect.type === "terminal") {
    for (const step of effect.plan.steps) {
      if (step.type === "run-status") {
        updateRunStatus(context.runJsonPath, step.status, undefined, undefined, context.onRunMutation);
      } else {
        launchesStarted.push(...applyOperation(step, context));
      }
    }
  } else if (effect.type === "retry") {
    for (const step of effect.plan.steps) {
      if (step.type === "run-status") {
        updateRunStatus(context.runJsonPath, step.status, step.reason, undefined, context.onRunMutation);
      } else if (step.type === "retry-state" && step.action === "clear" && effect.plan.action === "exhausted") {
        launchesStarted.push(...applyOperation({ ...step, attempt: effect.plan.currentAttempt }, context));
      } else {
        launchesStarted.push(...applyOperation(step, context));
      }
    }
  } else if (effect.type === "terminal-failure") {
    for (const step of effect.plan.steps) {
      launchesStarted.push(...applyOperation(step, context));
    }
  } else if (effect.type === "agent-completion") {
    for (const step of effect.plan.steps) {
      launchesStarted.push(...applyOperation(step, context));
    }
  }
  return { operations, launchesStarted };
}

function applyGenerationImport(plan: GenerationImportPlan, context: AdapterContext): void {
  const mentikoBin = join(config.codeRoot, "bin", "mentiko");
  const result = spawnSync(mentikoBin, ["generation", "import"], {
    encoding: "utf8",
    env: {
      ...process.env,
      ARTIFACTS_DIR: plan.artifactsDir,
      MENTIKO_GENERATION_JOB_ID: plan.jobId,
      MENTIKO_GENERATION_KIND: plan.generationKind,
      MENTIKO_RUN_ID: plan.runId,
      NAMESPACE_ID: plan.namespaceId || process.env.NAMESPACE_ID || "default",
      ORG_ID: plan.orgId || process.env.ORG_ID || "default",
      ...(plan.webUrl ? { MENTIKO_WEB_URL: plan.webUrl } : {}),
    },
  });
  appendJsonl(join(context.stateDir, "generation-import.jsonl"), {
    jobId: plan.jobId,
    generationKind: plan.generationKind,
    runId: plan.runId,
    artifactsDir: plan.artifactsDir,
    status: result.status === 0 ? "complete" : "failed",
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    timestamp: new Date().toISOString(),
  });
  if (result.status !== 0) {
    throw new GenerationImportError(plan, result.stderr || result.stdout || String(result.status));
  }
}

interface LaunchTargetProvenance {
  agentId: string;
  attemptId: string;
  session: string;
}

interface LaunchAcceptanceReceipt {
  pid?: number;
  targets?: LaunchTargetProvenance[];
}

interface DurableLaunchAcceptanceRecord {
  occurrenceId: string;
  runId: string;
  targets: LaunchTargetProvenance[];
  acceptedAt: string;
}

const DEFAULT_LAUNCH_ACCEPT_TIMEOUT_MS = 420_000;
const ACCEPTED_RUNNING_PHASES = new Set(["instructions_submitted", "stuck"]);
const ACCEPTED_BLOCKED_PHASES = new Set(["human_action_required", "startup_failed"]);
const TERMINAL_ATTEMPT_PHASES = new Set(["completed", "completion_failed", "startup_failed", "human_action_required", "stuck", "released"]);
const ACCEPTED_TERMINAL_AGENT_STATUSES = new Set(["complete", "failed", "cancelled", "error"]);

export function startLaunch(launch: RoutedLaunchPlan, context: AdapterContext): LaunchAcceptanceReceipt | undefined {
  if (context.dryRun) return undefined;
  const targets = Array.from(new Set((launch.agentIds || []).filter(Boolean)));
  const acceptanceKey = routedLaunchAcceptanceKey(context.runJsonPath, targets, launch.env);
  const alreadyAccepted = durableLaunchReceipt(context.runJsonPath, targets, launch.env, { acceptanceKey });
  if (alreadyAccepted) {
    persistLaunchAcceptance(context.runJsonPath, acceptanceKey, launch.env, alreadyAccepted);
    return alreadyAccepted;
  }
  const inProgress = inProgressLaunchTarget(context.runJsonPath, targets, launch.env);
  if (inProgress) {
    throw new RoutedLaunchAcceptanceError("acceptance_pending", `${inProgress} has a bootstrap attempt still in progress`);
  }
  const baseline = launchAttemptBaseline(context.runJsonPath, targets, launch.env);

  const logPath = launch.logPath || join(dirname(context.runJsonPath), "launches.log");
  let logFd: number | undefined;
  try {
    logFd = openSync(logPath, "a");
  } catch {
    logFd = undefined;
  }
  const timeout = positiveInteger(launch.env.MENTIKO_LAUNCH_ACCEPT_TIMEOUT_MS, DEFAULT_LAUNCH_ACCEPT_TIMEOUT_MS);
  const executable = launch.cli
    ? process.execPath
    : "/bin/bash";
  const args = launch.cli
    ? [existsSync(launch.cli.compiledPath) ? launch.cli.compiledPath : launch.cli.developmentPath, ...launch.cli.args]
    : ["-lc", launch.command];
  const child = spawnSync(executable, args, {
    timeout,
    killSignal: "SIGTERM",
    stdio: logFd === undefined ? ["ignore", "ignore", "pipe"] : ["ignore", logFd, logFd],
    encoding: "utf8",
    env: {
      ...process.env,
      ...launch.env,
    },
  });
  if (logFd !== undefined) closeSync(logFd);
  const accepted = durableLaunchReceipt(context.runJsonPath, targets, launch.env, {
    acceptanceKey,
    baseline,
    allowNewTerminal: true,
  });
  if (accepted) {
    persistLaunchAcceptance(context.runJsonPath, acceptanceKey, launch.env, accepted);
    return accepted;
  }
  if (child.error) {
    const timedOut = (child.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
    throw new RoutedLaunchAcceptanceError(timedOut ? "timeout" : "spawn_error", child.error.message);
  }
  if (child.status !== 0) {
    throw new RoutedLaunchAcceptanceError(
      "nonzero_exit",
      `exit=${String(child.status)} signal=${String(child.signal)} stderr=${String(child.stderr || "").trim().slice(-500)}`,
    );
  }
  if (targets.length > 0) {
    throw new RoutedLaunchAcceptanceError("missing_durable_state", `targets=${targets.join(",")}`);
  }
  return { pid: child.pid };
}

function durableLaunchReceipt(
  runJsonPath: string,
  targetAgentIds: string[],
  env: Record<string, string | undefined>,
  options: {
    acceptanceKey?: string;
    baseline?: Map<string, string>;
    allowNewTerminal?: boolean;
  } = {},
): LaunchAcceptanceReceipt | undefined {
  if (targetAgentIds.length === 0) return undefined;
  let run: RunRecord;
  try {
    run = readRunJson(runJsonPath);
  } catch {
    return undefined;
  }
  const runId = env.MENTIKO_RUN_ID || env.RUN_ID || run.id;
  const attempts = readRunnerV2AttemptState(runJsonPath).attempts;
  const recorded = options.acceptanceKey
    ? readRoutedLaunchAcceptance(run, options.acceptanceKey)
    : undefined;
  let pid: number | undefined;
  const targets: LaunchTargetProvenance[] = [];
  for (const agentId of targetAgentIds) {
    const agent = (run.agents || []).find((candidate) => candidate.id === agentId);
    const attempt = [...attempts].reverse().find((candidate) => candidate.runId === runId && candidate.agentId === agentId);
    if (!agent || !attempt) return undefined;
    const session = typeof agent.session === "string" ? agent.session : "";
    const processSession = attempt.processEvidence?.ptySessionId || "";
    const exactSession = Boolean(session) && processSession === session;
    const runningAccepted = agent.status === "running"
      && exactSession
      && ACCEPTED_RUNNING_PHASES.has(attempt.phase);
    const blockedAccepted = agent.status === "blocked"
      && ACCEPTED_BLOCKED_PHASES.has(attempt.phase);
    const terminalAccepted = exactSession
      && ACCEPTED_TERMINAL_AGENT_STATUSES.has(agent.status)
      && TERMINAL_ATTEMPT_PHASES.has(attempt.phase);
    const recordedTarget = recorded?.targets.find((target) => target.agentId === agentId);
    const recordedAccepted = Boolean(recordedTarget)
      && recordedTarget?.attemptId === attempt.id
      && recordedTarget.session === session
      && (runningAccepted || blockedAccepted || terminalAccepted);
    const baselineChanged = options.baseline?.get(agentId) !== attemptFingerprint(attempt);
    const newlyTerminalAccepted = options.allowNewTerminal === true
      && baselineChanged
      && terminalAccepted;
    if (!recordedAccepted && !runningAccepted && !blockedAccepted && !newlyTerminalAccepted) return undefined;
    pid ??= attempt.processEvidence?.processPid;
    targets.push({ agentId, attemptId: attempt.id, session });
  }
  return { pid, targets };
}

function launchAttemptBaseline(
  runJsonPath: string,
  targetAgentIds: string[],
  env: Record<string, string | undefined>,
): Map<string, string> {
  const baseline = new Map<string, string>();
  let run: RunRecord;
  try {
    run = readRunJson(runJsonPath);
  } catch {
    return baseline;
  }
  const runId = env.MENTIKO_RUN_ID || env.RUN_ID || run.id;
  const attempts = readRunnerV2AttemptState(runJsonPath).attempts;
  for (const agentId of targetAgentIds) {
    const attempt = [...attempts].reverse().find((candidate) => candidate.runId === runId && candidate.agentId === agentId);
    if (attempt) baseline.set(agentId, attemptFingerprint(attempt));
  }
  return baseline;
}

function attemptFingerprint(attempt: AgentAttemptRecord): string {
  return createHash("sha256").update(stableSerialize(attempt)).digest("hex");
}

function routedLaunchAcceptanceKey(
  runJsonPath: string,
  targetAgentIds: string[],
  env: Record<string, string | undefined>,
): string | undefined {
  const occurrenceId = env.MENTIKO_COMPLETION_OCCURRENCE_ID;
  if (!occurrenceId || targetAgentIds.length === 0) return undefined;
  const runId = env.MENTIKO_RUN_ID || env.RUN_ID || readRunId(runJsonPath);
  const digest = createHash("sha256")
    .update(stableSerialize({ occurrenceId, runId, targetAgentIds: [...targetAgentIds].sort() }))
    .digest("hex")
    .slice(0, 24);
  return `routed-launch:${digest}:v1`;
}

function readRoutedLaunchAcceptance(run: RunRecord, key: string): DurableLaunchAcceptanceRecord | undefined {
  const runnerV2 = run.runnerV2 && typeof run.runnerV2 === "object"
    ? run.runnerV2 as Record<string, unknown>
    : undefined;
  const records = runnerV2?.launchAcceptances;
  if (!records || typeof records !== "object" || Array.isArray(records)) return undefined;
  const record = (records as Record<string, unknown>)[key];
  if (!record || typeof record !== "object" || Array.isArray(record)) return undefined;
  const parsed = record as Partial<DurableLaunchAcceptanceRecord>;
  if (!Array.isArray(parsed.targets)
    || !parsed.targets.every((target) => target
      && typeof target === "object"
      && typeof target.agentId === "string"
      && typeof target.attemptId === "string"
      && typeof target.session === "string")
    || typeof parsed.occurrenceId !== "string"
    || typeof parsed.runId !== "string") {
    return undefined;
  }
  return parsed as DurableLaunchAcceptanceRecord;
}

function persistLaunchAcceptance(
  runJsonPath: string,
  key: string | undefined,
  env: Record<string, string | undefined>,
  receipt: LaunchAcceptanceReceipt,
): void {
  if (!key || !receipt.targets || receipt.targets.length === 0) return;
  const targets = receipt.targets;
  updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${runJsonPath}`);
    const runnerV2 = current.runnerV2 && typeof current.runnerV2 === "object"
      ? current.runnerV2 as Record<string, unknown>
      : {};
    const existing = runnerV2.launchAcceptances && typeof runnerV2.launchAcceptances === "object" && !Array.isArray(runnerV2.launchAcceptances)
      ? runnerV2.launchAcceptances as Record<string, unknown>
      : {};
    const occurrenceId = env.MENTIKO_COMPLETION_OCCURRENCE_ID || "";
    const runId = env.MENTIKO_RUN_ID || env.RUN_ID || current.id;
    const expected = { occurrenceId, runId, targets };
    if (existing[key]) {
      const actual = existing[key] as Partial<DurableLaunchAcceptanceRecord>;
      if (actual.occurrenceId === expected.occurrenceId
        && actual.runId === expected.runId
        && stableSerialize(actual.targets) === stableSerialize(expected.targets)) {
        return current;
      }
      throw new Error(`conflicting routed launch acceptance receipt: ${key}`);
    }
    return {
      ...current,
      runnerV2: {
        ...runnerV2,
        launchAcceptances: {
          ...existing,
          [key]: {
            occurrenceId,
            runId,
            targets,
            acceptedAt: new Date().toISOString(),
          } satisfies DurableLaunchAcceptanceRecord,
        },
      },
    };
  });
}

function inProgressLaunchTarget(
  runJsonPath: string,
  targetAgentIds: string[],
  env: Record<string, string | undefined>,
): string | undefined {
  if (targetAgentIds.length === 0) return undefined;
  let run: RunRecord;
  try {
    run = readRunJson(runJsonPath);
  } catch {
    return undefined;
  }
  const runId = env.MENTIKO_RUN_ID || env.RUN_ID || run.id;
  const attempts = readRunnerV2AttemptState(runJsonPath).attempts;
  return targetAgentIds.find((agentId) => {
    const attempt = [...attempts].reverse().find((candidate) => candidate.runId === runId && candidate.agentId === agentId);
    return attempt && !TERMINAL_ATTEMPT_PHASES.has(attempt.phase);
  });
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function applyEventSideEffects(
  plan: EventSideEffectPlan,
  context: AdapterContext,
): void {
  if (!plan.triggeredPath) return;
  if (plan.triggeredPath !== plan.markProcessed.path) {
    throw new Error(`Invalid explicit triggered-event policy for ${plan.triggeredPath}.`);
  }

  if (!context.eventsDir) {
    throw new Error("event-side-effects requires the configured eventsDir.");
  }
  const expectedArchiveDir = join(resolve(context.eventsDir), "archive");
  if (context.eventsArchiveDir && resolve(context.eventsArchiveDir) !== expectedArchiveDir) {
    throw new Error(
      `eventsArchiveDir must equal the configured events archive: ${expectedArchiveDir}`,
    );
  }
  if (!plan.acceptedTrigger) {
    throw new Error("event-side-effects requires the accepted trigger fingerprint.");
  }

  consumeRunnerEvents({
    eventsDir: context.eventsDir,
    runId: plan.markProcessed.runId,
    source: plan.ownerAgentId || plan.markProcessed.source,
    sessionName: plan.ownerSessionName,
    triggered: plan.triggeredPath,
    expectedEvent: plan.markProcessed.event,
    allAgentIds: plan.allAgentIds,
    acceptedTrigger: plan.acceptedTrigger,
  });
}

const REPLAY_SENSITIVE_DIRECT_OPERATIONS = new Set<AdapterOperation["type"]>([
  "event",
  "schedule-mark",
  "hook",
  "session-policy",
  "rollback",
]);

function bindCompletionOperationIdentity(
  operation: AdapterOperation,
  context: AdapterContext,
): AdapterOperation {
  const occurrenceId = operation.occurrenceId || context.completionOccurrenceId;
  if (!occurrenceId) {
    if (REPLAY_SENSITIVE_DIRECT_OPERATIONS.has(operation.type)) {
      throw new Error(`${operation.type} requires a stable completion occurrence id`);
    }
    return operation;
  }
  if (operation.idempotencyKey) {
    return operation.occurrenceId ? operation : { ...operation, occurrenceId };
  }
  const { idempotencyKey: _idempotencyKey, occurrenceId: _occurrenceId, ...payload } = operation;
  const digest = createHash("sha256")
    .update(stableSerialize({ occurrenceId, operation: payload }))
    .digest("hex")
    .slice(0, 32);
  return {
    ...operation,
    occurrenceId,
    idempotencyKey: `runner-v2-completion-operation:${digest}:v1`,
  };
}

function applyOperation(operation: AdapterOperation, context: AdapterContext): Array<{ command: string; pid?: number }> {
  const boundOperation = bindCompletionOperationIdentity(operation, context);
  context.beforeOperation?.(boundOperation);
  if (boundOperation.type === "event") {
    emitTypedEvent(boundOperation, context);
  } else if (boundOperation.type === "schedule-mark") {
    markSchedule(boundOperation, context);
  } else if (boundOperation.type === "retry-state") {
    applyRetryState(boundOperation, context);
  } else if (boundOperation.type === "circuit-breaker" && boundOperation.action === "record-failure") {
    recordCircuitFailure(boundOperation, context);
  } else if (boundOperation.type === "hook") {
    dispatchWatchdogHooks(boundOperation, context);
  } else if (boundOperation.type === "session-policy") {
    auditSessionPolicy(boundOperation, context);
  } else if (boundOperation.type === "next-chain") {
    const launch = launchNextChain(boundOperation, context);
    return launch ? [launch] : [];
  } else if (isExternalQueuedOperation(boundOperation)) {
    queueExternalEffect(boundOperation, context);
  } else if (boundOperation.type === "rollback") {
    auditRollbackPlan(boundOperation, context);
  }
  return [];
}

function emitTypedEvent(
  operation: Extract<AdapterOperation, { type: "event" }>,
  context: AdapterContext,
): void {
  const runId = readRunId(context.runJsonPath);
  const eventsDir = context.eventsDir || config.eventsDir;
  const idempotencyKey = requiredOperationKey(operation);
  const occurrenceId = requiredOccurrenceId(operation);
  const receiptPath = join(context.stateDir, "completion-event-emissions.jsonl");
  withExclusiveFileClaim(`${receiptPath}.lock`, () => {
    if (hasAppliedOperationReceipt(receiptPath, idempotencyKey)) return;
    const recoveredPath = findEmittedEventByKey(eventsDir, idempotencyKey, {
      event: operation.event,
      source: operation.source,
      runId,
    });
    if (recoveredPath) {
      appendJsonl(receiptPath, {
        event: operation.event,
        source: operation.source,
        runId,
        path: recoveredPath,
        idempotencyKey,
        occurrenceId,
        status: "recovered",
        timestamp: new Date().toISOString(),
      });
      return;
    }
    const emitted = emitRunnerEvent({
      event: operation.event,
      source: operation.source,
      runId,
      scope: "run",
      filenameMode: "canonical",
      eventsDir,
      data: operation.data,
      idempotencyKey,
      occurrenceId,
    });
    appendJsonl(receiptPath, {
      event: operation.event,
      source: operation.source,
      runId,
      path: emitted.path,
      idempotencyKey,
      occurrenceId,
      status: "emitted",
      timestamp: new Date().toISOString(),
    });
  });
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
  const idempotencyKey = requiredOperationKey(operation);
  const occurrenceId = requiredOccurrenceId(operation);
  mkdirSync(schedulesDir, { recursive: true });
  withExclusiveFileClaim(`${statePath}.lock`, () => {
    const history = readOptionalFile(historyPath);
    const priorTimestamp = scheduleHistoryTimestamp(history, idempotencyKey);
    const timestamp = priorTimestamp || new Date(nowSeconds * 1000).toISOString();
    if (!priorTimestamp) {
      writeFileAtomic(historyPath, `${history}${JSON.stringify({
        timestamp,
        status: operation.status,
        scheduleId,
        idempotencyKey,
        occurrenceId,
      })}\n`);
    }
    const state = readJsonObject(statePath);
    const appliedSeconds = Math.floor(new Date(timestamp).getTime() / 1000);
    const currentSeconds = typeof state[scheduleId] === "number" ? state[scheduleId] as number : undefined;
    if (currentSeconds === undefined || !Number.isFinite(currentSeconds) || currentSeconds < appliedSeconds) {
      state[scheduleId] = appliedSeconds;
      writeJsonAtomic(statePath, state);
    }
  });
}

function applyRetryState(
  operation: Extract<AdapterOperation, { type: "retry-state" }>,
  context: AdapterContext,
): void {
  if (operation.action === "clear") {
    if (typeof operation.attempt === "number") {
      writeRetryState(operation.agentId, operation.attempt, context, "exhausted");
    } else {
      clearRetryState(operation.agentId, context);
    }
  } else if (operation.action === "set" && typeof operation.attempt === "number") {
    writeRetryState(operation.agentId, operation.attempt, context, "active");
  }
}

function clearRetryState(agentId: string, context: AdapterContext): void {
  const retryPath = typedRetryStatePath(agentId, context);
  if (existsSync(retryPath)) {
    unlinkSync(retryPath);
  }
}

function writeRetryState(
  agentId: string,
  attempt: number,
  context: AdapterContext,
  status: "active" | "exhausted",
): void {
  const dir = retryDir(context);
  mkdirSync(dir, { recursive: true });
  const runId = readRunId(context.runJsonPath);
  if (!runId) throw new Error(`cannot persist typed retry state without run id: ${context.runJsonPath}`);
  writeJsonAtomic(typedRetryStatePath(agentId, context), {
    version: 1,
    runId,
    agentId,
    attempt: Math.max(0, Math.floor(attempt)),
    status,
  });
}

export function readTypedRetryAttempt(agentId: string, context: AdapterContext): number | undefined {
  const runId = readRunId(context.runJsonPath);
  if (!runId) throw new Error(`cannot hydrate typed retry state without run id: ${context.runJsonPath}`);
  const dir = retryDir(context);
  const legacyPath = join(dir, `retry_${sanitizeFilePart(agentId)}.count`);
  if (existsSync(legacyPath)) {
    throw new Error(`ambiguous unscoped retry state for run ${runId} agent ${agentId}: ${legacyPath}`);
  }
  const path = typedRetryStatePath(agentId, context);
  if (!existsSync(path)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`corrupt typed retry state for run ${runId} agent ${agentId}: ${path}`, { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`corrupt typed retry state for run ${runId} agent ${agentId}: ${path}`);
  }
  const record = parsed as { version?: unknown; runId?: unknown; agentId?: unknown; attempt?: unknown; status?: unknown };
  if (record.version !== 1
    || record.runId !== runId
    || record.agentId !== agentId
    || !Number.isInteger(record.attempt)
    || (record.attempt as number) < 0
    || (record.status !== "active" && record.status !== "exhausted")) {
    throw new Error(`mismatched typed retry state for run ${runId} agent ${agentId}: ${path}`);
  }
  return record.attempt as number;
}

function typedRetryStatePath(agentId: string, context: AdapterContext): string {
  const runId = readRunId(context.runJsonPath);
  if (!runId) throw new Error(`cannot resolve typed retry state without run id: ${context.runJsonPath}`);
  return join(retryDir(context), `retry_${sanitizeFilePart(runId)}_${sanitizeFilePart(agentId)}.json`);
}

export function recordCircuitFailure(
  operation: Extract<AdapterOperation, { type: "circuit-breaker" }>,
  context: AdapterContext,
): void {
  if (!operation.chainName) throw new Error("circuit breaker chain identity must not be empty");
  if (!operation.agentId) throw new Error("circuit breaker agent identity must not be empty");
  const dir = retryDir(context);
  mkdirSync(dir, { recursive: true });
  const path = circuitStatePath(dir, operation.chainName, operation.agentId);
  withExclusiveFileClaim(`${path}.lock`, () => {
    const current = readCircuitState(path, operation.chainName, operation.agentId);
    const appliedFailureIds = Array.isArray(current.applied_failure_ids)
      ? current.applied_failure_ids.filter((value): value is string => typeof value === "string")
      : [];
    if (operation.failureId && appliedFailureIds.includes(operation.failureId)) return;
    const failureCount = Number(current.failure_count || 0) + 1;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const opened = failureCount >= operation.threshold;
    writeJsonAtomic(path, {
      version: 1,
      chain_name: operation.chainName,
      agent_id: operation.agentId,
      state: opened ? "open" : String(current.state || "closed"),
      failure_count: failureCount,
      last_failure: nowSeconds,
      open_until: opened ? nowSeconds + operation.timeout : 0,
      threshold: operation.threshold,
      timeout: operation.timeout,
      applied_failure_ids: operation.failureId
        ? [...appliedFailureIds, operation.failureId]
        : appliedFailureIds,
    });
  });
}

function circuitStatePath(dir: string, chainName: string, agentId: string): string {
  const chainLabel = sanitizeFilePart(chainName).slice(0, 48);
  const agentLabel = sanitizeFilePart(agentId).slice(0, 48);
  const identityDigest = createHash("sha256")
    .update(stableSerialize({ chainName, agentId }))
    .digest("hex")
    .slice(0, 24);
  const root = resolve(dir);
  const path = resolve(root, `circuit_${chainLabel}_${agentLabel}_${identityDigest}.json`);
  if (dirname(path) !== root) {
    throw new Error(`circuit breaker path escaped retry root: ${path}`);
  }
  return path;
}

function readCircuitState(
  path: string,
  chainName: string,
  agentId: string,
): Record<string, unknown> {
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`corrupt circuit breaker state: ${path}`, { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`corrupt circuit breaker state: ${path}`);
  }
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1
    || record.chain_name !== chainName
    || record.agent_id !== agentId) {
    throw new Error(`mismatched circuit breaker identity for ${chainName}/${agentId}: ${path}`);
  }
  return record;
}

function dispatchWatchdogHooks(
  operation: Extract<AdapterOperation, { type: "hook" }>,
  context: AdapterContext,
): void {
  const hooksDir = context.hooksDir || join(context.stateDir, "watchdog-hooks");
  mkdirSync(hooksDir, { recursive: true });
  const dispatchPath = join(hooksDir, "dispatch.jsonl");
  const idempotencyKey = requiredOperationKey(operation);
  const occurrenceId = requiredOccurrenceId(operation);
  withExclusiveFileClaim(`${dispatchPath}.lock`, () => {
    const records = readJsonlRecords(dispatchPath);
    if (records.some((record) => (
      record.idempotencyKey === idempotencyKey && record.status === "dispatched"
    ))) return;

    const hooks = listExecutableHooks(hooksDir);
    const detailsRecord = {
      ...operation.details,
      idempotency_key: idempotencyKey,
      completion_occurrence_id: occurrenceId,
    };
    const details = JSON.stringify(detailsRecord);
    const attempt = records.filter((record) => record.idempotencyKey === idempotencyKey).length + 1;
    appendJsonl(dispatchPath, {
      event: operation.event,
      runId: operation.runId,
      hookCount: hooks.length,
      details: detailsRecord,
      idempotencyKey,
      occurrenceId,
      status: "dispatching",
      attempt,
      timestamp: new Date().toISOString(),
    });

    for (const hook of hooks) {
      const child = spawn("/bin/bash", [hook, operation.event, operation.runId, details], {
        detached: true,
        stdio: "ignore",
        env: {
          ...process.env,
          MENTIKO_IDEMPOTENCY_KEY: idempotencyKey,
          MENTIKO_COMPLETION_OCCURRENCE_ID: occurrenceId,
        },
      });
      child.unref();
    }

    appendJsonl(dispatchPath, {
      event: operation.event,
      runId: operation.runId,
      hookCount: hooks.length,
      details: detailsRecord,
      idempotencyKey,
      occurrenceId,
      status: "dispatched",
      attempt,
      semantics: "at-least-once-external",
      timestamp: new Date().toISOString(),
    });
  });
}

function auditSessionPolicy(
  operation: Extract<AdapterOperation, { type: "session-policy" }>,
  context: AdapterContext,
): void {
  const auditPath = join(context.stateDir, "session-policy.jsonl");
  const idempotencyKey = requiredOperationKey(operation);
  withExclusiveFileClaim(`${auditPath}.lock`, () => {
    if (hasAppliedOperationReceipt(auditPath, idempotencyKey)) return;
    appendJsonl(auditPath, {
      policy: operation.policy,
      sessions: operation.sessions || [],
      applied: false,
      reason: operation.policy === "stop"
        ? "typed completion cleanup is applied separately after the verdict"
        : "policy recorded for typed runner audit",
      idempotencyKey,
      occurrenceId: requiredOccurrenceId(operation),
      timestamp: new Date().toISOString(),
    });
  });
}

/**
 * Typed ownership of the predecessor handler's phase-4 session cleanup. Once
 * the typed entrypoint handles a completion, it must tear down the agent and monitor
 * itself. Left alive, the completed agent looks "stale" to the watchdog,
 * which nudges it back awake — a zombie agent doing unrequested work.
 * Uses remove (kill + delete) and verifies liveness. A failed cleanup is
 * durable diagnostic evidence so reconcile can retry it; it must never vanish
 * behind a swallowed best-effort error.
 */
export interface PtyCleanupResult {
  daemonName: string;
  removed: string[];
  failed: string[];
}

export function killAgentSessions(
  sessionName: string,
  options: { stateDir?: string; runId?: string; env?: RunnerV2Environment } = {},
): PtyCleanupResult {
  const removed: string[] = [];
  const failed: string[] = [];
  const transport = join(config.codeRoot, "bin", "p");
  const scopedEnv = runnerV2PtyEnv(options.env);
  for (const name of [`monitor-${sessionName}`, sessionName]) {
    try {
      spawnSync(transport, ["remove", name], {
        timeout: 5_000,
        stdio: "ignore",
        env: scopedEnv,
      });
      const alive = spawnSync(transport, ["alive", name], {
        timeout: 5_000,
        stdio: "ignore",
        env: scopedEnv,
      });
      if (alive.status !== 0) removed.push(name);
      else failed.push(name);
    } catch {
      failed.push(name);
    }
  }
  if (failed.length && options.stateDir) {
    appendJsonl(join(options.stateDir, "pty-cleanup.jsonl"), {
      event: "pty-cleanup-failed",
      runId: options.runId,
      sessionName,
      failed,
      retryable: true,
      timestamp: new Date().toISOString(),
    });
  }
  return { daemonName: scopedEnv.PTY_DAEMON || "", removed, failed };
}

function launchNextChain(
  operation: Extract<AdapterOperation, { type: "next-chain" }>,
  context: AdapterContext,
): { command: string; pid?: number } | undefined {
  const identity = resolveNextChainIdentity(operation.chainName, context);
  if (!identity) {
    appendJsonl(join(context.stateDir, "next-chain.jsonl"), {
      chainName: operation.chainName,
      parentRunId: operation.parentRunId,
      status: "missing",
      searched: searchedNextChainPaths(operation.chainName, context),
      timestamp: new Date().toISOString(),
    });
    return undefined;
  }

  const runsDir = context.runsDir || dirname(dirname(context.runJsonPath));
  const launcherPath = join(config.codeRoot, "lib", "runner-v2-next-chain.js");
  const launcherArgs = [identity.path, "--parent-run-id", operation.parentRunId, "--runs-dir", runsDir];
  const command = `node ${[launcherPath, ...launcherArgs].map(shellEscape).join(" ")}`;
  const ledgerPath = join(context.stateDir, "next-chain.jsonl");
  const claimPath = join(context.stateDir, "next-chain-claims", `${nextChainOperationKey(operation.parentRunId, identity)}.claim`);
  return withExclusiveFileClaim(claimPath, () => {
    const preflightChild = findAcceptedNextChainChild(runsDir, operation.parentRunId, identity);
    if (preflightChild) {
      recordNextChainAcceptanceOnce(ledgerPath, operation, identity, command, preflightChild, undefined, true);
      return { command };
    }

    // The compiled typed launcher owns child-run materialization and bootstrap.
    // Acceptance is the child run.json, not the process exit or an audit line,
    // so a crash after child creation is recoverable by the preflight above
    // without relaunch.
    let logFd: number | undefined;
    try {
      logFd = openSync(join(dirname(context.runJsonPath), "launches.log"), "a");
    } catch {
      logFd = undefined;
    }
    const nextChainEnv = { ...process.env };
    delete nextChainEnv.MENTIKO_RUN_ID;
    delete nextChainEnv.AGENT_CHAIN_RUN_ID;
    delete nextChainEnv.RUN_ID;
    delete nextChainEnv.MENTIKO_RUN_DIR;
    delete nextChainEnv.RUN_DIR;
    const child = spawnSync("node", [launcherPath, ...launcherArgs], {
      timeout: positiveInteger(process.env.MENTIKO_NEXT_CHAIN_ACCEPT_TIMEOUT_MS, DEFAULT_LAUNCH_ACCEPT_TIMEOUT_MS),
      killSignal: "SIGTERM",
      stdio: logFd === undefined ? "ignore" : ["ignore", logFd, logFd],
      env: {
        ...nextChainEnv,
      },
    });
    if (logFd !== undefined) closeSync(logFd);
    const acceptedChild = findAcceptedNextChainChild(runsDir, operation.parentRunId, identity);
    if (acceptedChild) {
      recordNextChainAcceptanceOnce(ledgerPath, operation, identity, command, acceptedChild, child.pid, false);
      return { command, pid: child.pid };
    }
    if (child.error) {
      throw new RoutedLaunchAcceptanceError(
        (child.error as NodeJS.ErrnoException).code === "ETIMEDOUT" ? "timeout" : "spawn_error",
        `next-chain ${operation.chainName}: ${child.error.message}`,
      );
    }
    if (child.status !== 0) {
      throw new RoutedLaunchAcceptanceError(
        "nonzero_exit",
        `next-chain ${operation.chainName}: exit=${String(child.status)} signal=${String(child.signal)}`,
      );
    }
    throw new RoutedLaunchAcceptanceError(
      "missing_durable_state",
      `next-chain ${operation.chainName}: no child run linked to parent ${operation.parentRunId}`,
    );
  });
}

interface NextChainIdentity {
  path: string;
  name: string;
  chainId?: string;
}

function resolveNextChainIdentity(chainName: string, context: AdapterContext): NextChainIdentity | undefined {
  const candidate = searchedNextChainPaths(chainName, context).find((path) => existsSync(path));
  if (!candidate) return undefined;
  const path = realpathSync(candidate);
  let parsed: { id?: unknown; name?: unknown } = {};
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as { id?: unknown; name?: unknown };
  } catch {
    // The typed launcher will report malformed chain content. Identity still
    // uses the resolved path and requested name for stable replay.
  }
  const name = typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : chainName;
  const chainId = typeof parsed.id === "string" && parsed.id.trim() ? parsed.id.trim() : undefined;
  return { path, name, chainId };
}

function nextChainOperationKey(parentRunId: string, identity: NextChainIdentity): string {
  return createHash("sha256")
    .update(stableSerialize({ parentRunId, path: identity.path, name: identity.name, chainId: identity.chainId }))
    .digest("hex")
    .slice(0, 24);
}

function findAcceptedNextChainChild(
  runsDir: string,
  parentRunId: string,
  identity: NextChainIdentity,
): RunRecord | undefined {
  if (!existsSync(runsDir)) return undefined;
  const matches: RunRecord[] = [];
  for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const runJsonPath = join(runsDir, entry.name, "run.json");
    if (!existsSync(runJsonPath)) continue;
    try {
      const run = readRunJson(runJsonPath);
      if (run.parent_run_id !== parentRunId || run.chain !== identity.name) continue;
      if (identity.chainId && run.chainId && run.chainId !== identity.chainId) continue;
      matches.push(run);
    } catch {
      // A malformed or partially published sibling is not durable acceptance.
    }
  }
  return matches.sort((left, right) => (
    String(left.started).localeCompare(String(right.started)) || left.id.localeCompare(right.id)
  ))[0];
}

function recordNextChainAcceptanceOnce(
  ledgerPath: string,
  operation: Extract<AdapterOperation, { type: "next-chain" }>,
  identity: NextChainIdentity,
  command: string,
  childRun: RunRecord,
  pid: number | undefined,
  recovered: boolean,
): void {
  const idempotencyKey = nextChainOperationKey(operation.parentRunId, identity);
  const alreadyRecorded = readOptionalFile(ledgerPath).split("\n").some((line) => {
    if (!line.trim()) return false;
    try {
      const record = JSON.parse(line) as { idempotencyKey?: unknown; status?: unknown; childRunId?: unknown };
      return record.idempotencyKey === idempotencyKey
        && record.status === "accepted"
        && record.childRunId === childRun.id;
    } catch {
      return false;
    }
  });
  if (alreadyRecorded) return;
  appendJsonl(ledgerPath, {
    idempotencyKey,
    chainName: operation.chainName,
    resolvedChainName: identity.name,
    ...(identity.chainId ? { chainId: identity.chainId } : {}),
    parentRunId: operation.parentRunId,
    childRunId: childRun.id,
    status: "accepted",
    chainPath: identity.path,
    command,
    ...(pid === undefined ? {} : { pid }),
    recovered,
    timestamp: new Date().toISOString(),
  });
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
  const idempotencyKey = operation.idempotencyKey || externalEffectOperationId(operation, context);
  enqueueExternalEffectsOnce(join(context.stateDir, "external-effects.jsonl"), [{
    idempotencyKey,
    operation: { ...operation, idempotencyKey },
    namespaceId: context.namespaceId,
    orgId: context.orgId,
    reason: "typed runner records external side effects for replay/dispatch audit",
  }]);
}

function externalEffectOperationId(operation: AdapterOperation, context: AdapterContext): string {
  const runId = readRunId(context.runJsonPath)
    || ("runId" in operation && typeof operation.runId === "string" ? operation.runId : "global");
  const digest = createHash("sha256")
    .update(stableSerialize(operation))
    .digest("hex")
    .slice(0, 24);
  return `runner-v2:${runId}:${operation.type}:${digest}:v1`;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => (
      `${JSON.stringify(key)}:${stableSerialize(record[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function auditRollbackPlan(
  operation: Extract<AdapterOperation, { type: "rollback" }>,
  context: AdapterContext,
): void {
  const auditPath = join(context.stateDir, "rollback-plan.jsonl");
  const idempotencyKey = requiredOperationKey(operation);
  withExclusiveFileClaim(`${auditPath}.lock`, () => {
    if (hasAppliedOperationReceipt(auditPath, idempotencyKey)) return;
    appendJsonl(auditPath, {
      agentId: operation.agentId,
      startSha: operation.startSha,
      action: operation.action,
      applied: false,
      reason: "destructive rollback requires explicit operator approval",
      idempotencyKey,
      occurrenceId: requiredOccurrenceId(operation),
      timestamp: new Date().toISOString(),
    });
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

function readJsonlRecords(path: string): Array<Record<string, unknown>> {
  const content = readOptionalFile(path);
  if (!content.trim()) return [];
  return content.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("record is not an object");
      }
      return parsed as Record<string, unknown>;
    } catch (error) {
      throw new Error(`corrupt JSONL receipt at ${path}:${index + 1}`, { cause: error });
    }
  });
}

function hasAppliedOperationReceipt(path: string, idempotencyKey: string): boolean {
  return readJsonlRecords(path).some((record) => record.idempotencyKey === idempotencyKey);
}

function findEmittedEventByKey(
  eventsDir: string,
  idempotencyKey: string,
  expected: { event: string; source: string; runId: string },
): string | undefined {
  for (const root of [eventsDir, join(eventsDir, "archive")]) {
    let filenames: string[];
    try {
      filenames = readdirSync(root);
    } catch {
      continue;
    }
    for (const filename of filenames) {
      if (!filename.endsWith(".event")) continue;
      const path = join(root, filename);
      try {
        const record = parseRunnerEvent(readFileSync(path, "utf8"));
        if (record.fields.idempotency_key === idempotencyKey
          && record.event === expected.event
          && record.source === expected.source
          && record.runId === expected.runId) {
          return path;
        }
      } catch {
        // Invalid or concurrently moved event files are not emission receipts.
      }
    }
  }
  return undefined;
}

function scheduleHistoryTimestamp(history: string, idempotencyKey: string): string | undefined {
  for (const [index, line] of history.split(/\r?\n/).entries()) {
    if (!line.trim() || !line.trimStart().startsWith("{")) continue;
    let record: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("record is not an object");
      }
      record = parsed as Record<string, unknown>;
    } catch (error) {
      throw new Error(`corrupt typed schedule history at line ${index + 1}`, { cause: error });
    }
    if (record.idempotencyKey !== idempotencyKey) continue;
    if (typeof record.timestamp !== "string" || !Number.isFinite(Date.parse(record.timestamp))) {
      throw new Error(`typed schedule history receipt ${idempotencyKey} has an invalid timestamp`);
    }
    return record.timestamp;
  }
  return undefined;
}

function requiredOperationKey(operation: AdapterOperation): string {
  if (!operation.idempotencyKey) {
    throw new Error(`${operation.type} requires a stable idempotency key`);
  }
  return operation.idempotencyKey;
}

function requiredOccurrenceId(operation: AdapterOperation): string {
  if (!operation.occurrenceId) {
    throw new Error(`${operation.type} requires a stable completion occurrence id`);
  }
  return operation.occurrenceId;
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
  if (effect.type === "terminal-failure") {
    return effect.plan.steps.map((step) => step as AdapterOperation);
  }
  if (effect.type === "agent-completion") {
    return effect.plan.steps.map((step) => step as AdapterOperation);
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
    return effect.plan.claim?.fanInAgent
      ? [{ type: "next-chain", chainName: effect.plan.claim.fanInAgent, parentRunId: effect.plan.group.runId || "" }]
      : [];
  }
  if (effect.type === "generation-import") {
    return [{ type: "generation-import", ...effect.plan }];
  }
  if (effect.type === "event-artifact") {
    return [{
      type: "event-artifact",
      runId: effect.plan.runId,
      status: "planned",
    }];
  }
  return [];
}
