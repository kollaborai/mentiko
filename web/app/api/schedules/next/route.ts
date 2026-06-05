import { NextRequest } from "next/server";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/auth/api-auth";
import { calculateCronNextRun } from "@/lib/schedules/cron-next-run";
import { normalizeCronExpression, normalizeTimezone } from "@/lib/schedules/cron-validation";

export const dynamic = "force-dynamic";

// POST /api/schedules/next - calculate next run time for a cron expression
export const POST = withErrorHandling(async (req: NextRequest) => {
  if (!(await checkAuth(req))) {
    throw new Unauthorized();
  }

  const body = await req.json();
  let safeCron: string;
  let safeTimezone: string;
  try {
    safeCron = normalizeCronExpression(body.cron);
    safeTimezone = normalizeTimezone(body.timezone, "UTC");
  } catch (err) {
    throw new BadRequest(err instanceof Error ? err.message : "invalid schedule input");
  }

  const next = calculateCronNextRun(safeCron, { timeoutMs: 30000 });
  if (!next) {
    throw new BadRequest("invalid cron expression or croniter unavailable");
  }

  return apiSuccess({ next, timezone: safeTimezone });
});
