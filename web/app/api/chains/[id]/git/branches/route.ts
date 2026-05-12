import { NextRequest } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { orgPath } from "@/lib/config";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/api-auth";
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

export const GET = withErrorHandling(async (
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

  // Get current branch
  const currentBranch = execSync("git branch --show-current", {
    cwd: chainDir,
    stdio: "pipe",
    encoding: "utf-8",
  }).trim();

  // Get all branches
  const branchOutput = execSync(
    'git branch -v --format="%(refname:short)%01%(objectname:short)%01%(authorname)%01%(committerdate:iso8601)%01%(contents:subject)"',
    { cwd: chainDir, stdio: "pipe", encoding: "utf-8" }
  );

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

  const { id } = await _context.params;
  const chainId = decodeURIComponent(id);
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const body = await request.json();
  const action = body.action; // create, switch, delete, merge
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
      // Check if branch already exists
      try {
        execSync(`git show-ref --verify --quiet refs/heads/${branch}`, {
          cwd: chainDir,
          stdio: "pipe",
        });
        throw new BadRequest("Branch already exists");
      } catch {
        // Branch doesn't exist, proceed
      }

      execSync(`git branch ${branch} ${startPoint}`, {
        cwd: chainDir,
        stdio: "pipe",
      });
      result.created = true;
      break;
    }

    case "switch": {
      // Stash uncommitted changes
      try {
        execSync('git diff --quiet', { cwd: chainDir, stdio: "pipe" });
      } catch {
        execSync('git stash push -m "auto-stash before switch"', {
          cwd: chainDir,
          stdio: "pipe",
        });
        result.stashed = true;
      }

      execSync(`git checkout ${branch}`, { cwd: chainDir, stdio: "pipe" });
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
      const currentBranch = execSync("git branch --show-current", {
        cwd: chainDir,
        stdio: "pipe",
        encoding: "utf-8",
      }).trim();

      if (branch === currentBranch) {
        throw new BadRequest("Cannot delete current branch");
      }

      const force = body.force || false;
      const deleteFlag = force ? "-D" : "-d";
      execSync(`git branch ${deleteFlag} ${branch}`, {
        cwd: chainDir,
        stdio: "pipe",
      });
      result.deleted = true;
      break;
    }

    case "compare": {
      const target = body.target || "main";
      const ahead = execSync(`git rev-list --count ${target}..${branch}`, {
        cwd: chainDir,
        stdio: "pipe",
        encoding: "utf-8",
      }).trim();
      const behind = execSync(`git rev-list --count ${branch}..${target}`, {
        cwd: chainDir,
        stdio: "pipe",
        encoding: "utf-8",
      }).trim();
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
