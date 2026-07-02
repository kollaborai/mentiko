"use client";

import { useState, useCallback } from "react";
import { ReviewStatusBadge } from "./review-status-badge";
import type { ReviewerStatus } from "./review-status-tracker";

interface ReviewApprovalGateProps {
  reviewers: ReviewerStatus[];
  onCommit: () => Promise<void>;
  /** Disabled from parent (busy, no staged files, no message) */
  baseDisabled?: boolean;
}

export function ReviewApprovalGate({
  reviewers,
  onCommit,
  baseDisabled = false,
}: ReviewApprovalGateProps) {
  const [committing, setCommitting] = useState(false);

  const allApproved =
    reviewers.length > 0 && reviewers.every((r) => r.status === "approved");

  const handleCommit = useCallback(async () => {
    if (committing) return;
    setCommitting(true);
    try {
      await onCommit();
    } finally {
      setCommitting(false);
    }
  }, [committing, onCommit]);

  const gateDisabled = reviewers.length > 0 && !allApproved;
  const isDisabled = baseDisabled || gateDisabled || committing;
  const tooltip =
    gateDisabled ? "Waiting for all reviewers to approve" : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      {/* Per-reviewer status summary */}
      {reviewers.length > 0 && (
        <div className="flex flex-col gap-1 pb-1">
          {reviewers.map((reviewer) => (
            <div
              key={reviewer.reviewerId}
              className="flex items-center gap-2 px-1"
            >
              <ReviewStatusBadge
                status={reviewer.status}
                className="text-[9px] px-1.5 py-0.5"
              />
              <span className="text-[10px] text-foreground/50 dark:text-white/50 truncate">
                {reviewer.name}
              </span>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={handleCommit}
        disabled={isDisabled}
        aria-disabled={isDisabled}
        aria-label={tooltip ? `Commit Changes — ${tooltip}` : "Commit Changes"}
        title={tooltip}
        className="text-[10px] text-foreground/50 dark:text-white/50 hover:text-foreground/80 dark:hover:text-white/80 bg-foreground/5 dark:bg-white/5 hover:bg-foreground/10 dark:hover:bg-white/10 px-3 py-1 rounded-sm transition-colors focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {committing ? "Committing..." : "Commit Changes"}
      </button>
    </div>
  );
}
