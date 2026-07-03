import { NextRequest } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import { runGit, runGitOptional } from "@/lib/git/exec";
import { orgPath } from "@/lib/config";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/auth/api-auth";
import { validateChainId } from "@/lib/git/validate";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";

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
  const gitDir = join(chainDir, ".git");

  if (!existsSync(gitDir)) {
    return apiSuccess({
      isRepo: false,
      error: "Not a git repository",
    });
  }

  // Get current branch
  const currentBranch = runGit(chainDir, ["branch", "--show-current"]);

  // Get status
  const statusOutput = runGit(chainDir, ["status", "--porcelain"]);

  const staged: string[] = [];
  const modified: string[] = [];
  const untracked: string[] = [];

  statusOutput.split("\n").forEach((line) => {
    if (!line.trim()) return;

    const status = line.substring(0, 2);
    const file = line.substring(3);

    switch (status) {
      case "M ":
      case "A ":
      case "D ":
        staged.push(file);
        break;
      case " M":
      case " D":
      case "MM":
        modified.push(file);
        break;
      case "??":
        untracked.push(file);
        break;
    }
  });

  // Check for uncommitted changes
  const hasChanges = staged.length > 0 || modified.length > 0 || untracked.length > 0;

  // Get ahead/behind info for main branch
  let ahead = 0;
  let behind = 0;
  try {
    ahead = parseInt(runGitOptional(chainDir, ["rev-list", "--count", "HEAD..@{u}"]) || "0", 10);
    behind = parseInt(runGitOptional(chainDir, ["rev-list", "--count", "@{u}..HEAD"]) || "0", 10);
  } catch {
    // No upstream or error
  }

  return apiSuccess({
    isRepo: true,
    branch: currentBranch,
    staged,
    modified,
    untracked,
    hasChanges,
    ahead,
    behind,
  });
});
