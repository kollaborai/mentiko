import { NextRequest, NextResponse } from "next/server";
import { requireOpsAuth } from "@/lib/mentiko-mcp-ops-auth";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request: NextRequest) => {
  const ctx = await requireOpsAuth(request);
  if (ctx instanceof NextResponse) return ctx;

  // Proxy to /api/system/detect-cli with inbox-key bypass
  const webUrl = process.env.MENTIKO_WEB_URL || "http://127.0.0.1:3000";
  const inboxKey = process.env.MENTIKO_INBOX_KEY || "";

  const response = await fetch(`${webUrl}/api/system/detect-cli`, {
    method: "GET",
    headers: {
      "X-Mentiko-Inbox-Key": inboxKey,
    },
  });

  const data = await response.json();
  return apiSuccess(data);
});
