import { spawnSync } from "child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { derivePtyDaemonName } from "@/lib/config";
import { runQualityGateEventArtifact } from "@/lib/event-artifacts/event-artifact-runner";
import { applyTypedExecutorPlan, killAgentSessions, type AdapterResult } from "@/lib/runner-v2/adapters";
import { adoptAgentAttemptForCompletion } from "@/lib/runner-v2/agent-attempt";
import { agentOwnsEvent } from "@/lib/runner-v2/completion";
import { runCompletionPipeline } from "@/lib/runner-v2/completion-pipeline";
import type { AgentLivenessInput } from "@/lib/runner-v2/completion-runner";
import { eventMatchesRunId, parseRunnerEvent, type RunnerEventRecord } from "@/lib/runner-v2/events";
import { buildTypedExecutorPlan, type TypedExecutorPlan } from "@/lib/runner-v2/executor";
import { captureHash, monitorStatePaths } from "@/lib/runner-v2/monitor-io";
import { readRunJson, updateRunAgent, updateRunJson, updateRunStatus, type RunAgentRecord, type RunRecord } from "@/lib/runner-v2/run-state";
import { evaluateQualityGate, type AgentSummary } from "@/lib/runner-v2/quality-gate";
import { loopStatePath, shellLoopStatePath } from "@/lib/runner-v2/loop-state";
import { readFanGroup } from "@/lib/runner-v2/fan-group-store";
import type { RoutingChain } from "@/lib/runner-v2/routing";

export interface RunnerV2CompletionEntrypointInput {
  sessionName: string;
  chainPath: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  dryRun?: boolean;
  now?: Date;
}

export interface RunnerV2CompletionEntrypointResult {
  status: "handled";
  runId: string;
  agentId: string;
  decision: string;
  plan: TypedExecutorPlan;
  adapter: AdapterResult;
  runJsonPath: string;
  eventsDir: string;
}

