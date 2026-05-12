import { NextResponse } from "next/server";
import { isManagedTenantSignupLocked } from "@/lib/auth-deployment";
import { getDb } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

/**
 * surfaces the same gate the user.create.before hook enforces, so the
 * front-end can show "Create first account" on fresh OSS installs and
 * "Invitation required" on locked tenants with existing users.
 *
 * matches the count===0 OSS bootstrap escape in auth-server.ts. managed
 * tenants (those with MENTIKO_PROVISIONING_TOKEN set) always report
 * locked — their first owner is created by the control plane callback,
 * not by anyone hitting /signup.
 */
async function isPublicSignupOpen(): Promise<boolean> {
  if (!isManagedTenantSignupLocked()) return true;

  // managed tenants: provisioning-token path is the only way in, even
  // while the user table is briefly empty during initial bootstrap.
  // mirrors the hook in auth-server.ts which rejects when envProvToken
  // is set but the request doesn't carry a matching token.
  if (process.env.MENTIKO_PROVISIONING_TOKEN) return false;

  try {
    const db = await getDb();
    if (!db) return false;
    const row = db
      .prepare('SELECT COUNT(*) as c FROM "user"')
      .get() as { c: number } | undefined;
    if (Number(row?.c ?? 0) === 0) return true;
  } catch {
    // table not ready / db not initialized — fail-closed; the locked
    // signup CTA still reflects the env intent and avoids leaking open.
  }

  return false;
}

export async function GET() {
  const publicEmailSignup = await isPublicSignupOpen();
  return NextResponse.json({
    github: !!process.env.GITHUB_CLIENT_ID,
    google: !!process.env.GOOGLE_CLIENT_ID,
    microsoft: !!process.env.MICROSOFT_CLIENT_ID,
    /** when false, email self-service signup is disabled (invitation links still work) */
    publicEmailSignup,
  });
}
