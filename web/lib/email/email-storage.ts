/**
 * email storage layer
 * file-based persistence for inbound/outbound email
 * stored in namespaces/{namespaceId}/emails/
 */

import { promises as fs } from "fs";
import { join } from "path";
import { createHmac } from "crypto";
import { orgPath } from "../config";
import { resolveAppSecret } from "../secrets/dev-secret";
import type {
  NormalizedEmail,
  EmailInbox,
  OutboundQueueEntry,
  AuditLogEntry,
} from "./email-types";

const EMAIL_BASE = "emails";
const INBOX_FOLDER_REGEX = /^emails\/[a-z0-9][a-z0-9_-]{0,49}$/;
const MAX_ATTACHMENT_COUNT = 25;
const DEFAULT_DISK_QUOTA_MB = parseInt(process.env.EMAIL_DISK_QUOTA_MB || "500");
const DEFAULT_SEND_QUOTA_PER_DAY = parseInt(process.env.EMAIL_SEND_QUOTA_PER_DAY || "1000");

// module-level disk quota cache, 60s TTL
const diskQuotaCache = new Map<string, { bytes: number; checkedAt: number }>();
const DISK_CACHE_TTL_MS = 60_000;

// void reference to suppress unused warning
void MAX_ATTACHMENT_COUNT;

// ---------------------------------------------------------------------------
// path helpers
// ---------------------------------------------------------------------------

function getEmailBase(namespaceId: string, orgId: string): string {
  return orgPath(namespaceId, orgId, EMAIL_BASE);
}

function getConfigDir(namespaceId: string, orgId: string): string {
  return join(getEmailBase(namespaceId, orgId), "config");
}

function getInboxDir(namespaceId: string, orgId: string, folder: string): string {
  return orgPath(namespaceId, orgId, folder);
}

function getFolderDir(
  namespaceId: string,
  orgId: string,
  folder: string,
  subfolder: "unread" | "processing" | "processed" | "failed"
): string {
  return join(getInboxDir(namespaceId, orgId, folder), subfolder);
}

function getOutboundDir(namespaceId: string, orgId: string): string {
  return join(getEmailBase(namespaceId, orgId), "outbound-queue");
}

// ---------------------------------------------------------------------------
// ensure dirs
// ---------------------------------------------------------------------------

async function ensureEmailDirs(namespaceId: string, orgId: string, folder: string): Promise<void> {
  const dirs = [
    getConfigDir(namespaceId, orgId),
    getFolderDir(namespaceId, orgId, folder, "unread"),
    getFolderDir(namespaceId, orgId, folder, "processing"),
    getFolderDir(namespaceId, orgId, folder, "processed"),
    getFolderDir(namespaceId, orgId, folder, "failed"),
    join(getEmailBase(namespaceId, orgId), "outbound-queue"),
    join(getEmailBase(namespaceId, orgId), "outbound-sent"),
    join(getEmailBase(namespaceId, orgId), "outbound-failed"),
  ];
  await Promise.all(dirs.map((d) => fs.mkdir(d, { recursive: true })));
}

// ---------------------------------------------------------------------------
// inbox config
// ---------------------------------------------------------------------------

export async function loadInboxes(namespaceId: string, orgId: string): Promise<EmailInbox[]> {
  const path = join(getConfigDir(namespaceId, orgId), "inboxes.json");
  try {
    const data = await fs.readFile(path, "utf-8");
    return JSON.parse(data) as EmailInbox[];
  } catch {
    return [];
  }
}

export async function saveInboxes(
  namespaceId: string,
  orgId: string,
  inboxes: EmailInbox[]
): Promise<void> {
  await fs.mkdir(getConfigDir(namespaceId, orgId), { recursive: true });
  const path = join(getConfigDir(namespaceId, orgId), "inboxes.json");
  await fs.writeFile(path, JSON.stringify(inboxes, null, 2));
}

// ---------------------------------------------------------------------------
// audit log
// ---------------------------------------------------------------------------

export async function appendAuditLog(
  namespaceId: string,
  orgId: string,
  entry: AuditLogEntry
): Promise<void> {
  await fs.mkdir(getConfigDir(namespaceId, orgId), { recursive: true });
  const path = join(getConfigDir(namespaceId, orgId), "audit.jsonl");
  await fs.appendFile(path, JSON.stringify(entry) + "\n");
}

// ---------------------------------------------------------------------------
// email files
// ---------------------------------------------------------------------------

export async function writeEmail(
  namespaceId: string,
  orgId: string,
  folder: string,
  email: NormalizedEmail
): Promise<void> {
  await ensureEmailDirs(namespaceId, orgId, folder);
  const path = join(getFolderDir(namespaceId, orgId, folder, "unread"), `${email.internalId}.json`);
  await fs.writeFile(path, JSON.stringify(email, null, 2));
}

