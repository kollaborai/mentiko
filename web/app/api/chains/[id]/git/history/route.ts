import { NextRequest } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";
import { orgPath } from "@/lib/config";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";

export const dynamic = "force-dynamic";

interface GitCommit {
  hash: string;
  short: string;
  author: string;
  date: string;
  message: string;
  body: string;
}

// argv git — no shell, so the branch ref can never be interpreted as a command.
function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf-8",
  });
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
  const { searchParams } = new URL(request.url);
  const parsedLimit = parseInt(searchParams.get("limit") || "50", 10);
  const maxCount = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(1000, parsedLimit)) : 50;
  const branch = searchParams.get("branch") || "HEAD";

  // reject option-like refs (array form already kills shell injection)
  if (branch.startsWith("-")) {
    throw new BadRequest("Invalid branch");
  }

  const chainDir = orgPath(namespaceId, orgId, "chains", chainId);
  const gitDir = join(chainDir, ".git");

  if (!existsSync(gitDir)) {
    throw new BadRequest("Not a git repository");
  }

  // Get commit history
  const logFormat = {
    hash: "%H",
    short: "%h",
    author: "%an",
    date: "%ci",
    message: "%s",
    body: "%b",
  };

  const formatString = Object.values(logFormat).join("%x1E");
  const delimiter = "%x1F";

  const logOutput = runGit(
    chainDir,
    ["log", "-n", String(maxCount), `--format=${formatString}${delimiter}`, branch]
  );

  const commits: GitCommit[] = logOutput
    .split(delimiter)
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const parts = chunk.split("\x1e");
      return {
        hash: parts[0]?.trim() || "",
        short: parts[1]?.trim() || "",
        author: parts[2]?.trim() || "",
        date: parts[3]?.trim() || "",
        message: parts[4]?.trim() || "",
        body: parts[5]?.trim() || "",
      };
    });

  // Get current branch
  const currentBranch = runGit(chainDir, ["branch", "--show-current"]).trim();

  return apiSuccess({
    branch: currentBranch,
    commits,
    total: commits.length,
  });
});
