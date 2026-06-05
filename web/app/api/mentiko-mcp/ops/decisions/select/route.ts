import { NextRequest, NextResponse } from "next/server";
import { requireOpsAuth, requireOpsPermission } from "@/lib/ai-engine/mentiko-mcp-ops-auth";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { BadRequest } from "@/lib/api-errors";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  const ctx = await requireOpsAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_tasks", "decisions:write");
  if (perm) return perm;

  const body = await request.json() as {
    decisionId: string;
    optionId: string;
  };

  if (!body.decisionId || !body.optionId) {
    throw new BadRequest("decisionId and optionId required");
  }

  // proxy to the main guided/plan route with inbox-key bypass
  const webUrl = process.env.MENTIKO_WEB_URL || "http://127.0.0.1:3000";
  const inboxKey = process.env.MENTIKO_INBOX_KEY || "";

  const res = await fetch(
    `${webUrl}/api/decisions/${body.decisionId}/guided/plan`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Mentiko-Inbox-Key": inboxKey,
      },
      body: JSON.stringify({
        selectedOptionId: body.optionId,
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to select option: ${res.status} ${errText}`);
  }

  const data = await res.json();
  return apiSuccess(data);
});
