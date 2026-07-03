import { NextRequest } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { runGit } from "@/lib/git/exec";
import { orgPath } from "@/lib/config";
import { Unauthorized, BadRequest, Conflict } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/auth/api-auth";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { validateChainId } from "@/lib/git/validate";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";

export const dynamic = "force-dynamic";

interface GitBranch {
  name: string;
  short: string;
  author: string;
  date: string;
  message: string;
  current: boolean;
}

/**
 * Check if the working tree has uncommitted changes.
 * Returns true if there are modified or staged changes.
 */
function isDirtyWorkingTree(cwd: string): boolean {
  try {
    // git diff --quiet exits non-zero if there are unstaged changes
    runGit(cwd, ["diff", "--quiet"]);
  } catch {
    return true;
  }
  try {
    // git diff --cached --quiet exits non-zero if there are staged changes
    runGit(cwd, ["diff", "--cached", "--quiet"]);
  } catch {
    return true;
  }
  return false;
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

  const chainDir = orgPath(namespaceId, orgId, "chains", chainId);
  const gitDir = join(chainDir, ".git");

  if (!existsSync(gitDir)) {
    throw new BadRequest("Not a git repository");
  }

  // Get current branch
  const currentBranch = runGit(chainDir, ["branch", "--show-current"]).trim();

  // Get all branches using format with unit separator for safe parsing
  const branchOutput = runGit(chainDir, [
    "branch",
    "-v",
    "--format=%(refname:short)\x01%(objectname:short)\x01%(authorname)\x01%(committerdate:iso8601)\x01%(contents:subject)",
  ]);

  const branches: GitBranch[] = branchOutput
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const parts = line.split("\x01");
      return {
        name: parts[0]?.trim() || "",
        short: parts[1]?.trim() || "",
        author: parts[2]?.trim() || "",
        date: parts[3]?.trim() || "",
        message: parts[4]?.trim() || "",
        current: parts[0]?.trim() === currentBranch,
      };
    });

  return apiSuccess({
    current: currentBranch,
    branches,
  });
});

export const POST = withErrorHandling(async (
  request: NextRequest,
  _context: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const permError = await requirePermission(request, "manage_chains");
  if (permError) return permError;

  const { id } = await _context.params;
  const chainId = validateChainId(id);
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const body = await request.json();
  const action = body.action; // create, switch, delete, compare
  const branch = body.branch;
  const startPoint = body.startPoint || "HEAD";

  const chainDir = orgPath(namespaceId, orgId, "chains", chainId);
  const gitDir = join(chainDir, ".git");

  if (!existsSync(gitDir)) {
    throw new BadRequest("Not a git repository");
  }

  if (!branch) {
    throw new BadRequest("Branch name required");
  }

  const result: Record<string, unknown> = { action, branch };

  switch (action) {
    case "create": {
      // Check if branch already exists — exit code 0 means it exists
      try {
        runGit(chainDir, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
        throw new BadRequest("Branch already exists");
      } catch (err) {
        // If it's our BadRequest, re-throw
        if (err instanceof BadRequest) throw err;
        // Non-zero exit means branch doesn't exist — proceed
      }

      runGit(chainDir, ["branch", branch, startPoint]);
      result.created = true;
      break;
    }

    case "switch": {
      // Reject switch if working tree has uncommitted changes.
      // Never auto-stash — that hides user work silently.
      if (isDirtyWorkingTree(chainDir)) {
        throw new Conflict(
          "Commit or discard chain changes before switching branches."
        );
      }

      // Use git switch instead of git checkout — safer, purpose-built for branches
      runGit(chainDir, ["switch", branch]);
      result.switched = true;
      result.current = branch;

      // Get chain content at new branch
      const chainJsonPath = join(chainDir, "chain.json");
      if (existsSync(chainJsonPath)) {
        result.chain = JSON.parse(readFileSync(chainJsonPath, "utf-8"));
      }
      break;
    }

    case "delete": {
      const currentBranch = runGit(chainDir, ["branch", "--show-current"]).trim();

      if (branch === currentBranch) {
        throw new BadRequest("Cannot delete current branch");
      }

      const force = body.force || false;
      runGit(chainDir, ["branch", force ? "-D" : "-d", branch]);
      result.deleted = true;
      break;
    }

    case "compare": {
      const target = body.target || "main";
      const ahead = runGit(chainDir, ["rev-list", "--count", `${target}..${branch}`]).trim();
      const behind = runGit(chainDir, ["rev-list", "--count", `${branch}..${target}`]).trim();
      result.comparison = {
        target,
        ahead: parseInt(ahead, 10),
        behind: parseInt(behind, 10),
      };
      break;
    }

    default:
      throw new BadRequest("Invalid action");
  }

  return apiSuccess(result);
});
