import { NextRequest } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { orgPath } from "@/lib/config";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";

export const dynamic = "force-dynamic";

interface DiffFile {
  status: string;
  file: string;
  additions?: number;
  deletions?: number;
}

interface DiffResult {
  from: string;
  to: string;
  files: DiffFile[];
  summary: {
    filesChanged: number;
    additions: number;
    deletions: number;
  };
  diff?: string;
}

function getStatusSymbol(status: string): string {
  switch (status) {
    case "A": return "added";
    case "D": return "deleted";
    case "M": return "modified";
    case "R": return "renamed";
    case "C": return "copied";
    default: return status;
  }
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
  const from = searchParams.get("from") || "HEAD";
  const to = searchParams.get("to") || "";
  const includeContent = searchParams.get("content") === "true";

  const chainDir = orgPath(namespaceId, orgId, "chains", chainId);
  const gitDir = join(chainDir, ".git");

  if (!existsSync(gitDir)) {
    throw new BadRequest("Not a git repository");
  }

  const toRev = to || "HEAD";

  // Get diff summary
  const diffOutput = execSync(
    `git diff --numstat ${from} ${toRev}`,
    { cwd: chainDir, stdio: "pipe", encoding: "utf-8" }
  );

  const files: DiffFile[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;

  diffOutput.split("\n").forEach((line) => {
    if (!line.trim()) return;

    const [addStr, delStr, ...fileParts] = line.split("\t");
    const file = fileParts.join("\t").trim();

    if (file) {
      const additions = addStr === "-" ? 0 : parseInt(addStr, 10);
      const deletions = delStr === "-" ? 0 : parseInt(delStr, 10);

      totalAdditions += additions;
      totalDeletions += deletions;

      const statusOutput = execSync(
        `git diff --name-status ${from} ${toRev} -- "${file}"`,
        { cwd: chainDir, stdio: "pipe", encoding: "utf-8" }
      );
      const status = statusOutput.trim().split(" ")[0] || "M";

      files.push({
        status: getStatusSymbol(status),
        file,
        additions,
        deletions,
      });
    }
  });

  const result: DiffResult = {
    from,
    to: toRev,
    files,
    summary: {
      filesChanged: files.length,
      additions: totalAdditions,
      deletions: totalDeletions,
    },
  };

  // Optionally include full diff content
  if (includeContent) {
    const diffContent = execSync(
      `git diff ${from} ${toRev}`,
      { cwd: chainDir, stdio: "pipe", encoding: "utf-8" }
    );
    result.diff = diffContent;
  }

  return apiSuccess(result);
});

// Get file content at a specific commit
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
  const commit = body.commit || "HEAD";
  const file = body.file || "chain.json";

  const chainDir = orgPath(namespaceId, orgId, "chains", chainId);
  const gitDir = join(chainDir, ".git");

  if (!existsSync(gitDir)) {
    throw new BadRequest("Not a git repository");
  }

  const content = execSync(
    `git show ${commit}:${file}`,
    { cwd: chainDir, stdio: "pipe", encoding: "utf-8" }
  );

  return apiSuccess({
    commit,
    file,
    content,
  });
});
