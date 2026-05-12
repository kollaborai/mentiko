import { NextRequest } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { orgPath } from "@/lib/config";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/api-auth";
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
  const maxCount = parseInt(searchParams.get("limit") || "50", 10);
  const branch = searchParams.get("branch") || "HEAD";

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

  const logOutput = execSync(
    `git log -n ${maxCount} --format="${formatString}${delimiter}" ${branch}`,
    { cwd: chainDir, stdio: "pipe", encoding: "utf-8" }
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
  const currentBranch = execSync("git branch --show-current", {
    cwd: chainDir,
    stdio: "pipe",
    encoding: "utf-8",
  }).trim();

  return apiSuccess({
    branch: currentBranch,
    commits,
    total: commits.length,
  });
});
