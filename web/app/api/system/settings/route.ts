import { NextRequest } from "next/server";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/auth/api-auth";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { execAuditLog } from "@/lib/api/audit-exec";
import { addAuditLog } from "@/lib/api/audit-queue";
import {
  readSystemSettings,
  writeSystemSettings as writeSettings,
  type SemanticPolicyOverride,
  type SystemSettings,
} from "@/lib/system/system-settings";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";

export const dynamic = "force-dynamic";

export type { SystemSettings };

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const namespaceId = await getNamespaceIdFromRequest(request);
  return apiSuccess({ settings: readSystemSettings(namespaceId) });
});

/**
 * Validate + stamp a semantic-policy override change (plan-of-record A6).
 * Admin-only, audited, namespace-scoped. `null` clears the override.
 */
function parseSemanticPolicy(raw: unknown, actor: string): SemanticPolicyOverride | undefined {
  if (raw === null) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BadRequest("semantic_policy must be an object or null");
  }
  const body = raw as Record<string, unknown>;
  if (body.mode !== "enforce" && body.mode !== "warn") {
    throw new BadRequest('semantic_policy.mode must be "enforce" or "warn"');
  }
  if (body.mode === "enforce") return undefined;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    throw new BadRequest("semantic_policy.reason is required when mode is warn");
  }
  const ruleIds = Array.isArray(body.rule_ids)
    ? body.rule_ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : undefined;
  let expiresAt: string | undefined;
  if (body.expires_at != null) {
    const expires = typeof body.expires_at === "string" ? Date.parse(body.expires_at) : Number.NaN;
    if (Number.isNaN(expires)) {
      throw new BadRequest("semantic_policy.expires_at must be an ISO-8601 timestamp");
    }
    expiresAt = new Date(expires).toISOString();
  }
  return {
    mode: "warn",
    ...(ruleIds && ruleIds.length > 0 ? { rule_ids: ruleIds } : {}),
    reason,
    actor,
    changed_at: new Date().toISOString(),
    ...(expiresAt ? { expires_at: expiresAt } : {}),
  };
}

export const PUT = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const body = await request.json();
  const namespaceId = await getNamespaceIdFromRequest(request);
  const current = readSystemSettings(namespaceId);

  let semanticPolicy = current.semantic_policy;
  if ("semantic_policy" in body) {
    // The circuit breaker is admin-only, unlike the general knobs above it.
    const perm = await requirePermission(request, "manage_org");
    if (perm) return perm;
    const actor = (await getSessionUser(request))?.email || "system-admin";
    semanticPolicy = parseSemanticPolicy(body.semantic_policy, actor);

    const description = semanticPolicy
      ? `Semantic policy override set to warn by ${actor}`
      : `Semantic policy override cleared by ${actor}`;
    const metadata: Record<string, string> = {
      namespace_id: namespaceId,
      actor,
      mode: semanticPolicy?.mode ?? "enforce",
      rule_ids: semanticPolicy?.rule_ids?.join(",") ?? "*",
      reason: semanticPolicy?.reason ?? "",
      expires_at: semanticPolicy?.expires_at ?? "",
    };
    execAuditLog("semantic_policy_override", description, metadata, {}).catch(() => {});
    addAuditLog({ eventType: "semantic_policy_override", description, metadata, options: {} }).catch(() => {});
  }

  const updated: SystemSettings = {
    max_concurrent_runs:
      typeof body.max_concurrent_runs === "number"
        ? Math.max(1, Math.min(50, body.max_concurrent_runs))
        : current.max_concurrent_runs,
    auto_run_enabled:
      typeof body.auto_run_enabled === "boolean"
        ? body.auto_run_enabled
        : current.auto_run_enabled,
    ...(semanticPolicy ? { semantic_policy: semanticPolicy } : {}),
  };

  writeSettings(updated, namespaceId);
  return apiSuccess({ settings: updated });
});
