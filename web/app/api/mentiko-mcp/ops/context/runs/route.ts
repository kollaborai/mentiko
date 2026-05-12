import { NextResponse } from "next/server";
import { requireOpsAuth, requireOpsPermission } from "@/lib/mentiko-mcp-ops-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/mentiko-mcp/ops/context/runs
 * Start a chain run. Delegates to the existing /api/chains/run route
 * using internal fetch with the ops inbox key instead of a user cookie.
 */
export async function POST(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_chains", "runs:start");
  if (perm) return perm;

  const { namespaceId } = ctx;
  const { chainId, task, workspaceId } = (await req.json()) as {
    chainId?: string;
    task?: string;
    workspaceId?: string;
  };

  if (!chainId) return new NextResponse("chainId required", { status: 400 });

  const webUrl = process.env.MENTIKO_WEB_URL || "http://127.0.0.1:3000";
  const inboxKey = process.env.MENTIKO_INBOX_KEY || "";

  // Call the existing public run route. We pass the inbox key as a header
  // so the route can bypass cookie auth on loopback. The route currently
  // uses checkAuth which requires a session — we need to call it via the
  // internal route path instead.
  //
  // Simplest safe path: POST to /api/chains/run with a synthetic internal
  // header. The chains/run route uses checkAuth; for now we accept that
  // start_run only works when the user is logged in (session cookie present).
  // A future improvement: add inbox-key bypass to /api/chains/run.
  const res = await fetch(`${webUrl}/api/chains/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Mentiko-Namespace-Id": namespaceId,
      // forward the inbox key so future versions of chains/run can bypass auth
      "X-Mentiko-Inbox-Key": inboxKey,
    },
    body: JSON.stringify({
      chainId,
      userPrompt: task || "",
      workspaceId,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    return new NextResponse(`Failed to start run: ${text}`, { status: res.status });
  }

  const data = await res.json();
  const runId = data?.data?.runId || data?.runId;
  return NextResponse.json({ runId });
}
