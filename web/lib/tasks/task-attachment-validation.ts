/**
 * Task attachment validation (FEAT-001/TASK-004).
 *
 * Server-side gate for the one proven upload path. Rules:
 *   - size must be 1..TASK_ATTACHMENT_MAX_BYTES
 *   - content type must be on the image allowlist
 *   - magic bytes must agree with the declared type (anti content-type spoof)
 *   - the original filename is sanitized for storage/display only; it never
 *     becomes the stored filename (that is `${attachmentId}${ext}`, see
 *     task-attachment-types.ts)
 */

import {
  TASK_ATTACHMENT_ALLOWED_MIME_TYPES,
  TASK_ATTACHMENT_MAX_BYTES,
} from "./task-attachment-types";

export interface TaskAttachmentValidationResult {
  valid: boolean;
  /** one of: empty_file, file_too_large, missing_file, invalid_mime_type, mime_mismatch, invalid_filename */
  reason?: string;
  detail?: string;
}

export interface TaskAttachmentFileCheckInput {
  size: number;
  contentType: string;
  /** first bytes of the payload, enough for magic-byte sniffing */
  head: Uint8Array | Buffer;
}

interface MagicSignature {
  mime: string;
  ext: string;
  /** byte offsets must start at 0 unless a matcher function is provided */
  bytes: number[];
  offset?: number;
  matcher?: (head: Uint8Array | Buffer) => boolean;
}

const MAGIC_SIGNATURES: MagicSignature[] = [
  { mime: "image/png", ext: ".png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/jpeg", ext: ".jpg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/gif", ext: ".gif", bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }, // GIF87a
  {
    mime: "image/gif",
    ext: ".gif",
    bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  }, // GIF89a
  {
    mime: "image/webp",
    ext: ".webp",
    bytes: [],
    matcher: (head) =>
      head.length >= 12 &&
      head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && // RIFF
      head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50, // WEBP
  },
];

/** Map an allowlisted MIME type to its canonical file extension. */
export function taskAttachmentExtForMime(contentType: string): string {
  switch (contentType) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    default:
      return "";
  }
}

/**
 * Validate one upload candidate. Pure (no fs, no crypto) so tests and the
 * route share the exact same gate.
 */
export function validateTaskAttachmentFile(
  input: TaskAttachmentFileCheckInput,
): TaskAttachmentValidationResult {
  if (!Number.isFinite(input.size) || input.size === 0) {
    return { valid: false, reason: "empty_file", detail: "attachment is empty" };
  }
  if (input.size > TASK_ATTACHMENT_MAX_BYTES) {
    return {
      valid: false,
      reason: "file_too_large",
      detail: `attachment exceeds ${TASK_ATTACHMENT_MAX_BYTES} byte limit`,
    };
  }
  if (!(TASK_ATTACHMENT_ALLOWED_MIME_TYPES as readonly string[]).includes(input.contentType)) {
    return {
      valid: false,
      reason: "invalid_mime_type",
      detail: `unsupported content type: ${input.contentType}`,
    };
  }
  const sniffed = sniffImageMime(input.head);
  if (!sniffed) {
    return {
      valid: false,
      reason: "mime_mismatch",
      detail: "file content does not match any supported image format",
    };
  }
  if (sniffed !== input.contentType) {
    return {
      valid: false,
      reason: "mime_mismatch",
      detail: `declared ${input.contentType} but content sniffs as ${sniffed}`,
    };
  }
  return { valid: true };
}

/**
 * Returns the sniffed image MIME type, or null when no signature matches.
 * Uses only the first bytes, so callers may pass a small head buffer.
 */
export function sniffImageMime(head: Uint8Array | Buffer): string | null {
  for (const sig of MAGIC_SIGNATURES) {
    if (sig.matcher) {
      if (sig.matcher(head)) return sig.mime;
      continue;
    }
    const start = sig.offset ?? 0;
    if (head.length < start + sig.bytes.length) continue;
    let matched = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      if (head[start + i] !== sig.bytes[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return sig.mime;
  }
  return null;
}

/**
 * Sanitize the client-supplied original filename for storage/display:
 * strips path components, control characters, and unsafe trailing dots.
 * The result is NEVER used as the stored filename on disk.
 */
export function sanitizeTaskAttachmentFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return "unnamed";
  return cleaned.slice(0, 255);
}
