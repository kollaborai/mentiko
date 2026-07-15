import { NextRequest } from "next/server";
import { orgPath } from "@/lib/config";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/auth/api-auth";
import { validateChainId } from "@/lib/git/validate";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { isGitRepository, readGitHistoryDetailed, readGitStatus } from "@/lib/runner-v2/git-integration";

export const dynamic = "force-dynamic";

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
  const parsedLimit = parseInt(searchParams.get("limit") || "50", 10);
  const maxCount = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(1000, parsedLimit)) : 50;
  const branch = searchParams.get("branch") || "HEAD";

  // reject option-like refs (array form already kills shell injection)
  if (branch.startsWith("-")) {
    throw new BadRequest("Invalid branch");
  }

  const chainDir = orgPath(namespaceId, orgId, "chains", chainId);

  if (!isGitRepository(chainDir)) {
    throw new BadRequest("Not a git repository");
  }

  const commits = readGitHistoryDetailed(chainDir, maxCount, branch);
  const currentBranch = readGitStatus(chainDir).branch;

  return apiSuccess({
    branch: currentBranch,
    commits,
    total: commits.length,
  });
});
