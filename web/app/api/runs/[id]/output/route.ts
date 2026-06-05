import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { sanitizeOutput } from "@/lib/sanitize-output";
import { checkRunAccess } from "@/lib/auth/run-acl";
import { Unauthorized, NotFound } from "@/lib/api-errors";
import { withErrorHandling } from "@/lib/api-response";
import { resolveLinkRunsDir } from "@/lib/links/link-run-runtime";

export const dynamic = "force-dynamic";

// GET /api/runs/[id]/output - fetch output.log content for download
export const GET = withErrorHandling(async (
  req: Request,
  context: { params: Promise<{ id: string }> }
) => {
  const { id: runId } = await context.params;
  const namespaceId = await getNamespaceIdFromRequest(req);
  const orgId = await getOrgIdFromRequest(req);
  const runsDir = resolveLinkRunsDir(namespaceId, orgId);
  const acl = await checkRunAccess(req, runId, runsDir);
  if (!acl.ok) {
    throw new Unauthorized();
  }

  const runDir = join(runsDir, runId);
  const outputLogPath = join(runDir, "output.log");

  if (!existsSync(outputLogPath)) {
    throw new NotFound("Output log", runId);
  }

  const raw = readFileSync(outputLogPath, "utf-8");
  const content = sanitizeOutput(raw);
  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/plain",
      "Content-Disposition": `attachment; filename="run-${runId}-output.log"`,
    },
  });
});
