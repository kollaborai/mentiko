/**
 * Task attachment contract (FEAT-001/TASK-004).
 *
 * The typed image/attachment data contract for task intake: the row shape,
 * the storage layout, and the pure helpers other modules must reuse instead
 * of re-deriving paths or filenames.
 *
 * Binding rules from the accepted contract review:
 *   - stored filenames and checksums are computed SERVER-SIDE ONLY. Client
 *     input never reaches the stored name or the hash. The stored filename is
 *     always the server-generated attachment id plus a validated extension.
 *   - blob paths must come from attachmentBlobPath() -- lifecycle cleanup
 *     (TASK-005) reuses this helper and never re-derives the layout.
 */

export const TASK_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Image MIME allowlist for task intake. Upload validation additionally
 * sniffs magic bytes (task-attachment-validation.ts) so a spoofed
 * Content-Type cannot pass with non-image content.
 */
export const TASK_ATTACHMENT_ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

export type TaskAttachmentMimeType = (typeof TASK_ATTACHMENT_ALLOWED_MIME_TYPES)[number];

export type TaskAttachmentStatus = "stored" | "deleted";

/**
 * Persisted attachment row (task_attachments table) plus its blob placement.
 * `storedFilename` is always `${id}${ext}` where ext is validated server-side;
 * `originalFilename` is the only client-influenced field and is never used
 * for filesystem placement.
 */
export interface TaskAttachment {
  id: string;
  taskId: string;
  orgId: string;
  originalFilename: string;
  storedFilename: string;
  contentType: TaskAttachmentMimeType | string;
  size: number;
  /** lowercase hex sha256 of the blob bytes, computed server-side */
  checksum: string;
  status: TaskAttachmentStatus;
  createdAt: string;
  createdBy: string;
}

/**
 * Pure, canonical blob path for a task attachment. Single source of truth for
 * the storage layout:
 *   {namespaceRoot}/data/task-attachments/{orgId}/{taskId}/{attachmentId}{ext}
 *
 * namespaceRoot resolution (namespaceId -> filesystem root) is the caller's
 * job, mirroring how task-store resolves {globalRoot}/namespaces/{nsId}/data.
 */
export function attachmentBlobPath(
  namespaceRoot: string,
  orgId: string,
  taskId: string,
  attachmentId: string,
  ext: string,
): string {
  return joinPath(
    namespaceRoot,
    "data",
    "task-attachments",
    orgId,
    taskId,
    `${attachmentId}${ext}`,
  );
}

/** Directory that contains every blob for one task (cleanup anchor for TASK-005). */
export function attachmentTaskBlobDir(
  namespaceRoot: string,
  orgId: string,
  taskId: string,
): string {
  return joinPath(namespaceRoot, "data", "task-attachments", orgId, taskId);
}

/**
 * Pure path join without importing node:path so this module stays importable
 * from browser-safe contexts that only need the types.
 */
function joinPath(...segments: string[]): string {
  return segments
    .filter((segment) => segment.length > 0)
    .join("/")
    .replace(/\/{2,}/g, "/");
}

/**
 * Canonical stored filename: the server-generated attachment id plus a
 * validated extension. Pure and synchronous so both the store and tests
 * derive identical names.
 */
export function taskAttachmentStoredFilename(attachmentId: string, ext: string): string {
  const normalizedExt = ext.startsWith(".") ? ext.toLowerCase() : ext ? `.${ext.toLowerCase()}` : "";
  return `${attachmentId}${normalizedExt}`;
}

/** server-side id generator: opaque, time-ordered, no client influence. */
export function newTaskAttachmentId(): string {
  const random = cryptoRandomHex(12);
  return `att_${Date.now().toString(36)}_${random}`;
}

function cryptoRandomHex(bytes: number): string {
  const array = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}
