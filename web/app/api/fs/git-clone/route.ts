import { NextRequest } from "next/server";
import { existsSync, mkdirSync, rmSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { execSync, ExecSyncOptionsWithBufferEncoding } from "child_process";
import os from "os";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { writeLog } from "@/lib/system/system-logger";
import { resolveAndValidate, getAllowedRoots } from "@/lib/system/path-validation";
import { BadRequest, Conflict, Forbidden, InternalServerError, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const { url, parent, name, token, branch } = await request.json();

  if (!url || !parent) {
    throw new BadRequest("url and parent required", { fields: ["url", "parent"] });
  }

  if (!url.match(/^(https?:\/\/|git@|ssh:\/\/)/)) {
    throw new BadRequest("invalid git URL", { field: "url" });
  }

  if (branch && !/^[\w.\-/]+$/.test(branch)) {
    throw new BadRequest("invalid branch name", { field: "branch" });
  }

  // resolve auth token: explicit > secrets vault GITHUB_TOKEN
  let authToken = token;
  if (!authToken && url.startsWith("https://")) {
    try {
      const { getSecretByName } = await import("@/lib/secrets/secrets-store");
      authToken = getSecretByName(namespaceId, orgId, "GitHub Token") || undefined;
    } catch { /* secrets not available */ }
  }

  // inject token into https URL for authenticated clones
  let cloneUrl = url;
  if (authToken && url.startsWith("https://")) {
    cloneUrl = url.replace("https://", `https://${authToken}@`);
  }

  let base: string;
  if (parent.startsWith("~")) {
    base = join(os.homedir(), parent.slice(1));
  } else {
    base = resolve(parent);
  }

  // validate parent directory is within allowed roots
  const validatedBase = resolveAndValidate(base, await getAllowedRoots(request));
  if (!validatedBase) {
    throw new Forbidden("Parent path not within any registered workspace");
  }

  const folderName = name || url.replace(/\.git$/, "").split("/").pop() || "repo";
  if (folderName.includes("..")) {
    throw new BadRequest("invalid folder name", { field: "name" });
  }

  if (!existsSync(validatedBase)) {
    try { mkdirSync(validatedBase, { recursive: true }); } catch { /* ignore */ }
  }

  const target = join(validatedBase, folderName);

  if (existsSync(target)) {
    throw new Conflict("folder already exists", { path: target });
  }

  try {
    const branchFlag = branch ? `-b ${JSON.stringify(branch)} ` : "";
    execSync(`git clone --depth 1 ${branchFlag}${JSON.stringify(cloneUrl)} ${JSON.stringify(target)}`, {
      timeout: 120000,
      stdio: "pipe",
    } as ExecSyncOptionsWithBufferEncoding);
  } catch (cloneErr) {
    if (existsSync(target)) {
      try { rmSync(target, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    const err = cloneErr as { stderr?: Buffer | string; message?: string };
    const stderr = err.stderr ? err.stderr.toString().trim() : "";
    // sanitize token from error output
    const sanitized = authToken ? stderr.replace(new RegExp(authToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "***") : stderr;
    const errorLine = sanitized.split("\n").find(l => l.toLowerCase().includes("error") || l.toLowerCase().includes("fatal")) || sanitized.split("\n")[0];
    const rawMsg = errorLine || (err.message || "git clone failed");
    const msg = authToken ? rawMsg.replace(new RegExp(authToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "***") : rawMsg;
    writeLog(namespaceId, orgId, "error", "git-clone", `Clone failed: ${url}`, msg);
    throw new InternalServerError(msg);
  }

  const files = existsSync(target) ? readdirSync(target) : [];
  if (files.length === 0) {
    if (existsSync(target)) {
      try { rmSync(target, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    const emptyMsg = "clone produced empty directory — check repo URL and credentials";
    writeLog(namespaceId, orgId, "error", "git-clone", `Clone empty: ${url}`, emptyMsg);
    throw new InternalServerError(emptyMsg);
  }

  writeLog(namespaceId, orgId, "info", "git-clone", `Cloned ${url} → ${target}`);
  return apiSuccess({ path: target, name: folderName });
});
