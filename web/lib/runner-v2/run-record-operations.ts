import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  readRunJson,
  updateRunJson,
  type RunAgentRecord,
  type RunRecord,
} from "@/lib/runner-v2/run-state";

interface AgentSummary extends Record<string, unknown> {
  agentId: string;
  status?: string;
  executiveSummary?: string;
  findings?: unknown[];
  risks?: unknown[];
  nextAgentHints?: unknown[];
  workCompleted?: unknown[];
  _file: string;
}

export interface RunSummary extends Record<string, unknown> {
  run_id: string;
  chain: string;
  status: string;
  outcome: string;
  decision_required: boolean;
  recommendation: string;
  summary: string;
  agents: Array<Pick<RunAgentRecord, "id" | "name" | "status" | "session" | "started" | "completed">>;
  findings: string[];
  risks: string[];
  next_actions: string[];
  artifacts_count: number;
  generated_at: string;
}

interface RunArtifact extends Record<string, unknown> {
  type: string;
  timestamp?: string;
  agentId?: string;
}

function nowIso(now = new Date()): string {
  return now.toISOString();
}

function requireCurrent(current: RunRecord | undefined, runJsonPath: string): RunRecord {
  if (!current) throw new Error(`run.json not found: ${runJsonPath}`);
  return current;
}

function upsertAgent(
  agents: RunAgentRecord[],
  agentId: string,
  update: (agent: RunAgentRecord) => RunAgentRecord,
): RunAgentRecord[] {
  const index = agents.findIndex((agent) => agent.id === agentId);
  if (index < 0) {
    return [...agents, update({ id: agentId, name: agentId, session: "", status: "pending" })];
  }
  const next = [...agents];
  next[index] = update(next[index]);
  return next;
}

export function markRunAgentBlocked(
  runJsonPath: string,
  agentId: string,
  reason: string,
  now = new Date(),
): RunRecord {
  const timestamp = nowIso(now);
  return updateRunJson(runJsonPath, (value) => {
    const current = requireCurrent(value, runJsonPath);
    return {
      ...current,
      status: "blocked",
      blockedAt: current.blockedAt || timestamp,
      blockedReason: reason,
      agents: upsertAgent(current.agents, agentId, (agent) => ({
        ...agent,
        status: "blocked",
        lastHeartbeat: timestamp,
        lastMessage: reason,
      })),
    };
  });
}

export function markRunAgentFailed(
  runJsonPath: string,
  agentId: string,
  reason: string,
  now = new Date(),
): RunRecord {
  const timestamp = nowIso(now);
  return updateRunJson(runJsonPath, (value) => {
    const current = requireCurrent(value, runJsonPath);
    return {
      ...current,
      status: "failed",
      status_message: reason,
      completed: current.completed || timestamp,
      agents: upsertAgent(current.agents, agentId, (agent) => ({
        ...agent,
        status: "failed",
        completed: agent.completed || timestamp,
        lastHeartbeat: timestamp,
        lastMessage: reason,
      })),
    };
  });
}

export function updateRunActivityManifest(
  runJsonPath: string,
  agentId: string,
  diffLines: number,
  fileCount: number,
  now = new Date(),
): RunRecord {
  if (!Number.isSafeInteger(diffLines) || diffLines < 0) throw new Error("diff lines must be a non-negative integer");
  if (!Number.isSafeInteger(fileCount) || fileCount < 0) throw new Error("file count must be a non-negative integer");
  const timestamp = nowIso(now);
  return updateRunJson(runJsonPath, (value) => {
    const current = requireCurrent(value, runJsonPath);
    let artifacts = runArtifacts(current);
    const upsert = (artifact: RunArtifact) => {
      artifacts = artifacts.filter((item) =>
        !isRecord(item) || item.agentId !== agentId || item.type !== artifact.type);
      artifacts.push(artifact);
    };
    upsert({ agentId, type: "diff", diffLines, timestamp });
    upsert({ agentId, type: "conversations", timestamp });
    upsert({ agentId, type: "output", timestamp });
    if (fileCount > 0) upsert({ agentId, type: "files", fileCount, timestamp });
    return { ...current, artifacts };
  });
}

