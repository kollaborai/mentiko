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

// validate chain ID - prevent path traversal
function validateChainId(id: string): string {
  const sanitized = String(id).replace(/[^a-zA-Z0-9\-_]/g, "");
  if (sanitized.length === 0 || sanitized.length > 100) {
    throw new BadRequest("Invalid chain ID");
  }
  return sanitized;
}

// argv git — no shell, so file paths and the commit message can never be
// interpreted as a command. This is what makes the old `execSync(`git commit
// -m "${message}"`)` shell-string form (which left `$()` / backticks live in
// the message) a non-issue here.
function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf-8",
    timeout: 30000,
  });
}

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
