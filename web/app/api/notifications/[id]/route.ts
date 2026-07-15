import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { Unauthorized, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { mutateNotifications } from "@/lib/notifications/notification-persistence";

export const dynamic = "force-dynamic";

// DELETE /api/notifications/[id] - delete a notification
export const DELETE = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { id } = await params;
  const namespaceId = await getNamespaceIdFromRequest(request);

  mutateNotifications(namespaceId, (notifications) => {
    const filtered = notifications.filter((notification) => notification.id !== id);
    if (filtered.length === notifications.length) {
      throw new NotFound("Notification", id);
    }
    return { notifications: filtered, result: undefined, write: true };
  });
  return apiSuccess({ success: true });
});

// PATCH /api/notifications/[id]/read - mark notification as read
export const PATCH = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { id } = await params;
  const namespaceId = await getNamespaceIdFromRequest(request);
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action"); // read, unread

  const notification = mutateNotifications(namespaceId, (notifications) => {
    const current = notifications.find((candidate) => candidate.id === id);
    if (!current) {
      throw new NotFound("Notification", id);
    }

    current.read = action !== "unread";
    return { notifications, result: current, write: true };
  });

  return apiSuccess({ notification });
});
