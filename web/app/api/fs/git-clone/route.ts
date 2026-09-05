import { NextRequest } from "next/server";
import { existsSync, mkdirSync, mkdtempSync, rmSync, readdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { execSync, ExecSyncOptionsWithBufferEncoding } from "child_process";
import os from "os";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { writeLog } from "@/lib/system/system-logger";
import { resolveAndValidate, getAllowedRoots } from "@/lib/system/path-validation";
import { getSecretByName, getSecretValue } from "@/lib/secrets/secrets-store";
import { BadRequest, Conflict, Forbidden, InternalServerError, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// Fixed, non-secret one-liner: the token itself travels only via the child
// git process's own environment (set right below), never through this file,
// argv, or the clone URL. Git invokes $GIT_ASKPASS and reads the password
// from stdout only at the moment it actually needs one.
const ASKPASS_SCRIPT = "#!/bin/sh\nprintf '%s' \"$MENTIKO_GIT_ASKPASS_TOKEN\"\n";

/** Run fn with a short-lived GIT_ASKPASS helper wired up when a token is present; always cleaned up. */
function withGitAskpassEnv<T>(token: string | undefined, fn: (env: NodeJS.ProcessEnv | undefined) => T): T {
  if (!token) return fn(undefined);
  const dir = mkdtempSync(join(os.tmpdir(), "mentiko-git-askpass-"));
  try {
    const scriptPath = join(dir, "askpass.sh");
    writeFileSync(scriptPath, ASKPASS_SCRIPT, { mode: 0o700 });
    return fn({ ...process.env, GIT_ASKPASS: scriptPath, GIT_TERMINAL_PROMPT: "0", MENTIKO_GIT_ASKPASS_TOKEN: token });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const { url, parent, name, tokenSecretId, branch } = await request.json();

  if (!url || !parent) {
    throw new BadRequest("url and parent required", { fields: ["url", "parent"] });
  }

  if (!url.match(/^(https?:\/\/|git@|ssh:\/\/)/)) {
    throw new BadRequest("invalid git URL", { field: "url" });
  }

  if (branch && !/^[\w.\-/]+$/.test(branch)) {
    throw new BadRequest("invalid branch name", { field: "branch" });
  }

  // Resolve the token server-side only, by reference — never accept a raw
  // PAT in the request body (spec: no raw tokens in browser request bodies).
  // explicit secret reference > secrets vault "GitHub Token" fallback.
  let authToken: string | undefined;
  if (typeof tokenSecretId === "string" && tokenSecretId) {
    authToken = getSecretValue(namespaceId, orgId, tokenSecretId) || undefined;
    if (!authToken) throw new BadRequest("Referenced secret was not found", { field: "tokenSecretId" });
  } else if (url.startsWith("https://")) {
    try {
      authToken = getSecretByName(namespaceId, orgId, "GitHub Token") || undefined;
    } catch { /* secrets not available */ }
  }

  // A username-only URL (no password) is what makes git actually invoke
  // GIT_ASKPASS for the password — never the token itself, and never in
  // argv/logs/git config, unlike the old `https://${token}@host/...` form.
  let cloneUrl = url;
  if (authToken && url.startsWith("https://") && !/^https:\/\/[^/@]+@/.test(url)) {
    cloneUrl = url.replace("https://", "https://x-access-token@");
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
    withGitAskpassEnv(authToken, (env) => execSync(`git clone --depth 1 ${branchFlag}${JSON.stringify(cloneUrl)} ${JSON.stringify(target)}`, {
      timeout: 120000,
      stdio: "pipe",
      ...(env ? { env } : {}),
    } as ExecSyncOptionsWithBufferEncoding));
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
