import { NextRequest } from "next/server";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { getSecretsEnvVars, resolveProfileEnvVars } from "@/lib/secrets/secrets-store";
import { getWorkspace } from "@/lib/workspaces/workspace-storage";
import { getProfile, findDefaultProfile } from "@/lib/agents/agent-profile-storage";
import { recordSessionOwner } from "@/lib/pty/session-owners";
import config from "@/lib/config";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    throw new Unauthorized();
  }

  const body = await request.json();
  const { name, cwd, workspaceId } = body;
  const terminalCwd = typeof cwd === "string" && cwd.trim() ? cwd.trim() : undefined;

  if (!name || typeof name !== "string") {
    throw new BadRequest("name is required", { field: "name" });
  }

  // validate session name
  if (!/^[a-zA-Z0-9][a-zA-Z0-9\-_]{0,99}$/.test(name)) {
    throw new BadRequest("invalid session name", { field: "name" });
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const { pty } = await import("@/lib/pty/pty-client");

  // check if session already exists
  try {
    const alive = await pty.alive(name);
    if (alive) {
      return apiSuccess({ name, status: "already_exists" });
    }
  } catch {
    // session doesn't exist, that's fine
  }

  // detect user's default shell, fallback to zsh (matches pty-manager + pty-client defaults)
  const userShell = process.env.SHELL || "zsh";
  const shellName = userShell.split("/").pop() || "zsh";

  // on VPS, spawn as the user's linux account (sudo -u {username} {shell} -l)
  // pty-manager runs as mentiko, which has NOPASSWD sudo
  const linuxUser = sessionUser?.linuxUsername;

  // VPS deployments require linuxUsername for isolation
  // local dev can use fallback (shared account acceptable for single-user dev)
  const isVps = process.env.NODE_ENV === "production";
  if (isVps && !linuxUser) {
    // TODO: enforce once linuxUsername is populated for all users
    // for now, allow with warning for backwards compatibility
    console.warn(`[terminal/spawn] VPS spawn without linuxUsername for user ${sessionUser?.id}. This will be enforced in future.`);
  }

  const spawnCmd = linuxUser ? "sudo" : shellName;
  const spawnArgs = linuxUser ? ["-u", linuxUser, shellName, "-l"] : ["-l"];

  // source secrets + workspace env into the terminal session
  let secretsEnv: Record<string, string> = {};
  try {
    secretsEnv = getSecretsEnvVars(namespaceId, orgId);
  } catch {
    // secrets store may not be initialized yet
  }

  let workspaceEnv: Record<string, string> = {};
  let profileEnv: Record<string, string> = {};
  if (workspaceId && typeof workspaceId === "string") {
    const workspace = getWorkspace(namespaceId, orgId, workspaceId);
    if (workspace?.env) {
      workspaceEnv = workspace.env;
    }
    // resolve agent profile env vars (workspace default_agent_profile > org default profile)
    // if workspace points to a missing profile, fall back to org default
    const profileId = workspace?.default_agent_profile;
    const profile =
      (profileId ? getProfile(namespaceId, orgId, profileId) : null) ||
      findDefaultProfile(namespaceId, orgId);
    if (profile?.env && Object.keys(profile.env).length > 0) {
      profileEnv = resolveProfileEnvVars(namespaceId, orgId, profile.env);
    }
  } else {
    // no workspace -- still try the org default profile
    const profile = findDefaultProfile(namespaceId, orgId);
    if (profile?.env && Object.keys(profile.env).length > 0) {
      profileEnv = resolveProfileEnvVars(namespaceId, orgId, profile.env);
    }
  }

  // build safe env -- only pass through known-safe shell variables.
  // SECURITY: never spread process.env here. that leaks server secrets
  // (BETTER_AUTH_SECRET, STRIPE_SECRET_KEY, DB creds, etc.) into the
  // user's interactive terminal session.
  const SAFE_ENV_KEYS = [
    "PATH", "HOME", "SHELL", "TERM", "LANG", "USER", "LOGNAME",
    "EDITOR", "VISUAL", "PAGER",
    "LC_ALL", "LC_CTYPE", "LC_MESSAGES",
    "TMPDIR", "XDG_RUNTIME_DIR",
    "COLORTERM", "TERM_PROGRAM",
  ];
  const safeEnv: Record<string, string> = {};
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key]) safeEnv[key] = process.env[key]!;
  }

  // spawn new session
  const result = await pty.spawn(name, spawnCmd, spawnArgs, {
    cwd: terminalCwd,
    env: {
      ...safeEnv,
      // mentiko path resolution (needed by bin/ and lib/ scripts)
      MENTIKO_GLOBAL_ROOT: config.globalRoot,
      MENTIKO_CODE_ROOT: config.codeRoot,
      MENTIKO_PROJECT_ROOT: config.projectRoot,
      MENTIKO_ORG_ROOT: config.orgRoot,
      MENTIKO_NAMESPACE_ROOT: config.namespaceRoot,
      ...(terminalCwd ? { MENTIKO_WORKSPACE_PATH: terminalCwd } : {}),
      NAMESPACE_ID: namespaceId,
      ORG_ID: orgId,
      // agent profile env (default profile or workspace-assigned profile)
      ...profileEnv,
      // workspace env + vault secrets (intentionally injected, not leaked)
      ...workspaceEnv,
      ...secretsEnv,
    },
  });

  // record ownership so other users cannot attach to / capture / send input
  // to this interactive session (see lib/pty/session-owners.ts).
  recordSessionOwner(result.name, sessionUser.id);

  return apiSuccess({
    name: result.name,
    pid: result.pid,
    status: "created",
  });
});
