import { basename, dirname, join } from "path";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync } from "fs";
import { createHash } from "crypto";
import { createNotification } from "@/lib/notifications/notification-server";
import { fireWebhooks, type WebhookEvent } from "@/lib/webhooks/webhook-utils";
import { postOutboundWebhook } from "@/lib/webhooks/outbound-webhook-delivery";
import { dispatchPlugins } from "@/lib/system/plugin-dispatch";
import {
  taskClaimMetadataKeyIfUnset,
  taskGet,
  taskMergeMeta,
  taskUpdate,
} from "@/lib/tasks/task-store";
import config from "@/lib/config";
import type { AdapterOperation } from "@/lib/runner-v2/adapters";
import {
  claimProcessIdentity,
  claimProcessIdentityHash,
  claimProcessIsAlive,
  ExclusiveFileClaimBusyError,
  withExclusiveFileClaim,
} from "@/lib/runner-v2/file-claim";

type QueuedExternalEffect = {
  type: AdapterOperation["type"];
  idempotencyKey?: string;
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
  idempotencyKey?: string;
  status: "dispatched" | "skipped" | "failed";
  operation?: AdapterOperation;
  reason?: string;
  error?: string;
  attempt?: number;
  timestamp: string;
};

const DEFAULT_MAX_DISPATCH_ATTEMPTS = 3;
const ORPHANED_CLAIM_MIN_AGE_MS = 5 * 60_000;

export interface ExternalEffectEnqueueRecord {
  idempotencyKey: string;
  operation: AdapterOperation;
  namespaceId?: string;
  orgId?: string;
  reason?: string;
  timestamp?: string;
}

export function externalEffectsLockPath(outboxPath: string): string {
  return join(dirname(outboxPath), ".external-effects.lock");
}

export function withExternalEffectsLock<T>(outboxPath: string, fn: () => T): T {
  return withExclusiveFileClaim(externalEffectsLockPath(outboxPath), fn);
}

export function enqueueExternalEffectsOnce(
  outboxPath: string,
  records: ExternalEffectEnqueueRecord[],
): number {
  mkdirSync(dirname(outboxPath), { recursive: true });
  return withExternalEffectsLock(outboxPath, () => {
    const knownIds = knownExternalEffectIds(outboxPath);
    const missing = records.filter((record) => !knownIds.has(record.idempotencyKey));
    if (missing.length === 0) return 0;
    appendFileSync(outboxPath, missing.map((record) => JSON.stringify({
      type: record.operation.type,
      idempotencyKey: record.idempotencyKey,
      status: "queued",
      operation: { ...record.operation, idempotencyKey: record.idempotencyKey },
      namespaceId: record.namespaceId,
      orgId: record.orgId,
      reason: record.reason || "typed runner queued durable external effect",
      timestamp: record.timestamp || new Date().toISOString(),
    })).join("\n") + "\n");
    return missing.length;
  });
}

