/**
 * POST /api/gdpr/export — GDPR Art 15 (access) + Art 20 (portability).
 *
 * Returns a JSON bundle of everything we hold for the calling user.
 * Auth required. No request body needed.
 */

import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { getSessionUser } from "@/lib/auth-bridge";
import { getDb } from "@/lib/auth-server";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import config from "@/lib/config";
import { join } from "path";
import { readdirSync, readFileSync, existsSync } from "fs";

export const dynamic = "force-dynamic";

async function collectUserData(userId: string, namespaceId: string, _orgId: string) {
  const db = await getDb();
  const bundle: Record<string, unknown> = {};

  if (!db) return bundle;

  // auth.db data
  bundle.user = db.prepare(`SELECT id, email, name, "createdAt" FROM "user" WHERE id = ?`).get(userId);
  bundle.sessions = db.prepare(`SELECT id, "createdAt", "expiresAt" FROM session WHERE "userId" = ?`).all(userId);
  bundle.accounts = db.prepare(`SELECT "providerId", "accountId", "createdAt" FROM account WHERE "userId" = ?`).all(userId);
  bundle.memberships = db.prepare(
    `SELECT m.role, m."createdAt", o.name as org_name, o.slug as org_slug FROM member m JOIN organization o ON o.id = m."organizationId" WHERE m."userId" = ?`,
  ).all(userId);

  // tasks.db data
  const tasksDbPath = join(config.globalRoot, "namespaces", namespaceId, "data", "tasks.db");
  if (existsSync(tasksDbPath)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Database = require("better-sqlite3");
      const tdb = new Database(tasksDbPath, { readonly: true });
      bundle.tasks = tdb.prepare(`SELECT * FROM tasks WHERE "createdBy" = ?`).all(userId);
      try {
        bundle.taskComments = tdb.prepare(`SELECT * FROM task_comments WHERE author = ?`).all(userId);
      } catch { /* task_comments may not exist */ }
      tdb.close();
    } catch { /* tasks.db not accessible */ }
  }

  // chains owned by user
  const chainsDir = join(config.globalRoot, "namespaces", namespaceId, "chains");
  if (existsSync(chainsDir)) {
    const userChains: unknown[] = [];
    try {
      for (const entry of readdirSync(chainsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const chainFile = join(chainsDir, entry.name, "chain.json");
        if (existsSync(chainFile)) {
          try {
            const data = JSON.parse(readFileSync(chainFile, "utf-8"));
            if (data.created_by === userId) userChains.push(data);
          } catch { /* skip malformed */ }
        }
      }
    } catch { /* permission error */ }
    bundle.chains = userChains;
  }

  // decisions
  const decisionsDir = join(config.globalRoot, "namespaces", namespaceId, "decisions");
  if (existsSync(decisionsDir)) {
    const userDecisions: unknown[] = [];
    try {
      for (const f of readdirSync(decisionsDir).filter((f) => f.endsWith(".json"))) {
        try {
          const data = JSON.parse(readFileSync(join(decisionsDir, f), "utf-8"));
          if (data.userId === userId) userDecisions.push(data);
        } catch { /* skip */ }
      }
    } catch { /* permission error */ }
    bundle.decisions = userDecisions;
  }

  return bundle;
}

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized("Authentication required");
  }

  const user = await getSessionUser(request);
  if (!user?.id) {
    throw new Unauthorized("Session expired");
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const bundle = await collectUserData(user.id, namespaceId, orgId);

  bundle._exportedAt = new Date().toISOString();
  bundle._userId = user.id;

  return apiSuccess(bundle);
});
