import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { basename } from "path";
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
// This boundary must reject drift before draft-child-tasks.json reaches disk.
import { assertValidGeneratedTask } from "@/lib/tasks/generated-task-validation";

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
  const context = buildFailureContext(input.payload);
  const draft = buildDraftTask(input.payload, mapping.maxChildren, context);
  assertValidGeneratedTask(draft);
  const triage = buildTriageArtifact(input.payload, draft);

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

interface FailureContext {
  title: string;
  descriptionLines: string[];
  findings: string[];
  risks: string[];
  nextActions: string[];
}

interface AgentSummaryArtifact {
  status?: string;
  executiveSummary?: string;
  findings?: string[];
  risks?: string[];
  nextAgentHints?: string[];
  workCompleted?: string[];
}

function buildTriageArtifact(payload: QualityGateFailedPayload, generated: GeneratedTask) {
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
    generated,
  };
}

function buildDraftTask(payload: QualityGateFailedPayload, maxChildren: number, context = buildFailureContext(payload)): GeneratedTask {
  return {
    title: context.title,
    description: context.descriptionLines.join("\n"),
    type: "epic",
    priority: payload.task?.priority ?? 1,
    labels: ["quality-gate", "triage"],
    acceptance_criteria: [
      "Quality gate evidence is reviewed.",
      "The validator summary findings are addressed or explicitly accepted.",
      `Run artifact ${basename(payload.run.artifactsDir)} remains auditable.`,
    ].join("\n"),
    subtasks: context.nextActions.slice(0, maxChildren).map((action, index) => ({
      title: action.length > 80 ? `${action.slice(0, 77)}...` : action,
      description: [
        `Follow-up from ${payload.event.name} on run ${payload.run.id}.`,
        context.findings.length ? `Evidence: ${context.findings.slice(0, 3).join("; ")}` : "",
      ].filter(Boolean).join("\n"),
      type: index === 0 ? "bug" : "task",
      priority: payload.task?.priority ?? 1,
      acceptance_criteria: "Complete this action and update the parent triage task.",
    })),
  };
}

function buildFailureContext(payload: QualityGateFailedPayload): FailureContext {
  const summary = readAgentSummary(payload);
  const taskLabel = payload.task
    ? `${payload.task.id} ${payload.task.title === payload.task.id ? "" : payload.task.title}`.trim()
    : payload.run.chainName || payload.run.id;
  const summaryFindings = boundedSummaryStrings(summary?.findings, 8);
  const summaryRisks = boundedSummaryStrings(summary?.risks, 6);
  const nextAgentHints = boundedSummaryStrings(summary?.nextAgentHints, 6);
  const findings = summaryFindings.length ? summaryFindings : payload.qualityGate.findings;
  const risks = summaryRisks.length ? summaryRisks : payload.qualityGate.risks;
  const nextActions = nextAgentHints.length
    ? nextAgentHints.map(actionFromHint)
    : payload.qualityGate.nextActions.length
      ? payload.qualityGate.nextActions
      : ["Investigate the failed quality gate and repair the underlying issue."];

  const specificTitle = buildSpecificTitle(payload, taskLabel, summary, findings);
  return {
    title: specificTitle,
    descriptionLines: [
      `Run ${payload.run.id} failed quality gate handling.`,
      `Reason: ${payload.qualityGate.reason}`,
      summary?.executiveSummary ? `Validator summary: ${summary.executiveSummary}` : "",
      findings.length ? `Findings: ${findings.join("; ")}` : "",
      risks.length ? `Risks: ${risks.join("; ")}` : "",
    ].filter(Boolean),
    findings,
    risks,
    nextActions,
  };
}

function buildSpecificTitle(
  payload: QualityGateFailedPayload,
  taskLabel: string,
  summary: AgentSummaryArtifact | null,
  findings: string[],
): string {
  const text = [
    summary?.executiveSummary || "",
    ...findings,
  ].join(" ").toLowerCase();

  const testCount = text.match(/(\d+)\s+fail(?:ing|ures|ed)?/i)?.[1];
  const scope = text.includes("stash") ? "stash api" : payload.qualityGate.agentId || "quality gate";
  const reason = text.includes("mock") ? "mock limitations" : "validator findings";

  if (testCount) {
    return `Fix ${testCount} failing ${scope} tests from ${reason} for ${taskLabel}`;
  }

  if (summary?.executiveSummary || findings.length) {
    return `Fix ${scope} ${reason} for ${taskLabel}`;
  }

  return `Fix quality gate failure for ${taskLabel}`;
}

function readAgentSummary(payload: QualityGateFailedPayload): AgentSummaryArtifact | null {
  const candidates = [
    payload.qualityGate.summaryPath,
    ...payload.qualityGate.findings
      .map((finding) => finding.match(/summary=([^;\s]+)/)?.[1])
      .filter((path): path is string => Boolean(path)),
  ];

  for (const path of candidates) {
    if (!path || !existsSync(path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as AgentSummaryArtifact;
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      continue;
    }
  }

  return null;
}

function boundedSummaryStrings(values: unknown, limit: number): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .map((value) => value.trim())
    .slice(0, limit);
}

function actionFromHint(hint: string): string {
  if (/mock git api|mock implementation|mock limitations/i.test(hint)) {
    return "Enhance the mock Git API so stash API edge cases pass validation.";
  }
  if (/permission/i.test(hint)) {
    return "Fix the mock permission model used by stash API tests.";
  }
  if (/concurrent/i.test(hint)) {
    return "Redesign the concurrent stash operation test for deterministic validation.";
  }
  return hint;
}