export async function readEmail(
  namespaceId: string,
  orgId: string,
  folder: string,
  subfolder: "unread" | "processing" | "processed" | "failed",
  internalId: string
): Promise<NormalizedEmail | null> {
  const path = join(getFolderDir(namespaceId, orgId, folder, subfolder), `${internalId}.json`);
  try {
    const data = await fs.readFile(path, "utf-8");
    return JSON.parse(data) as NormalizedEmail;
  } catch {
    return null;
  }
}

export async function listEmails(
  namespaceId: string,
  orgId: string,
  folder: string,
  subfolder: "unread" | "processing" | "processed" | "failed",
  limit: number,
  offset: number
): Promise<{ emails: NormalizedEmail[]; total: number }> {
  const dir = getFolderDir(namespaceId, orgId, folder, subfolder);
  try {
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
    const all: NormalizedEmail[] = [];

    await Promise.all(
      files.map(async (file) => {
        try {
          const data = await fs.readFile(join(dir, file), "utf-8");
          all.push(JSON.parse(data) as NormalizedEmail);
        } catch {
          // skip malformed
        }
      })
    );

    all.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));

    return {
      emails: all.slice(offset, offset + limit),
      total: all.length,
    };
  } catch {
    return { emails: [], total: 0 };
  }
}

export async function claimEmail(
  namespaceId: string,
  orgId: string,
  folder: string,
  internalId: string
): Promise<boolean> {
  const src = join(getFolderDir(namespaceId, orgId, folder, "unread"), `${internalId}.json`);
  const dst = join(getFolderDir(namespaceId, orgId, folder, "processing"), `${internalId}.json`);
  try {
    await fs.rename(src, dst);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw err;
  }
}

export async function moveEmail(
  namespaceId: string,
  orgId: string,
  folder: string,
  internalId: string,
  from: "unread" | "processing" | "processed" | "failed",
  to: "unread" | "processing" | "processed" | "failed"
): Promise<void> {
  const src = join(getFolderDir(namespaceId, orgId, folder, from), `${internalId}.json`);
  const dst = join(getFolderDir(namespaceId, orgId, folder, to), `${internalId}.json`);
  await fs.rename(src, dst);
}

export async function deleteEmail(
  namespaceId: string,
  orgId: string,
  folder: string,
  internalId: string
): Promise<void> {
  const subfolders = ["unread", "processed", "failed"] as const;
  for (const sub of subfolders) {
    const path = join(getFolderDir(namespaceId, orgId, folder, sub), `${internalId}.json`);
    try {
      await fs.unlink(path);
    } catch {
      // not in this subfolder, continue
    }
  }

  const inboxBase = getInboxDir(namespaceId, orgId, folder);

  // cascade: attachments dir
  const attachmentsDir = join(inboxBase, "attachments", internalId);
  try {
    await fs.rm(attachmentsDir, { recursive: true, force: true });
  } catch {
    // doesn't exist, skip
  }

  // cascade: quarantine dir
  const quarantineDir = join(inboxBase, "quarantine", internalId);
  try {
    await fs.rm(quarantineDir, { recursive: true, force: true });
  } catch {
    // doesn't exist, skip
  }

  await appendAuditLog(namespaceId, orgId, {
    timestamp: new Date().toISOString(),
    event: "email_deleted",
    namespaceId,
    details: { internalId, folder },
  });
}

// ---------------------------------------------------------------------------
// outbound queue
// ---------------------------------------------------------------------------

export async function enqueueOutbound(
  namespaceId: string,
  orgId: string,
  entry: OutboundQueueEntry
): Promise<void> {
  await fs.mkdir(getOutboundDir(namespaceId, orgId), { recursive: true });
  const path = join(getOutboundDir(namespaceId, orgId), `${entry.id}.json`);
  await fs.writeFile(path, JSON.stringify(entry, null, 2));
}

export async function loadOutboundQueue(
  namespaceId: string,
  orgId: string,
  status?: string
): Promise<OutboundQueueEntry[]> {
  const dir = getOutboundDir(namespaceId, orgId);
  try {
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
    const entries: OutboundQueueEntry[] = [];

    await Promise.all(
      files.map(async (file) => {
        try {
          const data = await fs.readFile(join(dir, file), "utf-8");
          const entry = JSON.parse(data) as OutboundQueueEntry;
          if (!status || entry.status === status) {
            entries.push(entry);
          }
        } catch {
          // skip malformed
        }
      })
    );

    return entries;
  } catch {
    return [];
  }
}

export async function updateOutboundEntry(
  namespaceId: string,
  orgId: string,
  id: string,
  updates: Partial<OutboundQueueEntry>
): Promise<void> {
  const path = join(getOutboundDir(namespaceId, orgId), `${id}.json`);
  const data = await fs.readFile(path, "utf-8");
  const entry = JSON.parse(data) as OutboundQueueEntry;
  const updated = { ...entry, ...updates };
  await fs.writeFile(path, JSON.stringify(updated, null, 2));
}

