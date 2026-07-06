"use client";

import { PeopleFilled, InfoCircleFilled } from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { ReviewStatusBadge, type ReviewStatus } from "./review-status-badge";
import { useEditorStore } from "@/lib/ui/editor-store";
import { cn } from "@/lib/utils";

/** stable synthetic tab key so re-opening focuses the existing review tab */
const PEER_REVIEW_VIEW_KEY = "mentiko-view://peer-review";

/**
 * Review summary data structure
 */
interface ReviewSummary {
  id: string;
  title: string;
  status: ReviewStatus;
  reviewers: Array<{ name: string }>;
  criteriaCount: number;
  passedCount: number;
  commentCount: number;
}

/**
 * Props for ReviewPanelSection component
 */
interface ReviewPanelSectionProps {
  /** Selected files for review */
  selectedFiles: string[];
  /** Workspace path */
  workspacePath: string;
  /** Currently checked-out branch — becomes the review's source branch */
  sourceBranch: string;
  /** Existing reviews for these files */
  existingReviews?: ReviewSummary[];
}

/**
 * Review panel section component
 * Integrates peer review functionality into the Git panel
 *
 * @component
 * @example
 * ```tsx
 * <ReviewPanelSection
 *   selectedFiles={["src/app.tsx"]}
 *   workspacePath="/path/to/repo"
 *   sourceBranch="feature/x"
 * />
 * ```
 */
export function ReviewPanelSection({
  selectedFiles,
  workspacePath,
  sourceBranch,
  existingReviews = [],
}: ReviewPanelSectionProps) {
  const openView = useEditorStore((s) => s.openView);
  const activePaneId = useEditorStore((s) => s.activePaneId);

  const hasSelection = selectedFiles.length > 0;
  const hasReviews = existingReviews.length > 0;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between px-3">
        <div className="flex items-center gap-2">
          <PeopleFilled className="w-4 h-4 text-foreground/60" />
          <span className="text-xs font-medium text-foreground/80">
            Peer Review
          </span>
        </div>
        {hasSelection && (
          <Button
            size="sm"
            onClick={() =>
              openView(activePaneId, PEER_REVIEW_VIEW_KEY, "Peer Review", {
                type: "peer-review",
                workspacePath,
                selectedFiles,
                sourceBranch,
              })
            }
            className="h-6 px-2 text-xs"
          >
            Assign Reviewers
          </Button>
        )}
      </div>

      {/* Selection hint */}
      {!hasSelection && !hasReviews && (
        <div className="px-3 py-4 text-center">
          <p className="text-xs text-foreground/40">
            Select files to start a review
          </p>
        </div>
      )}

      {/* Existing reviews */}
      {hasReviews && (
        <div className="space-y-2 px-3">
          {existingReviews.map(review => (
            <div
              key={review.id}
              className="p-3 rounded-md border border-border bg-card hover:bg-muted transition-colors cursor-pointer"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <h4 className="text-sm font-medium mb-1">{review.title}</h4>
                  <div className="flex items-center gap-2 text-xs text-foreground/60">
                    <span>
                      {review.reviewers.map(r => r.name).join(", ")}
                    </span>
                    <span>•</span>
                    <span>
                      {review.passedCount}/{review.criteriaCount} criteria passed
                    </span>
                    {review.commentCount > 0 && (
                      <>
                        <span>•</span>
                        <span>{review.commentCount} comments</span>
                      </>
                    )}
                  </div>
                </div>
                <ReviewStatusBadge status={review.status} />
              </div>

              {/* Progress bar */}
              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full transition-all",
                    review.status === "approved" && "bg-green-400",
                    review.status === "changes_requested" && "bg-amber-400",
                    review.status === "in_review" && "bg-blue-400",
                    review.status === "pending" && "bg-gray-400"
                  )}
                  style={{
                    width: `${(review.passedCount / review.criteriaCount) * 100}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state with selection */}
      {hasSelection && !hasReviews && (
        <div className="px-3 py-4">
          <div className="p-3 rounded-md bg-accent/10 border border-accent/20">
            <div className="flex items-start gap-2">
              <InfoCircleFilled className="w-4 h-4 text-accent mt-0.5" />
              <div className="flex-1">
                <p className="text-xs text-foreground/80 mb-1">
                  {selectedFiles.length} file{selectedFiles.length !== 1 ? "s" : ""} selected
                </p>
                <p className="text-xs text-foreground/60">
                  Click &ldquo;Assign Reviewers&rdquo; to start a peer review
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
