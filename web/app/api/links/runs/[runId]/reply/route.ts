import { NextRequest } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { checkRunAccess } from "@/lib/auth/run-acl";
import { BadRequest, NotFound, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import {
  normalizePeerSessionId,
  resolveLinkRunPaths,
  resolvePeerReplyPath,
  validateLinkRunId,
} from "@/lib/links/link-run-runtime";
import { updateRunJsonRecord } from "@/lib/runner-v2/run-state";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const { runId } = await params;
  if (!validateLinkRunId(runId)) {
    throw new BadRequest("Invalid run ID");
  }

  const { reply } = await request.json();

  if (!reply || typeof reply !== "string") {
    throw new BadRequest("reply text is required");
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { runsDir, runJsonPath: runPath, escalationsDir: escDir } = resolveLinkRunPaths(namespaceId, orgId, runId);
  const acl = await checkRunAccess(request, runId, runsDir);
  if (!acl.ok) {
    if (acl.reason === "run-not-found") throw new NotFound("Run", runId);
    throw new Unauthorized();
  }

  if (!existsSync(runPath)) {
    throw new NotFound("Run not found");
  }

  const run = JSON.parse(readFileSync(runPath, "utf-8"));
  if (run.type !== "link") {
    throw new BadRequest("Not a link run");
  }

  // write reply file for the typed peer link controller to consume
  mkdirSync(escDir, { recursive: true });
  writeFileSync(join(escDir, "reply.txt"), reply);

  const managerSession = normalizePeerSessionId(run.managerSession);
  if (managerSession) {
    const liveReplyPath = resolvePeerReplyPath(namespaceId, managerSession);
    mkdirSync(dirname(liveReplyPath), { recursive: true });
    writeFileSync(liveReplyPath, reply);
  }

  updateRunJsonRecord(runPath, (current) => {
    if (!current) throw new NotFound("Run not found");
    if (current.type !== "link") throw new BadRequest("Not a link run");
    const escalations = Array.isArray(current.escalations) ? current.escalations : [];
    const updatedEscalations = escalations.map((escalation, index) => {
      if (index !== escalations.length - 1 || !escalation || typeof escalation !== "object" || Array.isArray(escalation)) {
        return escalation;
      }
      return { ...(escalation as Record<string, unknown>), human_reply: reply, replied_at: new Date().toISOString() };
    });
    return { ...current, escalations: updatedEscalations, status: "running" };
  });

  return apiSuccess({ ok: true });
});
