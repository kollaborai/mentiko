import { NextRequest, NextResponse } from "next/server";
import { requireOpsAuth, requireOpsPermission } from "@/lib/ai-engine/mentiko-mcp-ops-auth";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { BadRequest } from "@/lib/api-errors";
import { internalApiUrl } from "@/lib/auth/internal-web-origin";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  const ctx = await requireOpsAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_tasks", "decisions:write");
  if (perm) return perm;

  const body = await request.json() as {
    decisionId: string;
    questionId: string;
    choice: "a" | "b" | "skip";
  };

  if (!body.decisionId || !body.questionId || !body.choice) {
    throw new BadRequest("decisionId, questionId, and choice required");
  }

  // proxy to the main guided/answer route with inbox-key bypass
  const inboxKey = process.env.MENTIKO_INBOX_KEY || "";

  const res = await fetch(
    internalApiUrl(`/api/decisions/${body.decisionId}/guided/answer`, request.url),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Mentiko-Inbox-Key": inboxKey,
      },
      body: JSON.stringify({
        questionId: body.questionId,
        choice: body.choice,
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to answer question: ${res.status} ${errText}`);
  }

  const data = await res.json();
  return apiSuccess(data);
});
