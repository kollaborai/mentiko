# Git Components

UI components for Mentiko's Git panel and peer-review integration. The review components live in this directory (`web/components/git/`); the Git panel itself and the branch selector live in `web/components/editor/` and compose the pieces below.

See `web/docs/peer-review.md` for the end-to-end review workflow. The commit-related Git operations back through `/api/git` (branch list/create/switch/delete, stage, commit).

## Review components — how they wire in

The Git panel (`web/components/editor/git-panel.tsx`) composes these directly: `ReviewPanelSection` and `ReviewStatusTracker` render in the review tab, and `ReviewApprovalGate` wraps the commit button. `ReviewAssignmentDialog` is opened by `ReviewPanelSection`. `ReviewStatusBadge` is a shared pill used by the tracker and the panel section.

```
Git panel
├── review tab (activeView === "review")
│     ├── ReviewPanelSection
│     │     └── "Assign Reviewers"  → ReviewAssignmentDialog
│     │                                    └── POST /api/reviews
│     └── ReviewStatusTracker   (per-reviewer approve → PATCH /api/reviews/[id]/assignments/[assignmentId])
└── commit area
      └── ReviewApprovalGate  (disabled until every assignment is `approved`)
```

### ReviewPanelSection

Renders in the Git panel's review tab. Shows the currently selected files, an "Assign Reviewers" button that opens `ReviewAssignmentDialog`, and any existing reviews with a status badge and progress bar. This is the entry point for creating a review from the panel.

**File**: `review-panel-section.tsx`
**Props**: `selectedFiles: string[]`, `workspacePath: string`, `existingReviews?: ReviewSummary[]`, `onReviewCreated?: (id: string) => void`.

### ReviewAssignmentDialog

Dialog opened by `ReviewPanelSection`. Loads org members via `/api/orgs` then `/api/orgs/[id]/members`, lets the user choose reviewers and add criteria, and creates the review with one `pending` assignment per reviewer via `POST /api/reviews`. The selected files ride along as a review label. Requires a title, description, at least one reviewer, at least one criterion, and a target branch before the submit button enables.

**File**: `review-assignment-dialog.tsx`
**Props**: `open`, `onOpenChange`, `selectedFiles`, `workspacePath`, `sourceBranch`, `onReviewCreated?`.

### ReviewApprovalGate

Wraps the commit button in the Git panel's commit area. Disables commit until every assigned reviewer's assignment status is `approved` (or there are no reviewers). On click it calls the parent's `onCommit` — the same commit handler the Git panel uses outside of review. The gate does not issue its own commit request; it only gates the parent action.

**File**: `review-approval-gate.tsx`
**Props**: `reviewers: ReviewerStatus[]`, `onCommit: () => Promise<void>`, `baseDisabled?: boolean`.

### ReviewStatusTracker

Per-reviewer rows with avatar, name, and a status selector, plus an aggregate `X of Y approved` badge. Fires a fire-and-forget POST to `/api/notifications` on `approved`/`changes_requested` transitions. The selector exposes three states — `pending | approved | changes_requested` — which are exactly what the server accepts on assignment PATCH. (`in_review` exists only on the badge type for display and is never offered by the tracker.)

**File**: `review-status-tracker.tsx`
**Props**: `reviewers: ReviewerStatus[]`, `onStatusChange: (reviewerId, status) => void`, `readOnly?: boolean`. The caller is responsible for PATCHing the assignment in `onStatusChange`.

### Supporting building block

- **ReviewStatusBadge** (`review-status-badge.tsx`) — small status pill; exports the `ReviewStatus` type and the `pending | in_review | approved | changes_requested` visual states. Used by `ReviewStatusTracker` and `ReviewPanelSection`.

## Branch selector

The branch selector used by the Git panel lives in `web/components/editor/branch-selector.tsx` (the `editor/` directory, not `git/`). It is a fully-featured dropdown for listing, creating, switching, and deleting branches with real-time validation, auto-refresh every 10s while open, and keyboard navigation. Branch operations go through `POST /api/git` with `action: list_branches | create_branch | switch_branch | delete_branch`. See the component's own doc comments for its full API.

## Design system

- **Icons**: `@aliimam/icons` exclusively (lucide-react is deprecated across the repo).
- **Colors**: status colors via Tailwind utility classes (emerald = approved/current, amber = changes requested, blue = in review, gray = pending).
- **Shapes**: `rounded-md` / `rounded-sm`, flat (no shadows, no glassmorphism).
- **Avatars**: `@dicebear/core` with the `bottts-neutral` style, or a supplied `avatarUrl`.
