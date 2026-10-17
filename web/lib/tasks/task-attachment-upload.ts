/**
 * Attachment upload client helper (FEAT-001/TASK-006).
 *
 * One function for both intake surfaces (paste + picker): multipart POST to
 * /api/tasks/{id}/attachments, field name exactly "file", browser-set
 * boundary, same-origin credentials. Rejections never throw silently -- the
 * envelope .error.message is returned so the UI can render it.
 */

import type { TaskAttachment } from "./task-attachment-types";

export type TaskAttachmentErrorCode =
  | "file_too_large"
  | "empty_file"
  | "invalid_mime_type"
  | "mime_mismatch"
  | "invalid_filename"
  | "missing_file"
  | "invalid_content_type"
  | "network_error"
  | "unknown";

/** Map an upload failure to a short, user-facing chip label. */
export function taskAttachmentErrorChip(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("file_too_large") || m.includes("too large")) return "too large (max 10MB)";
  if (m.includes("empty_file") || m.includes("empty")) return "empty file";
  if (m.includes("invalid_mime_type") || m.includes("mime type")) return "unsupported image type";
  if (m.includes("mime_mismatch") || m.includes("mismatch")) return "file content doesn't match its type";
  if (m.includes("invalid_filename")) return "invalid filename";
  return message.length > 80 ? `${message.slice(0, 77)}...` : message;
}

/**
 * Upload one image to an existing task. Resolves with the created attachment
 * or a thrown Error whose message comes from the server envelope.
 */
export async function uploadTaskAttachment(
  taskId: string,
  file: File,
): Promise<TaskAttachment> {
  if (!taskId) throw new Error("task must be created before attachments can be uploaded");

  const form = new FormData();
  // field name "file" is the server contract -- do not change
  form.append("file", file, file.name);

  let res: Response;
  try {
    res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/attachments`, {
      method: "POST",
      body: form,
      credentials: "same-origin",
    });
  } catch {
    throw new Error("network_error: attachment upload failed");
  }

  const body = (await res.json().catch(() => null)) as
    | { success: true; data: { attachment: TaskAttachment } }
    | { success: false; error: { message: string; details?: { reason?: string } } }
    | null;

  if (!body) throw new Error("unknown: attachment upload failed");
  if (!body.success) {
    const reason = body.error.details?.reason;
    throw new Error(reason ? `${reason}: ${body.error.message}` : body.error.message);
  }
  return body.data.attachment;
}

/** The image MIME types the server accepts -- mirrored for client-side UX. */
export const TASK_ATTACHMENT_CLIENT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];
