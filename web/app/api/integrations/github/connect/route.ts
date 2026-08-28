import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { withErrorHandling } from "@/lib/api-response";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
import { readOnboardingState, writeOnboardingState, CURRENT_SETUP_VERSION } from "@/lib/onboarding/onboarding-state";

export const dynamic = "force-dynamic";
const STATE_COOKIE = "mentiko-github-oauth-state";

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) throw new Unauthorized();
  if (!process.env.GITHUB_CLIENT_ID) throw new BadRequest("GitHub OAuth is not configured");
  const body = await request.json().catch(() => ({}));
  const setupVersion = Number(body.setupVersion);
  const idempotencyKey = String(body.idempotencyKey || "");
  if (!idempotencyKey) throw new BadRequest("idempotencyKey is required");
  if (setupVersion !== CURRENT_SETUP_VERSION) throw new BadRequest("Unsupported setupVersion", { setupVersion, current: CURRENT_SETUP_VERSION });
  const ns = await getNamespaceIdFromRequest(request); const org = await getOrgIdFromRequest(request);
  const state = readOnboardingState(ns, org);
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
