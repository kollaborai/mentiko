import {
  createDecision,
  deleteDecision,
  getDecision,
  updateDecision,
} from "@/lib/decisions/decision-storage";
import { createHash } from "node:crypto";
import {
  taskClaimMetadataKeyIfUnset,
  taskCreate,
  taskDelete,
  taskGet,
  taskList,
  taskUpdate,
} from "@/lib/tasks/task-store";
import type { Decision } from "@/lib/decisions/decision-types";
import type { TaskRecord } from "@/lib/tasks/task-store-types";
import { buildDecisionPromptFromTaskPrompt } from "@/lib/tasks/task-decision-routing";

interface CreateTaskDecisionInput {
  namespaceId: string;
  orgId: string;
  prompt: string;
  source: string;
  workspacePath?: string;
  parentTaskId?: string;
  sourceRunId?: string;
  runFingerprint?: string;
  generationJobId?: string;
}

interface CreateTaskDecisionResult {
  decision: Decision;
  task: TaskRecord;
}

function titleFromDecisionPrompt(prompt: string): string {
  return buildDecisionPromptFromTaskPrompt(prompt).split("\n")[0];
}

function metadataRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stableGateClaimKey(input: CreateTaskDecisionInput): string | undefined {
  if (!input.parentTaskId || !input.sourceRunId || !input.runFingerprint) return undefined;
  const fingerprint = [input.source, input.sourceRunId, input.runFingerprint].join("\u0000");
  return `decision_gate_${createHash("sha256").update(fingerprint).digest("hex")}`;
}

async function findExistingStableDecisionGate(
  input: CreateTaskDecisionInput,
): Promise<CreateTaskDecisionResult | null> {
  if (input.generationJobId) {
    const task = taskList(input.orgId, { status: "all" }, undefined, input.namespaceId).find((candidate) => {
      if (candidate.issue_type !== "decision") return false;
      const metadata = metadataRecord(candidate.metadata);
      return metadata.task_generation_job_id === input.generationJobId
        && metadata.task_generation_role === "decision";
    });
    if (task) {
      const decisionId = metadataRecord(task.metadata).decision_id;
      if (typeof decisionId === "string") {
        const decision = getDecision(input.namespaceId, input.orgId, decisionId, input.workspacePath);
        if (decision) {
          const repaired = decision.taskId === task.id
            ? decision
            : await updateDecision(input.namespaceId, input.orgId, decision.id, { taskId: task.id }, input.workspacePath);
          return { decision: repaired, task };
        }
      }
    }
  }
  if (!input.parentTaskId || !input.sourceRunId || !input.runFingerprint) return null;

  const task = taskList(input.orgId, { status: "all" }, undefined, input.namespaceId).find((candidate) => {
    if (candidate.parent_id !== input.parentTaskId || candidate.issue_type !== "decision") return false;
    const metadata = metadataRecord(candidate.metadata);
    return metadata.decision_source === input.source &&
      metadata.completion_audit_source_run_id === input.sourceRunId &&
      metadata.completion_audit_run_fingerprint === input.runFingerprint;
  });
  if (!task) return null;

  const decisionId = metadataRecord(task.metadata).decision_id;
  if (typeof decisionId !== "string") return null;
  const decision = getDecision(input.namespaceId, input.orgId, decisionId, input.workspacePath);
  if (!decision) return null;

  // The task row is the durable first side effect. If a previous attempt created it
  // and then died before linking the decision, repair that link instead of creating a
  // second gate for the same source fingerprint.
  const linked = decision.taskId === task.id && decision.parentTaskId === input.parentTaskId;
  const repaired = linked
    ? decision
    : await updateDecision(input.namespaceId, input.orgId, decision.id, {
        taskId: task.id,
        parentTaskId: input.parentTaskId,
      }, input.workspacePath);
  return { decision: repaired, task };
}

function stableTaskClaimKey(claimKey: string): string {
  return `${claimKey}_task`;
}

function stableGateLedger(
  input: CreateTaskDecisionInput,
  claimKey?: string,
): Record<string, unknown> | null {
  if (!claimKey || !input.parentTaskId) return null;
  const parent = taskGet(input.orgId, input.parentTaskId, input.namespaceId);
  if (!parent) return null;
  const entry = metadataRecord(parent.metadata)[claimKey];
  return entry && typeof entry === "object" && !Array.isArray(entry)
    ? entry as Record<string, unknown>
    : null;
}

