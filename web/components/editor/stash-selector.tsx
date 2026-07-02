"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  BoxFilled,
  TrashFilled,
  AddFilled,
  Refresh2Filled,
  ArrowRightFilled,
  CloseCircleFilled,
  Warning2Filled,
  TickCircleFilled,
} from "@aliimam/icons";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { showToast } from "@/components/app-shell/notifications-panel";
import type {
  GitStash,
  GitStashListResult,
  GitStashCreateResult,
  GitStashApplyResult,
  GitStashDropResult,
} from "@/app/api/git/route";

// ── types ──────────────────────────────────────────────────────────────────

interface StashSelectorProps {
  workspacePath: string;
  onStashApplied?: (stashId: string) => void;
}

// ── styles ─────────────────────────────────────────────────────────────────

const stashRowVariants = cva(
  "group flex items-center gap-3 px-3 py-1.5 hover:bg-foreground/5 dark:hover:bg-white/5 transition-colors cursor-default border-b border-foreground/5 dark:border-white/5 last:border-0",
  {
    variants: {
      loading: {
        true: "opacity-60 pointer-events-none",
        false: "",
      },
    },
  }
);

const conflictBadgeVariants = cva(
  "inline-flex items-center gap-1 px-2 py-1 rounded-sm text-[10px] font-medium",
  {
    variants: {
      severity: {
        none: "bg-emerald-400/15 text-emerald-400",
        conflict: "bg-red-500/15 text-red-400",
      },
    },
    defaultVariants: {
      severity: "none",
    },
  }
);

// ── focus trap hook ────────────────────────────────────────────────────────

function useFocusTrap(
  containerRef: React.RefObject<HTMLDivElement | null>,
  active: boolean,
  onEscape?: () => void
) {
  useEffect(() => {
    if (!active || !containerRef.current) return;

    const container = containerRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus the first focusable element
    const focusableSelectors =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const firstFocusable = container.querySelector<HTMLElement>(focusableSelectors);
    firstFocusable?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onEscape?.();
        return;
      }
      if (e.key !== "Tab") return;

      const focusables = Array.from(
        container.querySelectorAll<HTMLElement>(focusableSelectors)
      ).filter((el) => !el.hasAttribute("disabled"));

      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [active, containerRef, onEscape]);
}

// ── stash row ──────────────────────────────────────────────────────────────

