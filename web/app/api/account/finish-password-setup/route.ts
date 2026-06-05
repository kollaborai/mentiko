import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { clearMustChangePasswordFlag } from "@/lib/auth/auth-server";
import { getServerSession } from "@/lib/auth/auth-bridge";

export const dynamic = "force-dynamic";

/**
 * POST — clears mustChangePassword after authClient.changePassword succeeds.
 * Session-only; does not accept client-supplied user ids.
 */
export async function POST() {
  try {
    const h = await headers();
    const req = new Request("http://localhost", { headers: h });
    const session = await getServerSession(req);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await clearMustChangePasswordFlag(session.user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[finish-password-setup]", err);
    return NextResponse.json({ error: "Failed to update account" }, { status: 500 });
  }
}
