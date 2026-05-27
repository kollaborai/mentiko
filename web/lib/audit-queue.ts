import type { Queue, Worker, ConnectionOptions } from "bullmq";
import { createRedisClient, ping as redisPing, redisConfigured } from "./redis";
import { execAuditLog, type AuditLogMetadata, type AuditExecOptions } from "./audit-exec";

export interface AuditLogJobData {
  eventType: string;
  description: string;
  metadata?: AuditLogMetadata;
  options?: AuditExecOptions;
}

const QUEUE_NAME = "audit-log";
type AuditQueue = Queue<AuditLogJobData, void, string>;
type AuditWorker = Worker<AuditLogJobData, void, string>;

const auditState = globalThis as typeof globalThis & {
  __mentikoAuditQueue?: AuditQueue | null;
  __mentikoAuditQueuePromise?: Promise<AuditQueue | null>;
  __mentikoAuditWorker?: AuditWorker | null;
  __mentikoAuditWorkerPromise?: Promise<AuditWorker | null>;
  __mentikoAuditQueueSkipWarned?: boolean;
};

const importExternal = new Function("specifier", "return import(specifier)") as (
  specifier: string
) => Promise<typeof import("bullmq")>;

function createBullConnection(
  overrides?: Parameters<typeof createRedisClient>[0]
): ConnectionOptions | null {
  const connection = createRedisClient(overrides);
  return connection ? (connection as unknown as ConnectionOptions) : null;
}

async function createAuditQueue(): Promise<AuditQueue | null> {
  if (!redisConfigured) return null;
  const connection = createBullConnection();
  if (!connection) return null;
  const { Queue } = await importExternal("bullmq");
  return new Queue<AuditLogJobData, void, string>(QUEUE_NAME, { connection });
}

export async function getAuditQueue(): Promise<AuditQueue | null> {
  if (auditState.__mentikoAuditQueue !== undefined) {
    return auditState.__mentikoAuditQueue;
  }
  auditState.__mentikoAuditQueuePromise ??= createAuditQueue();
  auditState.__mentikoAuditQueue = await auditState.__mentikoAuditQueuePromise;
  return auditState.__mentikoAuditQueue;
}

async function createAuditWorker(): Promise<AuditWorker | null> {
  if (!redisConfigured) return null;
  const connection = createBullConnection({ maxRetriesPerRequest: null });
  if (!connection) return null;

  const { Worker } = await importExternal("bullmq");
  const worker = new Worker<AuditLogJobData, void, string>(
    QUEUE_NAME,
    async (job) => {
      const { eventType, description, metadata, options } = job.data;
      await execAuditLog(eventType, description, metadata, options);
    },
    {
      connection,
      concurrency: 5,
    }
  );

  worker.on("failed", (job, err) => {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[audit-queue] job ${job?.id} failed (attempt ${job?.attemptsMade}):`, errorMessage);
  });

  worker.on("error", (err) => {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[audit-queue] worker error:", errorMessage);
  });

  return worker;
}

async function ensureAuditWorker(): Promise<void> {
  if (auditState.__mentikoAuditWorker !== undefined) return;
  auditState.__mentikoAuditWorkerPromise ??= createAuditWorker();
  auditState.__mentikoAuditWorker = await auditState.__mentikoAuditWorkerPromise;
}

export async function addAuditLog(data: AuditLogJobData): Promise<void> {
  if (!redisConfigured || !(await redisPing())) {
    if (!auditState.__mentikoAuditQueueSkipWarned) {
      console.warn("[audit-queue] redis unavailable, skipping audit log:", data.eventType);
      auditState.__mentikoAuditQueueSkipWarned = true;
    }
    return;
  }

  const auditQueue = await getAuditQueue();
  if (!auditQueue) {
    if (!auditState.__mentikoAuditQueueSkipWarned) {
      console.warn("[audit-queue] redis unavailable, skipping audit log:", data.eventType);
      auditState.__mentikoAuditQueueSkipWarned = true;
    }
    return;
  }

  try {
    await ensureAuditWorker();

    await auditQueue.add(data.eventType, data, {
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    });
  } catch (err) {
    if (!auditState.__mentikoAuditQueueSkipWarned) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[audit-queue] redis unavailable, skipping audit log:", message);
      auditState.__mentikoAuditQueueSkipWarned = true;
    }
  }
}
