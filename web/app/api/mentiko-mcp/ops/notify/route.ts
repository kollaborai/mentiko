import { NextResponse } from "next/server";
import { requireOpsAuth, requireOpsPermission } from "@/lib/ai-engine/mentiko-mcp-ops-auth";
import { internalApiUrl } from "@/lib/auth/internal-web-origin";

export const dynamic = "force-dynamic";

/**
 * POST /api/mentiko-mcp/ops/notify
 * Push a notification to the user via the bar's show_toast + optional
 * browser notification. For now delegates to the bar's dispatch endpoint.
 *
 * Body: { level: "info"|"success"|"warning"|"error", title: string, message: string, linkRoute?: string }
 */
export async function POST(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "view_chains", "notifications:write");
  if (perm) return perm;

  const body = (await req.json()) as {
    level?: string;
    title?: string;
    message?: string;
    linkRoute?: string;
    durationMs?: number;
  };

  const level = body.level || "info";
  const message = body.linkRoute
    ? `${body.message || ""} → ${body.linkRoute}`
    : (body.message || "");

  const inboxKey = process.env.MENTIKO_INBOX_KEY || "";

  // dispatch a show_toast effect to the bar
  const res = await fetch(internalApiUrl("/api/mentiko-mcp/dispatch", req.url), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Mentiko-Inbox-Key": inboxKey,
    },
    body: JSON.stringify({
      kind: "show_toast",
      payload: {
        level,
        message,
        durationMs: body.durationMs ?? 6000,
      },
    }),
  });

  if (!res.ok) {
    return new NextResponse("Failed to dispatch notification", { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
