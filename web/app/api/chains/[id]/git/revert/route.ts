import { NextRequest } from "next/server";
import { existsSync, mkdirSync, copyFileSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { orgPath } from "@/lib/config";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/api-auth";
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
  const commit = body.commit;
  const createBranch = body.createBranch || false;

  if (!commit) {
    throw new BadRequest("Commit hash required");
  }

  // validate commit hash — must be 7-40 hex chars only
  if (!/^[a-f0-9]{7,40}$/.test(commit)) {
    throw new BadRequest("Invalid commit hash");
  }

  const chainDir = orgPath(namespaceId, orgId, "chains", chainId);
  const gitDir = join(chainDir, ".git");

  if (!existsSync(gitDir)) {
    throw new BadRequest("Not a git repository");
  }

  // Backup current chain.json
  const backupDir = join(chainDir, ".git-backup");
  mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = join(backupDir, `chain.json.${timestamp}`);
  const chainJsonPath = join(chainDir, "chain.json");

  if (existsSync(chainJsonPath)) {
    copyFileSync(chainJsonPath, backupFile);
  }

  const result: Record<string, unknown> = {
    backup: backupFile,
    targetCommit: commit,
  };

  if (createBranch) {
    // Create a new branch from the commit
    const branchName = `revert-${timestamp}`;
    execSync(`git checkout -b ${branchName} ${commit}`, {
      cwd: chainDir,
      stdio: "pipe",
    });
    result.branch = branchName;
    result.action = "branch_created";
  } else {
    // Hard reset to commit
    execSync(`git reset --hard ${commit}`, {
      cwd: chainDir,
      stdio: "pipe",
    });
    result.action = "reverted";
  }

  // Read the reverted chain content
  let chainContent = null;
  if (existsSync(chainJsonPath)) {
    chainContent = JSON.parse(readFileSync(chainJsonPath, "utf-8"));
  }

  result.chain = chainContent;

  return apiSuccess(result);
});
