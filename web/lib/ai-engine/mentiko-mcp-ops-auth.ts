// -------------------------------------------------------------------
// mentiko-mcp-ops-auth.ts — Auth for /api/mentiko-mcp/ops/* endpoints.
// -------------------------------------------------------------------
// All ops routes (data plane operations: list/read/write artifacts, agents,
// chains, etc.) call requireOpsAuth() — JWT bearer token only.
//
// SECURITY MODEL: ops endpoints are MUTATIVE and READ-ONLY access to
// user data. We require a signed JWT (session token) because:
//   1. JWTs encode user identity + role for RBAC
//   2. JWTs are short-lived (24h expiry — see session-token.ts TTL_SECONDS)
//
// NOTE: these access tokens are NOT individually revocable today and are
// INDEPENDENT of the better-auth cookie session — logout does NOT invalidate
// them. Revocation levers: 24h expiry, or rotating BETTER_AUTH_SECRET (global).
// The MCP device-flow *refresh* tokens (lib/auth/mcp-device-auth.ts) ARE
// revocable per-token; see docs/specs/MCP_AUTH_RECOVERY.md.
//
// MENTIKO_INBOX_KEY is NOT accepted here. The inbox key is a shared
// secret used ONLY for the signaling channel (dispatch/stream/reply) to
// allow the mentiko-mcp stdio subprocess to push UI effects to the browser
// without requiring a JWT for every SSE message. Accepting it here would
// weaken the security boundary — any subprocess with the inbox key could
// perform arbitrary data operations.
//
// Permission checks: requireOpsPermission() enforces both scope-based
// (ops:*, ops:read, etc.) and role-based (admin, member, etc.) access.
// -------------------------------------------------------------------

import { NextResponse } from "next/server";
import { verifySessionToken } from "../auth/session-token";
import { canRolePerformAction, type OrgAction, type OrgRole } from "../orgs/org-types";

export interface OpsContext {
  userId:      string;
  sessionId:   string;
  namespaceId: string;
  orgId:       string;
  role?:       OrgRole;
  scopes:      string[];
}

export async function requireOpsAuth(req: Request): Promise<OpsContext | NextResponse> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const token = authHeader.slice(7);
  let claims;
  try {
    claims = await verifySessionToken(token);
  } catch {
    return new NextResponse("Invalid or expired session token", { status: 401 });
  }

  const ctx: OpsContext = {
    userId:      claims.sub,
    sessionId:   claims.jti,
    namespaceId: claims.ns,
    orgId:       claims.org,
    role:        claims.role,
    scopes:      claims.scopes || [],
  };

  // structured audit log — every authenticated data ops call
  const url = new URL(req.url);
  console.log(JSON.stringify({
    level: "info",
    event: "mcp_ops_access",
    userId:      ctx.userId,
    sessionId:   ctx.sessionId,
    namespaceId: ctx.namespaceId,
    orgId:       ctx.orgId,
    role:        ctx.role,
    scopes:      ctx.scopes,
    method:      req.method,
    path:        url.pathname,
    ts:          new Date().toISOString(),
  }));

  return ctx;
}

export function requireOpsPermission(
  ctx: OpsContext,
  action: OrgAction,
  scope?: string | string[],
): NextResponse | null {
  const requiredScopes = Array.isArray(scope) ? scope : scope ? [scope] : [];
  const hasScope =
    ctx.scopes.includes("ops:*") ||
    requiredScopes.some((required) => ctx.scopes.includes(required));

  if (hasScope) return null;
  if (ctx.role && canRolePerformAction(ctx.role, action)) return null;

  return NextResponse.json(
    {
      error: "Forbidden",
      message: "MCP session token does not have permission for this operation",
      action,
      requiredScopes,
      role: ctx.role || "unknown",
    },
    { status: 403 },
  );
}