export function updateRunActivityManifestFromArtifacts(
  runJsonPath: string,
  agentId: string,
  now = new Date(),
): RunRecord {
  const artifactsDir = join(dirname(runJsonPath), "artifacts");
  const diffPath = join(artifactsDir, `${agentId}-diff.patch`);
  const changedPath = join(artifactsDir, `${agentId}-files-changed.json`);
  const diffLines = existsSync(diffPath)
    ? (readFileSync(diffPath, "utf8").match(/\n/g) || []).length
    : 0;
  let fileCount = 0;
  if (existsSync(changedPath)) {
    const changed = JSON.parse(readFileSync(changedPath, "utf8")) as unknown;
    if (!Array.isArray(changed)) throw new Error(`${changedPath} must contain a JSON array`);
    fileCount = changed.length;
  }
  return updateRunActivityManifest(runJsonPath, agentId, diffLines, fileCount, now);
}

export function startPeerRun(
  runJsonPath: string,
  firstSession: string,
  secondSession: string,
): RunRecord {
  return updateRunJson(runJsonPath, (value) => {
    const current = requireCurrent(value, runJsonPath);
    if (current.agents.length < 2) throw new Error("peer run requires at least two agents");
    const agents = [...current.agents];
    agents[0] = { ...agents[0], session: firstSession, status: "running" };
    agents[1] = { ...agents[1], session: secondSession, status: "running" };
    return {
      ...current,
      status: "running",
      completed: undefined,
      sessions: Array.from(new Set([...(current.sessions || []), firstSession, secondSession])),
      agents,
    };
  });
}

export function completePeerRun(
  runJsonPath: string,
  rounds: number,
  now = new Date(),
): RunRecord {
  if (!Number.isSafeInteger(rounds) || rounds < 0) throw new Error("rounds must be a non-negative integer");
  const timestamp = nowIso(now);
  return updateRunJson(runJsonPath, (value) => {
    const current = requireCurrent(value, runJsonPath);
    if (current.agents.length < 2) throw new Error("peer run requires at least two agents");
    const agents = [...current.agents];
    agents[0] = { ...agents[0], status: "complete", completed: agents[0].completed || timestamp };
    agents[1] = { ...agents[1], status: "complete", completed: agents[1].completed || timestamp };
    return { ...current, status: "completed", completed: timestamp, agents, rounds };
  });
}

export function buildRunSummaryFromFiles(
  runJsonPath: string,
  now = new Date(),
): RunSummary {
  const run = readRunJson(runJsonPath);
  const expectedRunId = basename(dirname(runJsonPath));
  if (run.id !== expectedRunId) {
    throw new Error(`Run record id ${run.id} does not match directory ${expectedRunId}`);
  }
  const artifactsDir = join(dirname(runJsonPath), "artifacts");
  const summaries = existsSync(artifactsDir)
    ? readdirSync(artifactsDir)
      .filter((name) => name.endsWith("-summary.json") && name !== "run-summary.json")
      .sort()
      .flatMap((name) => {
        const path = join(artifactsDir, name);
        try {
          const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
          if (!isRecord(value)) return [];
          return [{
            ...value,
            agentId: stringValue(value.agentId) || stringValue(value.agent_id) || basename(name, "-summary.json"),
            _file: path,
          } as AgentSummary];
        } catch {
          return [];
        }
      })
    : [];
  return buildRunSummary(run, summaries, now);
}