function updateStableGateLedger(
  input: CreateTaskDecisionInput,
  claimKey: string,
  updates: Record<string, unknown>,
): void {
  if (!input.parentTaskId) throw new Error("Stable decision gate requires a parent task");
  const parent = taskGet(input.orgId, input.parentTaskId, input.namespaceId);
  if (!parent) throw new Error(`Decision gate parent task ${input.parentTaskId} not found`);
  const metadata = metadataRecord(parent.metadata);
  const existing = metadataRecord(metadata[claimKey]);
  taskUpdate(input.orgId, input.parentTaskId, {
    metadata: {
      ...metadata,
      [claimKey]: { ...existing, ...updates, updatedAt: new Date().toISOString() },
    },
  }, input.namespaceId);
}

function releaseStableGateClaim(input: CreateTaskDecisionInput, claimKey?: string): void {
  if (!claimKey || !input.parentTaskId) return;
  const parent = taskGet(input.orgId, input.parentTaskId, input.namespaceId);
  if (!parent) return;
  const metadata = metadataRecord(parent.metadata);
  let changed = false;
  for (const key of [claimKey, stableTaskClaimKey(claimKey)]) {
    if (metadata[key] !== undefined) {
      delete metadata[key];
      changed = true;
    }
  }
  if (changed) taskUpdate(input.orgId, input.parentTaskId, { metadata }, input.namespaceId);
}

function releaseStableTaskClaim(input: CreateTaskDecisionInput, claimKey: string): void {
  if (!input.parentTaskId) return;
  const parent = taskGet(input.orgId, input.parentTaskId, input.namespaceId);
  if (!parent) return;
  const metadata = metadataRecord(parent.metadata);
  const taskClaimKey = stableTaskClaimKey(claimKey);
  if (metadata[taskClaimKey] === undefined) return;
  delete metadata[taskClaimKey];
  taskUpdate(input.orgId, input.parentTaskId, { metadata }, input.namespaceId);
}

