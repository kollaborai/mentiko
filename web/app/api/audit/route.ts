import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { BadRequest } from "@/lib/api-errors";
import { execAuditLog, execAuditQuery } from "@/lib/api/audit-exec";
import { requirePermission } from "@/lib/auth/rbac-auth";

export const dynamic = "force-dynamic";

interface AuditEntry {
  id?: string;
  timestamp?: string;
  event_type?: string;
  description?: string;
  user?: string;
  source?: string;
  ip?: string;
  hostname?: string;
  [key: string]: unknown;
}

// Get client IP
function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

// GET /api/audit - Query audit logs
// Query params:
//   - type: event type filter (chain_start, chain_complete, auth, etc)
//   - user: user filter
//   - chain: chain name filter
//   - runId: run ID filter
//   - since: ISO date or relative (e.g., "7 days ago")
//   - limit: max results (default 100)
//   - format: json or csv (default json)
export const GET = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "view_audit");
  if (perm) return perm;

  const ip = getClientIp(request);

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "all";
  const user = searchParams.get("user") || "";
  const chain = searchParams.get("chain") || "";
  const runId = searchParams.get("runId") || "";
  const since = searchParams.get("since") || "";
  const limit = searchParams.get("limit") || "100";
  const format = searchParams.get("format") || "json";

  // Build the audit-query command
  let filterType = type;
  let filterValue = "";

  if (user) {
    filterType = "user";
    filterValue = user;
  } else if (chain) {
    filterType = "chain";
    filterValue = chain;
  } else if (runId) {
    filterType = "run_id";
    filterValue = runId;
  }

  const stdout = await execAuditQuery(
    { filterType, filterValue, since, limit },
    { ip }
  );

  let result: unknown;

  if (format === "csv") {
    // Convert JSON to CSV - return raw NextResponse for download
    const entries = JSON.parse(stdout || "[]") as AuditEntry[];
    const headers = ["id", "timestamp", "event_type", "description", "user", "source", "ip", "hostname"];
    let csv = headers.join(",") + "\n";

    for (const entry of entries) {
      const row = headers.map(h =>
        JSON.stringify(entry[h] || "").replace(/"/g, '""')
      ).join(",");
      csv += row + "\n";
    }

    result = csv;
    return new NextResponse(result as string, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=audit-logs.csv",
      },
    });
  } else {
    result = JSON.parse(stdout || "[]") as AuditEntry[];
  }

  return apiSuccess({
    success: true,
    count: Array.isArray(result) ? result.length : 0,
    logs: result,
  });
});

// POST /api/audit - Write an audit log entry
// Body: { eventType, description, metadata }
export const POST = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "view_audit");
  if (perm) return perm;

  const ip = getClientIp(request);

  const body = await request.json();
  const { eventType, description, metadata = {} } = body as {
    eventType?: unknown;
    description?: unknown;
    metadata?: Record<string, unknown>;
  };

  if (typeof eventType !== "string" || typeof description !== "string" || !eventType || !description) {
    throw new BadRequest("eventType and description are required");
  }

  const safeMetadata: Record<string, string> = {};
  for (const [k, v] of Object.entries(metadata ?? {})) {
    if (v === null || v === undefined) continue;
    safeMetadata[k] = typeof v === "string" ? v : JSON.stringify(v);
  }

  const auditId = await execAuditLog(eventType, description, safeMetadata, { ip });

  return apiSuccess({
    success: true,
    auditId,
  });
});