export function writeRunSummaryArtifact(
  runJsonPath: string,
  now = new Date(),
): { run: RunRecord; summary: RunSummary } {
  const summary = buildRunSummaryFromFiles(runJsonPath, now);
  const artifactPath = join(dirname(runJsonPath), "artifacts", "run-summary.json");
  mkdirSync(dirname(artifactPath), { recursive: true });
  const temporaryPath = `${artifactPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx" });
  renameSync(temporaryPath, artifactPath);
  const timestamp = nowIso(now);
  const run = updateRunJson(runJsonPath, (value) => {
    const current = requireCurrent(value, runJsonPath);
    const artifacts = runArtifacts(current)
      .filter((artifact) => !isRecord(artifact) || artifact.type !== "run-summary");
    artifacts.push({ type: "run-summary", path: artifactPath, timestamp });
    return { ...current, summary, artifacts };
  });
  return { run, summary };
}

export function buildRunSummary(
  run: RunRecord,
  summaries: AgentSummary[],
  now = new Date(),
): RunSummary {
  const ranks = new Map(run.agents.map((agent, index) => [agent.id, index]));
  const ordered = [...summaries].sort((left, right) =>
    (ranks.get(left.agentId) ?? -1) - (ranks.get(right.agentId) ?? -1));
  const latestFirst = [...ordered].reverse();
  const finalSummary = latestFirst[0];
  let outcome: string;
  if (summaries.some((summary) => statusFailed(summary) || explicit(summary, /(?:overall )?result:\s*fail/i))) {
    outcome = "fail";
  } else if (summaries.some((summary) =>
    stringValue(summary.status).toLowerCase() === "partial"
    || explicit(summary, /(?:overall )?result:\s*partial\s*-?\s*pass|partial\s*-?\s*pass/i))) {
    outcome = "partial_pass";
  } else if (summaries.some((summary) =>
    explicit(summary, /(?:overall )?result:\s*pass|pipeline passes|passes all/i))) {
    outcome = "pass";
  } else if (run.status === "completed") {
    outcome = summaries.some((summary) => {
      const status = stringValue(summary.status).toLowerCase();
      return status !== "" && status !== "unknown" && status !== "needs_review";
    }) ? "complete" : "needs_review";
  } else {
    outcome = run.status || "unknown";
  }

  const finalExecutiveSummary = ordered
    .map((summary) => summary.executiveSummary)
    .filter((value): value is string => typeof value === "string")
    .at(-1);
  const selected = outcome === "pass" ? (finalSummary ? [finalSummary] : []) : latestFirst;
  return {
    run_id: run.id,
    chain: run.chain,
    status: run.status,
    outcome,
    decision_required: ["partial_pass", "fail", "needs_review"].includes(outcome),
    recommendation: outcome === "partial_pass"
      ? "review_before_next_task"
      : outcome === "fail"
        ? "fix_or_rerun"
        : outcome === "pass" || outcome === "complete"
          ? "move_forward"
          : "inspect_run",
    summary: finalExecutiveSummary
      ?? (run.status === "completed"
        ? "Run completed (no agent verdict — inspect run)."
        : `Run status: ${run.status || "unknown"}`),
    agents: run.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      status: agent.status,
      session: agent.session,
      ...(agent.started ? { started: agent.started } : {}),
      ...(agent.completed ? { completed: agent.completed } : {}),
    })),
    findings: uniqueStrings(selected.flatMap((summary) => summary.findings || [])).slice(0, 8),
    risks: uniqueStrings(selected.flatMap((summary) => summary.risks || [])).slice(0, 8),
    next_actions: uniqueStrings(selected.flatMap((summary) => summary.nextAgentHints || [])).slice(0, 6),
    artifacts_count: runArtifacts(run).length,
    generated_at: nowIso(now),
  };
}

function runArtifacts(run: RunRecord): unknown[] {
  if (!Array.isArray(run.artifacts)) return [];
  return [...run.artifacts];
}

function statusFailed(summary: AgentSummary): boolean {
  return ["failed", "failure", "error", "blocked"].includes(stringValue(summary.status).toLowerCase());
}

function explicit(summary: AgentSummary, pattern: RegExp): boolean {
  const values = [
    summary.status,
    summary.executiveSummary,
    ...(summary.workCompleted || []),
    ...(summary.findings || []),
    ...(summary.risks || []),
    ...(summary.nextAgentHints || []),
  ];
  return pattern.test(values.map(String).join("\n"));
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(new Set(values.map(String)));
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
