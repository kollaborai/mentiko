import { NextRequest } from "next/server";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join, basename } from "path";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { checkRunAccess } from "@/lib/auth/run-acl";
import { BadRequest, NotFound, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveLinkRunPaths, resolvePeerOutputDir, validateLinkRunId } from "@/lib/links/link-run-runtime";

export const dynamic = "force-dynamic";

interface TranscriptEntry {
  agent: string;
  round: number;
  timestamp: number;
  content: string;
}

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
  const { runsDir, runJsonPath: runPath } = resolveLinkRunPaths(namespaceId, orgId, runId);
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
    throw new NotFound("Not a link run");
  }

  // read peer output files matching this run's session names
  const peerOutputDir = resolvePeerOutputDir(namespaceId);
  if (!existsSync(peerOutputDir)) {
    return apiSuccess({ transcript: [], runId });
  }

  const sessions = run.agents
    .map((a: { session: string; name: string }) => ({ session: a.session, name: a.name }))
    .filter((a: { session: string }) => a.session);

  const transcript: TranscriptEntry[] = [];

  // add the kickoff prompt as the first entry
  if (run.goal) {
    const startTs = run.started ? Math.floor(new Date(run.started).getTime() / 1000) : 0;
    transcript.push({
      agent: "Prompt",
      round: -1,
      timestamp: startTs,
      content: run.goal,
    });
  }

  for (const { session, name } of sessions) {
    const files = readdirSync(peerOutputDir)
      .filter((f: string) => f.startsWith(session) && f.endsWith(".txt"))
      .sort();

    for (const file of files) {
      // parse filename: {session}-r{round}-{timestamp}.txt
      const match = basename(file, ".txt").match(/-r(\d+)-(\d+)$/);
      if (!match) continue;

      const round = parseInt(match[1], 10);
      const timestamp = parseInt(match[2], 10);
      const content = readFileSync(join(peerOutputDir, file), "utf-8").trim();

      if (content) {
        transcript.push({ agent: name, round, timestamp, content });
      }
    }
  }

  // sort by timestamp to get conversation order
  transcript.sort((a, b) => a.timestamp - b.timestamp);

  return apiSuccess({ transcript, runId });
});
