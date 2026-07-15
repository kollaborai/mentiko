import { createHash, randomUUID } from "crypto";
import fs from "fs";
import { basename, dirname, join } from "path";
import { nsPath } from "@/lib/config";
import { withExclusiveFileClaim } from "@/lib/runner-v2/file-claim";

export interface NotificationMetadata extends Record<string, unknown> {
  agentId?: string;
  chainId?: string;
  runId?: string;
  webhookUrl?: string;
  httpCode?: number;
  jobId?: string;
  jobType?: string;
  error?: unknown;
  taskId?: string;
  actionUrl?: string;
  actionLabel?: string;
}

export interface PersistedNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  metadata?: NotificationMetadata;
}

export interface NotificationMutation<T> {
  notifications: PersistedNotification[];
  result: T;
  write: boolean;
}

export interface AddNotificationInput {
  id?: string;
  idempotencyKey?: string;
  type: string;
  title: string;
  message: string;
  timestamp?: string;
  read?: boolean;
  metadata?: NotificationMetadata;
}

const MAX_NOTIFICATIONS = 200;
const CLAIM_WAIT_TIMEOUT_MS = 5_000;

export class NotificationPersistenceError extends Error {
  constructor(
    readonly operation: "prepare" | "claim" | "read" | "write",
    readonly file: string,
    options: { cause: unknown },
  ) {
    super(`notification store ${operation} failed: ${file}`, options);
    this.name = "NotificationPersistenceError";
  }
}

function notificationStorePaths(namespaceId: string): {
  file: string;
  claim: string;
} {
  const directory = nsPath(namespaceId, "notifications");
  const file = join(directory, "notifications.json");
  try {
    fs.mkdirSync(directory, { recursive: true });
  } catch (cause) {
    throw new NotificationPersistenceError("prepare", file, { cause });
  }
  return {
    file,
    claim: join(directory, ".notifications.claim"),
  };
}

function isNotificationRecord(value: unknown): value is PersistedNotification {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<PersistedNotification>;
  return typeof record.id === "string"
    && record.id.length > 0
    && typeof record.type === "string"
    && "title" in record
    && "message" in record
    && typeof record.timestamp === "string"
    && typeof record.read === "boolean"
    && (record.metadata === undefined
      || (record.metadata !== null
        && typeof record.metadata === "object"
        && !Array.isArray(record.metadata)));
}

function readNotificationFile(file: string): PersistedNotification[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(parsed) || !parsed.every(isNotificationRecord)) {
      throw new TypeError("notification store must contain an array of notification records");
    }
    return parsed;
  } catch (cause) {
    if (isNodeError(cause) && cause.code === "ENOENT") return [];
    if (cause instanceof NotificationPersistenceError) throw cause;
    throw new NotificationPersistenceError("read", file, { cause });
  }
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value !== null && typeof value === "object" && "code" in value;
}

function writeNotificationFile(file: string, notifications: PersistedNotification[]): void {
  const temp = join(
    dirname(file),
    `.${basename(file)}.tmp-${process.pid}-${randomUUID()}`,
  );
  try {
    fs.writeFileSync(temp, `${JSON.stringify(notifications, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    fs.renameSync(temp, file);
  } catch (cause) {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // Preserve the original persistence error.
    }
    throw new NotificationPersistenceError("write", file, { cause });
  }
}

export function readNotifications(namespaceId: string): PersistedNotification[] {
  return readNotificationFile(notificationStorePaths(namespaceId).file);
}

/**
 * Hold the namespace notification claim across the complete read/mutate/write
 * transaction. A thrown mutator leaves the existing store unchanged.
 */
export function mutateNotifications<T>(
  namespaceId: string,
  mutator: (notifications: PersistedNotification[]) => NotificationMutation<T>,
): T {
  const paths = notificationStorePaths(namespaceId);
  let claimEntered = false;
  try {
    return withExclusiveFileClaim(paths.claim, () => {
      claimEntered = true;
      const current = readNotificationFile(paths.file);
      const mutation = mutator(current);
      if (mutation.write) {
        writeNotificationFile(paths.file, mutation.notifications);
      }
      return mutation.result;
    }, {
      waitTimeoutMs: CLAIM_WAIT_TIMEOUT_MS,
      retryDelayMs: 10,
    });
  } catch (cause) {
    if (cause instanceof NotificationPersistenceError) throw cause;
    if (claimEntered) throw cause;
    throw new NotificationPersistenceError("claim", paths.file, { cause });
  }
}

export function notificationIdFor(input: Pick<AddNotificationInput, "id" | "idempotencyKey">): string {
  if (input.id) return input.id;
  if (input.idempotencyKey) {
    const digest = createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 24);
    return `notif_${digest}`;
  }
  return `notif_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

/** Insert once by stable notification ID, retaining the newest 200 records. */
export function addNotification(
  namespaceId: string,
  input: AddNotificationInput,
): PersistedNotification {
  const id = notificationIdFor(input);
  return mutateNotifications(namespaceId, (notifications) => {
    const existing = notifications.find((notification) => notification.id === id);
    if (existing) {
      return { notifications, result: existing, write: false };
    }

    const notification: PersistedNotification = {
      id,
      type: input.type,
      title: input.title,
      message: input.message,
      timestamp: input.timestamp ?? new Date().toISOString(),
      read: input.read ?? false,
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };
    return {
      notifications: [notification, ...notifications].slice(0, MAX_NOTIFICATIONS),
      result: notification,
      write: true,
    };
  });
}
