/**
 * audit-logger: async audit logging for guest enforcement.
 * non-blocking, graceful degradation if audit service unavailable.
 */

import type { OrgRole } from "../orgs/org-types";

export interface GuestEnforcementAuditEvent {
  timestamp: string;
  userId: string;
  role: OrgRole;
  method: string;
  pathname: string;
  decision: "allowed" | "blocked";
  reason?: string;
  requestId: string;
  userAgent?: string;
  clientIp?: string;
  orgId?: string;
}

export interface AuditLoggerOptions {
  enabled?: boolean;
  timeout?: number;
  throwOnError?: boolean;
}

const DEFAULT_AUDIT_OPTIONS: Required<AuditLoggerOptions> = {
  enabled: true,
  timeout: 5000,
  throwOnError: false,
};

// Use globalThis to share the singleton across Next.js module instances (instrumentation
// chunk vs route handler chunk both resolve to the same globalThis).
const GLOBAL_KEY = "__mentiko_audit_logger__";

declare global {
  var __mentiko_audit_logger__: ((event: unknown) => Promise<void>) | undefined;
}

export function setAuditLogger(fn: (event: unknown) => Promise<void>) {
  globalThis[GLOBAL_KEY] = fn;
}

async function execAuditLog(event: unknown): Promise<void> {
  const fn = globalThis[GLOBAL_KEY];
  if (!fn) {
    console.warn("[guest-enforcement] execAuditLog not configured, audit event lost:", event);
    return;
  }

  try {
    await fn(event);
  } catch (error) {
    console.error("[guest-enforcement] audit log emit failed:", error);
    throw error;
  }
}

export async function emitGuestEnforcementAudit(
  event: GuestEnforcementAuditEvent,
  options: AuditLoggerOptions = {}
): Promise<void> {
  const opts = { ...DEFAULT_AUDIT_OPTIONS, ...options };

  if (!opts.enabled) {
    return;
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("Audit log emit timeout")), opts.timeout);
    });

    await Promise.race([
      execAuditLog({
        type: "guest_enforcement",
        event,
      }),
      timeoutPromise,
    ]);
  } catch (error) {
    if (opts.throwOnError) {
      throw error;
    }
    console.warn("[guest-enforcement] audit log emit failed (non-blocking):", error);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export function createAuditEvent(
  request: Request,
  userId: string,
  role: OrgRole,
  decision: "allowed" | "blocked",
  reason?: string
): GuestEnforcementAuditEvent {
  const url = new URL(request.url);
  const userAgent = request.headers.get("user-agent") || undefined;

  const forwarded = request.headers.get("x-forwarded-for");
  const clientIp = forwarded
    ? forwarded.split(",")[0].trim()
    : request.headers.get("x-real-ip") || undefined;

  return {
    timestamp: new Date().toISOString(),
    userId,
    role,
    method: request.method,
    pathname: url.pathname,
    decision,
    reason,
    requestId: `req-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    userAgent,
    clientIp,
  };
}
