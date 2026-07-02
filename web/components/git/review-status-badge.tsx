"use client";

import { cn } from "@/lib/utils";

/**
 * Review status types
 */
export type ReviewStatus = 
  | "pending"        // Waiting for reviewer to start
  | "in_review"      // Reviewer is actively reviewing
  | "approved"       // Changes approved
  | "changes_requested"; // Reviewer requested modifications

/**
 * Props for ReviewStatusBadge component
 */
interface ReviewStatusBadgeProps {
  /** Current review status */
  status: ReviewStatus;
  /** Optional custom class name */
  className?: string;
}

/**
 * Status configuration mapping
 */
const STATUS_CONFIG: Record<ReviewStatus, {
  label: string;
  colors: string;
  icon: string;
}> = {
  pending: {
    label: "Pending",
    colors: "bg-gray-400/20 text-gray-400 border-gray-400/30",
    icon: "○",
  },
  in_review: {
    label: "In Review",
    colors: "bg-blue-400/20 text-blue-400 border-blue-400/30",
    icon: "◐",
  },
  approved: {
    label: "Approved",
    colors: "bg-green-400/20 text-green-400 border-green-400/30",
    icon: "●",
  },
  changes_requested: {
    label: "Changes Requested",
    colors: "bg-amber-400/20 text-amber-400 border-amber-400/30",
    icon: "◑",
  },
};

/**
 * Review status badge component
 * Displays the current status of a review with appropriate styling
 *
 * @component
 * @example
 * ```tsx
 * <ReviewStatusBadge status="in_review" />
 * // Renders: "◐ In Review" (blue badge)
 * ```
 */
export function ReviewStatusBadge({ status, className }: ReviewStatusBadgeProps) {
  const config = STATUS_CONFIG[status];

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium",
        config.colors,
        className
      )}
    >
      <span aria-hidden="true" className="text-sm">{config.icon}</span>
      <span>{config.label}</span>
    </div>
  );
}

/**
 * Helper function to get status label
 */
export function getStatusLabel(status: ReviewStatus): string {
  return STATUS_CONFIG[status].label;
}

/**
 * Helper function to get status colors
 */
export function getStatusColors(status: ReviewStatus): string {
  return STATUS_CONFIG[status].colors;
}
