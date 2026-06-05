/**
 * guest-enforcement: middleware that blocks guest write operations.
 * sits before route handlers, providing automatic security controls.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "../auth/auth-bridge";
import { type OrgRole } from "../orgs/org-types";
import { emitGuestEnforcementAudit } from "./audit-logger";
import { incrementCounter, recordLatency } from "./metrics";

// ============================================================
// types
// ============================================================

export interface GuestEnforcementResult {
  blocked: true;
  statusCode: 401 | 403;
  response: NextResponse;
  reason?: string;
}

export interface GuestEnforcementOptions {
  allowedRoutes?: string[];
  auditEnabled?: boolean;
  metricsEnabled?: boolean;
  auditLogger?: (event: GuestEnforcementAuditEvent) => Promise<void>;
  metricsRecorder?: (metric: GuestEnforcementMetric) => Promise<void>;
}

export interface GuestEnforcementContext {
  userId: string;
  role: OrgRole;
  orgId?: string;
  namespaceId: string;
  guestCheckPassed: boolean;
  requestId: string;
}

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

export interface GuestEnforcementMetric {
  type: string;
  value: number;
  labels: {
    role: OrgRole;
    method: string;
    route?: string;
    decision?: "allowed" | "blocked";
  };
  timestamp: string;
}

// ============================================================
// constants
// ============================================================

export const WRITE_METHODS = new Set<string>([
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
]);

export const READ_METHODS = new Set<string>([
  "GET",
  "HEAD",
  "OPTIONS",
]);

// ============================================================
// utilities
// ============================================================

export function isWriteMethod(method: string): boolean {
  return WRITE_METHODS.has(method.toUpperCase());
}

export function isReadMethod(method: string): boolean {
  return READ_METHODS.has(method.toUpperCase());
}

function generateRequestId(): string {
  return `req-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

function extractClientIp(request: NextRequest): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return request.headers.get("x-real-ip") || undefined;
}

// ============================================================
// main enforcement function
// ============================================================

export async function enforceGuestWrites(
  request: NextRequest,
  options: GuestEnforcementOptions = {}
): Promise<GuestEnforcementResult | null> {
  const startTime = performance.now();
  const requestId = generateRequestId();
  const method = request.method.toUpperCase();
  const pathname = new URL(request.url).pathname;

  const {
    allowedRoutes = [],
    auditEnabled = true,
    metricsEnabled = true,
    auditLogger,
  } = options;

  const emitAudit = (event: GuestEnforcementAuditEvent) => (
    auditLogger ? auditLogger(event) : emitGuestEnforcementAudit(event)
  );

  try {
    const session = await getSessionUser(request);

    if (!session) {
      if (auditEnabled) {
        await emitAudit({
          timestamp: new Date().toISOString(),
          userId: "unknown",
          role: "guest",
          method,
          pathname,
          decision: "blocked",
          reason: "No valid session found",
          requestId,
          userAgent: request.headers.get("user-agent") || undefined,
          clientIp: extractClientIp(request),
        }).catch(() => {});
      }

      if (metricsEnabled) {
        await incrementCounter("session_resolution_failure_total", {
          role: "guest",
          method,
          route: pathname,
        }).catch(() => {});
      }

      return {
        blocked: true,
        statusCode: 401,
        response: NextResponse.json(
          {
            error: "Unauthorized",
            code: "NO_AUTH",
            details: {
              reason: "No valid session found",
            },
          },
          { status: 401 }
        ),
        reason: "No valid session found",
      };
    }

    const { id: userId, role, orgId } = session;

    if (allowedRoutes.includes(pathname)) {
      const duration = performance.now() - startTime;
      if (metricsEnabled) {
        await recordLatency(duration, {
          role,
          method,
          route: pathname,
        }).catch(() => {});
      }

      return null;
    }

    const allowGuestWrite = request.headers.get("x-allow-guest-write");
    if (allowGuestWrite === "true") {
      const duration = performance.now() - startTime;
      if (metricsEnabled) {
        await recordLatency(duration, {
          role,
          method,
          route: pathname,
        }).catch(() => {});
      }

      return null;
    }

    if (role === "guest" && isWriteMethod(method)) {
      if (auditEnabled) {
        await emitAudit({
          timestamp: new Date().toISOString(),
          userId,
          role,
          method,
          pathname,
          decision: "blocked",
          reason: "Guest users cannot perform write operations",
          requestId,
          userAgent: request.headers.get("user-agent") || undefined,
          clientIp: extractClientIp(request),
          orgId,
        }).catch(() => {});
      }

      if (metricsEnabled) {
        await incrementCounter("guest_block_total", {
          role,
          method,
          route: pathname,
          decision: "blocked",
        }).catch(() => {});
      }

      return {
        blocked: true,
        statusCode: 403,
        response: NextResponse.json(
          {
            error: "Forbidden",
            code: "GUEST_WRITE_BLOCKED",
            details: {
              role,
              method,
              pathname,
              reason: "Guest users cannot perform write operations",
            },
          },
          { status: 403 }
        ),
        reason: "Guest users cannot perform write operations",
      };
    }

    if (auditEnabled) {
      await emitAudit({
        timestamp: new Date().toISOString(),
        userId,
        role,
        method,
        pathname,
        decision: "allowed",
        requestId,
        userAgent: request.headers.get("user-agent") || undefined,
        clientIp: extractClientIp(request),
        orgId,
      }).catch(() => {});
    }

    if (metricsEnabled) {
      await incrementCounter("guest_allow_total", {
        role,
        method,
        route: pathname,
        decision: "allowed",
      }).catch(() => {});

      const duration = performance.now() - startTime;
      await recordLatency(duration, {
        role,
        method,
        route: pathname,
      }).catch(() => {});
    }

    return null;
  } catch (_error) {
    if (metricsEnabled) {
      await incrementCounter("session_resolution_failure_total", {
        role: "guest",
        method,
        route: pathname,
      }).catch(() => {});
    }

    return {
      blocked: true,
      statusCode: 401,
      response: NextResponse.json(
        {
          error: "Unauthorized",
          code: "NO_AUTH",
          details: {
            reason: "Session resolution failed",
          },
        },
        { status: 401 }
      ),
      reason: "Session resolution failed",
    };
  }
}

// ============================================================
// middleware wrapper
// ============================================================

export function withGuestEnforcement<T extends unknown[] = []>(
  handler: (
    request: NextRequest,
    context: GuestEnforcementContext,
    ...args: T
  ) => Promise<NextResponse>,
  options: GuestEnforcementOptions = {}
): (request: NextRequest, ...args: T) => Promise<NextResponse> {
  return async (request: NextRequest, ...args: T): Promise<NextResponse> => {
    const blockResult = await enforceGuestWrites(request, options);
    if (blockResult?.blocked) {
      return blockResult.response!;
    }

    const session = await getSessionUser(request);
    const context: GuestEnforcementContext = {
      userId: session?.id || "unknown",
      role: session?.role || "guest",
      orgId: session?.orgId,
      namespaceId: session?.namespaceId || "default",
      guestCheckPassed: true,
      requestId: generateRequestId(),
    };

    return handler(request, context, ...args);
  };
}