export function runRunnerV2CompletionEntrypoint(
  input: RunnerV2CompletionEntrypointInput,
): RunnerV2CompletionEntrypointResult {
  const env = input.env || process.env;
  const chain = readChain(input.chainPath);
  const runId = env.MENTIKO_RUN_ID || env.RUN_ID;
  if (!runId) {
    throw unsupported("missing MENTIKO_RUN_ID/RUN_ID");
  }

  const runDir = resolveRunDir(env, runId);
  const runJsonPath = join(runDir, "run.json");
  if (!existsSync(runJsonPath)) {
    throw unsupported(`run.json not found: ${runJsonPath}`);
  }

  const run = readRunJson(runJsonPath);
  const agent = resolveAgent(input.sessionName, chain, run);
  const stateDir = resolveStateDir(env, runDir);

  // Fan-out members must suppress normal routing: their completion is an input
  // to the durable fan-group counter, and only the claim winner launches fan-in.
  // Read both shell and typed stores so routed shell-started members can still
  // complete through this typed entrypoint.
  const fanGroupId = findLiveFanGroupMembership(stateDir, agent.id, runId);
  const fanGroup = fanGroupId ? readFanGroup(stateDir, fanGroupId) || undefined : undefined;

  const eventsDir = resolveEventsDir(env, input.chainPath);
  // env EVENTS_DIR and the per-run events dir can disagree across the
  // shell/typed topology; the completion verdict must see events wherever the
  // agent actually emitted them. Always include the project/namespace events
  // dir (dirname(chainPath)/events) — not only when EVENTS_DIR is unset — so a
  // slow agent whose event lands there is still matched. TASK-093 regressed
  // exactly here: the valid event lived only in the project dir while
  // EVENTS_DIR pointed elsewhere and runDir/events did not exist, so completion
  // depended entirely on EVENTS_DIR being correct. readEventsFromDirs dedups by
  // directory, so an EVENTS_DIR that already equals the project dir is a no-op.
  const projectEventsDir = join(dirname(input.chainPath), "events");
  const events = readEventsFromDirs([eventsDir, projectEventsDir, join(runDir, "events")]);
  const duplicate = alreadyCompletedVerdict({ run, agent, sessionName: input.sessionName, events, runId });
  if (duplicate) {
    return {
      status: "handled",
      runId,
      agentId: agent.id,
      decision: "already-completed",
      plan: {
        action: "already-completed",
        launches: [],
        effects: [],
      },
      adapter: {
        effectsApplied: [],
        operations: [],
        launchesStarted: [],
      },
      runJsonPath,
      eventsDir,
    };
  }
  const runJsonSnapshot = readFileSync(runJsonPath, "utf8");
  const eventSnapshots = snapshotEvents(events);
  const loopStateSnapshots = [
    snapshotOptionalFile(loopStatePath(runDir)),
    snapshotOptionalFile(shellLoopStatePath(runDir)),
  ];

  // routed/relaunched agents (launched by shell chain-runner.sh, including
  // launches the typed bridge itself fired) have no AgentAttempt record —
  // only the typed bootstrap creates them. Adopt one now so this completion
  // produces the same typed lifecycle evidence as bootstrap-launched agents.
  // Placed after the snapshot: a dry run or an unsupported/failed pipeline
  // restores the snapshot, so the shell fallback never sees a half-typed record.
  adoptAgentAttemptForCompletion({
    runJsonPath,
    runId,
    agentId: agent.id,
    sessionName: input.sessionName,
    now: input.now,
  });

  const workspacePath = run.workspacePath || stringValue(chain.config?.project_root);
  const completionChainId = resolveCompletionChainId(run, chain);
  const completionChainName = chain.name || completionChainId || "unknown";
  const maxRounds = numberValue(chain.config?.max_rounds);
  const liveness = resolveCompletionLiveness({
    sessionName: input.sessionName,
    env,
    run,
    agentId: agent.id,
  });
  const qualityGate = maybeHandleQualityGateFailure({
    run,
    runDir,
    runJsonPath,
    agent,
    chain,
    namespaceId: env.NAMESPACE_ID || "default",
    orgId: env.ORG_ID || "default",
    now: input.now,
    dryRun: input.dryRun,
    });
  if (qualityGate) {
    if (input.dryRun) {
      restoreSnapshots(runJsonPath, runJsonSnapshot, eventSnapshots, loopStateSnapshots);
    } else {
      // shell phase-4 parity: the fallback handler never runs after a typed
      // verdict, so the bridge tears down the agent + monitor sessions itself
      killAgentSessions(input.sessionName);
    }
    return {
      status: "handled",
      runId,
      agentId: agent.id,
      decision: "quality-gate-failed",
      plan: {
        action: "fail",
        launches: [],
        effects: [],
      },
      adapter: {
        effectsApplied: ["event-artifact", "run-terminal"],
        operations: [{
          type: "event-artifact",
          runId,
          status: qualityGate.status,
          executionId: qualityGate.executionId,
          artifactPath: qualityGate.artifactPath,
        }],
        launchesStarted: [],
      },
      runJsonPath,
      eventsDir,
    };
  }

  try {
    const pipeline = runCompletionPipeline({
      runDir,
      runJsonPath,
      runId,
      agent,
      chain,
      events,
      maxRounds,
      now: input.now,
      terminal: {
        runId,
        chainId: completionChainId,
        chainName: completionChainName,
        chainPath: input.chainPath,
        taskId: run.taskId,
        lastAgentId: agent.id,
      },
      generation: generationImportPlan(run, runDir, env),
      agentCompleteMarker: monitorCompletionLatchAccepted(env),
      fanGroup,
      liveness,
      retry: {
        policy: objectValue(agent.retry) || objectValue(chain.config?.retry),
        currentAttempt: numberValue(env.MENTIKO_RETRY_ATTEMPT || env.RETRY_ATTEMPT) || 0,
        chainId: completionChainId,
        chainPath: input.chainPath,
        workspacePath,
        taskId: run.taskId,
        startSha: stringValue(run.startSha),
        debug: env.DEBUG === "1" || env.MENTIKO_DEBUG === "1",
      },
    });
    if (pipeline.decision.action === "await-liveness") {
      if (!input.dryRun) {
        recordCompletionLivenessExtension({
          runJsonPath,
          agentId: agent.id,
          decision: pipeline.decision.liveness,
          now: input.now,
        });
      }
    } else if (liveness && !input.dryRun) {
      clearCompletionLivenessExtension(runJsonPath, agent.id);
    }

    const plan = buildTypedExecutorPlan({
      pipeline,
      allEvents: events,
      allAgentIds: chain.agents.map((candidate) => candidate.id),
      terminal: {
        runId,
        chainId: completionChainId,
        chainName: completionChainName,
        chainPath: input.chainPath,
        taskId: run.taskId,
        lastAgentId: agent.id,
      },
      agentCompletion: {
        runId,
        chainName: completionChainName,
        agentId: agent.id,
        agentName: agent.name,
        sessionName: input.sessionName,
        chainWebhooks: parseChainWebhooks(chain.config?.webhooks),
      },
      routeContext: {
        chainPath: input.chainPath,
        workspacePath,
        taskId: run.taskId,
        runDir,
        env: {
          MENTIKO_RUN_ID: runId,
          RUN_ID: runId,
          NAMESPACE_ID: env.NAMESPACE_ID,
          ORG_ID: env.ORG_ID,
          WORKSPACE_TYPE: env.WORKSPACE_TYPE,
          MENTIKO_RUNNER_V2: env.MENTIKO_RUNNER_V2,
          MENTIKO_RUNNER_V2_COMPLETION: env.MENTIKO_RUNNER_V2_COMPLETION,
        },
      },
    });

    const adapter = applyTypedExecutorPlan(plan, {
      runJsonPath,
      stateDir,
      namespaceId: env.NAMESPACE_ID || "default",
      orgId: env.ORG_ID || "default",
      eventsDir,
      eventsArchiveDir: join(eventsDir, "archive"),
      dryRun: input.dryRun,
    });

    if (input.dryRun) {
      restoreSnapshots(runJsonPath, runJsonSnapshot, eventSnapshots, loopStateSnapshots);
    } else if (pipeline.decision.action !== "await-liveness") {
      // shell phase-4 parity: the fallback handler never runs after a typed
      // verdict, so the bridge tears down the agent + monitor sessions itself.
      // Runs for every handled verdict — v1 kills sessions unconditionally in
      // phase 4 before its routing decisions; relaunches use fresh sessions.
      killAgentSessions(input.sessionName);
    }

    return {
      status: "handled",
      runId,
      agentId: agent.id,
      decision: pipeline.decision.action,
      plan,
      adapter,
      runJsonPath,
      eventsDir,
    };
  } catch (error) {
    restoreSnapshots(runJsonPath, runJsonSnapshot, eventSnapshots, loopStateSnapshots);
    throw error;
  }
}

