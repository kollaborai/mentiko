import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

const pushSubscriptions = new Map<string, PushSubscription>();

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const { endpoint } = await request.json();

  if (!endpoint || typeof endpoint !== "string") {
    throw new BadRequest("endpoint is required", { field: "endpoint" });
  }

  pushSubscriptions.delete(endpoint);

  return apiSuccess({ unsubscribed: true });
});
