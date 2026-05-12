/**
 * mentiko-mcp-ops-auth.ts
 *
 * Auth for /api/mentiko-mcp/ops/* endpoints.
 * All ops routes call requireOpsAuth() — JWT bearer token only.
 * MENTIKO_INBOX_KEY is NOT accepted here (it is retained only for
 * the signaling channel: dispatch/stream/reply).
 */

import { NextResponse } from "next/server";
import { verifySessionToken } from "./session-token";
import { canRolePerformAction, type OrgAction, type OrgRole } from "./org-types";

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
