import { NextRequest } from "next/server";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { checkAuth } from "@/lib/api-auth";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

interface WebhookDelivery {
  event_id: string;
  event_type: string;
  url: string;
  attempts: number;
  status: "delivered" | "failed" | "pending";
  created_at: string;
  updated_at?: string;
  http_code?: number;
  last_response?: string;
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const { searchParams } = new URL(request.url);
  const chainName = searchParams.get("chain");

  const webhookStateDir = `${process.env.HOME || process.env.USERPROFILE || "."}/.mentiko_webhooks`;

  if (!existsSync(webhookStateDir)) {
    return apiSuccess({ deliveries: [] });
  }

  let deliveries: WebhookDelivery[] = [];

  const files = readdirSync(webhookStateDir).filter((f) => f.endsWith(".json"));

  for (const file of files) {
    try {
      const content = readFileSync(join(webhookStateDir, file), "utf-8");
      const delivery: WebhookDelivery = JSON.parse(content);

      // filter by chain name if provided
      if (chainName) {
        if (!delivery.event_id.includes(chainName)) {
          continue;
        }
      }

      deliveries.push(delivery);
    } catch {
      // skip invalid json
    }
  }

  // sort by created_at desc, take last 50
  deliveries.sort((a, b) => {
    const aTime = new Date(a.created_at).getTime();
    const bTime = new Date(b.created_at).getTime();
    return bTime - aTime;
  });

  deliveries = deliveries.slice(0, 50);

  return apiSuccess({ deliveries });
});
