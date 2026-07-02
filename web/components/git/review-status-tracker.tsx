"use client";

import { useMemo, useCallback } from "react";
import { createAvatar } from "@dicebear/core";
import * as botttsNeutral from "@dicebear/bottts-neutral";
import {
  ClockFilled,
  EyeFilled,
  TickCircleFilled,
  DangerFilled,
} from "@aliimam/icons";
import { ReviewStatusBadge, type ReviewStatus } from "./review-status-badge";
import { cn } from "@/lib/utils";

export interface ReviewerStatus {
  reviewerId: string;
  name: string;
  avatarUrl?: string;
  status: ReviewStatus;
  updatedAt: string;
  /** Assignment row id — needed to PATCH a reviewer's status. */
  assignmentId?: string;
  /** Review the assignment belongs to. */
  reviewId?: string;
}

export interface ReviewStatusTrackerProps {
  reviewers: ReviewerStatus[];
  onStatusChange: (reviewerId: string, newStatus: ReviewStatus) => void;
  readOnly?: boolean;
}

// Mirrors the store's assignment vocabulary (pending|approved|changes_requested).
// `in_review` is intentionally NOT offered — the PATCH route rejects it.
const STATUS_OPTIONS: { value: ReviewStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "changes_requested", label: "Changes Requested" },
];

const STATUS_ICON: Record<ReviewStatus, React.ReactNode> = {
  pending: <ClockFilled className="w-3.5 h-3.5 text-foreground/40" />,
  in_review: <EyeFilled className="w-3.5 h-3.5 text-blue-400" />,
  approved: <TickCircleFilled className="w-3.5 h-3.5 text-emerald-400" />,
  changes_requested: <DangerFilled className="w-3.5 h-3.5 text-amber-400" />,
};

function ReviewerAvatar({ reviewerId, avatarUrl, name, size = 28 }: {
  reviewerId: string;
  avatarUrl?: string;
  name: string;
  size?: number;
}) {
  const svg = useMemo(() => {
    if (avatarUrl) return null;
    const avatar = createAvatar(botttsNeutral, { seed: reviewerId, size });
    return avatar.toString();
  }, [reviewerId, avatarUrl, size]);

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        width={size}
        height={size}
        className="rounded-sm object-cover flex-shrink-0"
      />
    );
  }

  return (
    <div
      role="img"
      aria-label={name}
      className="rounded-sm overflow-hidden flex-shrink-0"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg! }}
    />
  );
}

function fireNotification(reviewerId: string, status: ReviewStatus) {
  fetch("/api/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "review_status_changed",
      reviewerId,
      status,
    }),
  }).catch(() => {});
}

export function ReviewStatusTracker({
  reviewers,
  onStatusChange,
  readOnly = false,
}: ReviewStatusTrackerProps) {
  const approvedCount = reviewers.filter((r) => r.status === "approved").length;
  const total = reviewers.length;

  const handleChange = useCallback(
    (reviewerId: string, newStatus: ReviewStatus) => {
      onStatusChange(reviewerId, newStatus);
      if (newStatus === "approved" || newStatus === "changes_requested") {
        fireNotification(reviewerId, newStatus);
      }
    },
    [onStatusChange]
  );

  if (total === 0) {
    return (
      <div className="p-4 bg-card rounded-md">
        <p className="text-xs text-foreground/40">No reviewers assigned.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4 bg-card rounded-md">
      <span className="text-xs font-medium text-foreground/70">Reviewers</span>

      <div className="flex flex-col gap-1">
        {reviewers.map((reviewer) => (
          <div
            key={reviewer.reviewerId}
            className="flex items-center gap-3 px-2 py-2 rounded-md bg-muted"
          >
            <ReviewerAvatar
              reviewerId={reviewer.reviewerId}
              avatarUrl={reviewer.avatarUrl}
              name={reviewer.name}
              size={28}
            />

            <span className="flex-1 text-sm truncate">{reviewer.name}</span>

            <div className="flex items-center gap-2 flex-shrink-0">
              <span aria-hidden="true">{STATUS_ICON[reviewer.status]}</span>

              {readOnly ? (
                <ReviewStatusBadge status={reviewer.status} />
              ) : (
                <div className="relative">
                  <select
                    aria-label={`Review status for ${reviewer.name}`}
                    value={reviewer.status}
                    onChange={(e) =>
                      handleChange(reviewer.reviewerId, e.target.value as ReviewStatus)
                    }
                    className={cn(
                      "appearance-none pr-6 pl-2.5 py-1 rounded-md text-xs font-medium",
                      "bg-transparent border focus:outline-none focus:ring-1 focus:ring-accent",
                      "cursor-pointer",
                      reviewer.status === "pending" &&
                        "bg-gray-400/20 text-gray-400 border-gray-400/30",
                      reviewer.status === "in_review" &&
                        "bg-blue-400/20 text-blue-400 border-blue-400/30",
                      reviewer.status === "approved" &&
                        "bg-green-400/20 text-green-400 border-green-400/30",
                      reviewer.status === "changes_requested" &&
                        "bg-amber-400/20 text-amber-400 border-amber-400/30"
                    )}
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option
                        key={opt.value}
                        value={opt.value}
                        className="bg-card text-foreground"
                      >
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <span aria-hidden="true" className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] opacity-60">
                    ▾
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 pt-1 border-t border-foreground/5">
        <span className="text-xs text-foreground/50">
          {approvedCount} of {total} approved
        </span>
        <div className="ml-auto">
          <ReviewStatusBadge
            status={
              reviewers.some((r) => r.status === "changes_requested")
                ? "changes_requested"
                : reviewers.some((r) => r.status === "pending")
                ? "pending"
                : "approved"
            }
          />
        </div>
      </div>
    </div>
  );
}
