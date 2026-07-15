import {
  queryAuditLog,
  writeAuditLog,
  type AuditLogMetadata,
} from "@/lib/system/audit-log";

// Retained here because runner command builders consume a shell-quoting helper;
// audit persistence itself no longer creates a shell command.
export function shellEscape(value: string): string {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

export type { AuditLogMetadata };

export interface AuditExecOptions {
  source?: string;
  ip?: string;
  timeoutMs?: number;
  namespaceId?: string;
}

export async function execAuditLog(
  eventType: string,
  description: string,
  metadata: AuditLogMetadata = {},
  options: AuditExecOptions = {},
): Promise<string> {
  const entry = writeAuditLog({
    namespaceId: options.namespaceId,
    eventType,
    description,
    metadata,
    source: options.source ?? "web",
    ip: sanitizeIp(options.ip),
  });
  return entry.id;
}

export interface AuditQueryArgs {
  filterType: "all" | "event_type" | "user" | "chain" | "run_id" | "auth";
  filterValue?: string;
  since?: string;
  limit?: string | number;
}

export async function execAuditQuery(
  args: AuditQueryArgs,
  options: AuditExecOptions = {},
): Promise<string> {
  const limit = args.limit === undefined ? undefined : Number(args.limit);
  const entries = queryAuditLog({
    namespaceId: options.namespaceId,
    filterType: args.filterType,
    filterValue: args.filterValue,
    since: args.since,
    limit,
  });
  return JSON.stringify(entries);
}

function sanitizeIp(ip: string | undefined): string {
  if (!ip) return "";
  const trimmed = ip.trim();
  return /^[\d.]+$/.test(trimmed) || /^[\da-f:]+$/i.test(trimmed) ? trimmed : "unknown";
}
