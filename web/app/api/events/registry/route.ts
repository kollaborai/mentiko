import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { PLATFORM_EVENTS, getEventDomains } from "@/lib/platform-events";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { searchParams } = new URL(request.url);
  const domain = searchParams.get("domain");

  const events = domain
    ? PLATFORM_EVENTS.filter((e) => e.domain === domain)
    : PLATFORM_EVENTS;

  return apiSuccess({
    events,
    domains: getEventDomains(),
    total: events.length,
  });
});
