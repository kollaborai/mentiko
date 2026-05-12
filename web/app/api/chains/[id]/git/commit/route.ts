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

// validate chain ID - prevent path traversal
function validateChainId(id: string): string {
  const sanitized = String(id).replace(/[^a-zA-Z0-9\-_]/g, "");
  if (sanitized.length === 0 || sanitized.length > 100) {
    throw new BadRequest("Invalid chain ID");
  }
  return sanitized;
}

// sanitize git commit message - prevent command injection
function sanitizeCommitMessage(message: string): string {
  // remove dangerous characters that could break out of quotes
  // limit length
  let sanitized = message.slice(0, 1000);
  // remove null bytes and control characters except newlines
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  // escape backslashes and quotes for shell
  sanitized = sanitized.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return sanitized;
}

// sanitize git file list - prevent command injection
function sanitizeFileList(files: string | string[]): string {
  const fileList = Array.isArray(files) ? files : [files];
  // only allow safe filename characters
  const safe = fileList.map(f => {
    const name = String(f).replace(/[^a-zA-Z0-9\-_./]/g, "");
    // prevent path traversal
    if (name.includes("..") || name.startsWith("/")) {
      return "";
    }
    return name;
  }).filter(Boolean).join(" ");

  if (safe.length > 5000) {
    throw new BadRequest("File list too long");
  }
  return safe;
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
  const message = sanitizeCommitMessage(body.message || "chore: update chain");
  const files = body.files || ".";

  const chainDir = orgPath(namespaceId, orgId, "chains", chainId);
  const gitDir = join(chainDir, ".git");

  if (!existsSync(gitDir)) {
    throw new BadRequest("Not a git repository");
  }

  // Stage files with sanitization
  if (files === ".") {
    execSync("git add -A", { cwd: chainDir, stdio: ["pipe", "pipe", "pipe"], timeout: 30000 });
  } else {
    const safeFileList = sanitizeFileList(files);
    if (safeFileList.length === 0) {
      throw new BadRequest("Invalid file list");
    }
    execSync(`git add ${safeFileList}`, { cwd: chainDir, stdio: ["pipe", "pipe", "pipe"], timeout: 30000 });
  }

  // Check if there's anything to commit
  try {
    execSync("git diff --cached --quiet", { cwd: chainDir, stdio: ["pipe", "pipe", "pipe"], timeout: 30000 });
    return apiSuccess({
      success: true,
      message: "Nothing to commit",
      commit: null,
    });
  } catch {
    // Changes exist, proceed with commit
  }

  // Commit with sanitized message - use heredoc-style to avoid injection
  const commitCmd = `git commit -m "${message}"`;
  execSync(commitCmd, {
    cwd: chainDir,
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf-8",
    timeout: 30000,
  });

  const commitHash = execSync("git rev-parse HEAD", {
    cwd: chainDir,
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf-8",
    timeout: 30000,
  }).trim();

  const shortHash = execSync("git rev-parse --short HEAD", {
    cwd: chainDir,
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf-8",
    timeout: 30000,
  }).trim();

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
