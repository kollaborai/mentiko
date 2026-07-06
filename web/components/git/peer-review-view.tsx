"use client";

import { useState, useEffect, useCallback } from "react";
import {
  PeopleFilled,
  AddFilled,
  CheckFilled,
  CloseCircleFilled as XFilled,
} from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Props for PeerReviewView.
 *
 * Rendered as a first-class editor tab (not a modal) so it lives inside the
 * editor's own stacking context — this is what fixes the "assign reviewers
 * opens behind / closes the floating code editor" bug that a Radix Dialog
 * (portaled to document.body at z-50, below the pill's z-12000) caused.
 */
interface PeerReviewViewProps {
  /** Selected files for review */
  selectedFiles: string[];
  /** Workspace path for Git operations */
  workspacePath: string;
  /** Branch the review is for (the currently checked-out branch) */
  sourceBranch: string;
  /** Close this tab (Cancel or after a successful create) */
  onClose: () => void;
  /** Called after a review is successfully created */
  onReviewCreated?: (reviewId: string) => void;
}

/** Org member for reviewer selection */
interface OrgMember {
  id: string;
  name: string;
  email: string;
}

/** Raw member shape from GET /api/orgs/[id]/members */
interface OrgMemberRaw {
  id: string;
  userId?: string;
  email: string;
  role?: string;
}

/** Unwrap the {success, data} envelope used by all API routes. */
async function unwrap(res: Response): Promise<Record<string, unknown>> {
  const body = await res.json().catch(() => ({}));
  return (body?.data ?? body) as Record<string, unknown>;
}

/**
 * Peer-review assignment view.
 * Enables users to assign reviewers to Git changes with context and criteria.
 * Same form + endpoints as the former ReviewAssignmentDialog, laid out as a
 * full editor tab instead of a portaled modal.
 */
export function PeerReviewView({
  selectedFiles,
  workspacePath,
  sourceBranch,
  onClose,
  onReviewCreated,
}: PeerReviewViewProps) {
  // ── state management ──────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedReviewers, setSelectedReviewers] = useState<string[]>([]);
  const [criteria, setCriteria] = useState<string[]>([""]);
  const [dueDate, setDueDate] = useState("");
  const [targetBranch, setTargetBranch] = useState("");

  // Org members (fetched on mount)
  const [availableMembers, setAvailableMembers] = useState<OrgMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);

  // ── data loading ──────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    // Reviewer candidates come from the org member list.
    setMembersLoading(true);
    setMembersError(null);
    (async () => {
      try {
        const orgData = (await unwrap(await fetch("/api/orgs"))) as { org?: { id?: string } };
        const orgId = orgData?.org?.id;
        if (!orgId) throw new Error("no org");
        const membersData = (await unwrap(await fetch(`/api/orgs/${orgId}/members`))) as {
          members?: OrgMemberRaw[];
        };
        const raw: OrgMemberRaw[] = membersData?.members ?? [];
        if (cancelled) return;
        setAvailableMembers(
          raw.map((m) => ({
            // assignments reference user ids (matches session identity on the server)
            id: m.userId || m.id,
            name: m.email.split("@")[0],
            email: m.email,
          }))
        );
      } catch {
        if (!cancelled) setMembersError("Could not load org members");
      } finally {
        if (!cancelled) setMembersLoading(false);
      }
    })();

    // Default the merge target to the repo's default branch.
    (async () => {
      try {
        const res = await fetch("/api/git", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list_branches", workspacePath }),
        });
        const data = (await unwrap(res)) as { defaultBranch?: string };
        if (!cancelled) {
          setTargetBranch((prev) => prev || data?.defaultBranch || "main");
        }
      } catch {
        if (!cancelled) setTargetBranch((prev) => prev || "main");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  // ── derived state ─────────────────────────────────────────────────────────
  const canSubmit =
    title.trim().length > 0 &&
    description.trim().length > 0 &&
    selectedReviewers.length > 0 &&
    criteria.filter(c => c.trim().length > 0).length > 0 &&
    targetBranch.trim().length > 0 &&
    !loading;

  // ── handlers ───────────────────────────────────────────────────────────────

  const toggleReviewer = useCallback((memberId: string) => {
    setSelectedReviewers(prev =>
      prev.includes(memberId)
        ? prev.filter(id => id !== memberId)
        : [...prev, memberId]
    );
  }, []);

  const updateCriterion = useCallback((index: number, value: string) => {
    setCriteria(prev => {
      const newCriteria = [...prev];
      newCriteria[index] = value;
      return newCriteria;
    });
  }, []);

  const addCriterion = useCallback(() => {
    setCriteria(prev => [...prev, ""]);
  }, []);

  const removeCriterion = useCallback((index: number) => {
    setCriteria(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleSubmit = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspacePath,
          selectedFiles,
          assignment: {
            title: title.trim(),
            description: description.trim(),
            reviewers: selectedReviewers,
            source_branch: sourceBranch,
            target_branch: targetBranch.trim(),
            checklist: criteria
              .filter(c => c.trim().length > 0)
              .map(c => ({ title: c.trim(), required: true, completed: false })),
            due_date: dueDate || undefined,
          },
        }),
      });

      const data = (await unwrap(res)) as {
        ok?: boolean;
        reviewId?: string;
        error?: { message?: string };
      };
      const reviewId = data?.reviewId;
      if (!res.ok || data?.ok === false || !reviewId) {
        throw new Error(data?.error?.message ?? "Failed to create review");
      }

      onReviewCreated?.(reviewId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create review");
    } finally {
      setLoading(false);
    }
  }, [title, description, selectedReviewers, criteria, dueDate, sourceBranch, targetBranch, workspacePath, selectedFiles, onReviewCreated, onClose]);

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div
      data-editor-view="peer-review"
      role="region"
      aria-label="Assign Reviewers"
      className="flex flex-col h-full bg-background"
    >
      {/* header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 shrink-0 border-b border-border">
        <h2 className="text-base font-black tracking-tighter flex items-center gap-2">
          <PeopleFilled className="w-5 h-5" />
          Assign Reviewers
        </h2>
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          title="Close"
          className="flex items-center justify-center w-7 h-7 rounded-md text-foreground/40 hover:text-foreground/70 hover:bg-muted transition-colors disabled:opacity-40"
        >
          <XFilled className="w-4 h-4" />
          <span className="sr-only">Close</span>
        </button>
      </div>

      {/* body (scrolls) */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">
          {/* Error banner */}
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-md">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Selected files summary */}
          <div className="p-3 bg-muted rounded-md">
            <p className="text-xs text-foreground/60 mb-1">
              {selectedFiles.length} file{selectedFiles.length !== 1 ? "s" : ""} selected for review
            </p>
            <div className="flex flex-wrap gap-1">
              {selectedFiles.slice(0, 3).map(file => (
                <span key={file} className="text-xs bg-card px-2 py-1 rounded">
                  {file.split("/").pop()}
                </span>
              ))}
              {selectedFiles.length > 3 && (
                <span className="text-xs bg-card px-2 py-1 rounded">
                  +{selectedFiles.length - 3} more
                </span>
              )}
            </div>
          </div>

          {/* Branches */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Source Branch</label>
              <input
                type="text"
                value={sourceBranch}
                readOnly
                className="w-full px-3 py-2 bg-muted border border-border rounded-md text-sm text-foreground/70"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Target Branch *</label>
              <input
                type="text"
                value={targetBranch}
                onChange={(e) => setTargetBranch(e.target.value)}
                placeholder="main"
                className="w-full px-3 py-2 bg-card border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-accent text-sm"
                disabled={loading}
              />
            </div>
          </div>

          {/* Title */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Review Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Fix authentication bug in login flow"
              className="w-full px-3 py-2 bg-card border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-accent"
              disabled={loading}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Description *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Provide context about the changes and what reviewers should focus on..."
              rows={4}
              className="w-full px-3 py-2 bg-card border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-accent resize-none"
              disabled={loading}
            />
          </div>

          {/* Reviewers */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Reviewers * ({selectedReviewers.length} selected)
            </label>
            {membersLoading && (
              <p className="text-xs text-foreground/50">Loading org members...</p>
            )}
            {membersError && (
              <p className="text-xs text-red-400">{membersError}</p>
            )}
            {!membersLoading && !membersError && availableMembers.length === 0 && (
              <p className="text-xs text-foreground/50">No org members available.</p>
            )}
            <div className="space-y-2">
              {availableMembers.map(member => (
                <div
                  key={member.id}
                  onClick={() => !loading && toggleReviewer(member.id)}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-md cursor-pointer transition-colors",
                    "border border-border",
                    selectedReviewers.includes(member.id)
                      ? "bg-accent/20 border-accent"
                      : "bg-card hover:bg-muted"
                  )
                }
                >
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-foreground/70 text-sm font-medium">
                    {member.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{member.name}</p>
                    <p className="text-xs text-foreground/60">{member.email}</p>
                  </div>
                  {selectedReviewers.includes(member.id) && (
                    <CheckFilled className="w-5 h-5 text-accent" />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Review criteria */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Review Criteria *</label>
            <div className="space-y-2">
              {criteria.map((criterion, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    type="text"
                    value={criterion}
                    onChange={(e) => updateCriterion(index, e.target.value)}
                    placeholder="e.g., Security: Check for SQL injection vulnerabilities"
                    className="flex-1 px-3 py-2 bg-card border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-accent text-sm"
                    disabled={loading}
                  />
                  {criteria.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeCriterion(index)}
                      disabled={loading}
                    >
                      <XFilled className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={addCriterion}
              disabled={loading}
              className="mt-2"
            >
              <AddFilled className="w-4 h-4 mr-1" />
              Add Criterion
            </Button>
          </div>

          {/* Due date (optional) */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Due Date (optional)</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full px-3 py-2 bg-card border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-accent"
              disabled={loading}
            />
          </div>
        </div>
      </div>

      {/* footer actions */}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end px-4 sm:px-6 py-3 shrink-0 border-t border-border">
        <Button
          variant="outline"
          onClick={onClose}
          disabled={loading}
        >
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit || loading}
          className="min-w-[120px]"
        >
          {loading ? "Creating..." : "Assign Reviewers"}
        </Button>
      </div>
    </div>
  );
}