function alreadyCompletedVerdict(input: {
  run: RunRecord;
  agent: ChainAgent;
  sessionName: string;
  events: RunnerEventRecord[];
  runId: string;
}): boolean {
  const runAgent = (input.run.agents || []).find((candidate) => candidate.id === input.agent.id);
  if (!runAgent || !["complete", "completed"].includes(runAgent.status || "")) return false;
  const emitted = input.agent.emits;
  if (!emitted) return false;
  return input.events.some((event) => (
    event.processed
    && event.event === emitted
    && eventMatchesRunId(event, input.runId)
    // canonical event source is the AGENT ID, not the session name -- a bare
    // (!event.source || event.source === sessionName) guard missed the common
    // "source: <agent id>" shape and let an already-completed agent be
    // re-routed/retried/failed. agentOwnsEvent checks exact identity against
    // the agent id, its declared session prefix, and the session name.
    && agentOwnsEvent(event, input.agent, input.sessionName)
  ));
}

function maybeHandleQualityGateFailure(input: {
  run: RunRecord;
  runDir: string;
  runJsonPath: string;
  agent: ChainAgent;
  chain: ChainFile;
  namespaceId: string;
  orgId: string;
  now?: Date;
  dryRun?: boolean;
}) {
  const artifactsDir = join(input.runDir, "artifacts");
  const summaryPath = join(artifactsDir, `${input.agent.id}-summary.json`);
  const summary = readJsonObject(summaryPath) as AgentSummary | undefined;
  const result = evaluateQualityGate({
    agent: {
      id: input.agent.id,
      name: input.agent.name,
      role: stringValue((input.agent as unknown as Record<string, unknown>).role),
    },
    summary,
  });
  if (result.passed) return null;

  const artifact: { status: string; executionId?: string; artifactPath?: string } = !input.dryRun ? runQualityGateEventArtifact({
    namespaceId: input.namespaceId,
    orgId: input.orgId,
    runId: input.run.id,
    runArtifactsDir: artifactsDir,
    now: input.now,
    payload: {
      event: {
        name: "quality_gate.failed",
        source: "runner-v2",
        timestamp: (input.now || new Date()).toISOString(),
      },
      namespace: { id: input.namespaceId },
      org: { id: input.orgId },
      run: {
        id: input.run.id,
        chainId: resolveCompletionChainId(input.run, input.chain),
        chainName: input.chain.name,
        status: "failed",
        artifactsDir,
      },
      ...(input.run.taskId ? {
        task: {
          id: input.run.taskId,
          title: input.run.taskId,
          status: "failed",
        },
      } : {}),
      qualityGate: {
        status: summary?.status?.toLowerCase() === "partial" ? "partial" : "failed",
        agentId: input.agent.id,
        reason: result.reason,
        summaryPath: existsSync(summaryPath) ? summaryPath : undefined,
        findings: boundedStringArray((summary as Record<string, unknown> | undefined)?.findings),
        risks: boundedStringArray((summary as Record<string, unknown> | undefined)?.risks),
        nextActions: boundedStringArray((summary as Record<string, unknown> | undefined)?.nextActions),
      },
      evidence: {
        changedFiles: [],
        liveSessions: [],
        artifacts: existsSync(summaryPath) ? [summaryPath] : [],
      },
    },
  }) : { status: "planned" as const };

  if (!input.dryRun) {
    updateRunAgent(input.runJsonPath, input.agent.id, "failed", input.now);
    updateRunStatus(input.runJsonPath, "failed", result.reason, input.now);
  }
  return artifact;
}

