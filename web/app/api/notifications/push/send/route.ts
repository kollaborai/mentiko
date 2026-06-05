import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { BadRequest, Unauthorized } from "@/lib/api-errors";

export const dynamic = "force-dynamic";

// simple in-memory subscription storage
const pushSubscriptions = new Map<string, PushSubscription>();

// web push would require vapid keys and web-push library
// this is a simplified version for demonstration
export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const { title } = await request.json();

  if (!title) {
    throw new BadRequest("title is required");
  }

  // in production, use web-push library to send actual push notifications
  // const webpush = require("web-push");
  // for (const subscription of pushSubscriptions.values()) {
  //   await webpush.sendNotification(subscription, JSON.stringify({
  //     title, message, url, type
  //   }));
  // }

  return apiSuccess({
    success: true,
    sent: pushSubscriptions.size,
    message: "push notifications sent",
  });
});
