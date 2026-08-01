// task-creation-service.ts
//
// Chain-contract Track C (task-creation producer parity). One typed service
// owning everything both task-creation producers (the UI route and the MCP
// tool) need: namespace/workspace authorization, server-generated identity,
// parent validation, decision routing, metadata normalization, auto-run
// policy resolution, idempotency, and a complete created-task response.
//
// Routes and the MCP tool are thin adapters over this service. They must not
// implement their own defaults -- if a producer needs a new default, it goes
// here, not in the route.
//
// Deliberately NOT here (see chain-contract-plan-of-record.md, Track C):
//   - auto-run ADMISSION. This service only stamps the policy a task is
//     created with; admitting a task into a run remains an orchestrator
//     action (lib/runs/auto-run.ts) that happens after creation.
//   - a second post-run reconciler. Nothing here touches run/completion state.
//   - decision-gate idempotency. createTaskDecision() already owns a stable
//     claim/replay system for decision gates (parentTaskId + sourceRunId +
//     runFingerprint). This service's idempotency key is a *different*
//     mechanism for plain/child task creation and does not touch that system.

import { createHash } from "node:crypto";
import { taskCreate, taskGet, taskUpdate, _getDb } from "@/lib/tasks/task-store";
import type { TaskRecord, TaskUpdateFields } from "@/lib/tasks/task-store-types";
import {
  resolveTaskAutoRunPolicy,
  type AutoRunPolicy,
} from "@/lib/tasks/task-auto-run-default";
import { validateChainId, buildChainMetadata } from "@/lib/chains/chain-validation";
import { resolveAuthorizedWorkspacePath } from "@/lib/auth/workspace-auth";
import { createTaskDecision } from "@/lib/tasks/task-decision-link";
import { BadRequest, Forbidden, NotFound } from "@/lib/api-errors";

// ---------------------------------------------------------------------------
// request / result types
// ---------------------------------------------------------------------------

export type TaskCreationSource = "ui" | "mcp";

export interface TaskCreationChainAssignment {
  chainId?: string;
  chainName?: string;
  /** Explicit auto-run intent. Undefined = "resolve from workspace/system default". */
  autoRun?: boolean;
}

/**
 * Ambient context for deriving a stable idempotency key for agent-created
 * children (C2). sourceRunId/creatingAgent should come from server-trusted
 * context (e.g. env vars set on the chain agent's session), never from a
 * caller-asserted field an agent could spoof -- logicalKey is the only piece
 * the caller actually chooses.
 */
export interface TaskCreationAgentContext {
  sourceRunId?: string;
  creatingAgent?: string;
  logicalKey?: string;
}

export interface TaskCreationRequest {
  namespaceId: string;
  orgId: string;
  source: TaskCreationSource;
  /** Authenticated actor, for workspace-membership checks and default owner. */
  actorUserId?: string;

  title: string;
  description?: string;
  /** Defaults to "task" (task-store's own default). "decision" routes through createTaskDecision. */
  issueType?: string;
  priority?: number;
  parentId?: string;
  /** Human/user identifier only -- see C4. Never a chain id or chain name; chain binding lives in chainAssignment. */
  assignee?: string;
  labels?: string[];
  notes?: string;
  acceptanceCriteria?: string;
  design?: string;
  estimatedMinutes?: number;
  dueAt?: string;
  /** Responsible identity. Defaults to actorUserId when omitted (matches prior MCP behavior). */
  owner?: string;
  createdBy?: string;

  /**
   * Raw workspace reference from the caller (UI's `?workspace=` query param,
   * MCP's `workspacePath` field). Always auth-resolved against the caller's
   * access before use -- neither adapter may trust this directly (Track C
   * divergence #7: UI used to skip this check entirely).
   */
  workspaceRef?: string;
  /**
   * UI-only compatibility: a `?workspace=` param was present on the request
   * but getWorkspaceId() couldn't parse it (path traversal / null byte).
   * Mirrors the pre-Track-C "Tasks not initialized in this workspace" 400.
   */
  malformedWorkspaceRef?: boolean;

  chainAssignment?: TaskCreationChainAssignment;

  /** Caller-supplied opaque idempotency key. Wins over agentContext derivation. */
  idempotencyKey?: string;
  agentContext?: TaskCreationAgentContext;
}

export type TaskCreationOutcome = "created" | "existing";

export interface TaskCreationChainBinding {
  chainId: string;
  chainName: string;
}

export interface TaskCreationDecisionRouting {
  decisionId: string;
  routedTo: "decision";
}

export interface TaskCreationResult {
  task: TaskRecord;
  outcome: TaskCreationOutcome;
  /** The EFFECTIVE policy the task was created with, not merely the requested value (C3). */
  effectiveAutoRun: AutoRunPolicy;
  chainBinding: TaskCreationChainBinding | null;
  /** Present only when issueType "decision" routed through createTaskDecision. */
  decision?: TaskCreationDecisionRouting;
}

// ---------------------------------------------------------------------------
// idempotency (C2)
// ---------------------------------------------------------------------------

