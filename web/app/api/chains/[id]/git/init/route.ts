import { NextRequest } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { orgPath } from "@/lib/config";
import { Unauthorized, NotFound } from "@/lib/api-errors";
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
  const initialBranch = body.branch || "main";

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
  execSync('git init -b "' + initialBranch + '"', { cwd: chainDir, stdio: "pipe" });
  execSync('git config user.name "Agent Chain"', { cwd: chainDir, stdio: "pipe" });
  execSync('git config user.email "agent@chain.local"', { cwd: chainDir, stdio: "pipe" });

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
    execSync("git add chain.json .gitignore", { cwd: chainDir, stdio: "pipe" });
    execSync('git commit -m "Initial import"', { cwd: chainDir, stdio: "pipe" });
  }

  return apiSuccess({
    success: true,
    message: "Git repository initialized",
    repo: chainDir,
    branch: initialBranch,
  });
});
