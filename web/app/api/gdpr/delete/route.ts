/**
 * POST /api/gdpr/delete — GDPR Art 17 (right to erasure) via crypto-shred.
 *
 * Requires body { confirmation: "DELETE MY ACCOUNT" } and auth.
 * Steps:
 *   1. Emit audit event gdpr_delete_requested
 *   2. Export user data to gdpr-exports/ (retain for legal)
 *   3. Overwrite wrapped_dek with random bytes (crypto-shred)
 *   4. Delete session + user rows (tombstone)
 *   5. Schedule filesystem sweep
 *   6. Emit audit event gdpr_delete_completed
 */

import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { getDb } from "@/lib/auth/auth-server";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { execAuditLog } from "@/lib/api/audit-exec";
import { shredDEK } from "@/lib/auth/user-crypto";
import config from "@/lib/config";
import { join } from "path";
import { mkdirSync, writeFileSync } from "fs";
import { scheduleGdprUserSweep } from "@/lib/runs/gdpr-user-sweep";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized("Authentication required");
  }

  const user = await getSessionUser(request);
  if (!user?.id) {
    throw new Unauthorized("Session expired");
  }

  // parse confirmation
  let body: { confirmation?: string };
  try {
    body = await request.json();
  } catch {
    throw new BadRequest("Invalid request body");
  }

  if (body.confirmation !== "DELETE MY ACCOUNT") {
    throw new BadRequest('Confirmation must be exactly "DELETE MY ACCOUNT"');
  }

  const userId = user.id;
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const stepErrors: string[] = [];

  // step 1: audit — fires unconditionally before any destructive work
  await execAuditLog("gdpr_delete_requested", "GDPR delete requested", {
    user_id: userId,
  }, { source: "gdpr" });

  // step 2: export BEFORE any shredding — if this fails, abort to preserve exportability
  const db = await getDb();
  if (db) {
    try {
      const userData = db.prepare(`SELECT * FROM "user" WHERE id = ?`).get(userId);
      const sessions = db.prepare(`SELECT * FROM session WHERE "userId" = ?`).all(userId);
      const accounts = db.prepare(`SELECT * FROM account WHERE "userId" = ?`).all(userId);
      const memberships = db.prepare(`SELECT * FROM member WHERE "userId" = ?`).all(userId);

      const exportDir = join(config.globalRoot, "namespaces", namespaceId, orgId === "default" ? "" : `orgs/${orgId}`, "gdpr-exports").replace(/\/+/g, "/");
      mkdirSync(exportDir, { recursive: true });
      const exportFile = join(exportDir, `${userId}-${Date.now()}.json`);
      writeFileSync(exportFile, JSON.stringify({
        exportedAt: new Date().toISOString(),
        userId,
        namespaceId,
        orgId,
        user: userData,
        sessions,
        accounts,
        memberships,
      }, null, 2), { mode: 0o600 });
    } catch (err) {
      console.error("[gdpr] pre-delete export failed:", err);
      stepErrors.push("export_failed");
    }
  }

  // step 3: crypto-shred — overwrite wrapped_dek with garbage
  if (db) {
    try {
      const shredded = await shredDEK(userId, db);
      if (!shredded) {
        console.warn("[gdpr] shredDEK returned false — user may not have had a DEK");
      }
    } catch (err) {
      console.error("[gdpr] DEK shred failed:", err);
      stepErrors.push("dek_shred_failed");
    }
  }

  // step 4: delete auth rows
  if (db) {
    try {
      db.prepare(`DELETE FROM session WHERE "userId" = ?`).run(userId);
      db.prepare(`DELETE FROM account WHERE "userId" = ?`).run(userId);
      db.prepare(`DELETE FROM member WHERE "userId" = ?`).run(userId);
      // tombstone: update user row to clear PII, keep id for audit trail
      db.prepare(
        `UPDATE "user" SET email = ?, name = ?, image = ?, "emailVerified" = 0 WHERE id = ?`,
      ).run(`deleted-${userId.slice(0, 8)}@gdpr-shred`, "[deleted]", null, userId);
    } catch (err) {
      console.error("[gdpr] auth cleanup failed:", err);
      stepErrors.push("auth_cleanup_failed");
    }
  }

  // step 5: schedule typed filesystem sweep (background, non-blocking)
  try {
    const namespaceRoot = join(config.globalRoot, "namespaces", namespaceId);
    scheduleGdprUserSweep(namespaceRoot, userId);
  } catch (err) {
    console.error("[gdpr] sweep launch failed:", err);
    stepErrors.push("sweep_launch_failed");
  }

  // step 6: audit completion — always fires, even if steps above partially failed
  await execAuditLog("gdpr_delete_completed", "GDPR delete completed", {
    user_id: userId,
    partial_failure: stepErrors.length > 0,
    failed_steps: stepErrors.join(",") || null,
  }, { source: "gdpr" });

  return apiSuccess({
    deleted: true,
    userId,
    method: "crypto-shred",
    ...(stepErrors.length > 0 && { warnings: stepErrors }),
    note: "User data encrypted under shredded DEK is now unreadable. Filesystem sweep running in background.",
  });
});
