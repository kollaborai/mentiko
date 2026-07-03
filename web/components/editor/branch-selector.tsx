"use client";

import { useState, useCallback, useEffect } from "react";
import {
  ArrowDownFilled,
  AddFilled,
  TrashFilled,
  ArrowRightFilled,
} from "@aliimam/icons";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { showToast } from "@/components/app-shell/notifications-panel";
import type {
  GitBranch,
  GitBranchListResult,
  GitBranchCreateResult,
  GitBranchSwitchResult,
  GitBranchDeleteResult,
} from "@/app/api/git/route";

/**
 * Props for BranchSelector component
 */
interface BranchSelectorProps {
  /** Absolute workspace path (provided by parent GitPanel) */
  workspacePath: string;
  /** Optional callback when branch switch completes */
  onBranchSwitch?: (branchName: string) => void;
}

/**
 * Branch selector dropdown component
 * Enables users to view, create, switch, and delete Git branches
 * with real-time validation, loading states, and error handling.
 *
 * @component
 * @example
 * ```tsx
 * <BranchSelector
 *   workspacePath="/path/to/repo"
 *   onBranchSwitch={(branch) => console.log("Switched to", branch)}
 * />
 * ```
 */
export function BranchSelector({
  workspacePath,
  onBranchSwitch,
}: BranchSelectorProps) {
  // ── state management ──────────────────────────────────────────────────────
  const [isOpen, setIsOpen] = useState(false);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [currentBranch, setCurrentBranch] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createInput, setCreateInput] = useState("");
  const [createValidationError, setCreateValidationError] = useState<
    string | null
  >(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<{
    branchName: string;
    force: boolean;
  } | null>(null);

  // ── derived state ─────────────────────────────────────────────────────────
  const localBranches = branches.filter((b) => !b.isRemote);
  const remoteBranches = branches.filter((b) => b.isRemote);
  const canCreateBranch =
    createInput.trim().length > 0 && !createValidationError;

  // ── api helper ────────────────────────────────────────────────────────────
  /**
   * Generic Git API call helper
   * All endpoints POST to /api/git with consistent request/response contract
   */
  const gitPost = useCallback(
    async (action: string, payload: Record<string, unknown>) => {
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

  // ── validation helpers ────────────────────────────────────────────────────
  /**
   * Client-side validation for branch names
   * Catches common errors before API call
   */
  const validateBranchNameClient = (name: string): string | null => {
    if (!name.trim()) {
      return null; // Empty is ok on initial render
    }

    if (name.length > 255) {
      return "Branch name too long (max 255 characters)";
    }

    // Git ref format validation
    if (/[~^:?*\[\\@{}]/.test(name)) {
      return "Contains invalid characters: ~ ^ : ? * [ \\ @ { }";
    }

    // Cannot start or end with dot
    if (name.startsWith(".") || name.endsWith(".")) {
      return "Cannot start or end with dot";
    }

    // Cannot contain consecutive dots
    if (name.includes("..")) {
      return "Cannot contain consecutive dots";
    }

    // Single @
    if (name === "@") {
      return "Cannot be a single @";
    }

    // Contains @{
    if (name.includes("@{")) {
      return "Cannot contain @{";
    }

    // Cannot end with .lock
    if (name.endsWith(".lock")) {
      return "Cannot end with .lock";
    }

    return null;
  };

  // ── fetch branches ────────────────────────────────────────────────────────
  /**
   * Fetch all branches from the repository
   * Called when dropdown opens or on refresh
   */
  const refreshBranches = useCallback(async () => {
    try {
      setLoading(true);
      const result = (await gitPost("list_branches", {})) as GitBranchListResult;
      setBranches(result.branches);
      setCurrentBranch(result.current);
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load branches";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [gitPost]);

  // ── event handlers ────────────────────────────────────────────────────────

  /**
   * Handle branch name input change with real-time validation
   */
  const handleCreateInputChange = (value: string) => {
    setCreateInput(value);

    if (!value.trim()) {
      setCreateValidationError(null);
      return;
    }

    // Check for existing branches (case-insensitive)
    const exists = branches.some(
      (b) => b.name.toLowerCase() === value.trim().toLowerCase()
    );
    if (exists) {
      setCreateValidationError("Branch already exists");
      return;
    }

    // Client-side format validation
    const validationError = validateBranchNameClient(value);
    setCreateValidationError(validationError);
  };

  /**
   * Create a new branch from current HEAD
   */
  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!canCreateBranch) return;

    try {
      setActionLoading("__create__");
      const result = (await gitPost("create_branch", {
        branchName: createInput.trim(),
      })) as GitBranchCreateResult;

      if (result.ok) {
        setCreateInput("");
        setCreateValidationError(null);
        setError(null);
        await refreshBranches();

        showToast({
          type: "success",
          title: "Branch created",
          message: result.branch || createInput.trim(),
        });
      } else {
        setError(result.error || "Failed to create branch");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to create branch";
      setError(msg);
    } finally {
      setActionLoading(null);
    }
  };

  /**
   * Switch to a different branch
   */
  const handleSwitchBranch = async (branchName: string) => {
    if (branchName === currentBranch) {
      setIsOpen(false);
      return;
    }

    try {
      setActionLoading(branchName);
      const result = (await gitPost("switch_branch", {
        branchName,
      })) as GitBranchSwitchResult;

      if (result.ok) {
        setCurrentBranch(result.current || branchName);
        setError(null);
        setIsOpen(false);
        await refreshBranches();

        if (result.hasUncommittedChanges) {
          showToast({
            type: "info",
            title: "Branch switched",
            message: "Uncommitted changes were auto-stashed.",
          });
        } else {
          showToast({
            type: "success",
            title: "Switched branch",
            message: branchName,
          });
        }

        // Optional parent callback
        onBranchSwitch?.(branchName);
      } else {
        setError(result.error || "Failed to switch branch");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to switch branch";
      setError(msg);
    } finally {
      setActionLoading(null);
    }
  };

  /**
   * Checkout a remote-tracking branch as a new local branch.
   * Strips the `<remote>/` prefix and switches to the local name; git's DWIM
   * behavior auto-creates a tracking branch from the unique remote match.
   */
  const handleCheckoutRemote = async (remoteBranchName: string) => {
    const localName = remoteBranchName.replace(/^[^/]+\//, "");
    if (!localName || localName === remoteBranchName) {
      setError(`Cannot parse remote branch: ${remoteBranchName}`);
      return;
    }
    await handleSwitchBranch(localName);
  };

  /**
   * Delete a branch with optional force flag
   */
  const handleDeleteBranch = async (branchName: string, force = false) => {
    try {
      setActionLoading(branchName);
      const result = (await gitPost("delete_branch", {
        branchName,
        force,
      })) as GitBranchDeleteResult;

      if (result.ok) {
        setError(null);
        setShowDeleteConfirm(null);
        await refreshBranches();
        showToast({
          type: "success",
          title: "Branch deleted",
          message: branchName,
        });
      } else {
        // Check if we need to prompt for force delete
        const isNotMerged =
          result.error && result.error.toLowerCase().includes("not fully merged");
        if (!force && isNotMerged) {
          setShowDeleteConfirm({ branchName, force: true });
          setError(
            "Branch has unmerged changes. Use force delete to remove it."
          );
        } else {
          setError(result.error || "Failed to delete branch");
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to delete branch";
      setError(msg);
    } finally {
      setActionLoading(null);
    }
  };

  // ── lifecycle effects ─────────────────────────────────────────────────────

  /**
   * Fetch the current branch + list on mount (and whenever the workspace
   * changes). Without this the header label sits on "loading…" forever, because
   * currentBranch is only ever populated by refreshBranches — which otherwise
   * runs only after the dropdown is opened.
   */
  useEffect(() => {
    refreshBranches();
  }, [refreshBranches]);

  /**
   * Fetch branches when dropdown first opens
   */
  useEffect(() => {
    if (isOpen && branches.length === 0) {
      refreshBranches();
    }
  }, [isOpen, branches.length, refreshBranches]);

  /**
   * Auto-refresh branches while dropdown is open (every 10s)
   * Ensures user sees latest branch list if other tools modify git state
   */
  useEffect(() => {
    if (!isOpen) return;

    const interval = setInterval(() => {
      refreshBranches().catch(() => {
        // Silently ignore refresh errors
      });
    }, 10000);

    return () => clearInterval(interval);
  }, [isOpen, refreshBranches]);

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <>
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <button
            className="flex items-center gap-1.5 px-2 py-1 rounded-sm hover:bg-foreground/5 dark:hover:bg-white/5 transition-colors focus:outline-none focus:ring-1 focus:ring-foreground/10 dark:focus:ring-white/10"
            title="Switch branch"
            aria-label="Switch git branch"
            aria-expanded={isOpen}
            aria-haspopup="menu"
            data-testid="branch-selector-trigger"
          >
            <ArrowRightFilled className="h-3 w-3 text-foreground/25 dark:text-white/25 flex-shrink-0" />
            <span className="text-[10px] font-mono text-foreground/60 dark:text-white/60 truncate max-w-[120px]">
              {currentBranch || "loading…"}
            </span>
            <ArrowDownFilled
              className={cn(
                "h-3 w-3 text-foreground/25 dark:text-white/25 transition-transform flex-shrink-0",
                isOpen && "rotate-180"
              )}
            />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          className="w-72"
          role="menu"
          aria-label="Available branches"
        >
          {/* Error banner */}
          {error && (
            <div className="mx-2 mb-2 p-2 rounded-sm bg-red-500/10 text-[9px] text-red-400/70 border border-red-500/20">
              <div className="flex items-start justify-between gap-2">
                <span>{error}</span>
                <button
                  onClick={() => setError(null)}
                  className="text-red-400/50 hover:text-red-400 text-[8px] flex-shrink-0"
                  aria-label="Dismiss error"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* Loading state */}
          {loading && branches.length === 0 ? (
            <div className="flex items-center justify-center py-6 px-4">
              <div className="text-[10px] text-foreground/40 dark:text-white/40">Loading…</div>
            </div>
          ) : (
            <>
              {/* Create branch section */}
              <DropdownMenuGroup>
                <form onSubmit={handleCreateBranch} className="px-2 py-1.5">
                  <div className="space-y-1">
                    <input
                      type="text"
                      value={createInput}
                      onChange={(e) => handleCreateInputChange(e.target.value)}
                      // Stop keydown bubbling so typing (esp. Enter/space) doesn't
                      // trigger parent menu / form-submit handlers.
                      onKeyDown={(e) => e.stopPropagation()}
                      placeholder="New branch name…"
                      className="w-full bg-foreground/5 dark:bg-white/5 rounded-sm px-2 py-1 text-[11px] text-foreground/70 dark:text-white/70 placeholder:text-foreground/20 dark:placeholder:text-white/20 outline-none border border-foreground/5 dark:border-white/5 focus:border-foreground/10 dark:focus:border-white/10 transition-colors focus:ring-1 focus:ring-foreground/10 dark:focus:ring-white/10"
                      autoFocus
                      autoComplete="off"
                    />
                    {createValidationError && (
                      <span className="text-[8px] text-red-400/60 block">
                        {createValidationError}
                      </span>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={!canCreateBranch || actionLoading !== null}
                    className={cn(
                      "mt-1 w-full text-[10px] px-2 py-1 rounded-sm transition-colors",
                      canCreateBranch && actionLoading === null
                        ? "text-foreground/70 dark:text-white/70 hover:text-foreground/90 dark:hover:text-white/90 bg-foreground/5 dark:bg-white/5 hover:bg-foreground/10 dark:hover:bg-white/10"
                        : "text-foreground/30 dark:text-white/30 bg-foreground/[0.02] dark:bg-white/[0.02] cursor-not-allowed"
                    )}
                  >
                    {actionLoading === "__create__" ? "Creating…" : "Create"}
                  </button>
                </form>
              </DropdownMenuGroup>

              <DropdownMenuSeparator className="bg-foreground/5 dark:bg-white/5" />

              {/* Local branches section */}
              {localBranches.length > 0 ? (
                <DropdownMenuGroup>
                  <span className="px-2 py-1 text-[8px] text-foreground/25 dark:text-white/25 uppercase tracking-wider font-medium">
                    Local ({localBranches.length})
                  </span>
                  {localBranches.map((branch) => (
                    <BranchItem
                      key={branch.name}
                      branch={branch}
                      isCurrent={currentBranch === branch.name}
                      isLoading={actionLoading === branch.name}
                      onSwitch={handleSwitchBranch}
                      onDelete={() => setShowDeleteConfirm({ branchName: branch.name, force: false })}
                    />
                  ))}
                </DropdownMenuGroup>
              ) : null}

              {localBranches.length > 0 && remoteBranches.length > 0 && (
                <DropdownMenuSeparator className="bg-foreground/5 dark:bg-white/5" />
              )}

              {/* Remote branches section */}
              {remoteBranches.length > 0 ? (
                <DropdownMenuGroup>
                  <span className="px-2 py-1 text-[8px] text-foreground/25 dark:text-white/25 uppercase tracking-wider font-medium">
                    Remote ({remoteBranches.length})
                  </span>
                  {remoteBranches.map((branch) => (
                    <BranchItem
                      key={branch.name}
                      branch={branch}
                      isRemote
                      isLoading={actionLoading === branch.name}
                      onSwitch={handleCheckoutRemote}
                      onCheckout={() => handleCheckoutRemote(branch.name)}
                    />
                  ))}
                </DropdownMenuGroup>
              ) : null}

              {/* Empty state */}
              {localBranches.length === 0 && remoteBranches.length === 0 && (
                <div className="px-2 py-4 text-[10px] text-foreground/25 dark:text-white/25 text-center">
                  No branches found
                </div>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <DeleteConfirmationDialog
          branchName={showDeleteConfirm.branchName}
          force={showDeleteConfirm.force}
          isLoading={actionLoading === showDeleteConfirm.branchName}
          onConfirm={() =>
            handleDeleteBranch(showDeleteConfirm.branchName, showDeleteConfirm.force)
          }
          onCancel={() => setShowDeleteConfirm(null)}
        />
      )}
    </>
  );
}

// ── sub-components ──────────────────────────────────────────────────────────

/**
 * Individual branch item in the dropdown list
 * Displays branch name, metadata, and action buttons
 */
interface BranchItemProps {
  branch: GitBranch;
  isCurrent?: boolean;
  isRemote?: boolean;
  isLoading?: boolean;
  onSwitch: (name: string) => void;
  onDelete?: (name: string) => void;
  onCheckout?: () => void;
}

function BranchItem({
  branch,
  isCurrent,
  isRemote,
  isLoading,
  onSwitch,
  onDelete,
  onCheckout,
}: BranchItemProps) {
  return (
    <DropdownMenuItem
      disabled={isLoading}
      className={cn(
        "flex items-center justify-between gap-2 px-2 py-1.5 rounded-sm cursor-pointer transition-colors",
        isCurrent && "bg-emerald-500/15",
        !isLoading && "hover:bg-foreground/5 dark:hover:bg-white/5",
        isLoading && "opacity-50 pointer-events-none"
      )}
      onClick={() => onSwitch(branch.name)}
      role="menuitem"
      aria-current={isCurrent ? "true" : "false"}
      aria-label={`Branch ${branch.name}${isCurrent ? " (current)" : ""}${branch.tracking ? ` tracking ${branch.tracking}` : ""}${isRemote ? " (remote, click to checkout)" : ""}`}
      data-branch={branch.name}
      data-is-current={isCurrent}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {isCurrent && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0"
              title="Current branch"
              aria-hidden="true"
            />
          )}
          <div className="text-[11px] font-mono text-foreground/70 dark:text-white/70 truncate">
            {branch.name}
          </div>
          {isRemote && (
            <span className="text-[8px] text-cyan-400/50 flex-shrink-0">
              remote
            </span>
          )}
        </div>
        {branch.tracking && (
          <div className="text-[8px] text-foreground/40 dark:text-white/40 ml-2.5">
            tracking {branch.tracking}
          </div>
        )}
        {branch.lastCommitDate && (
          <div className="text-[8px] text-foreground/25 dark:text-white/25 ml-2.5">
            {branch.lastCommitDate}
          </div>
        )}
      </div>

      {/* Action button: Checkout for remote, Delete for local */}
      {isRemote ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCheckout?.();
          }}
          className={cn(
            "flex-shrink-0 p-1 rounded-sm transition-colors",
            "text-foreground/25 dark:text-white/25 hover:text-emerald-400/80 hover:bg-emerald-500/5"
          )}
          title={`Checkout ${branch.name} as local branch`}
          aria-label={`Checkout remote branch ${branch.name} as a local branch`}
        >
          <ArrowRightFilled className="h-3 w-3" />
        </button>
      ) : onDelete ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(branch.name);
          }}
          className={cn(
            "flex-shrink-0 p-1 rounded-sm transition-colors",
            "text-foreground/25 dark:text-white/25 hover:text-red-400/60 hover:bg-red-500/5"
          )}
          title={`Delete ${branch.name}`}
          aria-label={`Delete branch ${branch.name}`}
        >
          <TrashFilled className="h-3 w-3" />
        </button>
      ) : null}
    </DropdownMenuItem>
  );
}

// ── confirmation dialog ─────────────────────────────────────────────────────

/**
 * Delete confirmation modal
 * Prevents accidental deletion of branches
 */
interface DeleteConfirmationDialogProps {
  branchName: string;
  force: boolean;
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function DeleteConfirmationDialog({
  branchName,
  force,
  isLoading,
  onConfirm,
  onCancel,
}: DeleteConfirmationDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Delete branch confirmation"
    >
      <div className="bg-card rounded-md p-4 max-w-sm mx-4 border border-foreground/10 dark:border-white/10">
        <h3 className="text-sm font-medium text-foreground/90 dark:text-white/90">Delete branch?</h3>
        <p className="mt-2 text-[10px] text-foreground/60 dark:text-white/60">
          {force
            ? `This will force delete "${branchName}" even if it has unmerged changes.`
            : `This will delete the branch "${branchName}".`}
        </p>
        <div className="mt-4 flex gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="text-[10px] text-foreground/50 dark:text-white/50 hover:text-foreground/70 dark:hover:text-white/70 bg-foreground/5 dark:bg-white/5 hover:bg-foreground/10 dark:hover:bg-white/10 px-3 py-1.5 rounded-sm transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className={cn(
              "text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-1.5 rounded-sm transition-colors",
              "hover:text-red-300 hover:bg-red-500/15",
              "disabled:opacity-50"
            )}
          >
            {isLoading ? "Deleting…" : force ? "Force Delete" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
