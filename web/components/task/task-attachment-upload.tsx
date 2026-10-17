"use client";

/**
 * TaskAttachmentUpload (FEAT-001/TASK-006).
 *
 * Paste zone + file picker feeding the SAME endpoint via uploadTaskAttachment.
 * Testids (kebab, per TASK-007 runbook):
 *   attachment-paste-zone / attachment-picker-button / task-attachment-input
 * Rejections render as STATUS_PILL error chips from the envelope message --
 * no silent drops. Exports: Controls (picker+paste+chips), PasteZone,
 * DeleteButton.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CloseCircleFilled, Upload } from "@aliimam/icons";
import { STATUS_PILL } from "@/lib/ui/status-colors";
import {
  TASK_ATTACHMENT_CLIENT_MIME_TYPES,
  uploadTaskAttachment,
} from "@/lib/tasks/task-attachment-upload";

function imageFileFromClipboard(items: DataTransferItemList | null): File | null {
  if (!items) return null;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

interface ControlsProps {
  taskId: string;
  onUploaded: (filename: string) => void;
  disabled?: boolean;
}

/** Picker + paste + per-upload error chips. Upload target must already exist. */
export function TaskAttachmentControls({ taskId, onUploaded, disabled }: ControlsProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ key: number; message: string }[]>([]);

  const upload = useCallback(
    async (file: File) => {
      if (!taskId || disabled) {
        setErrors((prev) => [
          ...prev,
          { key: Date.now(), message: "save the task first, then attach images" },
        ]);
        return;
      }
      const name = file.name || "pasted image";
      setPending(name);
      try {
        await uploadTaskAttachment(taskId, file);
        setErrors([]);
        onUploaded(name);
      } catch (err) {
        setErrors((prev) => [
          ...prev,
          { key: Date.now(), message: err instanceof Error ? err.message : "upload failed" },
        ]);
      } finally {
        setPending(null);
      }
    },
    [taskId, disabled, onUploaded],
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      const file = imageFileFromClipboard(event.clipboardData?.items ?? null);
      if (file) {
        event.preventDefault();
        void upload(file);
      }
    },
    [upload],
  );

  const dismiss = (key: number) =>
    setErrors((prev) => prev.filter((e) => e.key !== key));

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <div
          data-testid="attachment-paste-zone"
          tabIndex={0}
          aria-label="Paste image to attach"
          onPaste={handlePaste}
          className="flex h-8 flex-1 items-center rounded-md border border-dashed border-border/60 px-2 text-[11px] text-foreground/35 outline-none focus-visible:border-foreground/40"
        >
          {pending ? `uploading ${pending}...` : "paste an image here (⌘V)"}
        </div>
        <button
          type="button"
          data-testid="attachment-picker-button"
          aria-label="Choose image to attach"
          disabled={disabled}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-muted px-2.5 text-[11px] font-medium text-foreground/65 transition-colors hover:bg-accent hover:text-foreground/80 disabled:opacity-50"
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="h-3 w-3" />
          Choose
        </button>
        <input
          ref={inputRef}
          data-testid="task-attachment-input"
          type="file"
          accept={TASK_ATTACHMENT_CLIENT_MIME_TYPES.join(",")}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = "";
          }}
        />
      </div>
      {errors.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1" data-testid="attachment-error-chips">
          {errors.map((e) => (
            <span
              key={e.key}
              className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] ${STATUS_PILL.error}`}
            >
              {e.message}
              <button
                type="button"
                aria-label="Dismiss attachment error"
                onClick={() => dismiss(e.key)}
                className="text-current opacity-60 hover:opacity-100"
              >
                <CloseCircleFilled className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Drop-in wrapper with the shared upload callback shape. */
export function TaskAttachmentUploadControls(props: Omit<ControlsProps, "onUploaded"> & {
  onUploaded: () => void;
}) {
  return <TaskAttachmentControls {...props} onUploaded={() => props.onUploaded()} />;
}

/** Thin namespace so detail-view code reads taskAttachmentUpload.Controls. */
export const TaskAttachmentUpload = {
  Controls: TaskAttachmentControls,
  DeleteButton: TaskAttachmentDeleteButton,
};

interface DeleteProps {
  taskId: string;
  attachmentId: string;
  onDeleted: () => void;
}

export function TaskAttachmentDeleteButton({ taskId, attachmentId, onDeleted }: DeleteProps) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const remove = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(
        `/api/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(attachmentId)}`,
        { method: "DELETE", credentials: "same-origin" },
      );
      if (res.ok) {
        onDeleted();
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [taskId, attachmentId, onDeleted]);

  return (
    <button
      type="button"
      aria-label="Delete attachment"
      data-testid="attachment-delete-button"
      disabled={busy}
      onClick={() => void remove()}
      className={`flex w-full items-center justify-center gap-1 border-t border-border/40 py-1 text-[10px] transition-colors ${
        failed ? STATUS_PILL.error : "text-foreground/40 hover:text-destructive"
      } disabled:opacity-50`}
    >
      <CloseCircleFilled className="h-2.5 w-2.5" />
      {busy ? "deleting..." : failed ? "delete failed" : "Delete"}
    </button>
  );
}

/** Fullscreen overlay for viewing one attached image. */
export function TaskAttachmentLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const closeOnEsc = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    window.addEventListener("keydown", closeOnEsc);
    return () => window.removeEventListener("keydown", closeOnEsc);
  }, [closeOnEsc]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-8"
      onClick={onClose}
    >
      <img src={src} alt={alt} className="max-h-full max-w-full object-contain" />
      <button
        type="button"
        aria-label="Close image preview"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-md bg-muted p-2 text-foreground/60 hover:text-foreground"
      >
        <CloseCircleFilled className="h-4 w-4" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// create-dialog staging (FEAT-001/TASK-006)
//
// In the create flow the task does not exist yet, so uploads cannot happen
// until AFTER POST /api/tasks/create resolves. The stager holds picked or
// pasted files in memory; the dialog uploads them once it has the new task
// id. Rejected picks surface immediately as error chips -- no silent drops.
// ---------------------------------------------------------------------------

export function TaskAttachmentStager({
  staged,
  onStaged,
  onRemove,
}: {
  staged: File[];
  onStaged: (files: File[]) => void;
  onRemove: (index: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const stageFiles = useCallback(
    (files: FileList | null) => {
      if (!files?.length) return;
      const accepted: File[] = [];
      for (const file of Array.from(files)) {
        if (!TASK_ATTACHMENT_CLIENT_MIME_TYPES.includes(file.type)) {
          setError(`"${file.name || "pasted image"}": unsupported image type`);
          continue;
        }
        accepted.push(file);
      }
      if (accepted.length > 0) {
        setError(null);
        onStaged([...staged, ...accepted]);
      }
    },
    [staged, onStaged],
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      const file = imageFileFromClipboard(event.clipboardData?.items ?? null);
      if (file) {
        event.preventDefault();
        const transfer = new DataTransfer();
        transfer.items.add(file);
        stageFiles(transfer.files);
      }
    },
    [stageFiles],
  );

  return (
    <div className="mt-1">
      <div className="flex items-center gap-2">
        <div
          data-testid="attachment-paste-zone"
          tabIndex={0}
          aria-label="Paste image to attach after the task is created"
          onPaste={handlePaste}
          className="flex h-8 flex-1 items-center rounded-md border border-dashed border-border/60 px-2 text-[11px] text-foreground/35 outline-none focus-visible:border-foreground/40"
        >
          {staged.length > 0
            ? `${staged.length} image${staged.length === 1 ? "" : "s"} will upload after create`
            : "paste an image here (⌘V)"}
        </div>
        <button
          type="button"
          data-testid="attachment-picker-button"
          aria-label="Choose image to attach"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-muted px-2.5 text-[11px] font-medium text-foreground/65 transition-colors hover:bg-accent hover:text-foreground/80"
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="h-3 w-3" />
          Choose
        </button>
        <input
          ref={inputRef}
          data-testid="task-attachment-input"
          type="file"
          accept={TASK_ATTACHMENT_CLIENT_MIME_TYPES.join(",")}
          multiple
          className="hidden"
          onChange={(event) => {
            stageFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {error && (
        <div className="mt-1.5" data-testid="attachment-error-chips">
          <span className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] ${STATUS_PILL.error}`}>
            {error}
            <button
              type="button"
              aria-label="Dismiss attachment error"
              onClick={() => setError(null)}
              className="text-current opacity-60 hover:opacity-100"
            >
              <CloseCircleFilled className="h-2.5 w-2.5" />
            </button>
          </span>
        </div>
      )}

      {staged.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {staged.map((file, index) => (
            <span
              key={`${file.name}-${index}`}
              className={`inline-flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-foreground/55`}
            >
              <span className="max-w-36 truncate">{file.name || "pasted image"}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name || "pasted image"}`}
                onClick={() => onRemove(index)}
                className="text-current opacity-50 hover:opacity-100"
              >
                <CloseCircleFilled className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Upload staged files to a freshly created task. Used by the create dialog
 * AFTER the task exists -- never before. Returns per-file failures so the
 * caller can render them; successes are silent.
 */
export async function uploadStagedAttachments(
  taskId: string,
  files: File[],
): Promise<{ failed: { name: string; message: string }[] }> {
  const failed: { name: string; message: string }[] = [];
  for (const file of files) {
    try {
      await uploadTaskAttachment(taskId, file);
    } catch (err) {
      failed.push({
        name: file.name || "pasted image",
        message: err instanceof Error ? err.message : "upload failed",
      });
    }
  }
  return { failed };
}
