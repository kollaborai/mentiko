import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { loadPrefs, savePrefs } from "@/lib/notifications/notification-prefs";
import type { NotificationPreferences } from "@/lib/notifications/notification-prefs";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// GET /api/notifications/preferences
export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const user = await getSessionUser(request);
  const userId = user?.id || "default";
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const prefs = loadPrefs(namespaceId, orgId, userId);
  return apiSuccess(prefs);
});

// PATCH /api/notifications/preferences
export const PATCH = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const user = await getSessionUser(request);
  const userId = user?.id || "default";
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const updates = await request.json() as Partial<NotificationPreferences>;
  const current = loadPrefs(namespaceId, orgId, userId);

  const merged: NotificationPreferences = {
    ...current,
    ...updates,
    userId,
    categories: updates.categories ?? current.categories,
    quietHours: updates.quietHours
      ? { ...current.quietHours, ...updates.quietHours }
      : current.quietHours,
  };

  savePrefs(namespaceId, orgId, merged);
  return apiSuccess(merged);
});
