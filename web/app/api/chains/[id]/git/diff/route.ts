import { NextRequest } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import { runGit } from "@/lib/git/exec";
import { orgPath } from "@/lib/config";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/auth/api-auth";
import { validateChainId } from "@/lib/git/validate";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { isGitRepository, readGitDiffSummary } from "@/lib/runner-v2/git-integration";

export const dynamic = "force-dynamic";

// Reject option-like values (`--output=...`, `-S`, ...). Array form already
// kills shell injection; this closes the separate flag-injection vector where
// git would treat the value as its own option.
function assertRef(value: string, label: string): void {
  if (value.startsWith("-")) {
    throw new BadRequest(`Invalid ${label}`);
  }
}

export const GET = withErrorHandling(async (
  request: NextRequest,
  _context: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { id } = await _context.params;
  const chainId = validateChainId(id);
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") || "HEAD";
  const to = searchParams.get("to") || "";
  const includeContent = searchParams.get("content") === "true";

  assertRef(from, "from");
  const toRev = to || "HEAD";
  if (to) assertRef(to, "to");

  const chainDir = orgPath(namespaceId, orgId, "chains", chainId);

  if (!isGitRepository(chainDir)) {
    throw new BadRequest("Not a git repository");
  }

  return apiSuccess(readGitDiffSummary(chainDir, from, toRev, includeContent));
});

// Get file content at a specific commit
export const POST = withErrorHandling(async (
  request: NextRequest,
  _context: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { id } = await _context.params;
  const chainId = validateChainId(id);
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const body = await request.json();
  const commit = body.commit || "HEAD";
  const file = body.file || "chain.json";

  assertRef(commit, "commit");
  if (file.startsWith("-") || file.includes("..")) {
    throw new BadRequest("Invalid file");
  }

  const chainDir = orgPath(namespaceId, orgId, "chains", chainId);
  const gitDir = join(chainDir, ".git");

  if (!existsSync(gitDir)) {
    throw new BadRequest("Not a git repository");
  }

  const content = runGit(chainDir, ["show", `${commit}:${file}`]);

  return apiSuccess({
    commit,
    file,
    content,
  });
});
