import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { runQualityGateEventArtifact } from "@/lib/event-artifacts/event-artifact-runner";
import { applyTypedExecutorPlan, type AdapterResult } from "@/lib/runner-v2/adapters";
import { adoptAgentAttemptForCompletion } from "@/lib/runner-v2/agent-attempt";
import { runCompletionPipeline } from "@/lib/runner-v2/completion-pipeline";
import { parseRunnerEvent, type RunnerEventRecord } from "@/lib/runner-v2/events";
import { buildTypedExecutorPlan, type TypedExecutorPlan } from "@/lib/runner-v2/executor";
import { readRunJson, updateRunAgent, updateRunStatus, type RunAgentRecord, type RunRecord } from "@/lib/runner-v2/run-state";
import { evaluateQualityGate, type AgentSummary } from "@/lib/runner-v2/quality-gate";
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

  // fan-out members must fall back to the shell handler: typed completion has
  // no fan-group accounting wired, so handling one here would skip the member
  // counter and the fan-in would never fire. The shell recovers membership
  // from the durable fan-group state files for exactly this reason
  // (chain-runner-complete.sh fallback membership resolution) — apply the same
  // evidence to route these completions to the runner that owns them.
  const fanGroupId = findLiveFanGroupMembership(stateDir, agent.id, runId);
  if (fanGroupId) {
    throw unsupported(`agent ${agent.id} is a member of live fan group ${fanGroupId}; typed fan-in accounting is not wired`);
  }

  const eventsDir = resolveEventsDir(env, input.chainPath);
  // env EVENTS_DIR and the per-run events dir can disagree across the
  // shell/typed topology; the completion verdict must see events wherever the
  // agent actually emitted them.
  const events = readEventsFromDirs([eventsDir, join(runDir, "events")]);
  const runJsonSnapshot = readFileSync(runJsonPath, "utf8");
  const eventSnapshots = snapshotEvents(events);

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
  const maxRounds = numberValue(chain.config?.max_rounds);
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
      restoreSnapshots(runJsonPath, runJsonSnapshot, eventSnapshots);
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
        chainName: chain.name || chain.id || "unknown",
        chainPath: input.chainPath,
        taskId: run.taskId,
        lastAgentId: agent.id,
      },
      generation: generationImportPlan(run, runDir, env),
      retry: {
        policy: objectValue(agent.retry) || objectValue(chain.config?.retry),
        currentAttempt: numberValue(env.MENTIKO_RETRY_ATTEMPT || env.RETRY_ATTEMPT) || 0,
        chainPath: input.chainPath,
        workspacePath,
        taskId: run.taskId,
        startSha: stringValue(run.startSha),
        debug: env.DEBUG === "1" || env.MENTIKO_DEBUG === "1",
      },
    });

    const plan = buildTypedExecutorPlan({
      pipeline,
      allEvents: events,
      terminal: {
        runId,
        chainName: chain.name || chain.id || "unknown",
        chainPath: input.chainPath,
        taskId: run.taskId,
        lastAgentId: agent.id,
      },
      agentCompletion: {
        runId,
        chainName: chain.name || chain.id || "unknown",
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
      restoreSnapshots(runJsonPath, runJsonSnapshot, eventSnapshots);
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
    restoreSnapshots(runJsonPath, runJsonSnapshot, eventSnapshots);
    throw error;
  }
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
        chainId: input.chain.id,
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

function restoreSnapshots(runJsonPath: string, runJsonSnapshot: string, eventSnapshots: Map<string, string>): void {
  writeFileSync(runJsonPath, runJsonSnapshot);
  for (const [path, content] of eventSnapshots) {
    writeFileSync(path, content);
  }
}