function digest(parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

/**
 * Explicit key wins. Otherwise, for an agent-created child, derive a stable
 * key from namespace + parent task + source run + creating agent + caller
 * logical key (C2) -- all five must be present, or there is no durable
 * identity to replay against and creation proceeds unguarded (today's
 * behavior for every existing caller, since none currently supply these).
 */
function computeIdempotencyDigest(request: TaskCreationRequest): string | undefined {
  if (request.idempotencyKey && request.idempotencyKey.trim()) {
    return digest(["task-create:explicit", request.namespaceId, request.orgId, request.idempotencyKey.trim()]);
  }
  const ctx = request.agentContext;
  if (ctx?.sourceRunId && ctx?.creatingAgent && ctx?.logicalKey && request.parentId) {
    return digest([
      "task-create:child",
      request.namespaceId,
      request.orgId,
      request.parentId,
      ctx.sourceRunId,
      ctx.creatingAgent,
      ctx.logicalKey,
    ]);
  }
  return undefined;
}

function findByIdempotencyDigest(
  orgId: string,
  namespaceId: string,
  idemDigest: string,
): TaskRecord | null {
  const db = _getDb(namespaceId);
  const row = db
    .prepare(
      `SELECT id FROM tasks WHERE org_id = ? AND json_extract(metadata, '$.idempotency_key') = ? LIMIT 1`,
    )
    .get(orgId, idemDigest) as { id: string } | undefined;
  if (!row) return null;
  return taskGet(orgId, row.id, namespaceId);
}

// ---------------------------------------------------------------------------
// response enrichment helpers
// ---------------------------------------------------------------------------

function metadataOf(task: TaskRecord): Record<string, unknown> {
  return task.metadata && typeof task.metadata === "object" ? task.metadata : {};
}

function chainBindingOf(task: TaskRecord): TaskCreationChainBinding | null {
  const md = metadataOf(task);
  const binding = md.chainBinding;
  if (!binding || typeof binding !== "object") return null;
  const chainId = (binding as Record<string, unknown>).chain_id;
  if (typeof chainId !== "string" || !chainId) return null;
  const chainName = (binding as Record<string, unknown>).chain_name;
  return { chainId, chainName: typeof chainName === "string" && chainName ? chainName : chainId };
}

// Reconstructs the effective policy from an ALREADY-CREATED task's stored
// metadata (used for idempotent-replay responses, where we report what is
// really there instead of re-running resolution). Once a boolean is stamped
// into metadata.auto_run, its original provenance (explicit vs. defaulted)
// is no longer recoverable -- this is a pre-existing property of the stamped
// read path (resolveAutoRunState() has the same limitation), not something
// introduced here.
function describeExistingTaskPolicy(task: TaskRecord): AutoRunPolicy {
  const md = metadataOf(task);
  const binding = md.chainBinding as Record<string, unknown> | undefined;
  if (binding && typeof binding.auto_run === "boolean") {
    return { enabled: binding.auto_run, source: "explicit" };
  }
  if (typeof md.auto_run === "boolean") {
    return { enabled: md.auto_run, source: "explicit" };
  }
  return { enabled: false, source: "unscoped" };
}

// ---------------------------------------------------------------------------
// workspace authorization (closes divergence #7 -- both producers now
// auth-resolve; UI previously trusted the request-derived path directly)
// ---------------------------------------------------------------------------

function resolveWorkspace(request: TaskCreationRequest): string | undefined {
  if (request.malformedWorkspaceRef) {
    throw new BadRequest("Tasks not initialized in this workspace.");
  }
  if (request.workspaceRef === undefined) return undefined;

  const authorized = resolveAuthorizedWorkspacePath(
    request.namespaceId,
    request.orgId,
    request.workspaceRef,
    request.actorUserId,
  );
  if (!authorized) {
    throw new Forbidden("Workspace is not authorized", { workspace: request.workspaceRef });
  }
  return authorized;
}

// ---------------------------------------------------------------------------
// decision routing (C1: previously MCP-inline only -- divergence #4)
// ---------------------------------------------------------------------------

async function createDecisionRoutedTask(
  request: TaskCreationRequest,
  workspaceId: string | undefined,
): Promise<TaskCreationResult> {
  const prompt = [request.title, request.description].filter(Boolean).join("\n\n");
  const decisionSource = request.source === "mcp" ? "mcp-create-task" : "ui-create-task";
  const { decision, task } = await createTaskDecision({
    namespaceId: request.namespaceId,
    orgId: request.orgId,
    prompt,
    source: decisionSource,
    workspacePath: workspaceId,
    parentTaskId: request.parentId,
  });

  // Caller-supplied task-level fields apply to the linked decision task --
  // same allowlist MCP used inline (title/priority/labels/assignee/AC/
  // design/notes/estimate/due). description and parentId are already baked
  // into the decision prompt/link and are not reapplied here.
  const fields: TaskUpdateFields = {};
  if (request.title) fields.title = request.title;
  if (request.priority !== undefined) fields.priority = request.priority;
  if (request.labels !== undefined) fields.labels = request.labels;
  if (request.assignee !== undefined) fields.assignee = request.assignee;
  if (request.acceptanceCriteria !== undefined) fields.acceptance_criteria = request.acceptanceCriteria;
  if (request.design !== undefined) fields.design = request.design;
  if (request.notes !== undefined) fields.notes = request.notes;
  if (request.estimatedMinutes !== undefined) fields.estimated_minutes = request.estimatedMinutes;
  if (request.dueAt !== undefined) fields.due_at = request.dueAt;
  if (Object.keys(fields).length > 0) {
    taskUpdate(request.orgId, task.id, fields, request.namespaceId);
  }

  const finalTask = taskGet(request.orgId, task.id, request.namespaceId) ?? task;
  return {
    task: finalTask,
    outcome: "created",
    // Decision gates are not auto-run subjects.
    effectiveAutoRun: { enabled: false, source: "unscoped" },
    chainBinding: null,
    decision: { decisionId: decision.id, routedTo: "decision" },
  };
}

// ---------------------------------------------------------------------------
// main entry point
// ---------------------------------------------------------------------------

export async function createTask(request: TaskCreationRequest): Promise<TaskCreationResult> {
  if (!request.title || !request.title.trim()) {
    throw new BadRequest("Title is required", { field: "title" });
  }

  const workspaceId = resolveWorkspace(request);

  if (request.issueType === "decision") {
    return createDecisionRoutedTask(request, workspaceId);
  }

  // Parent/dependency validation (C1). Previously neither producer checked
  // this before insert -- an invalid parent_id fell through to a raw SQLite
  // foreign-key constraint failure (foreign_keys=ON) instead of a clean 404.
  if (request.parentId) {
    const parent = taskGet(request.orgId, request.parentId, request.namespaceId);
    if (!parent) {
      throw new NotFound("Parent task", request.parentId);
    }
  }

  const idemDigest = computeIdempotencyDigest(request);
  if (idemDigest) {
    const existing = findByIdempotencyDigest(request.orgId, request.namespaceId, idemDigest);
    if (existing) {
      return {
        task: existing,
        outcome: "existing",
        effectiveAutoRun: describeExistingTaskPolicy(existing),
        chainBinding: chainBindingOf(existing),
      };
    }
  }

  const policy = resolveTaskAutoRunPolicy({
    namespaceId: request.namespaceId,
    orgId: request.orgId,
    workspacePath: workspaceId,
    explicitAutoRun: request.chainAssignment?.autoRun,
  });

  let metadata: Record<string, unknown> = {};
  if (workspaceId) metadata.workspace_path = workspaceId;
  if (idemDigest) metadata.idempotency_key = idemDigest;

  let chainBinding: TaskCreationChainBinding | null = null;
  if (request.chainAssignment?.chainId) {
    const validation = validateChainId(request.chainAssignment.chainId, request.namespaceId, request.orgId);
    if (!validation.valid) {
      throw new BadRequest(validation.error || "Chain validation failed");
    }
    const chainName = validation.chainName || request.chainAssignment.chainName || request.chainAssignment.chainId;
    metadata = { ...metadata, ...buildChainMetadata(request.chainAssignment.chainId, chainName, policy.enabled) };
    chainBinding = { chainId: request.chainAssignment.chainId, chainName };
  } else if (policy.enabled) {
    // auto-run without a specific chain: system will analyze + generate
    metadata.auto_run = true;
  }

  // Priority range validation. Previously UI-only (divergence: MCP stored an
  // out-of-range priority verbatim); both producers now clamp the same way --
  // an out-of-range/non-finite value falls through to task-store's own
  // default (2) rather than persisting garbage.
  const priority =
    request.priority !== undefined &&
    Number.isFinite(request.priority) &&
    request.priority >= 0 &&
    request.priority <= 4
      ? request.priority
      : undefined;

  let created: TaskRecord;
  try {
    created = taskCreate(
      request.orgId,
      {
        title: request.title,
        description: request.description,
        issue_type: request.issueType,
        priority,
        parent_id: request.parentId,
        assignee: request.assignee,
        labels: request.labels,
        notes: request.notes,
        acceptance_criteria: request.acceptanceCriteria,
        design: request.design,
        estimated_minutes: request.estimatedMinutes,
        due_at: request.dueAt,
        owner: request.owner ?? request.actorUserId,
        created_by: request.createdBy,
        workspace_id: workspaceId,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      },
      request.namespaceId,
    );
  } catch (error) {
    // A concurrent replay may have won the unique idempotency-key index
    // (task-store.ts idx_tasks_idempotency_key) between our lookup and this
    // insert. Rediscover it rather than turn a harmless race into a failure
    // or a duplicate -- same recovery idiom as generated-task-import.ts.
    if (idemDigest) {
      const existing = findByIdempotencyDigest(request.orgId, request.namespaceId, idemDigest);
      if (existing) {
        return {
          task: existing,
          outcome: "existing",
          effectiveAutoRun: describeExistingTaskPolicy(existing),
          chainBinding: chainBindingOf(existing),
        };
      }
    }
    throw error;
  }

  return {
    task: created,
    outcome: "created",
    effectiveAutoRun: policy,
    chainBinding,
  };
}
