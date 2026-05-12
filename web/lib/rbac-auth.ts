/**
 * rbac-auth: role-based access control for organizations.
 * now derives identity from Better Auth session instead of headers.
 */

import { NextResponse } from "next/server";
import { checkAuthCompat, getSessionUser } from "./auth-bridge";
import { getNamespaceIdFromRequest } from "./namespace-config";
import type { OrgRole, OrgAction } from "./org-types";
import { canRolePerformAction } from "./org-types";

const DEFAULT_ROLE: OrgRole = "owner";
const DEFAULT_USER_ID = "default-user";

/**
 * get the user's role for the current namespace.
 * derives from Better Auth session, falls back to owner for single-user setups.
 */
async function getUserRole(request: Request): Promise<OrgRole> {
  const user = await getSessionUser(request);
  return user?.role || DEFAULT_ROLE;
}

/**
 * middleware that requires a specific permission.
 * returns 401 if not authenticated, 403 if permission denied.
 */
export async function requirePermission(
  request: Request,
  action: OrgAction
): Promise<NextResponse | null> {
  if (!(await checkAuthCompat(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userRole = await getUserRole(request);

  if (!canRolePerformAction(userRole, action)) {
    return NextResponse.json(
      {
        error: "Forbidden",
        message: `Role '${userRole}' does not have permission '${action}'`,
      },
      { status: 403 }
    );
  }

  return null;
}

/**
 * get the current user's role (for UI use).
 */
export async function getCurrentUserRole(
  request: Request
): Promise<OrgRole> {
  return getUserRole(request);
}

// ----------------------------------------------------------------------------
// USER RETRIEVAL
// ----------------------------------------------------------------------------

export interface User {
  id: string;
  email?: string;
  name?: string;
}

/**
 * get current user from Better Auth session.
 */
export async function getCurrentUser(request?: Request): Promise<User | null> {
  if (!request) {
    return null;
  }

  const user = await getSessionUser(request);
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
  };
}

// ----------------------------------------------------------------------------
// ROLE LOOKUP (by user id + org id)
// ----------------------------------------------------------------------------

/**
 * get user's role in an org by explicit user/org ids.
 * for Better Auth, the role comes from the member table.
 */
export async function getUserRoleInOrg(
  userId: string,
  orgId: string,
  namespaceId: string
): Promise<OrgRole | null> {
  // in the Better Auth world, role lookup goes through the session/API
  // this function is kept for compatibility but returns null for now
  // since the actual role is derived from getSessionUser()
  void userId;
  void orgId;
  void namespaceId;
  return null;
}

// ----------------------------------------------------------------------------
// PERMISSION CHECKING
// ----------------------------------------------------------------------------

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  role?: OrgRole;
  requiredLevel?: number;
  userLevel?: number;
}

/**
 * check if user has permission for action.
 */
export async function checkPermission(
  _userId: string,
  _orgId: string,
  _action: OrgAction,
  _namespaceId: string
): Promise<boolean> {
  return false;
}

/**
 * detailed permission check with reason.
 */
export async function checkPermissionDetailed(
  _userId: string,
  _orgId: string,
  _action: OrgAction,
  _namespaceId: string
): Promise<PermissionCheckResult> {
  return { allowed: false, reason: "use request-based auth instead" };
}

// ----------------------------------------------------------------------------
// EXPRESS-STYLE MIDDLEWARE
// ----------------------------------------------------------------------------

type AuthenticatedHandler<T extends unknown[] = []> = (
  request: Request,
  context: { userId: string; role: OrgRole; orgId?: string; namespaceId: string },
  ...args: T
) => Promise<NextResponse>;

/**
 * express-style middleware wrapper for next.js route handlers.
 * now derives context from Better Auth session.
 */
export function withAuth<T extends unknown[] = []>(
  action: OrgAction,
  handler: AuthenticatedHandler<T>
): (request: Request, ...args: T) => Promise<NextResponse> {
  return async (request: Request, ...args: T): Promise<NextResponse> => {
    if (!(await checkAuthCompat(request))) {
      return NextResponse.json(
        { error: "Unauthorized", code: "NO_AUTH" },
        { status: 401 }
      );
    }

    const user = await getSessionUser(request);
    const userId = user?.id || DEFAULT_USER_ID;
    const role = user?.role || DEFAULT_ROLE;
    const orgId = user?.orgId;
    const namespaceId = user?.namespaceId || await getNamespaceIdFromRequest(request);

    if (!canRolePerformAction(role, action)) {
      return NextResponse.json(
        {
          error: "Forbidden",
          code: "INSUFFICIENT_PERMISSIONS",
          action,
          role,
        },
        { status: 403 }
      );
    }

    return handler(request, { userId, role, orgId, namespaceId }, ...args);
  };
}

/**
 * require any of multiple permissions (or logic).
 */
export function withAnyAuth<T extends unknown[] = []>(
  actions: OrgAction[],
  handler: AuthenticatedHandler<T>
): (request: Request, ...args: T) => Promise<NextResponse> {
  return async (request: Request, ...args: T): Promise<NextResponse> => {
    if (!(await checkAuthCompat(request))) {
      return NextResponse.json(
        { error: "Unauthorized", code: "NO_AUTH" },
        { status: 401 }
      );
    }

    const user = await getSessionUser(request);
    const userId = user?.id || DEFAULT_USER_ID;
    const role = user?.role || DEFAULT_ROLE;
    const orgId = user?.orgId;
    const namespaceId = user?.namespaceId || await getNamespaceIdFromRequest(request);

    const hasAny = actions.some((a) => canRolePerformAction(role, a));

    if (!hasAny) {
      return NextResponse.json(
        {
          error: "Forbidden",
          code: "INSUFFICIENT_PERMISSIONS",
          required: actions,
          role,
        },
        { status: 403 }
      );
    }

    return handler(request, { userId, role, orgId, namespaceId }, ...args);
  };
}

/**
 * require all permissions (and logic).
 */
export function withAllAuth<T extends unknown[] = []>(
  actions: OrgAction[],
  handler: AuthenticatedHandler<T>
): (request: Request, ...args: T) => Promise<NextResponse> {
  return async (request: Request, ...args: T): Promise<NextResponse> => {
    if (!(await checkAuthCompat(request))) {
      return NextResponse.json(
        { error: "Unauthorized", code: "NO_AUTH" },
        { status: 401 }
      );
    }

    const user = await getSessionUser(request);
    const userId = user?.id || DEFAULT_USER_ID;
    const role = user?.role || DEFAULT_ROLE;
    const orgId = user?.orgId;
    const namespaceId = user?.namespaceId || await getNamespaceIdFromRequest(request);

    for (const action of actions) {
      if (!canRolePerformAction(role, action)) {
        return NextResponse.json(
          {
            error: "Forbidden",
            code: "INSUFFICIENT_PERMISSIONS",
            missing: action,
            role,
          },
          { status: 403 }
        );
      }
    }

    return handler(request, { userId, role, orgId, namespaceId }, ...args);
  };
}
