import { NextRequest, NextResponse } from "next/server";
import { requireOpsAuth, requireOpsPermission } from "@/lib/ai-engine/mentiko-mcp-ops-auth";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { BadRequest } from "@/lib/api-errors";
import { pty } from "@/lib/pty/pty-client";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  const ctx = await requireOpsAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_org", "cli-auth:start");
  if (perm) return perm;

  const body = await request.json();
  const { tool } = body;

  if (!tool) {
    throw new BadRequest("tool is required");
  }

  // Proxy to /api/system/cli-auth with inbox-key bypass
  const webUrl = process.env.MENTIKO_WEB_URL || "http://127.0.0.1:3000";
  const inboxKey = process.env.MENTIKO_INBOX_KEY || "";

  const response = await fetch(`${webUrl}/api/system/cli-auth`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Mentiko-Inbox-Key": inboxKey,
    },
    body: JSON.stringify({ tool }),
  });

  const data = await response.json();
  return apiSuccess(data);
});

export const GET = withErrorHandling(async (request: NextRequest) => {
  const ctx = await requireOpsAuth(request);
  if (ctx instanceof NextResponse) return ctx;

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  if (!sessionId) {
    throw new BadRequest("sessionId query parameter is required");
  }

  try {
    await pty.alive(sessionId);
    let output = "";

    try {
      output = await pty.capture(sessionId, 200);
    } catch {
      // capture can fail if session doesn't exist
    }

    // strip ANSI escape codes
    const ANSI_RE = /(?:\x1b(?:\[[0-?]*[ -/]*[@-~]|][^\x07]*(?:\x07|\x1b\\)|P[^\x1b]*\x1b\\|X[^\x1b]*\x1b\\|_[^\x1b]*\x1b\\|\^[^\x1b]*\x1b\\|[@-Z\\-_]))/g;
    const clean = output.replace(ANSI_RE, "");

    // look for auth URL in output
    const urlMatch = clean.match(/https?:\/\/[^\s\x00-\x1f]+/);
    const url = urlMatch ? urlMatch[0].replace(/[.)\]]+$/, "") : undefined;
    const deviceCodeMatch = clean.match(/\b[A-Z0-9]{4,8}-[A-Z0-9]{4,8}\b/);
    const deviceCode = deviceCodeMatch ? deviceCodeMatch[0] : undefined;

    // look for completion signals
    const lowerOutput = clean.toLowerCase();
    const completionPatterns = ["authenticated", "logged in", "success"];
    const hasCompletion = completionPatterns.some((p) => lowerOutput.includes(p));

    let status: "waiting" | "url_ready" | "complete" | "failed" = "waiting";
    if (url && !hasCompletion) {
      status = "url_ready";
    } else if (hasCompletion) {
      status = "complete";
    }

    return apiSuccess({
      status,
      url,
      deviceCode,
      output: clean,
    });
  } catch (err) {
    throw new BadRequest(`Failed to poll session: ${err}`);
  }
});
