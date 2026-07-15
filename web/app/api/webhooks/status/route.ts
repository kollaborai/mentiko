import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { listLegacyWebhookDeliveries, resolveLegacyWebhookStateDir } from "@/lib/runner-v2/integration-contract";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const { searchParams } = new URL(request.url);
  const chainName = searchParams.get("chain");

  const deliveries = listLegacyWebhookDeliveries(resolveLegacyWebhookStateDir(), chainName || undefined).slice(0, 50);

  return apiSuccess({ deliveries });
});