function StashRow({
  stash,
  loading,
  onApply,
  onDrop,
}: {
  stash: GitStash;
  loading?: boolean;
  onApply: (stashId: string) => void;
  onDrop: (stashId: string) => void;
}) {
  const stashLabel = stash.message || `stash@{${stash.id}}`;

  return (
    <div
      role="listitem"
      className={stashRowVariants({ loading })}
    >
      {/* Stash ID */}
      <span className="w-20 shrink-0 text-[9px] font-mono text-foreground/40 dark:text-white/40" aria-hidden="true">
        {`stash@{${stash.id}}`}
      </span>

      {/* Branch */}
      <span className="w-24 shrink-0 text-[10px] text-cyan-400/60 truncate" title={stash.branch}>
        {stash.branch}
      </span>

      {/* Message */}
      <span className="flex-1 text-[10px] text-foreground/70 dark:text-white/70 truncate" title={stash.message}>
        {stash.message}
      </span>

      {/* Date */}
      <span className="w-20 shrink-0 text-[10px] text-foreground/25 dark:text-white/25 text-right">
        {stash.date}
      </span>

      {/* Actions — always in DOM; visible on hover or focus-within for keyboard users */}
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
        <button
          onClick={() => onApply(stash.id)}
          aria-label={`Apply ${stashLabel}`}
          className="flex items-center justify-center w-5 h-5 rounded text-foreground/25 dark:text-white/25 hover:text-emerald-400/80 hover:bg-foreground/5 dark:hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground/50 dark:focus-visible:outline-white/50 transition-colors"
        >
          <ArrowRightFilled className="h-3 w-3" />
        </button>
        <button
          onClick={() => onDrop(stash.id)}
          aria-label={`Delete ${stashLabel}`}
          className="flex items-center justify-center w-5 h-5 rounded text-foreground/25 dark:text-white/25 hover:text-red-400/80 hover:bg-foreground/5 dark:hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground/50 dark:focus-visible:outline-white/50 transition-colors"
        >
          <TrashFilled className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ── create stash dialog ────────────────────────────────────────────────────

interface CreateStashDialogProps {
  open: boolean;
  loading: boolean;
  error?: string | null;
  onSubmit: (message: string) => void;
  onOpenChange: (open: boolean) => void;
}

function CreateStashDialog({
  open,
  loading,
  error,
  onSubmit,
  onOpenChange,
}: CreateStashDialogProps) {
  const [message, setMessage] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const maxChars = 200;
  const isValid = message.length <= maxChars;
  const charCountId = "create-stash-char-count";
  const errorId = "create-stash-error";
  const titleId = "create-stash-dialog-title";
  const textareaId = "create-stash-message";

  useFocusTrap(containerRef, open, () => onOpenChange(false));

  const handleSubmit = () => {
    if (!isValid) return;
    onSubmit(message.trim());
    setMessage("");
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80">
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-card border border-foreground/10 dark:border-white/10 rounded-md w-96 max-w-full mx-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-foreground/5 dark:border-white/5">
          <h2 id={titleId} className="text-[12px] font-medium text-foreground/90 dark:text-white/90">Create Stash</h2>
          <button
            onClick={() => onOpenChange(false)}
            aria-label="Close create stash dialog"
            className="p-1 text-foreground/40 dark:text-white/40 hover:text-foreground/70 dark:hover:text-white/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground/50 dark:focus-visible:outline-white/50 transition-colors"
          >
            <CloseCircleFilled className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          <div>
            <label
              htmlFor={textareaId}
              className="text-[10px] font-medium text-foreground/60 dark:text-white/60 uppercase"
            >
              Message (optional)
            </label>
            <textarea
              id={textareaId}
              value={message}
              onChange={(e) => setMessage(e.currentTarget.value)}
              placeholder="e.g., Fix login bug"
              disabled={loading}
              aria-describedby={`${charCountId}${error ? ` ${errorId}` : ""}${!isValid ? ` ${charCountId}` : ""}`}
              aria-invalid={!isValid}
              className={cn(
                "w-full mt-2 px-3 py-2 bg-foreground/5 dark:bg-white/5 border border-foreground/10 dark:border-white/10 rounded text-[11px] text-foreground dark:text-white placeholder-foreground/30 dark:placeholder-white/30",
                "focus:outline-none focus:border-foreground/30 dark:focus:border-white/30 focus:ring-1 focus:ring-foreground/20 dark:focus:ring-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground/40 dark:focus-visible:outline-white/40 transition-colors resize-none",
                loading && "opacity-50"
              )}
              rows={3}
            />
            <div className="flex items-center justify-between mt-1" aria-live="polite">
              <span id={charCountId} className="text-[9px] text-foreground/40 dark:text-white/40">
                {message.length} / {maxChars}
              </span>
              {!isValid && (
                <span className="text-[9px] text-red-400" role="alert">
                  Max {maxChars} characters
                </span>
              )}
            </div>
          </div>

          {error && (
            <div
              id={errorId}
              role="alert"
              className="px-3 py-2 bg-red-500/15 border border-red-400/30 rounded text-[10px] text-red-400"
            >
              {error}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-foreground/5 dark:border-white/5">
          <button
            onClick={() => {
              onOpenChange(false);
              setMessage("");
            }}
            disabled={loading}
            className={cn(
              "px-3 py-1.5 text-[10px] font-medium rounded transition-colors",
              "text-foreground/60 dark:text-white/60 hover:text-foreground/90 dark:hover:text-white/90 hover:bg-foreground/5 dark:hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground/50 dark:focus-visible:outline-white/50",
              loading && "opacity-50 cursor-not-allowed"
            )}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !isValid}
            aria-disabled={loading || !isValid}
            className={cn(
              "px-3 py-1.5 text-[10px] font-medium rounded transition-colors",
              "bg-emerald-400/20 text-emerald-400 hover:bg-emerald-400/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-400/70",
              (loading || !isValid) && "opacity-50 cursor-not-allowed"
            )}
          >
            {loading ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── apply stash confirm dialog (pre-apply confirmation) ─────────────────────

interface ApplyStashConfirmDialogProps {
  open: boolean;
  stashId: string;
  stash?: GitStash;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

function ApplyStashConfirmDialog({
  open,
  stashId,
  stash,
  onConfirm,
  onOpenChange,
}: ApplyStashConfirmDialogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const titleId = "apply-stash-confirm-title";

  useFocusTrap(containerRef, open, () => onOpenChange(false));

  if (!open) return null;

  const stashLabel = stash?.message || `stash@{${stashId}}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80">
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-card border border-foreground/10 dark:border-white/10 rounded-md w-96 max-w-full mx-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-foreground/5 dark:border-white/5">
          <h2 id={titleId} className="text-[12px] font-medium text-foreground/90 dark:text-white/90">Apply Stash</h2>
          <button
            onClick={() => onOpenChange(false)}
            aria-label="Close apply stash dialog"
            className="p-1 text-foreground/40 dark:text-white/40 hover:text-foreground/70 dark:hover:text-white/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground/50 dark:focus-visible:outline-white/50 transition-colors"
          >
            <CloseCircleFilled className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          <p className="text-[11px] text-foreground/70 dark:text-white/70">
            Apply <strong className="font-mono">{stashLabel}</strong> to the working tree?
          </p>
          <div
            role="note"
            className="flex items-start gap-2 px-3 py-2 bg-amber-500/15 border border-amber-400/30 rounded text-[10px] text-amber-400"
          >
            <Warning2Filled className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <span>Applying a stash can cause merge conflicts if the working tree has diverged.</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-foreground/5 dark:border-white/5">
          <button
            onClick={() => onOpenChange(false)}
            className={cn(
              "px-3 py-1.5 text-[10px] font-medium rounded transition-colors",
              "text-foreground/60 dark:text-white/60 hover:text-foreground/90 dark:hover:text-white/90 hover:bg-foreground/5 dark:hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground/50 dark:focus-visible:outline-white/50"
            )}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className={cn(
              "px-3 py-1.5 text-[10px] font-medium rounded transition-colors",
              "bg-emerald-400/20 text-emerald-400 hover:bg-emerald-400/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-400/70"
            )}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

// ── apply stash dialog (conflict view) ──────────────────────────────────────

interface ApplyStashDialogProps {
  open: boolean;
  stashId: string;
  stash?: GitStash;
  loading: boolean;
  conflicts?: string[] | null;
  conflictCount: number;
  error?: string | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

function ApplyStashDialog({
  open,
  stashId,
  stash,
  loading,
  conflicts,
  conflictCount,
  error,
  onConfirm,
  onOpenChange,
}: ApplyStashDialogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const titleId = "apply-stash-dialog-title";

  useFocusTrap(containerRef, open, () => onOpenChange(false));

  if (!open) return null;

  const hasConflicts = conflicts && conflicts.length > 0;
  const stashLabel = stash?.message || `stash@{${stashId}}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80">
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={loading}
        className="bg-card border border-foreground/10 dark:border-white/10 rounded-md w-96 max-w-full mx-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-foreground/5 dark:border-white/5">
          <h2 id={titleId} className="text-[12px] font-medium text-foreground/90 dark:text-white/90">
            {hasConflicts ? "Apply Stash: Conflicts Detected" : "Apply Stash"}
          </h2>
          <button
            onClick={() => onOpenChange(false)}
            aria-label="Close apply stash dialog"
            className="p-1 text-foreground/40 dark:text-white/40 hover:text-foreground/70 dark:hover:text-white/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground/50 dark:focus-visible:outline-white/50 transition-colors"
          >
            <CloseCircleFilled className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 max-h-96 overflow-y-auto">
          {loading && (
            <div role="status" aria-label={`Applying ${stashLabel}`} className="flex justify-center py-4">
              <WaveSpinner size="sm" />
            </div>
          )}

          {!loading && hasConflicts ? (
            <>
              <div>
                <div
                  role="alert"
                  className={conflictBadgeVariants({ severity: "conflict" })}
                >
                  <Warning2Filled className="h-3 w-3" aria-hidden="true" />
                  {" "}{conflictCount} {conflictCount === 1 ? "file has" : "files have"} merge conflicts
                </div>
              </div>

              <div>
                <p className="text-[10px] font-medium text-foreground/60 dark:text-white/60 uppercase mb-2" id="conflicted-files-label">
                  Conflicted Files
                </p>
                <ul
                  role="list"
                  aria-labelledby="conflicted-files-label"
                  className="space-y-1"
                >
                  {conflicts?.map((file) => (
                    <li
                      key={file}
                      className="flex items-center gap-2 px-3 py-1.5 bg-foreground/5 dark:bg-white/5 border border-foreground/10 dark:border-white/10 rounded text-[10px]"
                    >
                      <span className="w-3 h-3 rounded-full bg-red-400 shrink-0" aria-hidden="true" />
                      <span className="flex-1 font-mono text-foreground/70 dark:text-white/70 truncate" title={file}>
                        {file}
                      </span>
                      <span className="text-red-400/70 shrink-0">Conflict</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="px-3 py-2 bg-amber-500/15 border border-amber-400/30 rounded text-[10px] text-amber-400 space-y-1">
                <p className="font-medium">Resolution Steps:</p>
                <ol className="list-decimal list-inside space-y-1 ml-1">
                  <li>Edit conflicted files and resolve</li>
                  <li>Stage resolved files</li>
                  <li>Commit to complete the merge</li>
                </ol>
              </div>
            </>
          ) : !loading && error ? (
            <div role="alert" className="px-3 py-2 bg-red-500/15 border border-red-400/30 rounded text-[10px] text-red-400">
              {error}
            </div>
          ) : !loading ? (
            <div role="status" className="flex items-center gap-2 px-3 py-2 bg-emerald-400/15 border border-emerald-400/30 rounded text-[10px] text-emerald-400">
              <TickCircleFilled className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Stash applied successfully</span>
            </div>
          ) : null}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-foreground/5 dark:border-white/5">
          <button
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className={cn(
              "px-3 py-1.5 text-[10px] font-medium rounded transition-colors",
              "text-foreground/60 dark:text-white/60 hover:text-foreground/90 dark:hover:text-white/90 hover:bg-foreground/5 dark:hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground/50 dark:focus-visible:outline-white/50",
              loading && "opacity-50 cursor-not-allowed"
            )}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── drop stash confirmation dialog ─────────────────────────────────────────

interface DropStashConfirmDialogProps {
  open: boolean;
  stashId: string;
  stash?: GitStash;
  loading: boolean;
  error?: string | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

function DropStashConfirmDialog({
  open,
  stashId,
  stash,
  loading,
  error,
  onConfirm,
  onOpenChange,
}: DropStashConfirmDialogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const titleId = "drop-stash-dialog-title";
  const errorId = "drop-stash-error";

  useFocusTrap(containerRef, open, () => onOpenChange(false));

  if (!open) return null;

  const stashLabel = stash?.message || `stash@{${stashId}}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80">
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-card border border-foreground/10 dark:border-white/10 rounded-md w-96 max-w-full mx-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-foreground/5 dark:border-white/5">
          <h2 id={titleId} className="text-[12px] font-medium text-foreground/90 dark:text-white/90">Delete Stash</h2>
          <button
            onClick={() => onOpenChange(false)}
            aria-label="Close delete stash dialog"
            className="p-1 text-foreground/40 dark:text-white/40 hover:text-foreground/70 dark:hover:text-white/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground/50 dark:focus-visible:outline-white/50 transition-colors"
          >
            <CloseCircleFilled className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          <p className="text-[11px] text-foreground/70 dark:text-white/70">
            Delete <strong>{stashLabel}</strong>? This action cannot be undone.
          </p>

          {stash && (
            <dl className="space-y-2 px-3 py-2 bg-foreground/5 dark:bg-white/5 border border-foreground/10 dark:border-white/10 rounded">
              <div className="flex items-center gap-2">
                <dt className="text-[10px] font-medium text-foreground/50 dark:text-white/50 w-16">Stash:</dt>
                <dd className="text-[10px] font-mono text-foreground/70 dark:text-white/70">{`stash@{${stash.id}}`}</dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="text-[10px] font-medium text-foreground/50 dark:text-white/50 w-16">Message:</dt>
                <dd className="text-[10px] text-foreground/70 dark:text-white/70 truncate">{stash.message}</dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="text-[10px] font-medium text-foreground/50 dark:text-white/50 w-16">Branch:</dt>
                <dd className="text-[10px] text-foreground/70 dark:text-white/70">{stash.branch}</dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="text-[10px] font-medium text-foreground/50 dark:text-white/50 w-16">Date:</dt>
                <dd className="text-[10px] text-foreground/70 dark:text-white/70">{stash.date}</dd>
              </div>
            </dl>
          )}

          {error && (
            <div
              id={errorId}
              role="alert"
              className="px-3 py-2 bg-red-500/15 border border-red-400/30 rounded text-[10px] text-red-400"
            >
              {error}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-foreground/5 dark:border-white/5">
          <button
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className={cn(
              "px-3 py-1.5 text-[10px] font-medium rounded transition-colors",
              "text-foreground/60 dark:text-white/60 hover:text-foreground/90 dark:hover:text-white/90 hover:bg-foreground/5 dark:hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground/50 dark:focus-visible:outline-white/50",
              loading && "opacity-50 cursor-not-allowed"
            )}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            aria-describedby={error ? errorId : undefined}
            className={cn(
              "px-3 py-1.5 text-[10px] font-medium rounded transition-colors",
              "bg-red-500/20 text-red-400 hover:bg-red-500/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-red-400/70",
              loading && "opacity-50 cursor-not-allowed"
            )}
          >
            {loading ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── main stash panel ───────────────────────────────────────────────────────

export function StashSelector({
  workspacePath,
  onStashApplied,
}: StashSelectorProps) {
  // ── state management ──────────────────────────────────────────────────────
  const [stashes, setStashes] = useState<GitStash[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Pre-apply confirmation: stashId pending user confirmation before applying.
  const [applyConfirmId, setApplyConfirmId] = useState<string | null>(null);
  // Apply results dialog (conflicts / success / error).
  const [showApplyDialog, setShowApplyDialog] = useState<string | null>(null);
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyConflicts, setApplyConflicts] = useState<string[] | null>(null);
  const [conflictCount, setConflictCount] = useState(0);

  const [showDropDialog, setShowDropDialog] = useState<string | null>(null);
  const [dropLoading, setDropLoading] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // True while any mutation is in flight — pauses background polling so we
  // don't clobber the list mid-operation.
  const isMutating = createLoading || applyLoading || dropLoading;

  // ── api helper ────────────────────────────────────────────────────────────
  const gitPost = useCallback(
    async (action: string, payload?: Record<string, unknown>) => {
      const res = await fetch("/api/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspacePath, action, ...payload }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(
          errorData.error?.message ?? `HTTP ${res.status}: git error`
        );
      }

      const raw = await res.json();
      if (!raw.success) {
        throw new Error(raw.error?.message ?? "git error");
      }

      return raw.data;
    },
    [workspacePath]
  );

  // ── fetch stashes ─────────────────────────────────────────────────────────
  const fetchStashes = useCallback(async () => {
    try {
      const result = (await gitPost("list_stashes")) as GitStashListResult;
      setStashes(result.stashes || []);
      setError(null);
    } catch (e) {
      setError(String(e));
      setStashes([]);
    } finally {
      setLoading(false);
    }
  }, [gitPost]);

  // ── create stash ──────────────────────────────────────────────────────────
  const handleCreateStash = useCallback(
    async (message: string) => {
      setCreateLoading(true);
      setCreateError(null);
      try {
        const result = (await gitPost("create_stash", {
          stashMessage: message,
        })) as GitStashCreateResult;

        if (!result.ok) {
          setCreateError(result.error || "Failed to create stash");
          return;
        }

        showToast({ type: "success", title: "Stash created", message: result.stashId ?? "" });
        setShowCreateDialog(false);
        await fetchStashes();
      } catch (e) {
        const errorMsg = String(e);
        setCreateError(errorMsg);
        showToast({ type: "error", title: "Failed to create stash", message: errorMsg });
      } finally {
        setCreateLoading(false);
      }
    },
    [gitPost, fetchStashes]
  );

  // ── apply stash ───────────────────────────────────────────────────────────
  // Opens a confirmation dialog first; the actual apply runs only after the
  // user confirms (see runApplyStash).
  const requestApplyStash = useCallback((stashId: string) => {
    setApplyConfirmId(stashId);
  }, []);

  const runApplyStash = useCallback(
    async (stashId: string) => {
      // Confirmation done — close confirm dialog, open results dialog.
      setApplyConfirmId(null);
      setShowApplyDialog(stashId);
      setApplyLoading(true);
      setApplyError(null);
      setApplyConflicts(null);
      setConflictCount(0);

      try {
        const result = (await gitPost("apply_stash", {
          stashId: `stash@{${stashId}}`,
        })) as GitStashApplyResult;

        if (!result.ok && result.conflicts && result.conflicts.length > 0) {
          setApplyConflicts(result.conflicts);
          setConflictCount(result.conflictCount || result.conflicts.length);
          showToast({ type: "error", title: "Merge conflicts detected", message: `${result.conflictCount} file(s) conflicted` });
        } else if (!result.ok) {
          setApplyError(result.error || "Failed to apply stash");
          showToast({ type: "error", title: "Failed to apply stash", message: result.error ?? "" });
        } else {
          showToast({ type: "success", title: "Stash applied", message: `stash@{${stashId}}` });
          onStashApplied?.(stashId);
          await fetchStashes();
          setTimeout(() => {
            setShowApplyDialog(null);
          }, 2000);
        }
      } catch (e) {
        const errorMsg = String(e);
        setApplyError(errorMsg);
        showToast({ type: "error", title: "Failed to apply stash", message: errorMsg });
      } finally {
        setApplyLoading(false);
      }
    },
    [gitPost, fetchStashes, onStashApplied]
  );

  // ── drop stash ────────────────────────────────────────────────────────────
  const handleDropStash = useCallback(
    async (stashId: string) => {
      setDropLoading(true);
      setDropError(null);

      try {
        const result = (await gitPost("drop_stash", {
          stashId: `stash@{${stashId}}`,
        })) as GitStashDropResult;

        if (!result.ok) {
          setDropError(result.error || "Failed to delete stash");
          showToast({ type: "error", title: "Failed to delete stash", message: result.error ?? "" });
          return;
        }

        showToast({ type: "success", title: "Stash deleted", message: `stash@{${stashId}}` });
        setShowDropDialog(null);
        await fetchStashes();
      } catch (e) {
        const errorMsg = String(e);
        setDropError(errorMsg);
        showToast({ type: "error", title: "Failed to delete stash", message: errorMsg });
      } finally {
        setDropLoading(false);
      }
    },
    [gitPost, fetchStashes]
  );

  // ── effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchStashes();
  }, [fetchStashes]);

  // Background polling — paused while any mutation is in flight so the list
  // isn't refreshed out from under an ongoing create/apply/drop.
  useEffect(() => {
    if (isMutating) return;

    pollRef.current = setInterval(() => {
      fetchStashes();
    }, 5000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchStashes, isMutating]);

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-card text-foreground/70 dark:text-white/70 overflow-hidden border-t border-foreground/5 dark:border-white/5">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-foreground/5 dark:border-white/5 shrink-0">
        <div className="flex items-center gap-2">
          <BoxFilled className="h-4 w-4 text-foreground/50 dark:text-white/50" aria-hidden="true" />
          <span className="text-[11px] font-medium text-foreground/70 dark:text-white/70" aria-live="polite" aria-atomic="true">
            {stashes.length} {stashes.length === 1 ? "stash" : "stashes"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => fetchStashes()}
            disabled={loading}
            aria-label="Refresh stash list"
            className="p-1 text-foreground/40 dark:text-white/40 hover:text-foreground/70 dark:hover:text-white/70 hover:bg-foreground/5 dark:hover:bg-white/5 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground/50 dark:focus-visible:outline-white/50 transition-colors disabled:opacity-50"
          >
            <Refresh2Filled className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            onClick={() => {
              setShowCreateDialog(true);
              setCreateError(null);
            }}
            disabled={loading}
            aria-label="Create new stash"
            className="p-1 text-foreground/40 dark:text-white/40 hover:text-emerald-400/80 hover:bg-foreground/5 dark:hover:bg-white/5 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-400/60 transition-colors disabled:opacity-50"
          >
            <AddFilled className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div
            role="status"
            aria-label="Loading stashes"
            className="flex items-center justify-center h-32"
          >
            <WaveSpinner size="sm" />
          </div>
        )}

        {error && !loading && (
          <div className="p-4 space-y-3">
            <div role="alert" className="px-3 py-2 bg-red-500/15 border border-red-400/30 rounded text-[10px] text-red-400">
              {error}
            </div>
            <button
              onClick={() => fetchStashes()}
              className="w-full px-3 py-1.5 text-[10px] font-medium rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-red-400/60 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && stashes.length === 0 && (
          <div
            role="status"
            className="flex items-center justify-center h-32 text-foreground/40 dark:text-white/40"
          >
            <span className="text-[11px]">No stashes yet</span>
          </div>
        )}

        {!loading && !error && stashes.length > 0 && (
          <div role="list" aria-label="Git stashes">
            {stashes.map((stash) => (
              <StashRow
                key={stash.id}
                stash={stash}
                onApply={() => requestApplyStash(stash.id)}
                onDrop={() => setShowDropDialog(stash.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Dialogs */}
      <CreateStashDialog
        open={showCreateDialog}
        loading={createLoading}
        error={createError}
        onSubmit={handleCreateStash}
        onOpenChange={setShowCreateDialog}
      />

      {applyConfirmId && (
        <ApplyStashConfirmDialog
          open={true}
          stashId={applyConfirmId}
          stash={stashes.find((s) => s.id === applyConfirmId)}
          onConfirm={() => runApplyStash(applyConfirmId)}
          onOpenChange={(open) => {
            if (!open) setApplyConfirmId(null);
          }}
        />
      )}

      {showApplyDialog && (
        <ApplyStashDialog
          open={true}
          stashId={showApplyDialog}
          stash={stashes.find((s) => s.id === showApplyDialog)}
          loading={applyLoading}
          conflicts={applyConflicts}
          conflictCount={conflictCount}
          error={applyError}
          onConfirm={() => {
            setShowApplyDialog(null);
            setApplyConflicts(null);
          }}
          onOpenChange={(open) => {
            if (!open) {
              setShowApplyDialog(null);
              setApplyConflicts(null);
              setApplyError(null);
            }
          }}
        />
      )}

      {showDropDialog && (
        <DropStashConfirmDialog
          open={true}
          stashId={showDropDialog}
          stash={stashes.find((s) => s.id === showDropDialog)}
          loading={dropLoading}
          error={dropError}
          onConfirm={() => handleDropStash(showDropDialog)}
          onOpenChange={(open) => {
            if (!open) {
              setShowDropDialog(null);
              setDropError(null);
            }
          }}
        />
      )}
    </div>
  );
}