function generationImportPlan(
  run: RunRecord,
  runDir: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
) {
  const metadata = objectValue(run.metadata);
  const jobId = stringValue(metadata?.generationJobId) || stringValue(metadata?.jobId);
  const generationKind = stringValue(metadata?.generationKind);
  if (!jobId || !generationKind) return undefined;
  const artifactsDir = join(runDir, "artifacts");
  return {
    jobId,
    generationKind,
    runId: run.id,
    artifactsDir,
    namespaceId: env.NAMESPACE_ID,
    orgId: env.ORG_ID,
    webUrl: env.MENTIKO_WEB_URL,
    importablePayload: hasImportableGenerationPayload(artifactsDir),
  };
}

function hasImportableGenerationPayload(artifactsDir: string): boolean {
  if (!existsSync(artifactsDir)) return false;
  const canonical = join(artifactsDir, "generation-result.json");
  if (existsSync(canonical)) return true;
  return readdirSync(artifactsDir).some((file) =>
    file.endsWith("-generation-result.json") ||
    file.endsWith("-output.json") ||
    file.endsWith("-result.json") ||
    file.endsWith("-output.txt") ||
    file.endsWith("-conversations.json")
  );
}

export class RunnerV2CompletionUnsupportedError extends Error {
  readonly code = "RUNNER_V2_COMPLETION_UNSUPPORTED";
}

function unsupported(message: string): RunnerV2CompletionUnsupportedError {
  return new RunnerV2CompletionUnsupportedError(message);
}

interface ChainAgent {
  id: string;
  name?: string;
  emits?: string;
  triggers?: string[];
  session_prefix?: string;
  retry?: unknown;
}

interface ChainConfig {
  project_root?: unknown;
  max_rounds?: unknown;
  retry?: unknown;
  session_prefix?: unknown;
  webhooks?: unknown;
}

interface ChainFile extends RoutingChain {
  id?: string;
  name?: string;
  config?: ChainConfig;
  agents: ChainAgent[];
}

function readChain(path: string): ChainFile {
  if (!existsSync(path)) throw unsupported(`chain not found: ${path}`);
  const chain = JSON.parse(readFileSync(path, "utf8")) as ChainFile;
  if (!Array.isArray(chain.agents)) throw unsupported("chain agents missing");
  return chain;
}

