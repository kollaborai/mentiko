import { dirname, join } from "path";
import { existsSync, readFileSync, renameSync, writeFileSync } from "fs";
import { createNotification } from "@/lib/notifications/notification-server";
import { fireWebhooks, type WebhookEvent } from "@/lib/webhooks/webhook-utils";
import type { AdapterOperation } from "@/lib/runner-v2/adapters";

type QueuedExternalEffect = {
  type: AdapterOperation["type"];
  status?: string;
  operation?: AdapterOperation;
};

export interface ExternalEffectsDispatchInput {
  outboxPath: string;
  namespaceId: string;
  orgId: string;
  auditPath?: string;
  allowLegacyWebhookNetwork?: boolean;
}

export interface ExternalEffectsDispatchResult {
  handled: number;
  dispatched: number;
  skipped: number;
  failed: number;
}

type DispatchAuditRecord = {
  type: string;
  status: "dispatched" | "skipped" | "failed";
  operation?: AdapterOperation;
  reason?: string;
  error?: string;
  timestamp: string;
};

export async function dispatchExternalEffects(input: ExternalEffectsDispatchInput): Promise<ExternalEffectsDispatchResult> {
  const auditPath = input.auditPath || join(dirname(input.outboxPath), "external-effects.dispatch.jsonl");
  const result: ExternalEffectsDispatchResult = { handled: 0, dispatched: 0, skipped: 0, failed: 0 };

  for (const record of readQueuedEffects(input.outboxPath)) {
    const operation = record.operation;
    if (!operation) continue;
    result.handled += 1;

    try {
      const dispatch = await dispatchOperation(operation, input);
      appendJsonl(auditPath, {
        type: operation.type,
        status: dispatch.status,
        operation,
        reason: dispatch.reason,
        timestamp: new Date().toISOString(),
      });
      if (dispatch.status === "dispatched") {
        result.dispatched += 1;
      } else {
        result.skipped += 1;
      }
    } catch (error) {
      result.failed += 1;
      appendJsonl(auditPath, {
        type: operation.type,
        status: "failed",
        operation,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
    }
  }

  return result;
}

async function dispatchOperation(
  operation: AdapterOperation,
  input: ExternalEffectsDispatchInput,
): Promise<{ status: "dispatched" | "skipped"; reason?: string }> {
  if (operation.type === "notification") {
    createNotification(input.namespaceId, notificationFromOperation(operation));
    return { status: "dispatched" };
  }

  if (operation.type === "metadata-webhooks") {
    await fireWebhooks(input.namespaceId, input.orgId, operation.chainName, normalizeWebhookEvent(operation.event), {
      runId: operation.runId,
    });
    return { status: "dispatched" };
  }

  if (operation.type === "task-status") {
    return { status: "skipped", reason: "task status dispatch requires task-store context" };
  }

  if (operation.type === "webhook") {
    return { status: "skipped", reason: "legacy send-webhook event has no typed dispatcher yet" };
  }

  if (operation.type === "plugin") {
    return { status: "skipped", reason: "no typed plugin executor yet" };
  }

  if (operation.type === "legacy-webhook") {
    return {
      status: "skipped",
      reason: input.allowLegacyWebhookNetwork
        ? "legacy webhook network dispatch not implemented in typed dispatcher"
        : "legacy webhook dispatch requires explicit network opt-in",
    };
  }

  return { status: "skipped", reason: "operation is not an external dispatcher record" };
}

function notificationFromOperation(operation: Extract<AdapterOperation, { type: "notification" }>): {
  type: string;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
} {
  const chainName = operation.chainName || "chain";
  const failed = operation.event.includes("failed") || operation.event.includes("stopped");
  return {
    type: failed ? "chain_failed" : "chain_complete",
    title: failed ? "Chain failed" : "Chain completed",
    message: operation.reason || `${chainName} ${failed ? "failed" : "completed"}`,
    metadata: {
      chainId: operation.chainName,
      runId: operation.runId,
      agentId: operation.agentId,
    },
  };
}

function normalizeWebhookEvent(event: string): WebhookEvent {
  if (event === "started" || event === "completed" || event === "failed") return event;
  if (event === "chain_complete" || event === "chain-completed") return "completed";
  if (event === "chain_failed" || event === "chain-failed") return "failed";
  return "completed";
}

function readQueuedEffects(path: string): QueuedExternalEffect[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as QueuedExternalEffect)
    .filter((record) => !record.status || record.status === "queued");
}

function appendJsonl(path: string, value: DispatchAuditRecord): void {
  const tmp = `${path}.tmp.${process.pid}`;
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  writeFileSync(tmp, `${current}${JSON.stringify(value)}\n`);
  renameSync(tmp, path);
}
