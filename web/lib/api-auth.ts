/**
 * api-auth: auth utilities for API route handlers.
 * delegates to auth-bridge (Better Auth).
 *
 * AUTH PATTERN INVENTORY (as of 2026-03-27):
 *
 *   161 routes  - bare checkAuth(request) from this file (auth-only)
 *    50 routes  - requirePermission(request, action) from rbac-auth.ts (RBAC wrapper)
 *    11 routes  - checkPermission/requirePermission from this file (curried middleware)
 *     0 routes  - withAuth() from this file (defined but unused)
 *
 * RECOMMENDED PATTERNS (in order of preference):
 *
 * 1. requirePermission(request, action) from rbac-auth.ts
 *    for routes needing RBAC permission checks. returns null if allowed,
 *    or a 401/403 NextResponse if not. simple guard pattern:
 *
 *      import { requirePermission } from "@/lib/rbac-auth";
 *      const authError = await requirePermission(request, "manage_chains");
 *      if (authError) return authError;
 *
 * 2. enforceGuestWrites(request) from middleware/guest-enforcement.ts
 *    for blocking guest write operations. returns null if allowed,
 *    or a 403 NextResponse if blocked. simple guard pattern:
 *
 *      import { enforceGuestWrites } from "@/lib/middleware";
 *      const blockResult = await enforceGuestWrites(request);
 *      if (blockResult?.blocked) return blockResult.response;
 *
 * 3. checkAuth(request) from this file
 *    for routes that only need authentication (no permission check).
 *    returns boolean:
 *
 *      import { checkAuth } from "@/lib/api-auth";
 *      if (!(await checkAuth(request))) {
 *        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
 *      }
 *
 * AVOID in new code:
 *   - withAuth() from this file (unused wrapper, adds indirection)
 *   - withAuth(action, handler) from rbac-auth.ts (express-style wrapper,
 *     harder to audit than the inline guard pattern above)
 *   - requirePermission() from this file (curried middleware factory,
 *     prefer the simpler rbac-auth.ts version that returns NextResponse|null)
 */

import { NextRequest, NextResponse } from "next/server";
import { checkAuthCompat, getSessionUser } from "./auth-bridge";
import { canRolePerformAction, type OrgAction, type OrgRole } from "./org-types";

export function withAuth<T extends unknown[]>(
  handler: (request: NextRequest, ...args: T) => Promise<NextResponse>
) {
  return async (request: NextRequest, ...args: T): Promise<NextResponse> => {
    if (!(await checkAuthCompat(request))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return handler(request, ...args);
  };
}

export async function checkAuth(request: Request): Promise<boolean> {
  return await checkAuthCompat(request);
}

/**
 * get user role from Better Auth session.
 * falls back to header-based lookup for legacy clients.
 */
async function getUserRole(
  request: Request,
): Promise<OrgRole> {
  const user = await getSessionUser(request);
  if (user) return user.role;
  return "member";
}

/**
 * check if user has permission for the given action.
 */
export async function checkPermission(
  request: Request,
  action: OrgAction,
): Promise<boolean> {
  if (!(await checkAuthCompat(request))) return false;
  const role = await getUserRole(request);
  return canRolePerformAction(role, action);
}

/**
 * middleware factory that requires a specific permission.
 * usage: export const GET = requirePermission("view_tasks")(handler);
 */
export function requirePermission(action: OrgAction) {
  return <T extends unknown[]>(
    handler: (request: NextRequest, ...args: T) => Promise<NextResponse>
  ) => {
    return async (request: NextRequest, ...args: T): Promise<NextResponse> => {
      if (!(await checkAuthCompat(request))) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const role = await getUserRole(request);
      if (!canRolePerformAction(role, action)) {
        return NextResponse.json(
          { error: "Forbidden", action, role },
          { status: 403 }
        );
      }

      return handler(request, ...args);
    };
  };
}
