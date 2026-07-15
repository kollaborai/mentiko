import { NextRequest } from "next/server";
import { orgPath } from "@/lib/config";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/auth/api-auth";
import { validateChainId } from "@/lib/git/validate";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { isGitRepository, readGitBranchComparison, readGitStatus } from "@/lib/runner-v2/git-integration";

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

  const chainDir = orgPath(namespaceId, orgId, "chains", chainId);

  if (!isGitRepository(chainDir)) {
    return apiSuccess({
      isRepo: false,
      error: "Not a git repository",
    });
  }

  const status = readGitStatus(chainDir);
  let ahead = 0;
  let behind = 0;
  try {
    // Preserve the API's historical naming: `ahead` counts upstream commits
    // not present locally, while `behind` counts local commits not upstream.
    const upstream = readGitBranchComparison(chainDir, "@{u}", "HEAD");
    ahead = upstream.ahead;
    behind = upstream.behind;
  } catch {
    // No upstream or error
  }

  return apiSuccess({
    isRepo: true,
    branch: status.branch,
    staged: status.staged,
    modified: status.modified,
    untracked: status.untracked,
    hasChanges: status.has_changes,
    ahead,
    behind,
  });
});
