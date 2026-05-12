import { NextRequest } from "next/server";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { checkRunAccess } from "@/lib/run-acl";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { Unauthorized, NotFound, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveLinkRunsDir } from "@/lib/link-run-runtime";

export const dynamic = "force-dynamic";

interface ApproveRequest {
  action: "approve" | "reject";
  reason?: string;
}

interface ApprovalRecord {
  status: "approved" | "rejected";
  at: string;
  reason?: string;
}

// POST /api/runs/[id]/approve - handle human approval decision
export const POST = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const params = await context.params;
  const runId = params.id;
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const runsDir = resolveLinkRunsDir(namespaceId, orgId);
  const acl = await checkRunAccess(request, runId, runsDir);
  if (!acl.ok) {
    if (acl.reason === "run-not-found") throw new NotFound("Run", runId);
    throw new Unauthorized();
  }
  const runDir = join(runsDir, runId);

  // verify run exists
  const runFile = join(runDir, "run.json");
  if (!existsSync(runFile)) {
    throw new NotFound("Run", runId);
  }

  const body: ApproveRequest = await request.json();

  if (body.action !== "approve" && body.action !== "reject") {
    throw new BadRequest("Invalid action", { validActions: ["approve", "reject"] });
  }

  const approval: ApprovalRecord = {
    status: body.action === "approve" ? "approved" : "rejected",
    at: new Date().toISOString(),
    reason: body.reason,
  };

  const approvalFile = join(runDir, "approval.json");
  writeFileSync(approvalFile, JSON.stringify(approval, null, 2));

  // update run status
  try {
    const runContent = readFileSync(runFile, "utf-8");
    const run = JSON.parse(runContent);
    run.status = body.action === "approve" ? "running" : "stopped";
    run.completed = body.action === "reject" ? new Date().toISOString() : run.completed;
    writeFileSync(runFile, JSON.stringify(run, null, 2));
  } catch {
    // run update is non-critical
  }

  return apiSuccess({ action: body.action });
});