function resolveRunDir(env: NodeJS.ProcessEnv | Record<string, string | undefined>, runId: string): string {
  if (env.MENTIKO_RUN_DIR) return env.MENTIKO_RUN_DIR;
  if (env.RUN_DIR) return env.RUN_DIR;
  if (env.RUNS_DIR) return join(env.RUNS_DIR, runId);
  throw unsupported("missing MENTIKO_RUN_DIR/RUN_DIR/RUNS_DIR");
}

function resolveEventsDir(env: NodeJS.ProcessEnv | Record<string, string | undefined>, chainPath: string): string {
  return env.EVENTS_DIR || join(dirname(chainPath), "events");
}

function resolveCompletionLiveness(input: {
  sessionName: string;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  run: RunRecord;
  agentId: string;
}): AgentLivenessInput | undefined {
  const sessionAlive = ptySessionAlive(input.sessionName, input.env);
  if (sessionAlive === undefined) return undefined;

  const maxExtensions = positiveIntValue(input.env.MENTIKO_RUNNER_V2_COMPLETION_MAX_EXTENSIONS, 6);
  const extensionCount = completionLivenessExtensionCount(input.run, input.agentId);
  if (!sessionAlive) {
    return { sessionAlive: false, extensionCount, maxExtensions };
  }

  const info = ptySessionInfo(input.sessionName, input.env);
  const processAlive = processIdAlive(numberValue(info?.childPid) || numberValue(info?.pid));
  const outputChanged = ptyOutputChangedSinceMonitorCheck(input.sessionName, input.env);

  return {
    sessionAlive: true,
    processAlive,
    outputChanged,
    extensionCount,
    maxExtensions,
  };
}

function ptySessionAlive(
  sessionName: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): boolean | undefined {
  const result = runPtyMgr(env, ["alive", sessionName]);
  if (!result) return undefined;
  if (result.status !== 0) return undefined;
  const out = result.stdout.trim().toLowerCase();
  if (out === "alive") return true;
  if (out === "dead") return false;
  return undefined;
}

function ptySessionInfo(
  sessionName: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Record<string, unknown> | undefined {
  const result = runPtyMgr(env, ["info", sessionName]);
  if (!result || result.status !== 0) return undefined;
  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    return objectValue(parsed);
  } catch {
    return undefined;
  }
}

function ptyOutputChangedSinceMonitorCheck(
  sessionName: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): boolean {
  const stateDir = env.MENTIKO_MONITOR_STATE_DIR;
  const statePath = monitorStatePaths(sessionName, stateDir).state;
  if (!existsSync(statePath)) return false;

  const previous = readFileSync(statePath, "utf8").trim();
  if (!previous) return false;

  const result = runPtyMgr(env, ["capture", sessionName, "20"]);
  if (!result || result.status !== 0) return false;
  return captureHash(result.stdout, 20) !== previous;
}

