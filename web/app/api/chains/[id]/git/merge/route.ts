import { NextRequest } from "next/server";
import { existsSync, readFileSync } from "fs";
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
  const sourceBranch = body.branch;
  const strategy = body.strategy || ""; // recursive, resolve, ours, theirs

  if (!sourceBranch) {
    throw new BadRequest("Source branch required");
  }

  // validate branch name (alphanumeric, hyphens, underscores, slashes, dots — no shell metacharacters)
  if (!/^[a-zA-Z0-9._\-/]+$/.test(sourceBranch)) {
    throw new BadRequest("Invalid branch name");
  }

  // whitelist merge strategy
  if (strategy && !/^(recursive|resolve|ours|theirs|octopus|subtree)$/.test(strategy)) {
    throw new BadRequest("Invalid merge strategy");
  }

  const chainDir = orgPath(namespaceId, orgId, "chains", chainId);
  const gitDir = join(chainDir, ".git");

  if (!existsSync(gitDir)) {
    throw new BadRequest("Not a git repository");
  }

  // Get current branch before merge
  const currentBranch = runGit(chainDir, ["branch", "--show-current"]);

  // Perform merge. A failure here can mean conflicts (detected below via the
  // status check) OR a genuine error (unrelated histories, bad ref, dirty tree).
  // Capture it so a real failure doesn't fall through to the success path.
  let mergeError: string | null = null;
  try {
    runGit(chainDir, ["merge", ...(strategy ? ["-s", strategy] : []), sourceBranch]);
  } catch (error: unknown) {
    mergeError = error instanceof Error ? error.message : "merge failed";
  }

  // Check for conflicts
  const statusOutput = runGit(chainDir, ["status", "--porcelain"]);

  const conflictedFiles = statusOutput
    .split("\n")
    .filter((line) => line.startsWith("UU") || line.startsWith("AA"))
    .map((line) => line.substring(3))
    .filter((f) => f);

  if (conflictedFiles.length > 0) {
    // Get conflict details
    const conflicts = conflictedFiles.map((file) => {
      const filePath = join(chainDir, file);
      const content = readFileSync(filePath, "utf-8");

      // Parse conflict markers
      const fileConflicts: unknown[] = [];
      const lines = content.split("\n");
      let inConflict = false;
      let currentConflict: { file: string; start: number; end?: number; ours: string[]; theirs?: string[] } | null = null;

      lines.forEach((line, idx) => {
        if (line.startsWith("<<<<<<<")) {
          inConflict = true;
          currentConflict = {
            file,
            start: idx + 1,
            ours: [],
          };
        } else if (line.startsWith("=======") && inConflict) {
          if (currentConflict) currentConflict.theirs = [];
        } else if (line.startsWith(">>>>>>>") && inConflict) {
          if (currentConflict) {
            currentConflict.end = idx + 1;
            fileConflicts.push({ ...currentConflict });
          }
          inConflict = false;
          currentConflict = null;
        } else if (inConflict && currentConflict) {
          if (currentConflict.theirs) {
            currentConflict.theirs.push(line);
          } else {
            currentConflict.ours.push(line);
          }
        }
      });

      return {
        file,
        conflicts: fileConflicts,
      };
    });

    return apiSuccess({
      status: "conflict",
      message: "Merge conflicts detected",
      source: sourceBranch,
      target: currentBranch,
      conflicts,
    });
  }

  // Merge command failed but left no conflict markers — a genuine error, not a
  // conflict. Report it instead of falsely returning success.
  if (mergeError) {
    return apiSuccess({
      status: "error",
      message: mergeError,
      source: sourceBranch,
      target: currentBranch,
    });
  }

  // Get merge result info
  const mergedChainJsonPath = join(chainDir, "chain.json");
  let mergedChain = null;
  if (existsSync(mergedChainJsonPath)) {
    mergedChain = JSON.parse(readFileSync(mergedChainJsonPath, "utf-8"));
  }

  return apiSuccess({
    status: "success",
    message: "Branch merged successfully",
    source: sourceBranch,
    target: currentBranch,
    chain: mergedChain,
  });
});

// Abort merge
export const DELETE = withErrorHandling(async (
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

  const chainDir = orgPath(namespaceId, orgId, "chains", chainId);
  const gitDir = join(chainDir, ".git");

  if (!existsSync(gitDir)) {
    throw new BadRequest("Not a git repository");
  }

  runGit(chainDir, ["merge", "--abort"]);

  return apiSuccess({
    status: "aborted",
    message: "Merge aborted",
  });
});