export async function dispatchExternalEffects(input: ExternalEffectsDispatchInput): Promise<ExternalEffectsDispatchResult> {
  const auditPath = input.auditPath || join(dirname(input.outboxPath), "external-effects.dispatch.jsonl");
  const result: ExternalEffectsDispatchResult = { handled: 0, dispatched: 0, skipped: 0, failed: 0 };
  const completedIds = completedExternalEffectIds(auditPath);

  for (const record of readQueuedEffects(input.outboxPath)) {
    const queuedOperation = record.operation;
    if (!queuedOperation) continue;
    result.handled += 1;
    const idempotencyKey = externalEffectId(record);
    const operation = idempotencyKey
      ? { ...queuedOperation, idempotencyKey } as AdapterOperation
      : queuedOperation;
    if (idempotencyKey && completedIds.has(idempotencyKey)) {
      result.skipped += 1;
      continue;
    }

    try {
      const dispatch = await dispatchOperation(operation, dispatchContextForRecord(record, input));
      appendJsonl(auditPath, {
        type: operation.type,
        idempotencyKey,
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
      if (idempotencyKey) completedIds.add(idempotencyKey);
    } catch (error) {
      result.failed += 1;
      appendJsonl(auditPath, {
        type: operation.type,
        idempotencyKey,
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
  let claimPaths: string[];
  try {
    claimPaths = withExternalEffectsLock(input.outboxPath, () => {
      const paths = adoptOrphanedClaims(input.outboxPath, input.now);
      if (existsSync(input.outboxPath)) {
        const claimPath = freshClaimPath(input.outboxPath);
        try {
          renameSync(input.outboxPath, claimPath);
          paths.push(claimPath);
        } catch {
          // another consumer claimed it between existsSync and rename
        }
      }
      return paths;
    });
  } catch (error) {
    if (error instanceof ExclusiveFileClaimBusyError) return result;
    throw error;
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
  const completedIds = completedExternalEffectIds(auditPath);

  for (const record of readQueuedEffects(claimPath)) {
    const queuedOperation = record.operation;
    if (!queuedOperation) continue;
    result.handled += 1;
    const idempotencyKey = externalEffectId(record);
    const operation = idempotencyKey
      ? { ...queuedOperation, idempotencyKey } as AdapterOperation
      : queuedOperation;
    if (idempotencyKey && completedIds.has(idempotencyKey)) {
      result.skipped += 1;
      continue;
    }
    const attempt = (record.attempts ?? 0) + 1;

    try {
      const dispatch = await dispatchOperation(operation, dispatchContextForRecord(record, input));
      appendJsonl(auditPath, {
        type: operation.type,
        idempotencyKey,
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
      if (idempotencyKey) completedIds.add(idempotencyKey);
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
          idempotencyKey,
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
          idempotencyKey,
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
      const owner = claimOwner(entry, prefix);
      if (owner?.pid && claimProcessIsAlive(owner.pid)) {
        // Legacy claim names have no start identity, so a live/EPERM PID is
        // conservatively authoritative. New names can prove PID reuse.
        if (!owner.processIdentityHash) continue;
        const currentIdentity = claimProcessIdentity(owner.pid);
        if (
          currentIdentity === undefined
          || claimProcessIdentityHash(currentIdentity) === owner.processIdentityHash
        ) continue;
      }
      if (statSync(path).mtimeMs > cutoff) continue;
      const freshPath = freshClaimPath(outboxPath);
      renameSync(path, freshPath);
      adopted.push(freshPath);
    } catch {
      // claim removed or adopted by another consumer
    }
  }
  return adopted;
}

function freshClaimPath(outboxPath: string): string {
  const identity = claimProcessIdentity(process.pid);
  const identityPart = identity ? `i${claimProcessIdentityHash(identity)}` : "u";
  return `${outboxPath}.claim-${process.pid}-${identityPart}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function claimOwner(
  entry: string,
  prefix: string,
): { pid: number; processIdentityHash?: string } | undefined {
  const parts = entry.slice(prefix.length).split("-");
  const pid = Number.parseInt(parts[0] || "", 10);
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  const identity = /^i([a-f0-9]{16})$/.exec(parts[1] || "");
  return {
    pid,
    ...(identity ? { processIdentityHash: identity[1] } : {}),
  };
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
    createNotification(context.namespaceId, {
      ...notificationFromOperation(operation),
      idempotencyKey: operation.idempotencyKey,
    });
    return { status: "dispatched" };
  }

  if (operation.type === "metadata-webhooks") {
    const chainId = operation.chainId || persistentChainIdFromPath(operation.chainPath) || operation.chainName;
    await fireWebhooks(context.namespaceId, context.orgId, chainId, normalizeWebhookEvent(operation.event), {
      runId: operation.runId,
      ...(operation.idempotencyKey ? { idempotencyKey: operation.idempotencyKey } : {}),
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
    const metadata = {
      last_run_status: operation.status,
      ...(operation.runId ? { last_run_id: operation.runId } : {}),
    };
    if (operation.idempotencyKey) {
      const claimKey = `runner_v2_external_effect_${stableKey(operation.idempotencyKey)}`;
      const taskMetadata = task.metadata && typeof task.metadata === "object"
        ? task.metadata as Record<string, unknown>
        : {};
      if (taskMetadata[claimKey] === operation.idempotencyKey) {
        return { status: "skipped", reason: "task-status operation already applied" };
      }
      // Reopen before claiming the metadata ID. If the worker dies between
      // these writes, retry sees no claim and finishes the metadata update;
      // claiming first could permanently suppress the still-missing reopen.
      if (operation.status === "completed" && task.status !== "open") {
        taskUpdate(context.orgId, operation.taskId, { status: "open" }, context.namespaceId);
      }
      const claimed = taskClaimMetadataKeyIfUnset(context.orgId, operation.taskId, claimKey, {
        ...metadata,
        [claimKey]: operation.idempotencyKey,
      }, context.namespaceId);
      if (!claimed) return { status: "skipped", reason: "task-status operation already applied" };
      return { status: "dispatched" };
    } else {
      taskMergeMeta(context.orgId, operation.taskId, metadata, context.namespaceId);
    }
    // shell parity (run-lib.sh update-task-from-run): a completed run returns
    // its task to the open column for triage.
    if (operation.status === "completed" && task.status !== "open") {
      taskUpdate(context.orgId, operation.taskId, { status: "open" }, context.namespaceId);
    }
    return { status: "dispatched" };
  }

  if (operation.type === "webhook") {
    const chainId = operation.chainId || persistentChainIdFromPath(operation.chainPath);
    if (!chainId) {
      return { status: "skipped", reason: "webhook operation missing chain path" };
    }
    const event = normalizeWebhookEvent(operation.event);
    if (operation.idempotencyKey) {
      await fireWebhooks(context.namespaceId, context.orgId, chainId, event, {
        idempotencyKey: operation.idempotencyKey,
      });
    } else {
      await fireWebhooks(context.namespaceId, context.orgId, chainId, event);
    }
    return { status: "dispatched" };
  }

  if (operation.type === "plugin") {
    if (!context.allowPluginDispatch) {
      // the synthetic probe and proof scripts dispatch fixture outboxes; only
      // the live drain may invoke real org plugins.
      return { status: "skipped", reason: "plugin dispatch requires live drain opt-in" };
    }
    dispatchPlugins({
      namespaceId: context.namespaceId,
      orgId: context.orgId,
      event: operation.event,
      chainId: operation.chainName,
      runId: operation.runId,
      agentId: operation.agentId,
      data: {},
    });
    return { status: "dispatched" };
  }

  if (operation.type === "legacy-webhook") {
    if (!context.allowLegacyWebhookNetwork) {
      return { status: "skipped", reason: "legacy webhook dispatch requires explicit network opt-in" };
    }
    const response = await postOutboundWebhook(operation.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "mentiko/1.0",
        ...(operation.idempotencyKey ? { "Idempotency-Key": operation.idempotencyKey } : {}),
      },
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

function notificationFromOperation(operation: Extract<AdapterOperation, { type: "notification" }>): {
  type: string;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
} {
  const chainName = operation.chainName || "chain";
  const stalled = operation.event.includes("stalled");
  const failed = stalled || operation.event.includes("failed") || operation.event.includes("stopped");
  // agent-level events keep agent typing (dispatch route parity:
  // agent-completed -> agent_complete, agent-failed -> agent_error) so a
  // mid-chain agent completion never reads as a chain-level notification.
  if (operation.event.startsWith("agent")) {
    return {
      type: failed ? "agent_error" : "agent_complete",
      title: failed ? `Agent failed in ${chainName}` : `Agent completed in ${chainName}`,
      message: operation.reason
        || `An agent in chain '${chainName}' ${failed ? "failed" : "finished"}${operation.runId ? ` (run: ${operation.runId})` : ""}.`,
      metadata: {
        chainId: operation.chainName,
        runId: operation.runId,
        agentId: operation.agentId,
      },
    };
  }
  return {
    type: failed ? "chain_failed" : "chain_complete",
    title: stalled ? "Chain stalled" : failed ? "Chain failed" : "Chain completed",
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

function persistentChainIdFromPath(chainPath?: string): string | undefined {
  const id = chainIdFromPath(chainPath);
  return id && !id.startsWith("run-") ? id : undefined;
}

function knownExternalEffectIds(outboxPath: string): Set<string> {
  const dir = dirname(outboxPath);
  const paths = [outboxPath, join(dir, "external-effects.dispatch.jsonl")];
  if (existsSync(dir)) {
    const prefix = `${basename(outboxPath)}.claim-`;
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(prefix)) paths.push(join(dir, entry));
    }
  }
  const ids = new Set<string>();
  for (const path of paths) {
    for (const record of readJsonlRecords(path)) {
      const id = externalEffectId(record as QueuedExternalEffect);
      if (id) ids.add(id);
    }
  }
  return ids;
}

function completedExternalEffectIds(auditPath: string): Set<string> {
  const ids = new Set<string>();
  for (const record of readJsonlRecords(auditPath)) {
    if (record.status !== "dispatched" && record.status !== "skipped") continue;
    const id = externalEffectId(record as QueuedExternalEffect);
    if (id) ids.add(id);
  }
  return ids;
}

function externalEffectId(record: QueuedExternalEffect): string | undefined {
  if (typeof record.idempotencyKey === "string" && record.idempotencyKey) {
    return record.idempotencyKey;
  }
  const operation = record.operation;
  return operation && typeof operation.idempotencyKey === "string" && operation.idempotencyKey
    ? operation.idempotencyKey
    : undefined;
}

function readJsonlRecords(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const value = JSON.parse(line);
          return value && typeof value === "object" && !Array.isArray(value) ? [value] : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function stableKey(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
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
  // Append-only via O_APPEND: the OS guarantees a single write() of this size
  // is atomic, so concurrent appenders each land their whole line and readers
  // never observe a partial one. The previous read-entire-file -> write
  // tmp -> rename approach was a read-modify-write: two concurrent appends
  // read the same base content and the second rename clobbered the first
  // record (lost update) instead of both lines surviving.
  appendFileSync(path, `${JSON.stringify(value)}\n`);
}
