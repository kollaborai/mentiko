import { NextRequest } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import { runGit } from "@/lib/git/exec";
import { orgPath } from "@/lib/config";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/auth/api-auth";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { validateChainId } from "@/lib/git/validate";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";

export const dynamic = "force-dynamic";

// keep only safe filename chars; reject traversal. returns an array so callers
// can spread into argv after a `--` separator.
function sanitizeFiles(files: string | string[]): string[] {
  const list = Array.isArray(files) ? files : [files];
  return list
    .map((f) => String(f).replace(/[^a-zA-Z0-9\-_./]/g, ""))
    .filter((name) => name.length > 0 && !name.includes("..") && !name.startsWith("/"));
}

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
  const message =
    (typeof body.message === "string" ? body.message.trim() : "") || "chore: update chain";
  const files = body.files ?? ".";

  const chainDir = orgPath(namespaceId, orgId, "chains", chainId);
  const gitDir = join(chainDir, ".git");

  if (!existsSync(gitDir)) {
    throw new BadRequest("Not a git repository");
  }

  // Stage files
  if (files === ".") {
    runGit(chainDir, ["add", "-A"]);
  } else {
    const safeFiles = sanitizeFiles(files);
    if (safeFiles.length === 0) {
      throw new BadRequest("Invalid file list");
    }
    runGit(chainDir, ["add", "--", ...safeFiles]);
  }

  // Check if there's anything to commit (--quiet exits non-zero when staged
  // changes exist, so the throw is the "proceed" path).
  try {
    runGit(chainDir, ["diff", "--cached", "--quiet"]);
    return apiSuccess({
      success: true,
      message: "Nothing to commit",
      commit: null,
    });
  } catch {
    // Changes exist, proceed with commit
  }

  runGit(chainDir, ["commit", "-m", message]);

  const commitHash = runGit(chainDir, ["rev-parse", "HEAD"]).trim();
  const shortHash = runGit(chainDir, ["rev-parse", "--short", "HEAD"]).trim();

  return apiSuccess({
    success: true,
    message: "Changes committed",
    commit: {
      hash: commitHash,
      short: shortHash,
      message,
    },
  });
});