function runPtyMgr(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  args: string[],
): { status: number | null; stdout: string; stderr: string } | undefined {
  const daemonName = derivePtyDaemonName(
    env.MENTIKO_GLOBAL_ROOT || env.MENTIKO_ROOT || join(homedir(), ".mentiko"),
    env.NAMESPACE_ID || "default",
    env.ORG_ID || "default",
  );
  const result = spawnSync(resolvePtyMgrBin(env), args, {
    encoding: "utf8",
    timeout: positiveIntValue(env.MENTIKO_RUNNER_V2_PTY_PROBE_TIMEOUT_MS, 2_000),
    env: stringEnv({
      ...process.env,
      ...env,
      // Completion may be invoked by a monitor whose inherited env was
      // stripped or stale. Always probe the daemon derived from this run's
      // namespace/org; otherwise pty-mgr silently falls back to `default` and
      // reports the live agent session as missing.
      PTY_DAEMON: daemonName,
    }),
  });
  if (result.error) return undefined;
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function resolvePtyMgrBin(env: NodeJS.ProcessEnv | Record<string, string | undefined>): string {
  const explicit = env.PTY_MGR_BIN || env.MENTIKO_PTY_MGR_BIN;
  if (explicit) return explicit;
  const codeRoot = env.MENTIKO_CODE_ROOT || process.env.MENTIKO_CODE_ROOT;
  return codeRoot ? join(codeRoot, "bin", "pty-mgr") : "pty-mgr";
}

function positiveIntValue(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function stringEnv(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV || "test" };
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function processIdAlive(pid: number | undefined): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function completionLivenessExtensionCount(run: RunRecord, agentId: string): number {
  const runnerV2 = objectValue(run.runnerV2);
  const liveness = objectValue(runnerV2?.completionLiveness);
  const agent = objectValue(liveness?.[agentId]);
  return numberValue(agent?.extensions) || 0;
}

function recordCompletionLivenessExtension(input: {
  runJsonPath: string;
  agentId: string;
  decision: { disposition: string; reason: string };
  now?: Date;
}): RunRecord {
  return updateRunJson(input.runJsonPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${input.runJsonPath}`);
    const runnerV2 = objectValue(current.runnerV2) || {};
    const liveness = objectValue(runnerV2.completionLiveness) || {};
    const previous = objectValue(liveness[input.agentId]);
    return {
      ...current,
      runnerV2: {
        ...runnerV2,
        completionLiveness: {
          ...liveness,
          [input.agentId]: {
            extensions: (numberValue(previous?.extensions) || 0) + 1,
            disposition: input.decision.disposition,
            reason: input.decision.reason,
            checkedAt: (input.now || new Date()).toISOString(),
          },
        },
      },
    };
  });
}

function clearCompletionLivenessExtension(runJsonPath: string, agentId: string): RunRecord {
  return updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${runJsonPath}`);
    const runnerV2 = objectValue(current.runnerV2);
    const liveness = objectValue(runnerV2?.completionLiveness);
    if (!runnerV2 || !liveness || !(agentId in liveness)) return current;

    const nextLiveness = { ...liveness };
    delete nextLiveness[agentId];
    return {
      ...current,
      runnerV2: {
        ...runnerV2,
        completionLiveness: nextLiveness,
      },
    };
  });
}

function monitorCompletionLatchAccepted(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  const value = (env.MENTIKO_MONITOR_COMPLETION_LATCH || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "agent_complete";
}

function readJsonObject(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return objectValue(parsed);
  } catch {
    return undefined;
  }
}

function boundedStringArray(value: unknown, limit = 10): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => item.trim())
    .slice(0, limit);
}

function resolveStateDir(env: NodeJS.ProcessEnv | Record<string, string | undefined>, runDir: string): string {
  return env.STATE_DIR || join(runDir, "state");
}

function parseChainWebhooks(value: unknown): { enabled?: boolean; urls?: string[]; events?: string[] } | undefined {
  const raw = objectValue(value);
  if (!raw) return undefined;
  return {
    enabled: raw.enabled === true || raw.enabled === "true",
    urls: boundedStringArray(raw.urls, 20),
    events: boundedStringArray(raw.events, 20),
  };
}

/**
 * Mirror of the shell fallback membership resolution in
 * chain-runner-complete.sh: a live (status running) fan group whose member
 * list contains this agent, scoped to this run when both sides know the run
 * id. Reads both stores under <stateDir>/fan-groups: v1 .state key-value files
 * and typed .json files.
 */
function findLiveFanGroupMembership(stateDir: string, agentId: string, runId: string): string | undefined {
  const groupsDir = join(stateDir, "fan-groups");
  if (!existsSync(groupsDir)) return undefined;
  for (const file of readdirSync(groupsDir)) {
    const path = join(groupsDir, file);
    if (file.endsWith(".state")) {
      const content = readOptionalFile(path);
      if (!content) continue;
      const status = matchKeyValue(content, "status");
      if (status !== "running") continue;
      const groupRunId = matchKeyValue(content, "run_id");
      if (runId && groupRunId && groupRunId !== runId) continue;
      const members = (matchKeyValue(content, "fan_out_agents") || "").split(/\s+/).filter(Boolean);
      if (members.includes(agentId)) return file.slice(0, -".state".length);
    } else if (file.endsWith(".json")) {
      const group = readJsonObject(path);
      if (!group || group.status !== "running") continue;
      if (runId && typeof group.runId === "string" && group.runId && group.runId !== runId) continue;
      const members = Array.isArray(group.fanOutAgents) ? group.fanOutAgents : [];
      if (members.includes(agentId)) return file.slice(0, -".json".length);
    }
  }
  return undefined;
}

