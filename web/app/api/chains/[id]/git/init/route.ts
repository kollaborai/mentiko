import { NextRequest } from "next/server";
import { existsSync, mkdirSync, copyFileSync, readFileSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";
import { orgPath } from "@/lib/config";
import { Unauthorized, BadRequest, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";

export const dynamic = "force-dynamic";

// argv git — no shell, so the branch name can never be interpreted as a
// command (the old `execSync('git init -b "' + initialBranch + '"')` form
// broke on a literal `"` in the name and let `$()` / backticks through).
function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf-8",
  });
}

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
  const initialBranch =
    (typeof body.branch === "string" ? body.branch.trim() : "") || "main";

  // reject shell/flag-like branch names (defense against option-injection on
  // top of the argv form)
  if (!/^[a-zA-Z0-9._\-/]+$/.test(initialBranch)) {
    throw new BadRequest("Invalid branch name");
  }

  const chainDir = orgPath(namespaceId, orgId, "chains", chainId);

  if (!existsSync(chainDir)) {
    throw new NotFound("Chain", chainId);
  }

  const gitDir = join(chainDir, ".git");

  if (existsSync(gitDir)) {
    return apiSuccess({
      success: true,
      message: "Already a git repository",
      repo: chainDir,
    });
  }

  // Initialize git repo
  runGit(chainDir, ["init", "-b", initialBranch]);
  runGit(chainDir, ["config", "user.name", "Agent Chain"]);
  runGit(chainDir, ["config", "user.email", "agent@chain.local"]);

  // Create .gitignore
  const gitignorePath = join(chainDir, ".gitignore");
  const gitignoreContent = `# state files
*.state
*.event

# temp files
.tmp/
*.tmp
.rollback-backup/

# cache
.cache/

# IDE
.idea/
.vscode/
*.swp
*.swo
`;
  const { writeFile } = await import("fs/promises");
  await writeFile(gitignorePath, gitignoreContent);

  // Initial commit if chain.json exists
  const chainJsonPath = join(chainDir, "chain.json");
  if (existsSync(chainJsonPath)) {
    runGit(chainDir, ["add", "chain.json", ".gitignore"]);
    runGit(chainDir, ["commit", "-m", "Initial import"]);
  }

  return apiSuccess({
    success: true,
    message: "Git repository initialized",
    repo: chainDir,
    branch: initialBranch,
  });
});
