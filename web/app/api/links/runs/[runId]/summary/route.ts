import { NextRequest } from "next/server";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { checkRunAccess } from "@/lib/auth/run-acl";
import { BadRequest, NotFound, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveLinkRunPaths, validateLinkRunId } from "@/lib/links/link-run-runtime";
import config from "@/lib/config";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const { runId } = await params;
  if (!validateLinkRunId(runId)) {
    throw new BadRequest("Invalid run ID");
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { runsDir, runDir } = resolveLinkRunPaths(namespaceId, orgId, runId);
  const acl = await checkRunAccess(request, runId, runsDir);
  if (!acl.ok) {
    if (acl.reason === "run-not-found") throw new NotFound("Run", runId);
    throw new Unauthorized();
  }

  const summaryPath = join(runDir, "summary.json");
  const hasSummary = existsSync(summaryPath);

  let summary = null;
  if (hasSummary) {
    try {
      summary = JSON.parse(readFileSync(summaryPath, "utf-8"));
    } catch {
      summary = null;
    }
  }

  // check for pending generation job
  let hasPendingJob = false;
  try {
    const jobsDir = config.jobsDir;
    if (existsSync(jobsDir)) {
      const jobFiles = readdirSync(jobsDir).filter((f: string) => f.endsWith(".json"));
      for (const f of jobFiles) {
        try {
          const job = JSON.parse(readFileSync(join(jobsDir, f), "utf-8"));
          if (job.type === "link_summary" && job.input?.runId === runId && job.status === "running") {
            hasPendingJob = true;
            break;
          }
        } catch { /* skip malformed */ }
      }
    }
  } catch { /* jobs dir not accessible */ }

  return apiSuccess({
    summary,
    hasSummary: !!summary,
    hasPendingJob,
  });
});
