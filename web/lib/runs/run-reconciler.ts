/**
 * run reconciler
 *
 * scans runs directory and marks orphaned runs as stopped.
 * a run is orphaned if status=running but none of its agent sessions are alive
 * in pty-manager. also fixes stale agent statuses on stopped runs.
 *
 * runs on server startup AND every 60s interval to catch state mismatches
 * from crashes, killed processes, or race conditions.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { isAbsolute, join } from "path";
import config from "../config";
import { writeLog } from "../system/system-logger";
import { getLiveSessions } from "../pty/pty-client";
import { taskGet, taskMergeMeta, taskUpdate } from "../tasks/task-store";
import { normalizeRunId } from "../auth/run-acl";
import { cleanTaskExecutionRunMetadata, isNonExecutionRun } from "./run-provenance";
import { hasLivePendingHandoff, pendingHandoffs } from "../runner-v2/handoff-liveness";
import { parseRunnerEvent } from "../runner-v2/events";
import { runnerEventIdentityMatches } from "../runner-v2/event-identity";
import type { RunStatusReason } from "./run-record";

interface ReconcilerContext {
  namespaceId: string;
  orgId: string;
  runsDir: string;
  eventsDir: string;
}

export interface ReconcileOptions {
  namespaceId?: string;
  orgId?: string;
  runsDir?: string;
  eventsDir?: string;
}

function resolveReconcilerContext(options: ReconcileOptions = {}): ReconcilerContext {
  return {
    namespaceId: options.namespaceId || config.namespaceId,
    orgId: options.orgId || config.orgId || "default",
    runsDir: options.runsDir || config.runsDir,
    eventsDir: options.eventsDir || config.eventsDir,
  };
}

function reconcilerLog(context: ReconcilerContext, msg: string, level: "info" | "warn" | "error" = "info") {
  console.log(`[reconciler] ${msg}`);
  writeLog(context.namespaceId, context.orgId, level, "reconciler", msg);
}

interface RunAgent {
  id: string;
  name: string;
  status: string;
  session?: string;
  started?: string;
  completed?: string;
  lastHeartbeat?: string;
  statusReason?: RunStatusReason;
}

interface RunJson {
  id?: string;
  status: string;
  started?: string;
  completed?: string;
  statusReason?: RunStatusReason;
  agents?: RunAgent[];
  artifacts?: Array<{
    agentId?: string;
    type?: string;
    path?: string;
    timestamp?: string;
  }>;
  taskId?: string;
  workspacePath?: string;
  [key: string]: unknown;
}

interface ChainAgent {
  id?: string;
  name?: string;
  role?: string;
  emits?: string | string[];
  session_prefix?: string;
}

interface EventRecord {
  file: string;
  event?: string;
  source?: string;
  runId: string;
  processed: boolean;
  mtimeMs: number;
}

function asTimeMs(value?: string): number | undefined {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readChainEmits(runDir: string): Map<string, string[]> {
  const chainFile = join(runDir, "chain.json");
  if (!existsSync(chainFile)) return new Map();

  try {
    const chain = JSON.parse(readFileSync(chainFile, "utf-8")) as { agents?: ChainAgent[] };
    const emitsByAgent = new Map<string, string[]>();
    for (const agent of chain.agents || []) {
      if (!agent.id || !agent.emits) continue;
      const emits = Array.isArray(agent.emits) ? agent.emits : [agent.emits];
      emitsByAgent.set(
        agent.id,
        emits
          .filter((event): event is string => typeof event === "string" && event.trim().length > 0)
          .map((event) => event.trim().toLowerCase())
      );
    }
    return emitsByAgent;
  } catch {
    return new Map();
  }
}

function parseEventRecord(eventsDir: string, file: string): EventRecord | null {
  const eventFile = join(eventsDir, file);
  if (!existsSync(eventFile)) return null;

  try {
    const event = parseRunnerEvent(readFileSync(eventFile, "utf-8"));

    return {
      file,
      event: event.event,
      source: event.source,
      runId: event.runId,
      processed: event.processed,
      mtimeMs: statSync(eventFile).mtimeMs,
    };
  } catch {
    return null;
  }
}

function readEventRecords(eventsDir: string): EventRecord[] {
  if (!existsSync(eventsDir)) return [];

  try {
    return readdirSync(eventsDir)
      .filter((file) => file.endsWith(".event"))
      .map((file) => parseEventRecord(eventsDir, file))
      .filter((record): record is EventRecord => Boolean(record));
  } catch {
    return [];
  }
}

function recoverCompletedAgentsFromEvents(
  context: ReconcilerContext,
  run: RunJson,
  runDir: string,
  runId: string,
): boolean {
  const agents = run.agents || [];
  if (agents.length === 0) return false;

  const emitsByAgent = readChainEmits(runDir);
  if (emitsByAgent.size === 0) return false;

  const events = readEventRecords(context.eventsDir);
  if (events.length === 0) return false;

  let changed = false;
  for (const agent of agents) {
    if (!["running", "stopped"].includes(agent.status)) continue;
    if (!agent.session && !agent.started) continue;

    const expectedEvents = emitsByAgent.get(agent.id);
    if (!expectedEvents || expectedEvents.length === 0) continue;

    const notBefore = asTimeMs(agent.started || run.started);
    const notAfter = asTimeMs(run.completed);
    const sourceNeedle = agent.id.toLowerCase();
    const event = events.find((candidate) => {
      if (candidate.runId !== runId) return false;
      const eventName = candidate.event?.trim().toLowerCase();
      const source = candidate.source?.trim().toLowerCase() || "";
      if (!eventName || !expectedEvents.includes(eventName)) return false;
      if (!source.includes(sourceNeedle)) return false;
      if (notBefore && candidate.mtimeMs + 30_000 < notBefore) return false;
      if (notAfter && candidate.mtimeMs > notAfter + 300_000) return false;
      return true;
    });

    if (!event) continue;

    agent.status = "complete";
    agent.completed = new Date(event.mtimeMs).toISOString();
    changed = true;
    reconcilerLog(context, `recovered agent ${agent.id} from event ${event.file}`, "warn");
  }

  return changed;
}

function repairOutOfWindowCompletions(context: ReconcilerContext, run: RunJson): boolean {
  const runCompleted = asTimeMs(run.completed);
  if (!runCompleted) return false;

  let changed = false;
  for (const agent of run.agents || []) {
    if (agent.status !== "complete" || !agent.completed) continue;

    const agentCompleted = asTimeMs(agent.completed);
    if (!agentCompleted || agentCompleted <= runCompleted + 300_000) continue;

    agent.status = "stopped";
    delete agent.completed;
    changed = true;
    reconcilerLog(context, `repaired out-of-window completion for agent ${agent.id}`, "warn");
  }

  return changed;
}

function readChainAgents(runDir: string): ChainAgent[] {
  const chainFile = join(runDir, "chain.json");
  if (!existsSync(chainFile)) return [];

  try {
    const chain = JSON.parse(readFileSync(chainFile, "utf-8")) as { agents?: ChainAgent[] };
    return Array.isArray(chain.agents) ? chain.agents : [];
  } catch {
    return [];
  }
}

function allDeclaredAgentsComplete(run: RunJson, runDir: string): boolean {
  const declaredAgentIds = readChainAgents(runDir)
    .map((agent) => agent.id)
    .filter((id): id is string => Boolean(id));
  if (declaredAgentIds.length === 0) return false;

  const statusByAgentId = new Map(
    (run.agents || []).map((agent) => [agent.id, agent.status])
  );

  return declaredAgentIds.every(
    (agentId) => statusByAgentId.get(agentId) === "complete"
  );
}

function hasPendingCompletionWork(context: ReconcilerContext, run: RunJson, runDir: string, runId: string): boolean {
  const chainAgents = readChainAgents(runDir).filter((agent): agent is ChainAgent & { id: string } => Boolean(agent.id));
  const declaredAgentIds = new Set(chainAgents.map((agent) => agent.id));

  // A completion event can have been accepted before the routed launch starts.
  // Until the event is consumed, the declared flow has not reached its next
  // decision (and a loop-back target may still be waiting to run).
  const emitsByAgent = readChainEmits(runDir);
  const activeEvents = readEventRecords(context.eventsDir);
  if (activeEvents.some((event) => !event.processed && event.runId === runId && chainAgents.some((agent) => {
    const emits = emitsByAgent.get(agent.id) || [];
    return Boolean(event.event && event.source)
      && emits.includes(event.event!.trim().toLowerCase())
      && runnerEventIdentityMatches(event.source!, agent.id, agent.session_prefix, [...declaredAgentIds]);
  }))) {
    return true;
  }

  // A consumed event may already have queued its revisit. Keep the run stopped
  // until the durable handoff, launch job, and latest typed attempts have all
  // settled; agent summaries alone describe only the most recent status write.
  if (pendingHandoffs(run).length > 0) return true;
  const runnerV2 = objectValue(run.runnerV2);
  const launchJobs = objectValue(runnerV2?.launchJobs);
  if (launchJobs && Object.values(launchJobs).some((value) => {
    const job = objectValue(value);
    const targets = Array.isArray(job?.targets) ? job.targets : [];
    const targetsDeclaredAgent = targets.some((target) => {
      const record = objectValue(target);
      return typeof record?.agentId === "string" && declaredAgentIds.has(record.agentId);
    });
    return targetsDeclaredAgent && job?.status !== "completed";
  })) {
    return true;
  }

  const attempts = Array.isArray(runnerV2?.attempts) ? runnerV2.attempts : [];
  const latestAttemptByAgent = new Map<string, Record<string, unknown>>();
  for (const value of attempts) {
    const attempt = objectValue(value);
    if (!attempt || typeof attempt.agentId !== "string" || !declaredAgentIds.has(attempt.agentId)) continue;
    if (attempt.runId !== undefined && attempt.runId !== runId) continue;
    latestAttemptByAgent.set(attempt.agentId, attempt);
  }
  if ([...latestAttemptByAgent.values()].some((attempt) => attempt.phase !== "completed")) return true;

  // Require durable proof that each declared completion handoff was consumed.
  // Processed events move to the archive; an empty event directory is not proof
  // that every agent's flow reached its terminal decision.
  const completionEvents = [
    ...activeEvents,
    ...readEventRecords(join(context.eventsDir, "archive")),
  ];
  return chainAgents.some((agent) => {
    const emits = emitsByAgent.get(agent.id) || [];
    if (emits.length === 0) {
      const latestAttempt = latestAttemptByAgent.get(agent.id);
      return latestAttempt?.terminalReason !== "completed_empty_emits_last_agent";
    }
    return !completionEvents.some((event) => {
      const eventName = event.event?.trim().toLowerCase();
      return event.processed
        && event.runId === runId
        && Boolean(eventName && emits.includes(eventName))
        && Boolean(event.source && runnerEventIdentityMatches(event.source, agent.id, agent.session_prefix, [...declaredAgentIds]));
    });
  });
}

function latestAgentCompletion(run: RunJson): string | undefined {
  const latest = (run.agents || [])
    .filter((agent) => agent.status === "complete" && agent.completed)
    .map((agent) => new Date(agent.completed!).getTime())
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => b - a)[0];

  return latest ? new Date(latest).toISOString() : undefined;
}

function repairStoppedAllCompleteRun(context: ReconcilerContext, run: RunJson, runDir: string): boolean {
  if (run.status !== "stopped") return false;
  if (!allDeclaredAgentsComplete(run, runDir)) return false;
  if (hasPendingCompletionWork(context, run, runDir, run.id || "")) return false;

  run.status = "completed";
  run.completed = latestAgentCompletion(run) || run.completed || new Date().toISOString();
  reconcilerLog(context, `reclassified ${run.id || "run"} stopped all-complete run as completed`, "warn");
  return true;
}

function isQualityGateAgent(runDir: string, agentId?: string): boolean {
  if (!agentId) return false;

  const chainAgent = readChainAgents(runDir).find((agent) => agent.id === agentId);
  const descriptor = [
    agentId,
    chainAgent?.name,
    chainAgent?.role,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /(verifier|validator|validation|compliance|tester|reviewer|qa|coverage|quality|gate|auditor)/.test(descriptor);
}

function resolveRunArtifactPath(runDir: string, artifactPath?: string): string | undefined {
  if (!artifactPath) return undefined;
  return isAbsolute(artifactPath) ? artifactPath : join(runDir, artifactPath);
}

function repairFalsePartialQualityGateFailure(context: ReconcilerContext, run: RunJson, runDir: string): boolean {
  if (run.status !== "failed") return false;

  const qualityGateArtifacts = (run.artifacts || []).filter((artifact) => artifact.type === "quality-gate");
  for (const artifact of qualityGateArtifacts) {
    const artifactPath = resolveRunArtifactPath(runDir, artifact.path);
    if (!artifactPath || !existsSync(artifactPath)) continue;

    try {
      const gate = JSON.parse(readFileSync(artifactPath, "utf-8")) as {
        agentId?: string;
        reason?: string;
      };
      const agentId = gate.agentId || artifact.agentId;
      if (gate.reason !== "agent summary status is partial") continue;
      if (isQualityGateAgent(runDir, agentId)) continue;

      run.status = "stopped";
      run.completed = run.completed || new Date().toISOString();
      run.reconciledQualityGate = {
        at: new Date().toISOString(),
        reason: "partial summary from non-gate agent was incorrectly treated as fatal",
        originalStatus: "failed",
        agentId,
      };

      const failedAgent = (run.agents || []).find((agent) => agent.id === agentId && agent.status === "failed");
      if (failedAgent) {
        failedAgent.status = "complete";
        failedAgent.completed = failedAgent.completed || run.completed;
      }

      reconcilerLog(context, `reclassified ${run.id || "run"} false partial quality gate failure as stopped`, "warn");
      return true;
    } catch {
      continue;
    }
  }

  return false;
}

function shouldPropagateRunToTask(
  context: ReconcilerContext,
  run: RunJson,
  runId: string
): run is RunJson & { taskId: string } {
  if (!run.taskId) return false;
  if (isNonExecutionRun(run)) return false;

  try {
    const task = taskGet(context.orgId, run.taskId, context.namespaceId);
    const metadata = (task?.metadata || {}) as Record<string, unknown>;
    const currentRunId = typeof metadata.last_run_id === "string" ? metadata.last_run_id : undefined;
    return !currentRunId || currentRunId === runId;
  } catch {
    return false;
  }
}

function repairMisclassifiedNonExecutionRunTask(
  context: ReconcilerContext,
  run: RunJson,
  runId: string
): boolean {
  if (!run.taskId) return false;
  if (!isNonExecutionRun(run)) return false;

  try {
    const task = taskGet(context.orgId, run.taskId, context.namespaceId);
    const metadata = (task?.metadata || {}) as Record<string, unknown>;
    if (metadata.last_run_id !== runId) return false;

    const cleaned = cleanTaskExecutionRunMetadata(metadata, run, runId);
    taskUpdate(context.orgId, run.taskId, { metadata: cleaned }, context.namespaceId);
    reconcilerLog(context, `repaired non-execution run metadata on task ${run.taskId}: ${runId}`, "warn");
    return true;
  } catch {
    return false;
  }
}

export async function reconcileOrphanedRuns(options: ReconcileOptions = {}): Promise<{
  scanned: number;
  orphaned: number;
  cleaned: string[];
}> {
  const context = resolveReconcilerContext(options);
  const runsDir = context.runsDir;
  if (!existsSync(runsDir)) {
    return { scanned: 0, orphaned: 0, cleaned: [] };
  }

  let liveSessions: Set<string>;
  try {
    liveSessions = await getLiveSessions();
  } catch {
    // pty-manager not running yet - can't reconcile
    console.warn("[reconciler] pty-manager not available, skipping");
    return { scanned: 0, orphaned: 0, cleaned: [] };
  }

  const entries = readdirSync(runsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && normalizeRunId(d.name) !== null);

  const now = Date.now();
  let scanned = 0;
  let orphaned = 0;
  const cleaned: string[] = [];

  for (const entry of entries) {
    const runFile = join(runsDir, entry.name, "run.json");
    if (!existsSync(runFile)) continue;

    let run: RunJson;
    try {
      run = JSON.parse(readFileSync(runFile, "utf-8"));
    } catch {
      continue;
    }

    const agents = run.agents || [];
    const runId = entry.name;
    let changed = false;
    const runDir = join(runsDir, entry.name);

    if (repairMisclassifiedNonExecutionRunTask(context, run, runId)) {
      if (!cleaned.includes(runId)) cleaned.push(runId);
    }

    if (repairOutOfWindowCompletions(context, run)) {
      changed = true;
    }

    if (recoverCompletedAgentsFromEvents(context, run, runDir, runId)) {
      changed = true;
    }

    if (repairFalsePartialQualityGateFailure(context, run, runDir)) {
      changed = true;
    }

    if (repairStoppedAllCompleteRun(context, run, runDir)) {
      changed = true;
    }

    if (run.status === "running" || run.status === "pending") {
      scanned++;

      // grace period: don't touch recently resumed runs (2 min)
      // chain-runner needs time to create sessions after resume
      const resumedAt = run.resumedAt as string | undefined;
      if (resumedAt) {
        const resumeAge = now - new Date(resumedAt).getTime();
        if (resumeAge < 120_000) continue; // skip, still starting up
      }

      // check if any agent session is alive
      const hasLiveSession = agents.some(
        (a) => a.session && liveSessions.has(a.session)
      );

      if (hasLiveSession) continue; // run is alive
      if (hasLivePendingHandoff(run)) continue; // detached chain-runner is starting the next PTY

      if (allDeclaredAgentsComplete(run, runDir) && !hasPendingCompletionWork(context, run, runDir, runId)) {
        run.status = "completed";
        run.completed = latestAgentCompletion(run) || run.completed || new Date().toISOString();
        changed = true;
        reconcilerLog(context, `completed ${runId}: all declared agents are complete`, "warn");
      } else {
        // grace period: if any agent completed recently, typed completion
        // may be doing handoff (artifact capture + next agent launch).
        // don't mark as orphaned until 5 min after last agent completion.
        const lastCompletion = agents
          .filter((a) => a.status === "complete" && a.completed)
          .map((a) => new Date(a.completed!).getTime())
          .sort((a, b) => b - a)[0];

        if (lastCompletion && now - lastCompletion < 300_000) {
          reconcilerLog(context, `skipping ${runId}: agent completed ${Math.round((now - lastCompletion) / 1000)}s ago (handoff window)`);
          continue;
        }

        // grace period: don't kill young runs (2 min from start). Run IDs are
        // intentionally collision-resistant (`run-<millis>-<random>`), so the
        // ID is not a timestamp parser. Trust the durable run-start field or
        // this watchdog can stop a freshly queued run before its first PTY is
        // admitted.
        const runStartedAt = asTimeMs(run.started);
        if (!runStartedAt) {
          reconcilerLog(context, `skipping ${runId}: run has no valid started timestamp (startup age unknown)`, "warn");
          continue;
        }
        if (now - runStartedAt < 120_000) {
          reconcilerLog(context, `skipping ${runId}: run is ${Math.round((now - runStartedAt) / 1000)}s old (startup window)`);
          continue;
        }

        // no live sessions → orphaned run
        orphaned++;
        run.status = "stopped";
        run.completed = run.completed || new Date().toISOString();
        run.statusReason = { actor: "reaper", reason: "no live agent session found after startup/handoff grace windows" };
        changed = true;
      }
    }

    // fix stale agent statuses on ANY non-active run
    // (catches stopped runs with running/pending agents from crashes)
    if (run.status !== "running" && run.status !== "pending") {
      for (const agent of agents) {
        if (agent.status === "running") {
          // check if session is actually alive before marking stopped
          const sessionAlive = agent.session ? liveSessions.has(agent.session) : false;
          if (sessionAlive) continue;
          reconcilerLog(context, `fixing agent ${agent.id} in ${runId}: running -> stopped (session alive: ${sessionAlive}, session: ${agent.session || 'none'})`, "warn");
          agent.status = "stopped";
          agent.statusReason = { actor: "reaper", reason: "agent session was not alive when the run was reconciled" };
          changed = true;
        } else if (agent.status === "pending") {
          agent.status = "cancelled";
          agent.statusReason = { actor: "reaper", reason: "run reconciled as non-active while agent was still pending" };
          changed = true;
        }
      }
    }

    if (changed) {
      try {
        writeFileSync(runFile, JSON.stringify(run, null, 2));
        if (!cleaned.includes(runId)) cleaned.push(runId);
        reconcilerLog(context, `cleaned: ${runId} (status=${run.status})`, "warn");

        // propagate to linked task
        if (shouldPropagateRunToTask(context, run, runId)) {
          try {
            const agentSummary = (run.agents || [])
              .map((a) => `${a.id}|${a.status}`)
              .join(",");
            taskMergeMeta(context.orgId, run.taskId, {
              last_run_status: run.status,
              last_run_id: runId,
              last_run_completed: run.completed || new Date().toISOString(),
              last_run_agents: agentSummary,
            }, context.namespaceId);
          } catch { /* non-fatal */ }
        }
      } catch (err) {
        console.warn(`[reconciler] failed to clean ${runId}:`, err);
      }
    }
  }

  return { scanned, orphaned, cleaned };
}
