import { existsSync } from "fs";
import { join } from "path";
import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/api-auth";
import { checkRunAccess } from "@/lib/auth/run-acl";
import { applyDraftChildTasks } from "@/lib/event-artifacts/event-artifact-actions";
import { appendExecutionRecord, readExecutionRecords } from "@/lib/event-artifacts/event-artifact-ledger";
import { BadRequest, Conflict, NotFound, Unauthorized } from "@/lib/api-errors";
import { apiSuccess, withErrorHandling } from "@/lib/api-response";
import { resolveLinkRunsDir } from "@/lib/links/link-run-runtime";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";

export const dynamic = "force-dynamic";

export const POST = requirePermission("manage_tasks")(
  withErrorHandling(async (
    request: NextRequest,
    context: { params: Promise<{ id: string; executionId: string }> },
  ) => {
    const { id: runId, executionId } = await context.params;
    const namespaceId = await getNamespaceIdFromRequest(request);
    const orgId = await getOrgIdFromRequest(request);
    const runsDir = resolveLinkRunsDir(namespaceId, orgId);
    const acl = await checkRunAccess(request, runId, runsDir);
    if (!acl.ok) {
      if (acl.reason === "run-not-found") throw new NotFound("Run", runId);
      throw new Unauthorized();
    }

    const artifactsDir = join(runsDir, runId, "artifacts");
    const records = readExecutionRecords(artifactsDir);
    const record = [...records].reverse().find((candidate) => candidate.id === executionId);
    if (!record) throw new NotFound("Event artifact execution", executionId);
    if (record.status === "blocked_on_children" || record.status === "actions_applied") {
      return apiSuccess({ status: record.status, actionResults: record.actionResults || [] });
    }
    if (record.status !== "awaiting_review") {
      throw new Conflict(`Event artifact execution is not awaiting review (${record.status})`);
    }
    if (!record.draftTaskPath || !record.artifactPath) {
      throw new BadRequest("Event artifact execution has no draft task artifact");
    }
    if (!existsSync(record.draftTaskPath)) {
      throw new NotFound("Draft task artifact", record.draftTaskPath);
    }

    const body = await safeJson(request);
    const parentTaskId = typeof body.parentTaskId === "string" && body.parentTaskId.trim()
      ? body.parentTaskId.trim()
      : undefined;
    if (!parentTaskId) throw new BadRequest("parentTaskId is required");

    const result = applyDraftChildTasks({
      namespaceId,
      orgId,
      parentTaskId,
      draftTaskPath: record.draftTaskPath,
      executionId,
      runId,
      artifactPath: record.artifactPath,
      createdBy: "event-artifact",
      workspacePath: typeof body.workspacePath === "string" ? body.workspacePath : undefined,
    });
    const now = new Date().toISOString();
    appendExecutionRecord(artifactsDir, {
      ...record,
      status: "blocked_on_children",
      actionResults: [{ type: "create_tasks", createdTaskIds: result.createdTaskIds, created: result.created }],
      updatedAt: now,
    });

    return apiSuccess({
      status: "blocked_on_children",
      created: result.created,
      createdTaskIds: result.createdTaskIds,
      parentId: result.parentId,
    });
  }),
);

async function safeJson(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
