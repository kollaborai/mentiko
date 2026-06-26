import { createHash } from "crypto";
import { basename, join } from "path";
import {
  appendExecutionRecord,
  findExecutionByDedupeKey,
  resolveArtifactOutputPath,
  writeJsonArtifact,
  type EventArtifactExecutionStatus,
} from "@/lib/event-artifacts/event-artifact-ledger";
import type { QualityGateFailedPayload } from "@/lib/event-artifacts/event-payload";
import {
  evaluateMappingDedupeKey,
  getEnabledMappingsForEvent,
  readEventTemplateMappings,
} from "@/lib/event-artifacts/event-template-map";
import type { GeneratedTask } from "@/lib/tasks/generated-task-import";

export interface RunQualityGateEventArtifactInput {
  namespaceId: string;
  orgId: string;
  runId: string;
  runArtifactsDir: string;
  payload: QualityGateFailedPayload;
  now?: Date;
}

export interface RunQualityGateEventArtifactResult {
  status: EventArtifactExecutionStatus;
  executionId?: string;
  artifactPath?: string;
  draftTaskPath?: string;
}

export function runQualityGateEventArtifact(
  input: RunQualityGateEventArtifactInput,
): RunQualityGateEventArtifactResult {
  const mappings = getEnabledMappingsForEvent(
    readEventTemplateMappings(input.namespaceId, input.orgId),
    "quality_gate.failed",
  );
  const mapping = mappings[0];
  if (!mapping) return { status: "deduped" };

  const dedupeKey = evaluateMappingDedupeKey(mapping.dedupeKey, {
    namespaceId: input.namespaceId,
    orgId: input.orgId,
    taskId: input.payload.task?.id,
    runId: input.runId,
  });
  const existing = findExecutionByDedupeKey(input.runArtifactsDir, dedupeKey);
  if (existing && ["awaiting_review", "actions_applied", "blocked_on_children"].includes(existing.status)) {
    return {
      status: "deduped",
      executionId: existing.id,
      artifactPath: existing.artifactPath,
      draftTaskPath: existing.draftTaskPath,
    };
  }

  const now = (input.now || new Date()).toISOString();
  const executionId = executionIdForDedupeKey(dedupeKey);
  const artifactPath = resolveArtifactOutputPath(input.runArtifactsDir, mapping.outputArtifact);
  const draftTaskPath = resolveArtifactOutputPath(input.runArtifactsDir, "draft-child-tasks.json");
  const triage = buildTriageArtifact(input.payload, mapping.maxChildren);
  const draft = buildDraftTask(input.payload, mapping.maxChildren);

  appendExecutionRecord(input.runArtifactsDir, {
    id: executionId,
    mappingId: mapping.id,
    event: mapping.event,
    evaluatedDedupeKey: dedupeKey,
    status: "artifact_pending",
    ...(existing ? { retryOf: existing.id } : {}),
    createdAt: now,
    updatedAt: now,
  });

  writeJsonArtifact(artifactPath, triage);
  writeJsonArtifact(draftTaskPath, draft);

  appendExecutionRecord(input.runArtifactsDir, {
    id: executionId,
    mappingId: mapping.id,
    event: mapping.event,
    evaluatedDedupeKey: dedupeKey,
    status: "awaiting_review",
    artifactPath,
    draftTaskPath,
    actionResults: [{ type: "draft_tasks", count: 1 + (draft.subtasks?.length || 0) }],
    ...(existing ? { retryOf: existing.id } : {}),
    createdAt: now,
    updatedAt: now,
  });

  return {
    status: "awaiting_review",
    executionId,
    artifactPath,
    draftTaskPath,
  };
}

function executionIdForDedupeKey(dedupeKey: string): string {
  return `evt-${createHash("sha256").update(dedupeKey).digest("hex").slice(0, 24)}`;
}

function buildTriageArtifact(payload: QualityGateFailedPayload, maxChildren: number) {
  return {
    schema: "generated-tasks/v1",
    event: payload.event,
    run: {
      id: payload.run.id,
      status: payload.run.status,
      chainName: payload.run.chainName,
    },
    task: payload.task,
    qualityGate: payload.qualityGate,
    evidence: payload.evidence,
    generated: buildDraftTask(payload, maxChildren),
  };
}

function buildDraftTask(payload: QualityGateFailedPayload, maxChildren: number): GeneratedTask {
  const taskTitle = payload.task
    ? `${payload.task.id} ${payload.task.title}`.trim()
    : payload.run.chainName || payload.run.id;
  const nextActions = payload.qualityGate.nextActions.length
    ? payload.qualityGate.nextActions
    : ["Investigate the failed quality gate and repair the underlying issue."];
  return {
    title: `Fix quality gate failure for ${taskTitle}`,
    description: [
      `Run ${payload.run.id} failed quality gate handling.`,
      `Reason: ${payload.qualityGate.reason}`,
      payload.qualityGate.findings.length ? `Findings: ${payload.qualityGate.findings.join("; ")}` : "",
      payload.qualityGate.risks.length ? `Risks: ${payload.qualityGate.risks.join("; ")}` : "",
    ].filter(Boolean).join("\n"),
    type: "bug",
    priority: payload.task?.priority ?? 1,
    labels: ["quality-gate", "triage"],
    acceptance_criteria: [
      "Quality gate evidence is reviewed.",
      "Root cause is fixed or a follow-up task is documented.",
      `Run artifact ${basename(payload.run.artifactsDir)} remains auditable.`,
    ],
    subtasks: nextActions.slice(0, maxChildren).map((action, index) => ({
      title: action.length > 80 ? `${action.slice(0, 77)}...` : action,
      description: `Follow-up from ${payload.event.name} on run ${payload.run.id}.`,
      type: index === 0 ? "bug" : "task",
      priority: payload.task?.priority ?? 1,
      acceptance_criteria: "Complete this action and update the parent triage task.",
    })),
  };
}
