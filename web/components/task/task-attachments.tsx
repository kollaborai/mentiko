"use client";

/**
 * TaskAttachments (FEAT-001/TASK-006).
 *
 * Detail-view rendering for task image attachments: original filename,
 * human-readable size, created timestamp, and the image itself via the
 * bytes route. Quiet zero-state when a task has none. Upload errors surface
 * as STATUS_PILL chips -- never a silent drop. The <img> URLs point at
 * GET /api/tasks/{id}/attachments/{attachmentId} (same-origin only).
 */

import { useCallback, useEffect, useState } from "react";
import { PaperclipFilled } from "@aliimam/icons";
import type { TaskAttachment } from "@/lib/tasks/task-attachment-types";
import { STATUS_PILL } from "@/lib/ui/status-colors";
import { taskAttachmentErrorChip } from "@/lib/tasks/task-attachment-upload";
import { TaskAttachmentUpload } from "./task-attachment-upload";

/** Bytes -> compact human string ("2.4 MB"). */
export function humanAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} ${units[unit]}` : `${value.toFixed(1)} ${units[unit]}`;
}

interface TaskAttachmentsProps {
  taskId: string;
  /** when set, show the upload controls (edit surface reuse) */
  editable?: boolean;
  /** bumped by parents after an upload to refetch the list */
  refreshKey?: number;
  onChanged?: () => void;
}

export function TaskAttachments({
  taskId,
  editable = false,
  refreshKey = 0,
  onChanged,
}: TaskAttachmentsProps) {
  const [attachments, setAttachments] = useState<TaskAttachment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/attachments`, {
        credentials: "same-origin",
      });
      const body = (await res.json()) as
        | { success: true; data: { attachments: TaskAttachment[] } }
        | { success: false; error: { message: string } };
      if (!body.success) {
        setLoadError(body.error.message);
        return;
      }
      setAttachments(body.data.attachments);
      setLoadError(null);
    } catch {
      setLoadError("failed to load attachments");
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const handleUploaded = useCallback(() => {
    void load();
    onChanged?.();
  }, [load, onChanged]);

  const handleDeleted = useCallback(() => {
    void load();
    onChanged?.();
  }, [load, onChanged]);

  return (
    <div className="px-4 py-3" data-testid="task-attachments">
      <span className="flex items-center gap-1.5 text-xs text-foreground/40 font-medium">
        <PaperclipFilled className="h-3 w-3" />
        Attachments
      </span>

      <div className="mt-2">
        {loadError && (
          <span
            className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] ${STATUS_PILL.error}`}
            data-testid="attachments-load-error"
          >
            {loadError}
          </span>
        )}

        {!loadError && attachments === null && (
          <span className="text-[11px] text-foreground/30">loading...</span>
        )}

        {!loadError && attachments?.length === 0 && (
          <span className="text-[11px] text-foreground/30" data-testid="attachments-empty">
            no attachments
          </span>
        )}

        <div className="flex flex-wrap gap-2">
          {attachments?.map((a) => (
            <figure
              key={a.id}
              className="w-44 overflow-hidden rounded-md bg-muted/25 ring-1 ring-border/50"
              data-testid="task-attachment-card"
            >
              {/* safe: server validates every blob against a four-type image
                  allowlist plus magic bytes before it can ever be served */}
              <img
                src={`/api/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(a.id)}`}
                alt={a.originalFilename}
                className="h-28 w-full bg-background/60 object-contain"
                loading="lazy"
              />
              <figcaption className="min-w-0 px-2 py-1.5">
                <p
                  className="truncate text-[11px] font-medium text-foreground/70"
                  title={a.originalFilename}
                >
                  {a.originalFilename}
                </p>
                <p className="text-[10px] text-foreground/40">
                  {humanAttachmentSize(a.size)} ·{" "}
                  <time dateTime={a.createdAt}>
                    {new Date(a.createdAt).toLocaleString()}
                  </time>
                </p>
              </figcaption>
              {editable && (
                <TaskAttachmentUpload.DeleteButton
                  taskId={taskId}
                  attachmentId={a.id}
                  onDeleted={handleDeleted}
                />
              )}
            </figure>
          ))}
        </div>

        {editable && (
          <TaskAttachmentUpload.Controls
            taskId={taskId}
            onUploaded={handleUploaded}
          />
        )}
      </div>
    </div>
  );
}

export { taskAttachmentErrorChip };
