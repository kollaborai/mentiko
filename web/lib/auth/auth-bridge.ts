/**
 * auth-bridge: compatibility layer between Better Auth and existing auth system.
 * allows gradual migration of 90+ API routes without breaking changes.
 */

import { getAuth, getDb } from "./auth-server";
import { headersForCookieSession } from "./session-cookie-headers";
import { timingSafeEqual } from "./security";
import type { OrgRole } from "../orgs/org-types";
import config from "../config";

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;

function getTrustedBearerContext(request: Request): { namespaceId?: string; orgId?: string } | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  const isInternalService = BETTER_AUTH_SECRET && timingSafeEqual(token, BETTER_AUTH_SECRET);
  if (!isInternalService) return null;

  return {
    namespaceId: request.headers.get("x-namespace-id") || undefined,
    orgId: request.headers.get("x-org-id") || undefined,
  };
}

function shouldUseDevAuthFallback(): boolean {
  // Local/test bypass when auth is intentionally unconfigured.
  // Production must never bypass auth if the database env is missing.
  return process.env.NODE_ENV !== "production" && !process.env.DATABASE_URL;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: OrgRole;
  isAdmin: boolean;
  orgId?: string;
  namespaceId: string;
  linuxUsername?: string;
}

/**
 * get better-auth session from request headers.
 * returns null if not authenticated or auth not configured.
 */
export async function getServerSession(request: Request) {
  const auth = await getAuth();
  if (!auth) return null;
  try {
    const session = await auth.api.getSession({
      headers: headersForCookieSession(request.headers),
    });
    return session;
  } catch {
    return null;
  }
}

/**
 * check auth: better-auth session OR internal service bearer token.
 * this is the main compat function that replaces validateRequest().
 */
export async function checkAuthCompat(request: Request): Promise<boolean> {
  // local/test fallback when auth isn't configured
  if (shouldUseDevAuthFallback()) {
    return true;
  }

  // check better-auth session first
  const session = await getServerSession(request);
  if (session?.session) return true;

  // fall back to bearer token for internal service calls
  if (getTrustedBearerContext(request)) return true;

  return false;
}

/**
 * get namespace id from the active session or trusted service context.
 * Namespaces are tenant/billing boundaries; orgs live inside namespaces.
 *
 * When NAMESPACE_ID is set (typical Docker / hosted tenant), the filesystem
 * root is always `namespaces/{NAMESPACE_ID}/...`. Better Auth's default org
 * slug is often "default", which must not become the top-level namespace
 * folder or installs land in `namespaces/default/` while the container only
 * provisions `namespaces/{tenant}/`.
 *
 * When NAMESPACE_ID is unset (typical OSS local), the top-level folder still
 * follows the active org slug so multi-org layouts match on-disk trees.
 */
export async function getNamespaceFromSession(request: Request): Promise<string> {
  const bearerContext = getTrustedBearerContext(request);
  if (bearerContext?.namespaceId) return bearerContext.namespaceId;

  const auth = await getAuth();
  if (!auth) return config.namespaceId;

  const session = await getServerSession(request);
  if (!session?.session) return config.namespaceId;

  const pinnedTenant = (process.env.NAMESPACE_ID || "").trim();
  if (pinnedTenant) {
    return pinnedTenant;
  }

  const activeOrgId = (session.session as Record<string, unknown>).activeOrganizationId as string | undefined;
  if (!activeOrgId) return config.namespaceId;

  try {
    const org = await auth.api.getFullOrganization({
      headers: headersForCookieSession(request.headers),
      query: { organizationId: activeOrgId },
    });
    return org?.slug || config.namespaceId;
  } catch {
    return config.namespaceId;
  }
}

/**
 * get session user with role and namespace context.
 * main replacement for the x-user-id / x-user-email header pattern.
 */
export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  // local/test fallback when auth isn't configured
  if (shouldUseDevAuthFallback()) {
    return {
      id: "default-user",
      email: "user@mentiko.com",
      name: "User",
      role: "owner",
      isAdmin: true,
      namespaceId: "default",
    };
  }

  const session = await getServerSession(request);
  if (!session?.user) {
    // bearer token check for internal service calls
    const bearerContext = getTrustedBearerContext(request);
    if (bearerContext) {
      return {
        id: "service-user",
        email: "service@mentiko.com",
        name: "Internal Service",
        role: "member",
        isAdmin: false,
        orgId: bearerContext.orgId,
        namespaceId: bearerContext.namespaceId || config.namespaceId,
      };
    }
    return null;
  }

  const namespaceId = await getNamespaceFromSession(request);

  // determine role from active organization membership
  let role: OrgRole = "owner";
  const activeOrgId = (session.session as Record<string, unknown>).activeOrganizationId as string | undefined;
  const auth = await getAuth();
  // resolve org slug — orgId must be a slug for path resolution, not a UUID
  let orgSlug: string | undefined;
  if (activeOrgId && auth) {
    try {
      const activeMember = await auth.api.getActiveMember({
        headers: headersForCookieSession(request.headers),
      });
      if (activeMember?.role) {
        role = activeMember.role as OrgRole;
      }
      // fetch slug alongside membership
      const org = await auth.api.getFullOrganization({
        headers: headersForCookieSession(request.headers),
        query: { organizationId: activeOrgId },
      });
      orgSlug = org?.slug;
    } catch {
      // fallback to owner if member lookup fails
    }
  }

  // check platform admin status + fetch linux username
  let isAdmin = false;
  let linuxUsername: string | undefined;
  const userEmail = (session.user.email || "").toLowerCase();

  // ADMIN_EMAILS env override
  if (ADMIN_EMAILS.length > 0 && ADMIN_EMAILS.includes(userEmail)) {
    isAdmin = true;
  }

  // fetch is_admin + linux_username from user table
  try {
    const db = await getDb();
    if (db) {
      const row = db.prepare(
        `SELECT is_admin, linux_username FROM "user" WHERE id = ?`,
      ).get(session.user.id);
      if (row?.is_admin) {
        isAdmin = true;
      }
      if (row?.linux_username) {
        linuxUsername = row.linux_username;
      }
    }
  } catch {
    // columns may not exist yet or query fails
  }

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name || session.user.email,
    role,
    isAdmin,
    // use slug so orgPath() resolves correctly ("default" collapses to namespace root)
    orgId: orgSlug ?? activeOrgId,
    namespaceId,
    linuxUsername,
  };
}
