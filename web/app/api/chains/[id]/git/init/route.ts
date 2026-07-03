import { NextRequest } from "next/server";
import { existsSync, mkdirSync, copyFileSync, readFileSync } from "fs";
import { join } from "path";
import { runGit } from "@/lib/git/exec";
import { orgPath } from "@/lib/config";
import { Unauthorized, BadRequest, NotFound } from "@/lib/api-errors";
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
