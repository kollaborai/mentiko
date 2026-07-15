import { basename, dirname } from "node:path";
import { emitRunnerEvent } from "@/lib/runner-v2/event-emitter";
import { readRunJson, type RunRecord } from "@/lib/runner-v2/run-state";
import { writeRunSummaryArtifact, type RunSummary } from "@/lib/runner-v2/run-record-operations";

export interface RunTaskSyncContext {
  apiBase: string;
  authSecret?: string;
  namespaceId: string;
  orgId: string;
  eventsDir?: string;
  fetchImpl?: typeof fetch;
}

export interface RunTaskSyncResult {
  status: "updated" | "skipped";
  reason?: string;
  taskId?: string;
  runId: string;
  runStatus: string;
  outcome?: string;
  decisionRequired?: boolean;
  commentWritten?: boolean;
  taskReopened?: boolean;
  eventPath?: string;
  eventError?: string;
}

interface TaskSnapshot {
  status: string;
  metadata: Record<string, unknown>;
}

export async function syncLinkedTaskFromRun(
  runJsonPath: string,
  status: string,
  context: RunTaskSyncContext,
): Promise<RunTaskSyncResult> {
  if (!status.trim()) throw new Error("run task status must not be empty");
  const run = readExpectedRun(runJsonPath);
  if (!run.taskId) {
    return { status: "skipped", reason: "run has no linked task", runId: run.id, runStatus: status };
  }

  const task = await getTask(run.taskId, context);
  const generationKind = metadataString(run.metadata, "generationKind");
  if (generationKind) {
    const auditStatus = normalizedAuditStatus(status);
    const metadata = generationAuditMetadata(run, task.metadata, generationKind, auditStatus, terminalReason(run, status));
    if (!metadata) {
      return {
        status: "skipped",
        reason: `unsupported generation kind: ${generationKind}`,
        taskId: run.taskId,
        runId: run.id,
        runStatus: status,
      };
    }
    await patchTask(run.taskId, { metadata }, context);
    return { status: "updated", taskId: run.taskId, runId: run.id, runStatus: status };
  }

  const { run: summarizedRun, summary } = writeRunSummaryArtifact(runJsonPath);
  const completed = summarizedRun.completed || "running";
  const agents = summarizedRun.agents
    .map((agent) => `${agent.id || "unknown"}|${agent.status || "unknown"}`)
    .join(",");
  const artifacts = Array.isArray(summarizedRun.artifacts) ? summarizedRun.artifacts : [];
  const blockedReason = status === "blocked" ? terminalReason(summarizedRun, status) : undefined;
  const updatedMetadata = {
    ...task.metadata,
    last_run_status: status,
    last_run_id: summarizedRun.id,
    last_run_chain: summarizedRun.chain || "unknown",
    last_run_started: summarizedRun.started || "unknown",
    last_run_completed: completed,
    last_run_agents: agents,
    last_run_artifacts: artifacts,
    last_run_outcome: summary.outcome,
    last_run_decision_required: summary.decision_required,
    last_run_summary: summary,
    // A block is a terminal, non-retryable execution result. Keep its exact
    // producer-owned reason on the task so reconciliation and the UI never
    // need to infer it from a stale .state file or a lossy run summary.
    ...(blockedReason
      ? {
          last_run_error: blockedReason,
          last_run_blocked_reason: blockedReason,
        }
      : {}),
    ...(status !== "blocked" ? { last_run_blocked_reason: undefined } : {}),
  };
  const taskReopened = status === "completed" && task.status !== "open";
  await patchTask(run.taskId, {
    metadata: updatedMetadata,
    ...(taskReopened ? { status: "open" } : {}),
  }, context);

  const terminal = status === "completed" || status === "failed" || status === "stopped" || status === "blocked";
  if (terminal) {
    // Task comments are intentionally at-least-once. A retry after an ambiguous
    // HTTP response may append the same terminal note again; no task-comment
    // idempotency key exists in the current API contract.
    await addTaskComment(run.taskId, taskSummaryNote(summarizedRun, summary, status, agents, completed, blockedReason), context);
  }

  let eventPath: string | undefined;
  let eventError: string | undefined;
  try {
    eventPath = emitRunnerEvent({
      event: "task-status-updated",
      source: `run-${summarizedRun.id}`,
      runId: summarizedRun.id,
      scope: "run",
      filenameMode: "canonical",
      data: `task=${run.taskId} status=${status}`,
      eventsDir: context.eventsDir,
    }).path;
  } catch (error) {
    eventError = error instanceof Error ? error.message : String(error);
  }

  return {
    status: "updated",
    taskId: run.taskId,
    runId: run.id,
    runStatus: status,
    outcome: summary.outcome,
    decisionRequired: summary.decision_required,
    commentWritten: terminal,
    taskReopened,
    ...(eventPath ? { eventPath } : {}),
    ...(eventError ? { eventError } : {}),
  };
}

