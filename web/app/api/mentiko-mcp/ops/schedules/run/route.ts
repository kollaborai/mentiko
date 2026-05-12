import { NextResponse } from "next/server";
import { requireOpsAuth, requireOpsPermission } from "@/lib/mentiko-mcp-ops-auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_chains", ["schedules:write", "schedules:run"]);
  if (perm) return perm;

  const { id } = await req.json() as { id?: string };
  if (!id) return new NextResponse("id required", { status: 400 });

  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) return new NextResponse("BETTER_AUTH_SECRET required for schedule run-now", { status: 500 });

  const res = await fetch(`${new URL(req.url).origin}/api/schedules/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
      "x-namespace-id": ctx.namespaceId,
      "x-org-id": ctx.orgId,
    },
    body: JSON.stringify({ id, triggeredBy: "api" }),
  });

  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") || "application/json" },
  });
}
