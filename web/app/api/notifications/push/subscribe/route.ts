import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// in-memory storage for push subscriptions (use a real db in production)
const pushSubscriptions = new Map<string, PushSubscription>();

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const subscription = await request.json();

  if (!subscription.endpoint || !subscription.keys) {
    throw new BadRequest("invalid subscription - endpoint and keys required", {
      fields: ["endpoint", "keys"]
    });
  }

  // store subscription (use user id in real app)
  pushSubscriptions.set(subscription.endpoint, subscription);

  return apiSuccess({ subscribed: true });
});

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  return apiSuccess({ count: pushSubscriptions.size });
});

export const DELETE = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const { endpoint } = await request.json();

  if (endpoint) {
    pushSubscriptions.delete(endpoint);
  }

  return apiSuccess({ unsubscribed: true });
});