export async function createTaskDecision({
  namespaceId,
  orgId,
  prompt,
  source,
  workspacePath,
  parentTaskId,
  sourceRunId,
  runFingerprint,
  generationJobId,
}: CreateTaskDecisionInput): Promise<CreateTaskDecisionResult> {
  const input = {
    namespaceId,
    orgId,
    prompt,
    source,
    workspacePath,
    parentTaskId,
    sourceRunId,
    runFingerprint,
    generationJobId,
  };
  const existing = await findExistingStableDecisionGate(input);
  if (existing) return existing;

  const claimKey = stableGateClaimKey(input);
  // The completion-audit path hands us a fully composed decision prompt; the
  // Generate-Task path hands us a raw user request that still needs the decision
  // framing. Only wrap the latter — wrapping an already-composed prompt is what
  // produced the doubled "Decide the implementation approach for… Original
  // request:…" text on auto-created decisions.
  const alreadyComposed = source === "completion-audit";
  const decisionPrompt = alreadyComposed ? prompt : buildDecisionPromptFromTaskPrompt(prompt);
  const title = alreadyComposed
    ? (prompt.split("\n")[0] || prompt)
    : titleFromDecisionPrompt(prompt);

  const taskFields = (decision: Decision) => ({
    workspace_id: workspacePath,
    title,
    description: decisionPrompt,
    issue_type: "decision" as const,
    priority: 2,
    parent_id: parentTaskId,
    metadata: {
      decision_id: decision.id,
      decision_status: decision.status,
      decision_source: source,
      ...(parentTaskId ? { decision_parent_task_id: parentTaskId } : {}),
      ...(source === "completion-audit" && sourceRunId
        ? { completion_audit_source_run_id: sourceRunId }
        : {}),
      ...(source === "completion-audit" && runFingerprint
        ? { completion_audit_run_fingerprint: runFingerprint }
        : {}),
      ...(generationJobId
        ? { task_generation_job_id: generationJobId, task_generation_role: "decision" }
        : {}),
    },
  });

  // No stable fingerprint means there is no durable identity that can safely tie a
  // retry to a prior side effect. Preserve the original one-shot behavior for those
  // interactive/manual callers.
  if (!claimKey || !parentTaskId) {
    const deterministicId = generationJobId
      ? deterministicGenerationDecisionId(namespaceId, orgId, generationJobId)
      : undefined;
    const decision = createDecision(namespaceId, orgId, { prompt: decisionPrompt, source, id: deterministicId }, workspacePath);
    let task: TaskRecord;
    try {
      task = taskCreate(orgId, taskFields(decision), namespaceId);
    } catch (error) {
      const concurrent = await findExistingStableDecisionGate(input);
      if (concurrent) return concurrent;
      throw error;
    }
    const updatedDecision = await updateDecision(
      namespaceId,
      orgId,
      decision.id,
      { title, taskId: task.id },
      workspacePath,
    );
    return { decision: updatedDecision, task };
  }

  let ledger = stableGateLedger(input, claimKey);
  if (!ledger) {
    const claimed = taskClaimMetadataKeyIfUnset(orgId, parentTaskId, claimKey, {
      [claimKey]: {
        source,
        sourceRunId,
        runFingerprint,
        state: "claim_acquired",
        claimedAt: new Date().toISOString(),
      },
    }, namespaceId);
    if (!claimed) {
      // A competing creator may have completed its synchronous decision/task writes
      // between our first read and this atomic claim. Discover it; never relaunch.
      for (let attempt = 0; attempt < 3; attempt++) {
        const concurrent = await findExistingStableDecisionGate(input);
        if (concurrent) return concurrent;
        ledger = stableGateLedger(input, claimKey);
        if (ledger?.decisionId) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      if (!ledger?.decisionId) {
        throw new Error(`Decision gate creation is already in progress for ${sourceRunId}`);
      }
    }
    ledger = stableGateLedger(input, claimKey);
  }

  let decision = typeof ledger?.decisionId === "string"
    ? getDecision(namespaceId, orgId, ledger.decisionId, workspacePath)
    : null;
  let createdDecision = false;
  if (!decision) {
    decision = createDecision(namespaceId, orgId, { prompt: decisionPrompt, source }, workspacePath);
    createdDecision = true;
    try {
      // This write is the recovery boundary for createDecision -> taskCreate. A retry
      // reuses decisionId from the parent ledger rather than minting another decision.
      updateStableGateLedger(input, claimKey, {
        decisionId: decision.id,
        state: "decision_created",
      });
      ledger = stableGateLedger(input, claimKey);
    } catch (error) {
      // Without the durable decision id, keeping this newly-created file would orphan it.
      try { deleteDecision(namespaceId, orgId, decision.id, workspacePath); } catch { /* best effort */ }
      releaseStableGateClaim(input, claimKey);
      throw error;
    }
  }

  let task = typeof ledger?.taskId === "string"
    ? taskGet(orgId, ledger.taskId, namespaceId)
    : null;
  if (!task) {
    const taskClaimKey = stableTaskClaimKey(claimKey);
    const taskClaimed = taskClaimMetadataKeyIfUnset(orgId, parentTaskId, taskClaimKey, {
      [taskClaimKey]: {
        decisionId: decision.id,
        state: "task_create_claimed",
        claimedAt: new Date().toISOString(),
      },
    }, namespaceId);
    if (!taskClaimed) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const concurrent = await findExistingStableDecisionGate(input);
        if (concurrent) return concurrent;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`Decision task creation is already in progress for ${sourceRunId}`);
    }

    try {
      task = taskCreate(orgId, taskFields(decision), namespaceId);
    } catch (error) {
      // Keep decisionId in the primary ledger and release only the task lease. The next
      // retry starts at taskCreate with this exact decision instead of duplicating it.
      updateStableGateLedger(input, claimKey, {
        decisionId: decision.id,
        state: "task_create_failed",
        lastError: error instanceof Error ? error.message : String(error),
      });
      releaseStableTaskClaim(input, claimKey);
      throw error;
    }

    try {
      updateStableGateLedger(input, claimKey, {
        decisionId: decision.id,
        taskId: task.id,
        state: "task_created",
      });
    } catch (error) {
      // The task cannot be recovered without its id. Compensate the exact records we
      // created in this attempt rather than leave an orphan that a retry could duplicate.
      try { taskDelete(orgId, task.id, namespaceId); } catch { /* best effort */ }
      if (createdDecision) {
        try { deleteDecision(namespaceId, orgId, decision.id, workspacePath); } catch { /* best effort */ }
        releaseStableGateClaim(input, claimKey);
      }
      throw error;
    } finally {
      releaseStableTaskClaim(input, claimKey);
    }
  }

  try {
    const updatedDecision = await updateDecision(
      namespaceId,
      orgId,
      decision.id,
      {
        title,
        taskId: task.id,
        ...(parentTaskId ? { parentTaskId } : {}),
      },
      workspacePath,
    );

    releaseStableGateClaim(input, claimKey);
    return { decision: updatedDecision, task };
  } catch (error) {
    // Both durable ids are already in the primary ledger. Keep them for a retry to
    // repair the decision link; clearing this ledger would reintroduce the duplicate gate.
    updateStableGateLedger(input, claimKey, {
      decisionId: decision.id,
      taskId: task.id,
      state: "decision_link_failed",
      lastError: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function deterministicGenerationDecisionId(namespaceId: string, orgId: string, generationJobId: string): string {
  const hex = createHash("sha256")
    .update(["task-generation-decision", namespaceId, orgId, generationJobId].join("\u0000"))
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}
