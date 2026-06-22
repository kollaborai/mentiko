import { NextRequest } from "next/server";
import path from "path";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getProfile, getProfilesDir } from "@/lib/agents/agent-profile-storage";
import { recordSessionOwner } from "@/lib/pty/session-owners";
import { buildChildEnv } from "@/lib/runs/child-env";
import { resolveAndValidate, getAllowedRoots } from "@/lib/system/path-validation";
import config, { nsPath, orgPath } from "@/lib/config";
import { BadRequest, Forbidden, NotFound, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function buildSessionName(profileId: string): string {
  const slug = profileId.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `agent-test-${(slug || "profile").slice(0, 40)}-${Date.now()}`;
}

export const POST = withErrorHandling(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    const permError = await requirePermission(request, "manage_chains");
    if (permError) return permError;

    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      throw new Unauthorized();
    }

    const { id } = await context.params;
    const namespaceId = await getNamespaceIdFromRequest(request);
    const orgId = await getOrgIdFromRequest(request);
    const profileId = decodeURIComponent(id);
    const profile = getProfile(namespaceId, orgId, profileId);

    if (!profile) {
      throw new NotFound("Profile", profileId);
    }

    let body: { cwd?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const rawCwd = typeof body.cwd === "string" && body.cwd.trim() ? body.cwd.trim() : undefined;
    let terminalCwd: string | undefined;
    if (rawCwd) {
      const validated = resolveAndValidate(rawCwd, await getAllowedRoots(request));
      if (!validated) {
        throw new Forbidden("cwd is outside the allowed roots");
      }
      terminalCwd = validated;
    }

    const profileFile = path.join(getProfilesDir(namespaceId, orgId), `${profile.id}.json`);
    const helperFile = path.join(config.codeRoot, "lib", "agent-profile.sh");
    const namespaceRoot = nsPath(namespaceId);
    const orgRoot = orgPath(namespaceId, orgId);
    const sessionName = buildSessionName(profile.id);

    if (!/^[a-zA-Z0-9][a-zA-Z0-9\-_]{0,99}$/.test(sessionName)) {
      throw new BadRequest("invalid generated session name");
    }

    const launchScript = [
      "set -e",
      `source ${shellQuote(helperFile)}`,
      `cmd=$(build_profile_command ${shellQuote(profileFile)} --interactive)`,
      `printf '\\033]0;%s\\007' ${shellQuote(`test ${profile.name}`)}`,
      "exec bash -lc \"$cmd\"",
    ].join("\n");

    const { pty } = await import("@/lib/pty/pty-client");
    const result = await pty.spawn(sessionName, "bash", ["-lc", launchScript], {
      cwd: terminalCwd || config.codeRoot,
      env: buildChildEnv({
        MENTIKO_GLOBAL_ROOT: config.globalRoot,
        MENTIKO_CODE_ROOT: config.codeRoot,
        MENTIKO_PROJECT_ROOT: namespaceRoot,
        MENTIKO_ORG_ROOT: orgRoot,
        MENTIKO_NAMESPACE_ROOT: namespaceRoot,
        ...(terminalCwd ? { MENTIKO_WORKSPACE_PATH: terminalCwd } : {}),
        NAMESPACE_ID: namespaceId,
        ORG_ID: orgId,
      }),
    });

    recordSessionOwner(result.name, sessionUser.id);

    return apiSuccess({
      name: result.name,
      pid: result.pid,
      profileId: profile.id,
      message: `Launched ${profile.name}`,
    });
  }
);
