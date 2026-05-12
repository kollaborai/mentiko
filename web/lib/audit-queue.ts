import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { createRedisClient, redisConfigured } from "./redis";
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
  __mentikoAuditWorker?: AuditWorker | null;
};

function createBullConnection(
  overrides?: Parameters<typeof createRedisClient>[0]
): ConnectionOptions | null {
  const connection = createRedisClient(overrides);
  return connection ? (connection as unknown as ConnectionOptions) : null;
}

function createAuditQueue(): AuditQueue | null {
  if (!redisConfigured) return null;
  const connection = createBullConnection();
  return connection ? new Queue<AuditLogJobData, void, string>(QUEUE_NAME, { connection }) : null;
}

export const auditQueue = auditState.__mentikoAuditQueue ?? (
  auditState.__mentikoAuditQueue = createAuditQueue()
);

function createAuditWorker(): AuditWorker | null {
  if (!redisConfigured) return null;
  const connection = createBullConnection({ maxRetriesPerRequest: null });
  if (!connection) return null;

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

auditState.__mentikoAuditWorker ??= createAuditWorker();

export async function addAuditLog(data: AuditLogJobData): Promise<void> {
  if (!auditQueue) {
    console.warn("[audit-queue] redis unavailable, skipping audit log:", data.eventType);
    return;
  }

  await auditQueue.add(data.eventType, data, {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  });
}