function readExpectedRun(runJsonPath: string): RunRecord {
  const run = readRunJson(runJsonPath);
  const expectedRunId = basename(dirname(runJsonPath));
  if (run.id !== expectedRunId) {
    throw new Error(`Run record id ${run.id} does not match directory ${expectedRunId}`);
  }
  return run;
}

async function getTask(taskId: string, context: RunTaskSyncContext): Promise<TaskSnapshot> {
  const body = await requestJson(taskUrl(context.apiBase, taskId), { method: "GET" }, context);
  const issue = recordValue(recordValue(body, "data"), "issue");
  return {
    status: typeof issue.status === "string" ? issue.status : "",
    metadata: isRecord(issue.metadata) ? issue.metadata : {},
  };
}

async function patchTask(
  taskId: string,
  body: Record<string, unknown>,
  context: RunTaskSyncContext,
): Promise<void> {
  await requestJson(taskUrl(context.apiBase, taskId), {
    method: "PATCH",
    body: JSON.stringify(body),
  }, context);
}

async function addTaskComment(taskId: string, text: string, context: RunTaskSyncContext): Promise<void> {
  await requestJson(`${taskUrl(context.apiBase, taskId)}/comments`, {
    method: "POST",
    body: JSON.stringify({ text, author: "chain-runner" }),
  }, context);
}

async function requestJson(
  url: string,
  init: RequestInit,
  context: RunTaskSyncContext,
): Promise<Record<string, unknown>> {
  const fetchImpl = context.fetchImpl || fetch;
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-namespace-id": context.namespaceId,
      "x-org-id": context.orgId,
      ...(context.authSecret ? { Authorization: `Bearer ${context.authSecret}` } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${init.method || "GET"} ${url} failed (${response.status}): ${text.slice(0, 300)}`);
  if (!text.trim()) return {};
  const value = JSON.parse(text) as unknown;
  if (!isRecord(value)) throw new Error(`${init.method || "GET"} ${url} returned a non-object JSON payload`);
  return value;
}

function generationAuditMetadata(
  run: RunRecord,
  current: Record<string, unknown>,
  generationKind: string,
  auditStatus: string,
  reason?: string,
): Record<string, unknown> | undefined {
  if (generationKind === "chain_recommendation") {
    return {
      ...current,
      analysis_status: auditStatus,
      recommendation_run_id: run.id,
      ...(run.chainId ? { recommendation_chain_id: run.chainId } : {}),
      ...(reason ? { analysis_error: reason } : {}),
    };
  }
  if (generationKind === "chain_generation") {
    return {
      ...current,
      generation_status: auditStatus,
      generated_chain_run_id: run.id,
      ...(run.chainId ? { generated_chain_source_chain_id: run.chainId } : {}),
      ...(reason ? { generation_error: reason } : {}),
    };
  }
  return undefined;
}

function normalizedAuditStatus(status: string): "complete" | "failed" | "running" {
  if (status === "completed" || status === "complete") return "complete";
  if (["blocked", "failed", "stopped", "cancelled", "error"].includes(status)) return "failed";
  return "running";
}

function taskSummaryNote(
  run: RunRecord,
  summary: RunSummary,
  status: string,
  agents: string,
  completed: string,
  blockedReason?: string,
): string {
  const artifacts = Array.isArray(run.artifacts) ? run.artifacts.length : 0;
  return [
    `Chain run ${run.id} ${status}.`,
    `Chain: ${run.chain || "unknown"}`,
    `Outcome: ${summary.outcome}`,
    `Decision required: ${summary.decision_required}`,
    `Started: ${run.started || "unknown"}`,
    `Completed: ${completed}`,
    `Agents: ${agents}`,
    `Artifacts: ${artifacts} files`,
    ...(blockedReason ? [`Blocked reason: ${blockedReason}`] : []),
  ].join("\n");
}

/**
 * The run record is authoritative for terminal cause. Agent state is only a
 * live overlay and must never be consulted to reconstruct a terminal task.
 */
function terminalReason(run: RunRecord, status: string): string | undefined {
  if (status !== "blocked") return undefined;
  if (typeof run.blockedReason === "string" && run.blockedReason.trim()) return run.blockedReason.trim();
  if (typeof run.status_message === "string" && run.status_message.trim()) return run.status_message.trim();
  const blockedAgent = run.agents.find((agent) => agent.status === "blocked");
  if (typeof blockedAgent?.lastMessage === "string" && blockedAgent.lastMessage.trim()) {
    return blockedAgent.lastMessage.trim();
  }
  return "runner-v2 blocked this run without a recorded reason";
}

function taskUrl(apiBase: string, taskId: string): string {
  return `${apiBase.replace(/\/$/, "")}/api/tasks/${encodeURIComponent(taskId)}`;
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string {
  const value = metadata?.[key];
  return typeof value === "string" ? value : "";
}

function recordValue(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const nested = value[key];
  if (!isRecord(nested)) throw new Error(`Task API response is missing object field ${key}`);
  return nested;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
