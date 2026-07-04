import { basename, dirname, join } from "path";
import { existsSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { execFile } from "child_process";
import { createNotification } from "@/lib/notifications/notification-server";
import { fireWebhooks, type WebhookEvent } from "@/lib/webhooks/webhook-utils";
import { postOutboundWebhook } from "@/lib/webhooks/outbound-webhook-delivery";
import { taskGet, taskMergeMeta, taskUpdate } from "@/lib/tasks/task-store";
import config, { orgPath } from "@/lib/config";
import type { AdapterOperation } from "@/lib/runner-v2/adapters";

type QueuedExternalEffect = {
  type: AdapterOperation["type"];
  status?: string;
  operation?: AdapterOperation;
  namespaceId?: string;
  orgId?: string;
  attempts?: number;
};

export interface ExternalEffectsDispatchInput {
  outboxPath: string;
  namespaceId: string;
  orgId: string;
  auditPath?: string;
  allowLegacyWebhookNetwork?: boolean;
  allowPluginDispatch?: boolean;
}

export interface ExternalEffectsDispatchResult {
  handled: number;
  dispatched: number;
  skipped: number;
  failed: number;
}

export interface ExternalEffectsDrainResult extends ExternalEffectsDispatchResult {
  requeued: number;
}

export interface RunnerV2ExternalEffectsSweepResult extends ExternalEffectsDrainResult {
  outboxes: number;
}

type DispatchAuditRecord = {
  type: string;
  status: "dispatched" | "skipped" | "failed";
  operation?: AdapterOperation;
  reason?: string;
  error?: string;
  attempt?: number;
  timestamp: string;
};

const DEFAULT_MAX_DISPATCH_ATTEMPTS = 3;
const ORPHANED_CLAIM_MIN_AGE_MS = 5 * 60_000;
const PLUGIN_DISPATCH_TIMEOUT_MS = 30_000;

export async function dispatchExternalEffects(input: ExternalEffectsDispatchInput): Promise<ExternalEffectsDispatchResult> {
  const auditPath = input.auditPath || join(dirname(input.outboxPath), "external-effects.dispatch.jsonl");
  const result: ExternalEffectsDispatchResult = { handled: 0, dispatched: 0, skipped: 0, failed: 0 };

  for (const record of readQueuedEffects(input.outboxPath)) {
    const operation = record.operation;
    if (!operation) continue;
    result.handled += 1;

    try {
      const dispatch = await dispatchOperation(operation, dispatchContextForRecord(record, input));
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

export interface ExternalEffectsDrainInput extends ExternalEffectsDispatchInput {
  maxAttempts?: number;
  now?: Date;
}

/**
 * Consume an outbox for live delivery: claim the file by atomic rename so a
 * concurrent queue append starts a fresh outbox, dispatch every queued record,
 * requeue transient failures with a bounded attempt count, and audit each
 * outcome. Also adopts claim files orphaned by a crashed prior drain.
 */
export async function drainExternalEffectsOutbox(input: ExternalEffectsDrainInput): Promise<ExternalEffectsDrainResult> {
  const result: ExternalEffectsDrainResult = { handled: 0, dispatched: 0, skipped: 0, failed: 0, requeued: 0 };
  const claimPaths = adoptOrphanedClaims(input.outboxPath, input.now);

  if (existsSync(input.outboxPath)) {
    const claimPath = `${input.outboxPath}.claim-${process.pid}-${Date.now()}`;
    try {
      renameSync(input.outboxPath, claimPath);
      claimPaths.push(claimPath);
    } catch {
      // another consumer claimed it between existsSync and rename; nothing to do
    }
  }

  for (const claimPath of claimPaths) {
    const drained = await drainClaimedFile(claimPath, input);
    result.handled += drained.handled;
    result.dispatched += drained.dispatched;
    result.skipped += drained.skipped;
    result.failed += drained.failed;
    result.requeued += drained.requeued;
  }

  return result;
}

export interface RunnerV2ExternalEffectsSweepInput {
  stateDir?: string;
  runsDir?: string;
  namespaceId?: string;
  orgId?: string;
  allowLegacyWebhookNetwork?: boolean;
  maxAttempts?: number;
  now?: Date;
}

/**
 * Live-path sweep for the background worker: drain the project-level state
 * outbox (bash completion exports STATE_DIR) and every per-run state outbox
 * (typed completion fallback when STATE_DIR is absent). Probe outboxes live
 * under <runDir>/runner-v2-probe/ and are intentionally not swept — the probe
 * dispatches its own fixtures.
 */
export async function drainRunnerV2ExternalEffects(
  input: RunnerV2ExternalEffectsSweepInput = {},
): Promise<RunnerV2ExternalEffectsSweepResult> {
  const stateDir = input.stateDir || config.stateDir;
  const runsDir = input.runsDir || config.runsDir;
  const namespaceId = input.namespaceId || config.namespaceId;
  const orgId = input.orgId || config.orgId;

  const outboxPaths = new Set<string>();
  const stateOutbox = join(stateDir, "external-effects.jsonl");
  if (hasPendingOutboxWork(stateOutbox)) outboxPaths.add(stateOutbox);

  if (existsSync(runsDir)) {
    for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const runOutbox = join(runsDir, entry.name, "state", "external-effects.jsonl");
      if (hasPendingOutboxWork(runOutbox)) outboxPaths.add(runOutbox);
    }
  }

  const result: RunnerV2ExternalEffectsSweepResult = {
    outboxes: 0,
    handled: 0,
    dispatched: 0,
    skipped: 0,
    failed: 0,
    requeued: 0,
  };

  for (const outboxPath of outboxPaths) {
    result.outboxes += 1;
    try {
      const drained = await drainExternalEffectsOutbox({
        outboxPath,
        namespaceId,
        orgId,
        allowLegacyWebhookNetwork: input.allowLegacyWebhookNetwork ?? true,
        allowPluginDispatch: true,
        maxAttempts: input.maxAttempts,
        now: input.now,
      });
      result.handled += drained.handled;
      result.dispatched += drained.dispatched;
      result.skipped += drained.skipped;
      result.failed += drained.failed;
      result.requeued += drained.requeued;
    } catch (error) {
      // one corrupt outbox must not stop the sweep; surface via audit next to it
      appendJsonl(join(dirname(outboxPath), "external-effects.dispatch.jsonl"), {
        type: "sweep",
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
    }
  }

  return result;
}

async function drainClaimedFile(claimPath: string, input: ExternalEffectsDrainInput): Promise<ExternalEffectsDrainResult> {
  const auditPath = input.auditPath || join(dirname(input.outboxPath), "external-effects.dispatch.jsonl");
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_DISPATCH_ATTEMPTS;
  const result: ExternalEffectsDrainResult = { handled: 0, dispatched: 0, skipped: 0, failed: 0, requeued: 0 };

  for (const record of readQueuedEffects(claimPath)) {
    const operation = record.operation;
    if (!operation) continue;
    result.handled += 1;
    const attempt = (record.attempts ?? 0) + 1;

    try {
      const dispatch = await dispatchOperation(operation, dispatchContextForRecord(record, input));
      appendJsonl(auditPath, {
        type: operation.type,
        status: dispatch.status,
        operation,
        reason: dispatch.reason,
        attempt,
        timestamp: new Date().toISOString(),
      });
      if (dispatch.status === "dispatched") {
        result.dispatched += 1;
      } else {
        result.skipped += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < maxAttempts) {
        result.requeued += 1;
        appendJsonl(input.outboxPath, {
          ...record,
          status: "queued",
          attempts: attempt,
        });
        appendJsonl(auditPath, {
          type: operation.type,
          status: "failed",
          operation,
          error: message,
          reason: `requeued for retry ${attempt + 1}/${maxAttempts}`,
          attempt,
          timestamp: new Date().toISOString(),
        });
      } else {
        result.failed += 1;
        appendJsonl(auditPath, {
          type: operation.type,
          status: "failed",
          operation,
          error: message,
          reason: `max dispatch attempts reached (${maxAttempts})`,
          attempt,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  unlinkSync(claimPath);
  return result;
}

function adoptOrphanedClaims(outboxPath: string, now?: Date): string[] {
  const dir = dirname(outboxPath);
  if (!existsSync(dir)) return [];
  const prefix = `${basename(outboxPath)}.claim-`;
  const cutoff = (now?.getTime() ?? Date.now()) - ORPHANED_CLAIM_MIN_AGE_MS;
  const adopted: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.startsWith(prefix)) continue;
    const path = join(dir, entry);
    try {
      if (statSync(path).mtimeMs <= cutoff) adopted.push(path);
    } catch {
      // claim removed by its owner between readdir and stat
    }
  }
  return adopted;
}

function hasPendingOutboxWork(outboxPath: string): boolean {
  if (existsSync(outboxPath)) return true;
  const dir = dirname(outboxPath);
  if (!existsSync(dir)) return false;
  const prefix = `${basename(outboxPath)}.claim-`;
  return readdirSync(dir).some((entry) => entry.startsWith(prefix));
}

type OperationDispatchContext = {
  namespaceId: string;
  orgId: string;
  allowLegacyWebhookNetwork?: boolean;
  allowPluginDispatch?: boolean;
};

function dispatchContextForRecord(
  record: QueuedExternalEffect,
  input: Pick<ExternalEffectsDispatchInput, "namespaceId" | "orgId" | "allowLegacyWebhookNetwork" | "allowPluginDispatch">,
): OperationDispatchContext {
  return {
    namespaceId: record.namespaceId || input.namespaceId,
    orgId: record.orgId || input.orgId,
    allowLegacyWebhookNetwork: input.allowLegacyWebhookNetwork,
    allowPluginDispatch: input.allowPluginDispatch,
  };
}

async function dispatchOperation(
  operation: AdapterOperation,
  context: OperationDispatchContext,
): Promise<{ status: "dispatched" | "skipped"; reason?: string }> {
  if (operation.type === "notification") {
    createNotification(context.namespaceId, notificationFromOperation(operation));
    return { status: "dispatched" };
  }

  if (operation.type === "metadata-webhooks") {
    await fireWebhooks(context.namespaceId, context.orgId, operation.chainName, normalizeWebhookEvent(operation.event), {
      runId: operation.runId,
    });
    return { status: "dispatched" };
  }

  if (operation.type === "task-status") {
    if (!operation.taskId) {
      return { status: "skipped", reason: "task-status operation has no linked task" };
    }
    const task = taskGet(context.orgId, operation.taskId, context.namespaceId);
    if (!task) {
      return { status: "skipped", reason: `task not found: ${operation.taskId}` };
    }
    taskMergeMeta(context.orgId, operation.taskId, {
      last_run_status: operation.status,
      ...(operation.runId ? { last_run_id: operation.runId } : {}),
    }, context.namespaceId);
    // shell parity (run-lib.sh update-task-from-run): a completed run returns
    // its task to the open column for triage.
    if (operation.status === "completed" && task.status !== "open") {
      taskUpdate(context.orgId, operation.taskId, { status: "open" }, context.namespaceId);
    }
    return { status: "dispatched" };
  }

  if (operation.type === "webhook") {
    const chainId = chainIdFromPath(operation.chainPath);
    if (!chainId) {
      return { status: "skipped", reason: "webhook operation missing chain path" };
    }
    await fireWebhooks(context.namespaceId, context.orgId, chainId, normalizeWebhookEvent(operation.event));
    return { status: "dispatched" };
  }

  if (operation.type === "plugin") {
    if (!context.allowPluginDispatch) {
      // the synthetic probe and proof scripts dispatch fixture outboxes; only
      // the live drain may invoke real org plugins.
      return { status: "skipped", reason: "plugin dispatch requires live drain opt-in" };
    }
    await runPluginsViaShell(operation, context);
    return { status: "dispatched" };
  }

  if (operation.type === "legacy-webhook") {
    if (!context.allowLegacyWebhookNetwork) {
      return { status: "skipped", reason: "legacy webhook dispatch requires explicit network opt-in" };
    }
    const response = await postOutboundWebhook(operation.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "mentiko/1.0" },
      body: JSON.stringify(operation.payload),
      timeoutMs: 10_000,
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`legacy webhook HTTP ${response.statusCode}`);
    }
    return { status: "dispatched" };
  }

  return { status: "skipped", reason: "operation is not an external dispatcher record" };
}

/**
 * The plugin system is bash-owned (lib/plugin-runner.sh reads the org plugin
 * registry and invokes each enabled plugin). Typed dispatch delegates to the
 * same run-plugins entrypoint the shell completion uses, so plugin behavior
 * cannot drift between runners.
 */
function runPluginsViaShell(
  operation: Extract<AdapterOperation, { type: "plugin" }>,
  context: OperationDispatchContext,
): Promise<void> {
  const pluginRunner = join(config.codeRoot, "lib", "plugin-runner.sh");
  if (!existsSync(pluginRunner)) {
    throw new Error(`plugin runner not found: ${pluginRunner}`);
  }
  return new Promise((resolve, reject) => {
    execFile(
      "bash",
      [
        "-c",
        'source "$0" && run-plugins "$1" "$2" "$3" "$4"',
        pluginRunner,
        operation.event,
        operation.chainName,
        operation.runId,
        operation.agentId || "",
      ],
      {
        timeout: PLUGIN_DISPATCH_TIMEOUT_MS,
        env: {
          ...process.env,
          NAMESPACE_ID: context.namespaceId,
          ORG_ID: context.orgId,
          MENTIKO_ORG_ROOT: orgPath(context.namespaceId, context.orgId),
        },
      },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(`plugin dispatch failed: ${error.message}${stderr ? ` (${stderr.trim().slice(-200)})` : ""}`));
          return;
        }
        resolve();
      },
    );
  });
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

function chainIdFromPath(chainPath?: string): string | undefined {
  if (!chainPath) return undefined;
  const normalized = chainPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const chainDir = normalized.endsWith("/chain.json") ? dirname(normalized) : normalized;
  const id = basename(chainDir);
  return id && id !== "." && id !== ".." ? id : undefined;
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

function appendJsonl(path: string, value: DispatchAuditRecord | QueuedExternalEffect): void {
  const tmp = `${path}.tmp.${process.pid}`;
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  writeFileSync(tmp, `${current}${JSON.stringify(value)}\n`);
  renameSync(tmp, path);
}
