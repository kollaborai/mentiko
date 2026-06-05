import { NextRequest } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { orgPath } from "@/lib/config";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (
  request: NextRequest,
  _context: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { id } = await _context.params;
  const chainId = decodeURIComponent(id);
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
  const currentBranch = execSync("git branch --show-current", {
    cwd: chainDir,
    stdio: "pipe",
    encoding: "utf-8",
  }).trim();

  // Perform merge
  const strategyArg = strategy ? `-s ${strategy}` : "";

  try {
    execSync(`git merge ${strategyArg} ${sourceBranch}`, {
      cwd: chainDir,
      stdio: "pipe",
      encoding: "utf-8",
    });
  } catch (_error: unknown) {
    // merge failed, check for conflicts below
  }

  // Check for conflicts
  const statusOutput = execSync("git status --porcelain", {
    cwd: chainDir,
    stdio: "pipe",
    encoding: "utf-8",
  });

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

  const { id } = await _context.params;
  const chainId = decodeURIComponent(id);
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const chainDir = orgPath(namespaceId, orgId, "chains", chainId);
  const gitDir = join(chainDir, ".git");

  if (!existsSync(gitDir)) {
    throw new BadRequest("Not a git repository");
  }

  execSync("git merge --abort", { cwd: chainDir, stdio: "pipe" });

  return apiSuccess({
    status: "aborted",
    message: "Merge aborted",
  });
});
