import { existsSync, readFileSync } from "fs";
import { orgPath } from "@/lib/config";
import { BadRequest, NotFound } from "@/lib/api-errors";
import type { Chain } from "@/lib/types";
import type { InboundWebhook } from "@/lib/webhooks/inbound-webhook-storage";

const SAFE_CHAIN_ID_RE = /^[A-Za-z0-9_-]{1,120}$/;

interface BuildInboundRunBodyInput {
  hook: InboundWebhook;
  chain: Chain;
  payload: unknown;
  headers: Record<string, string>;
  triggerId: string;
  overrides?: unknown;
}

function stringField(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function recordField(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function lookupPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split(".")) {
    if (!segment) return undefined;
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Read a scalar value out of a webhook payload by dotted path (e.g.
 * "delivery.id"). Returns a string only for scalar leaves; objects/arrays
 * and missing paths yield undefined. Used to derive idempotency keys.
 */
export function readWebhookPayloadValue(payload: unknown, path: string): string | undefined {
  const value = lookupPath(payload, path);
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function stringifyTemplateValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function renderWebhookTemplate(
  template: string | undefined,
  payload: unknown,
  headers: Record<string, string>
): string {
  if (!template) return "";
  return template.replace(/\{\{\s*(payload|headers)\.([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, source: string, key: string) => {
    const value = source === "headers"
      ? headers[key.toLowerCase()]
      : lookupPath(payload, key);
    return stringifyTemplateValue(value);
  });
}

export function normalizeWebhookHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    const normalized = key.toLowerCase();
    if (normalized === "authorization" || normalized === "cookie" || normalized === "set-cookie") return;
    out[normalized] = value;
  });
  return out;
}

export function loadChainForInboundWebhook(namespaceId: string, orgId: string, chainId: string): Chain {
  if (!SAFE_CHAIN_ID_RE.test(chainId)) {
    throw new BadRequest("Invalid chain ID", { field: "chainId" });
  }

  const chainPath = orgPath(namespaceId, orgId, "chains", chainId, "chain.json");
  if (!existsSync(chainPath)) {
    throw new NotFound("Chain", chainId);
  }

  const parsed = JSON.parse(readFileSync(chainPath, "utf-8")) as Chain;
  return { ...parsed, id: parsed.id || chainId };
}

export function buildInboundRunBody({
  hook,
  chain,
  payload,
  headers,
  triggerId,
  overrides,
}: BuildInboundRunBodyInput) {
  const overrideRecord = recordField(overrides);
  const defaults = hook.runDefaults || {};
  const allowed = hook.allowedOverrides || {};
  const overrideGoal = allowed.goal ? stringField(overrideRecord?.goal, 50000) : undefined;
  const overrideWorkspaceId = allowed.workspace ? stringField(overrideRecord?.workspaceId, 200) : undefined;
  const overrideWorkspacePath = allowed.workspace ? stringField(overrideRecord?.workspacePath, 2000) : undefined;
  const overrideProfile = allowed.profile ? stringField(overrideRecord?.agentProfileId, 200) : undefined;
  const overrideExecutor = allowed.executor ? stringField(overrideRecord?.executor, 50) : undefined;
  const overrideMetadata = allowed.metadata ? recordField(overrideRecord?.metadata) : undefined;

  const payloadMode = defaults.payloadMode || "both";
  const userPrompt =
    overrideGoal ||
    renderWebhookTemplate(defaults.goal, payload, headers) ||
    `Triggered by inbound webhook: ${hook.name}`;

  return {
    chain,
    chainId: hook.chainId || chain.id,
    userPrompt,
    workspaceId: overrideWorkspaceId || defaults.workspaceId,
    workspacePath: overrideWorkspacePath || defaults.workspacePath,
    agentProfileId: overrideProfile || defaults.agentProfileId,
    executor: overrideExecutor || defaults.executor,
    metadata: {
      triggeredBy: "inbound-webhook",
      inboundWebhookId: hook.id,
      inboundWebhookName: hook.name,
      inboundTriggerId: triggerId,
      ...(payloadMode === "metadata" || payloadMode === "both" ? { inboundPayload: payload } : {}),
      ...(overrideMetadata || {}),
    },
  };
}
