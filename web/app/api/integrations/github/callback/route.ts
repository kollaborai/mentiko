import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "@/lib/auth/security";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { readOnboardingState, writeOnboardingState, CURRENT_SETUP_VERSION } from "@/lib/onboarding/onboarding-state";
import { createSecret } from "@/lib/secrets/secrets-store";

export const dynamic = "force-dynamic";
const STATE_COOKIE = "mentiko-github-oauth-state";

export async function GET(request: NextRequest) {
  const redirect = new URL("/settings/integrations?github=error", request.url);
  if (!(await checkAuth(request))) return NextResponse.redirect(redirect);
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const returnedState = params.get("state");
  const cookieState = request.cookies.get(STATE_COOKIE)?.value;
  if (!code || !returnedState || !cookieState || !timingSafeEqual(returnedState, cookieState)) {
    redirect.searchParams.set("reason", "invalid_state");
    return NextResponse.redirect(redirect);
  }
  const ns = await getNamespaceIdFromRequest(request); const org = await getOrgIdFromRequest(request);
  const state = readOnboardingState(ns, org);
  const entry = Object.values(state.operations).find((o) => o.kind === "github_oauth" && o.result && typeof o.result === "object" && "state" in o.result && timingSafeEqual(String((o.result as { state: string }).state), returnedState));
  if (!entry) { redirect.searchParams.set("reason", "expired_state"); return NextResponse.redirect(redirect); }
  try {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code, redirect_uri: process.env.GITHUB_OAUTH_REDIRECT_URI || new URL("/api/integrations/github/callback", request.url).toString() }) });
    if (!tokenResponse.ok) throw new Error("token_exchange_failed");
    const token = await tokenResponse.json() as { access_token?: string };
    if (!token.access_token) throw new Error("missing_access_token");
    const userResponse = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
    if (!userResponse.ok) throw new Error("github_user_failed");
    const user = await userResponse.json() as { id?: number; login?: string; name?: string; avatar_url?: string };
    state.setupVersion = CURRENT_SETUP_VERSION;
    const tokenSecret = createSecret(ns, org, {
      name: "GitHub OAuth token",
      envVar: "GITHUB_ACCESS_TOKEN",
      value: token.access_token,
      description: `OAuth token for GitHub account ${user.login || user.id || "unknown"}`,
    });
    state.github = { status: "connected", account: { id: user.id, login: user.login, name: user.name, avatarUrl: user.avatar_url, tokenSecretId: tokenSecret.id } };
    state.operations[entry.operationId] = { ...entry, status: "completed", result: { state: returnedState, login: user.login } };
    writeOnboardingState(ns, org, state, state.revision);
    const response = NextResponse.redirect(new URL("/settings/integrations?github=connected", request.url));
    response.cookies.delete(STATE_COOKIE);
    return response;
  } catch {
    state.operations[entry.operationId] = { ...entry, status: "failed", result: { state: returnedState } };
    writeOnboardingState(ns, org, state, state.revision);
    redirect.searchParams.set("reason", "oauth_failed");
    return NextResponse.redirect(redirect);
  }
}
