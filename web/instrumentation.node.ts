/**
 * instrumentation.node.ts: Node.js-only startup work.
 * imported dynamically from instrumentation.ts ONLY when NEXT_RUNTIME === "nodejs".
 * this file must NEVER be imported from edge runtime code.
 *
 * contains: database init, marketplace sync, and any other Node-only startup.
 */

async function startMarketplaceSync() {
  if (process.env.MARKETPLACE_AUTO_SYNC === "false") return;

  const { syncMarketplace } = await import("@/lib/marketplace-sync");

  const run = async (label: string) => {
    try {
      const r = await syncMarketplace();
      console.log(`[marketplace] ${label}: ${r.status} — ${r.agents} agents, ${r.templates} templates (${r.commit})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[marketplace] ${label} failed:`, msg.split("\n")[0]);
    }
  };

  run("startup").catch(() => {});

  const interval = parseInt(process.env.MARKETPLACE_SYNC_INTERVAL || "86400000", 10);
  setInterval(() => run("periodic").catch(() => {}), interval).unref();
}

type GuestEnforcementAuditPayload = {
  type?: string;
  event?: {
    timestamp?: string;
    userId?: string;
    role?: string;
    method?: string;
    pathname?: string;
    decision?: string;
    reason?: string;
    requestId?: string;
    userAgent?: string;
    clientIp?: string;
    orgId?: string;
  };
};

export async function initAuditLogger() {
  const [{ setAuditLogger }, { execAuditLog }] = await Promise.all([
    import("@/lib/middleware/audit-logger"),
    import("@/lib/audit-exec"),
  ]);

  setAuditLogger(async (payload: unknown) => {
    const auditPayload = payload as GuestEnforcementAuditPayload;
    if (auditPayload.type !== "guest_enforcement" || !auditPayload.event) {
      execAuditLog("middleware_audit", "middleware audit event", {
        payload_type: typeof payload,
      }).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[audit] middleware audit log failed:", msg);
      });
      return;
    }

    const event = auditPayload.event;
    const method = event.method || "UNKNOWN";
    const pathname = event.pathname || "unknown";
    const decision = event.decision || "unknown";
    const role = event.role || "unknown";
    const description = `${decision} ${method} ${pathname} for ${role}`;

    execAuditLog(
      "guest_enforcement",
      event.reason ? `${description}: ${event.reason}` : description,
      {
        user_id: event.userId,
        role: event.role,
        method: event.method,
        pathname: event.pathname,
        decision: event.decision,
        reason: event.reason,
        request_id: event.requestId,
        user_agent: event.userAgent,
        org_id: event.orgId,
        event_timestamp: event.timestamp,
      },
      { ip: event.clientIp },
    ).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[audit] guest enforcement audit log failed:", msg);
    });
  });
}

async function initDatabase() {
  try {
    const { getAuth, getDb } = await import("@/lib/auth-server");
    const auth = await getAuth();
    if (auth) {
      try {
        const db = await getDb();
        if (!db) throw new Error("sqlite db not initialized");

        // tables are created by better-auth's getMigrations in auth-server.ts
        // only add custom columns that better-auth doesn't know about

        try {
          db.exec(`ALTER TABLE "user" ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0`);
        } catch { /* column already exists */ }

        try {
          db.exec(`ALTER TABLE "user" ADD COLUMN linux_username TEXT`);
        } catch { /* column already exists */ }

        try {
          db.exec(`ALTER TABLE "user" ADD COLUMN wrapped_dek BLOB`);
        } catch { /* column already exists */ }

        db.pragma("foreign_keys = ON");

        console.log("[auth] database ready");
      } catch (migErr) {
        console.error("[auth] database init failed:", migErr);
      }
    }
  } catch (err) {
    console.error("[auth] database initialization failed:", err);
  }
}

export async function register() {
  await initDatabase();
  try {
    await initAuditLogger();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[audit] guest enforcement audit logger init failed:", msg);
  }
  await startMarketplaceSync();
}