export async function moveOutboundEntry(
  namespaceId: string,
  orgId: string,
  id: string,
  destination: "outbound-sent" | "outbound-failed"
): Promise<void> {
  const src = join(getOutboundDir(namespaceId, orgId), `${id}.json`);
  const dstDir = join(getEmailBase(namespaceId, orgId), destination);
  await fs.mkdir(dstDir, { recursive: true });
  const dst = join(dstDir, `${id}.json`);
  const data = await fs.readFile(src, "utf-8");
  await fs.writeFile(dst, data);
  await fs.unlink(src);
}

// ---------------------------------------------------------------------------
// quota
// ---------------------------------------------------------------------------

async function sumDirBytes(dirPath: string): Promise<number> {
  let total = 0;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const full = join(dirPath, entry.name);
        if (entry.isDirectory()) {
          total += await sumDirBytes(full);
        } else {
          try {
            const stat = await fs.lstat(full);
            total += stat.size;
          } catch {
            // skip
          }
        }
      })
    );
  } catch {
    // dir doesn't exist
  }
  return total;
}

export async function getDiskUsageBytes(namespaceId: string, orgId: string): Promise<number> {
  const cached = diskQuotaCache.get(namespaceId);
  if (cached && Date.now() - cached.checkedAt < DISK_CACHE_TTL_MS) {
    return cached.bytes;
  }

  const bytes = await sumDirBytes(getEmailBase(namespaceId, orgId));
  diskQuotaCache.set(namespaceId, { bytes, checkedAt: Date.now() });
  return bytes;
}

export async function checkDiskQuota(
  namespaceId: string,
  orgId: string
): Promise<{ ok: boolean; usedBytes: number; quotaBytes: number }> {
  const quotaBytes = DEFAULT_DISK_QUOTA_MB * 1024 * 1024;
  const usedBytes = await getDiskUsageBytes(namespaceId, orgId);
  return { ok: usedBytes < quotaBytes, usedBytes, quotaBytes };
}

interface SendCountFile {
  count: number;
  date: string; // YYYY-MM-DD UTC
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

async function readSendCountFile(namespaceId: string, orgId: string): Promise<SendCountFile> {
  const path = join(getConfigDir(namespaceId, orgId), "send-count.json");
  try {
    const data = await fs.readFile(path, "utf-8");
    return JSON.parse(data) as SendCountFile;
  } catch {
    return { count: 0, date: todayUTC() };
  }
}

async function writeSendCountFile(
  namespaceId: string,
  orgId: string,
  file: SendCountFile
): Promise<void> {
  await fs.mkdir(getConfigDir(namespaceId, orgId), { recursive: true });
  const path = join(getConfigDir(namespaceId, orgId), "send-count.json");
  await fs.writeFile(path, JSON.stringify(file, null, 2));
}

export async function getSendCount(namespaceId: string, orgId: string): Promise<number> {
  const file = await readSendCountFile(namespaceId, orgId);
  if (file.date !== todayUTC()) {
    // reset window
    const reset: SendCountFile = { count: 0, date: todayUTC() };
    await writeSendCountFile(namespaceId, orgId, reset);
    return 0;
  }
  return file.count;
}

export async function incrementSendCount(namespaceId: string, orgId: string): Promise<number> {
  const file = await readSendCountFile(namespaceId, orgId);
  const today = todayUTC();
  const newCount = file.date === today ? file.count + 1 : 1;
  await writeSendCountFile(namespaceId, orgId, { count: newCount, date: today });
  return newCount;
}

// expose quota constant for callers
export const SEND_QUOTA_PER_DAY = DEFAULT_SEND_QUOTA_PER_DAY;

// ---------------------------------------------------------------------------
// filename sanitization (H2)
// ---------------------------------------------------------------------------

export function sanitizeFilename(originalName: string, internalId: string): string {
  const lastDot = originalName.lastIndexOf(".");
  const hasExt = lastDot > 0 && lastDot < originalName.length - 1;

  const rawBase = hasExt ? originalName.slice(0, lastDot) : originalName;
  const rawExt = hasExt ? originalName.slice(lastDot + 1) : "";

  // strip non-safe chars
  let base = rawBase.replace(/[^a-zA-Z0-9._-]/g, "");
  const ext = rawExt.replace(/[^a-zA-Z0-9._-]/g, "");

  // no leading dot on base
  base = base.replace(/^\.+/, "") || "file";

  // truncate base to 180 chars
  base = base.slice(0, 180);

  const suffix = internalId.slice(0, 8);

  if (ext) {
    return `${base}-${suffix}.${ext}`;
  }
  return `${base}-${suffix}`;
}

// ---------------------------------------------------------------------------
// HMAC-derived secret (C2)
// ---------------------------------------------------------------------------

export function deriveInboundSecret(namespaceId: string, version: number): string {
  const BETTER_AUTH_SECRET = resolveAppSecret("email-storage");
  return createHmac("sha256", BETTER_AUTH_SECRET)
    .update(`email-inbound:v${version}:${namespaceId}`)
    .digest("hex");
}

// ---------------------------------------------------------------------------
// inbox folder validation (H5)
// ---------------------------------------------------------------------------

export function validateInboxFolder(folder: string): boolean {
  return INBOX_FOLDER_REGEX.test(folder);
}
