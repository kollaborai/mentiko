import { NextRequest } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { execFileSync } from "child_process";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { checkRunAccess } from "@/lib/auth/run-acl";
import { BadRequest, NotFound, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { findDefaultProfile } from "@/lib/agents/agent-profile-storage";
import { buildChildEnv } from "@/lib/runs/child-env";
import { resolveLinkRunPaths, validateLinkRunId } from "@/lib/links/link-run-runtime";
import { hasInternalAuth } from "@/lib/auth/internal-api-auth";
import { LINK_ESCALATION_FALLBACK_MODEL } from "@/lib/agents/agent-provider-catalog";

export const dynamic = "force-dynamic";

function generateSummary(peer1Last: string, peer2Last: string, namespaceId: string, orgId: string): string {
  try {
    const profile = findDefaultProfile(namespaceId, orgId);
    const cliBin = profile?.cli || "claude";
    const pipeFlag = profile?.pipe_flag || "-p";
    const profileEnv = profile?.env || {};

    const prompt = `Summarize this disagreement in ONE sentence. Peer 1: "${peer1Last.slice(0, 500)}" Peer 2: "${peer2Last.slice(0, 500)}"`;
    const args = [pipeFlag, prompt, "--model", profile?.model || LINK_ESCALATION_FALLBACK_MODEL];

    const result = execFileSync(cliBin, args, {
      timeout: 30000,
      encoding: "utf-8",
      env: buildChildEnv(profileEnv),
    });
    return result.trim().slice(0, 200);
  } catch {
    return "Agents are stuck and need human guidance.";
  }
}

export const POST = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) => {
  const permErr = await requirePermission(request, "manage_chains");
  if (permErr) return permErr;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { runId } = await params;
  if (!validateLinkRunId(runId)) {
    throw new BadRequest("Invalid run ID");
  }

  const { runsDir, runJsonPath: runPath, escalationsDir: escDir } = resolveLinkRunPaths(namespaceId, orgId, runId);
  if (!hasInternalAuth(request, "link-escalate")) {
    const acl = await checkRunAccess(request, runId, runsDir);
    if (!acl.ok) {
      if (acl.reason === "run-not-found") throw new NotFound("Run", runId);
      throw new Unauthorized();
    }
  }

  if (!existsSync(runPath)) {
    throw new NotFound("Run not found");
  }

  const run = JSON.parse(readFileSync(runPath, "utf-8"));
  if (run.type !== "link") {
    throw new BadRequest("Not a link run");
  }

  const body = await request.json();
  const { escalation_id, round, trigger, consecutive_continues, peer1_last, peer2_last } = body;

  const summary = generateSummary(peer1_last || "", peer2_last || "", namespaceId, orgId);

  const escalation = {
    id: escalation_id || `esc-${Date.now()}`,
    round: round || 0,
    trigger: trigger || "STALL",
    consecutive_continues: consecutive_continues || 0,
    haiku_summary: summary,
    created_at: new Date().toISOString(),
  };

  // append to run.json escalations
  if (!run.escalations) run.escalations = [];
  run.escalations.push(escalation);
  run.status = "stalled";
  writeFileSync(runPath, JSON.stringify(run, null, 2));

  // create escalation dir for reply file
  mkdirSync(escDir, { recursive: true });

  // telegram support: requires chat_id in run.json (future enhancement)
  // for now, skip telegram send since link runs don't have chat_id storage yet
  const telegramSent = false;
  const telegramMessageId = null;

  return apiSuccess({
    ok: true,
    telegram_sent: telegramSent,
    telegram_message_id: telegramMessageId,
  });
});