function matchKeyValue(content: string, key: string): string | undefined {
  const match = content.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  return match ? match[1].trim() : undefined;
}

function readOptionalFile(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function readEvents(eventsDir: string): RunnerEventRecord[] {
  if (!existsSync(eventsDir)) return [];
  return readdirSync(eventsDir)
    .filter((file) => file.endsWith(".event"))
    .map((file) => {
      const path = join(eventsDir, file);
      return { ...parseRunnerEvent(readFileSync(path, "utf8")), path };
    });
}

function readEventsFromDirs(eventsDirs: string[]): RunnerEventRecord[] {
  const seen = new Set<string>();
  const events: RunnerEventRecord[] = [];
  for (const dir of eventsDirs) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    events.push(...readEvents(dir));
  }
  return events;
}

function resolveAgent(sessionName: string, chain: ChainFile, run: RunRecord): ChainAgent {
  const runAgent = (run.agents || []).find((agent) => agent.session === sessionName);
  const agent = runAgent ? chain.agents.find((candidate) => candidate.id === runAgent.id) : undefined;
  if (agent) return normalizeAgent(agent, runAgent);

  const prefix = sessionPrefix(sessionName, chain);
  const byPrefix = chain.agents.find((candidate) => candidate.session_prefix === prefix)
    || chain.agents.find((candidate) => candidate.id === prefix)
    || chain.agents.find((candidate) => prefix.endsWith(candidate.id));
  if (byPrefix) return normalizeAgent(byPrefix);

  throw unsupported(`could not resolve agent for session: ${sessionName}`);
}

function normalizeAgent(agent: ChainAgent, runAgent?: RunAgentRecord): ChainAgent {
  return {
    ...agent,
    name: agent.name || runAgent?.name || agent.id,
  };
}

function sessionPrefix(sessionName: string, chain: ChainFile): string {
  let prefix = sessionName
    .replace(/-run-[0-9]+(-[0-9a-zA-Z]+)?$/, "")
    .replace(/-[0-9]{8}-[0-9]{4}$/, "");
  const chainPrefix = stringValue(chain.config?.session_prefix);
  if (chainPrefix && prefix.startsWith(`${chainPrefix}-`)) {
    prefix = prefix.slice(chainPrefix.length + 1);
  }
  return prefix;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function resolveCompletionChainId(run: RunRecord, chain: Pick<ChainFile, "id" | "name">): string | undefined {
  return stringValue(run.chainId)
    || stringValue(chain.id)
    || stringValue(chain.name)?.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function objectValue<T extends object = Record<string, unknown>>(value: unknown): T | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as T : undefined;
}

function snapshotEvents(events: RunnerEventRecord[]): Map<string, string> {
  const snapshots = new Map<string, string>();
  for (const event of events) {
    if (event.path && existsSync(event.path)) {
      snapshots.set(event.path, readFileSync(event.path, "utf8"));
    }
  }
  return snapshots;
}

interface OptionalFileSnapshot {
  path: string;
  existed: boolean;
  content?: string;
}

function snapshotOptionalFile(path: string): OptionalFileSnapshot {
  return existsSync(path)
    ? { path, existed: true, content: readFileSync(path, "utf8") }
    : { path, existed: false };
}

function restoreOptionalFile(snapshot: OptionalFileSnapshot): void {
  if (snapshot.existed) {
    writeFileSync(snapshot.path, snapshot.content || "");
  } else {
    rmSync(snapshot.path, { force: true });
  }
}

function restoreSnapshots(
  runJsonPath: string,
  runJsonSnapshot: string,
  eventSnapshots: Map<string, string>,
  loopStateSnapshots: OptionalFileSnapshot[],
): void {
  writeFileSync(runJsonPath, runJsonSnapshot);
  for (const [path, content] of eventSnapshots) {
    writeFileSync(path, content);
  }
  for (const snapshot of loopStateSnapshots) {
    restoreOptionalFile(snapshot);
  }
}
