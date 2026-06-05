import { NextResponse } from "next/server";
import { requireOpsAuth, requireOpsPermission } from "@/lib/ai-engine/mentiko-mcp-ops-auth";

export const dynamic = "force-dynamic";

type PtySession = {
  name?: string;
  pid?: number;
  alive?: boolean;
  createdAt?: string;
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * GET  /api/mentiko-mcp/ops/terminal?action=list
 * GET  /api/mentiko-mcp/ops/terminal?action=read&session=<name>&lines=50
 * POST /api/mentiko-mcp/ops/terminal  { action: "send", session, command }
 */

export async function GET(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action") || "list";

  try {
    const { pty } = await import("@/lib/pty/pty-client");

    if (action === "list") {
      const sessions = await pty.list();
      return NextResponse.json({
        sessions: (sessions as PtySession[]).map((s) => ({
          name: s.name,
          pid: s.pid,
          alive: s.alive,
          createdAt: s.createdAt,
        })),
      });
    }

    if (action === "read") {
      const session = searchParams.get("session");
      if (!session) return new NextResponse("session required", { status: 400 });
      const lines = parseInt(searchParams.get("lines") || "50");
      const output = await pty.capture(session, lines);
      return NextResponse.json({ session, output });
    }

    return new NextResponse("Unknown action", { status: 400 });
  } catch (err: unknown) {
    return new NextResponse(`PTY error: ${errorMessage(err)}`, { status: 503 });
  }
}

export async function POST(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_org", "terminal:write");
  if (perm) return perm;

  const { action, session, command } = (await req.json()) as {
    action?: string;
    session?: string;
    command?: string;
  };

  if (!session) return new NextResponse("session required", { status: 400 });

  try {
    const { pty } = await import("@/lib/pty/pty-client");

    if (action === "send") {
      if (!command) return new NextResponse("command required", { status: 400 });
      await pty.sendKeys(session, command);
      return NextResponse.json({ ok: true, session, command });
    }

    return new NextResponse("Unknown action", { status: 400 });
  } catch (err: unknown) {
    return new NextResponse(`PTY error: ${errorMessage(err)}`, { status: 503 });
  }
}
