import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { withErrorHandling } from "@/lib/api-response";
import { BadRequest, ServiceUnavailable, Unauthorized } from "@/lib/api-errors";
import { readOnboardingState, writeOnboardingState, CURRENT_SETUP_VERSION } from "@/lib/onboarding/onboarding-state";
import { createSecret } from "@/lib/secrets/secrets-store";
import { getGhCliToken } from "@/lib/integrations/gh-cli";

export const dynamic = "force-dynamic";
const STATE_COOKIE = "mentiko-github-oauth-state";

const GITHUB_HEADERS = {
  Authorization: "", // set per call
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
} as const;

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) throw new Unauthorized();
  const body = await request.json().catch(() => ({}));
  const setupVersion = Number(body.setupVersion);
  const idempotencyKey = String(body.idempotencyKey || "");
  const method = body.method === "gh-cli" ? "gh-cli" : "oauth";
  if (!idempotencyKey) throw new BadRequest("idempotencyKey is required");
  if (setupVersion !== CURRENT_SETUP_VERSION) throw new BadRequest("Unsupported setupVersion", { setupVersion, current: CURRENT_SETUP_VERSION });
  const ns = await getNamespaceIdFromRequest(request);
  const org = await getOrgIdFromRequest(request);
  const state = readOnboardingState(ns, org);

  if (method === "gh-cli") {
    // no GITHUB_CLIENT_ID needed — the signed-in gh CLI's token is the credential
    const prior = Object.values(state.operations).find((o) => o.kind === "github_ghcli" && o.idempotencyKey === idempotencyKey);
    if (prior?.status === "completed" && state.github.status === "connected") {
      return NextResponse.json({ success: true, data: { connected: true, source: "gh-cli" } });
    }
    const token = await getGhCliToken();
    if (!token) throw new ServiceUnavailable("gh CLI is not signed in — run `gh auth login` or use OAuth");
    const userResponse = await fetch("https://api.github.com/user", {
      headers: { ...GITHUB_HEADERS, Authorization: `Bearer ${token}` },
    });
    if (userResponse.status === 401 || userResponse.status === 403) throw new ServiceUnavailable("gh CLI token was rejected — re-run `gh auth login`");
    if (!userResponse.ok) throw new ServiceUnavailable("GitHub user lookup is unavailable");
    const user = (await userResponse.json()) as { id?: number; login?: string; name?: string; avatar_url?: string };
    const tokenSecret = createSecret(ns, org, {
      name: "GitHub CLI token",
      envVar: "GITHUB_ACCESS_TOKEN",
      value: token,
      description: `gh CLI token for GitHub account ${user.login || user.id || "unknown"}`,
    });
    state.setupVersion = CURRENT_SETUP_VERSION;
    state.github = { status: "connected", account: { id: user.id, login: user.login, name: user.name, avatarUrl: user.avatar_url, tokenSecretId: tokenSecret.id } };
    const operationId = prior?.operationId || `onb_${crypto.randomUUID()}`;
    state.operations[operationId] = { operationId, idempotencyKey, kind: "github_ghcli", status: "completed", phase: "github", createdAt: new Date().toISOString(), result: { source: "gh-cli", login: user.login } };
    writeOnboardingState(ns, org, state, state.revision);
    return NextResponse.json({ success: true, data: { connected: true, source: "gh-cli", login: user.login } });
  }

  if (!process.env.GITHUB_CLIENT_ID) throw new BadRequest("GitHub OAuth is not configured");
  const prior = Object.values(state.operations).find((o) => o.kind === "github_oauth" && o.idempotencyKey === idempotencyKey);
  const oauthState = prior?.result && typeof prior.result === "object" && "state" in prior.result ? String((prior.result as { state: string }).state) : randomBytes(32).toString("hex");
  if (!prior) {
    const operationId = `onb_${crypto.randomUUID()}`;
    state.operations[operationId] = { operationId, idempotencyKey, kind: "github_oauth", status: "in_progress", phase: "github", createdAt: new Date().toISOString(), result: { state: oauthState } };
    writeOnboardingState(ns, org, state, state.revision);
  }
  const redirectUri = process.env.GITHUB_OAUTH_REDIRECT_URI || new URL("/api/integrations/github/callback", request.url).toString();
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", process.env.GITHUB_CLIENT_ID); url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", process.env.GITHUB_OAUTH_SCOPE || "repo read:user user:email"); url.searchParams.set("state", oauthState);
  const response = NextResponse.json({ success: true, data: { authorizationUrl: url.toString() } });
  response.cookies.set(STATE_COOKIE, oauthState, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  return response;
});
