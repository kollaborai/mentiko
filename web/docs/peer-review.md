# Peer Review

Peer review in Mentiko lets team members review Git changes before they are committed. A review is created from the Git panel's review tab, reviewers are assigned from org members, each reviewer leaves file- and line-anchored comments and moves their assignment to `approved`, and the commit button stays gated until every assigned reviewer has approved.

All review routes are org-scoped via `getOrgIdFromRequest` and authorize through `requirePermission` (session-derived). The reviewer identity recorded on an assignment or comment comes from the session user — it is not read from a spoofable request header or body field.

## How the pieces fit together

```
Git panel (web/components/editor/git-panel.tsx)          editor pane
├── review tab  ── ReviewPanelSection                     └── "Peer Review" tab
│                   └── "Assign Reviewers" ──openView──────────→ PeerReviewView
│                                                                  └── POST /api/reviews  (creates review + assignments)
│                                                                  └── notifyReviewsChanged() → git panel refreshes tracker
└── commit area ── ReviewApprovalGate  (disabled until every assignment is `approved`)
                    └── calls the panel's onCommit (the normal git commit path)

Standalone building blocks (not rendered by the git panel directly):
  ReviewStatusTracker   — per-reviewer status selector + aggregate badge
  ReviewCommentThread   — file/line-anchored threaded comments
  ReviewChecklist       — pass/fail criteria display
  ReviewAssignmentPanel — lower-level reviewer picker (no review creation)
```

The assignment UI is a **full editor tab** (`PeerReviewView`), not a modal. The Git panel renders inside the floating code editor (`floating-code-pill.tsx`), a `fixed` overlay at `z-12000` with a click-outside-to-close handler; a Radix `Dialog` portals to `document.body` at `z-50`, so it rendered *behind* the pill and the click-outside handler dismissed the whole editor when the dialog was clicked. An editor tab lives in the editor's own stacking context, avoiding both. The tab is opened via `useEditorStore().openView` and rendered by `EditorPane` from `FileData.view`.

## ReviewPanelSection — review tab entry point

Renders in the Git panel's review tab (`activeView === "review"`). Shows the currently selected files, an "Assign Reviewers" button that opens the `PeerReviewView` editor tab, and a list of existing reviews with status badges and progress bars.

**Props**

| Prop | Type | Description |
|------|------|-------------|
| `selectedFiles` | `string[]` | Files currently selected in the Git panel. |
| `workspacePath` | `string` | Absolute workspace path. |
| `sourceBranch` | `string` | Currently checked-out branch (becomes the review's source branch). |
| `existingReviews` | `ReviewSummary[]` | Optional list of prior reviews to display. |

## PeerReviewView — creates reviews

Opened by `ReviewPanelSection` as an editor tab. Fetches reviewer candidates from `/api/orgs` then `/api/orgs/[id]/members`, lets the user pick reviewers and add review criteria, then POSTs to `/api/reviews`:

```json
{
  "workspacePath": "/abs/repo",
  "selectedFiles": ["src/auth.ts"],
  "assignment": {
    "title": "Fix auth refresh",
    "description": "...",
    "reviewers": ["user-id-1"],
    "source_branch": "feature/x",
    "target_branch": "main",
    "checklist": [{ "title": "Check token expiry", "required": true, "completed": false }],
    "due_date": "2026-07-15"
  }
}
```

The server creates the review plus one `pending` assignment per reviewer. Selected files currently ride along as a label on the review.

**Props**

| Prop | Type | Description |
|------|------|-------------|
| `selectedFiles` | `string[]` | Files under review. |
| `workspacePath` | `string` | Absolute workspace path. |
| `sourceBranch` | `string` | Currently checked-out branch (the branch under review). |
| `onClose` | `() => void` | Closes the tab (Cancel or after a successful create). |
| `onReviewCreated` | `(reviewId: string) => void` | Fired with the new review id. |

## ReviewStatusTracker — shows and updates reviewer status

Per-reviewer row with avatar, name, and a status selector. Shows an aggregate badge (`X of Y approved`). Fires a fire-and-forget POST to `/api/notifications` on `approved` and `changes_requested` transitions.

**Props**

| Prop | Type | Description |
|------|------|-------------|
| `reviewers` | `ReviewerStatus[]` | `{ reviewerId, name, avatarUrl?, status, updatedAt }`. |
| `onStatusChange` | `(reviewerId, newStatus) => void` | Called when a reviewer's status changes. The caller is responsible for PATCHing the assignment. |
| `readOnly` | `boolean` | When `true`, shows static badges instead of selectors. |

The selector exposes four visual states, but the server only accepts three for an assignment (see status table below). `in_review` exists only as a frontend display state — PATCHing it to the API returns 400.

## ReviewCommentThread — file/line comments

Threaded comments anchored to a file, optionally a line number. Markdown-rendered, Cmd+Enter to submit, per-comment resolve. Threads with more than three comments collapse the older ones behind a "Show N earlier comments" toggle.

**Props**

| Prop | Type | Description |
|------|------|-------------|
| `filePath` | `string` | File the thread is anchored to. |
| `lineNumber` | `number \| null` | Line number, or `null` for file-level. |
| `comments` | `ReviewComment[]` | Existing comments. |
| `onAddComment` | `(body: string) => Promise<void>` | Submit a new comment. |
| `onResolveComment` | `(commentId: string) => Promise<void>` | Resolve a comment. |
| `aiSummary` | `string` | Optional caller-supplied summary string shown in an amber banner. The component only renders what is passed in — it does not generate anything itself. |

## ReviewApprovalGate — commit button gate

Wraps the commit button in the Git panel's commit area. The button is disabled unless every assigned reviewer has status `approved` (or there are no reviewers assigned at all). When enabled, a click calls the parent's `onCommit` — the same commit handler the Git panel uses outside of review. The gate does not perform its own commit HTTP call.

**Props**

| Prop | Type | Description |
|------|------|-------------|
| `reviewers` | `ReviewerStatus[]` | Same reviewer array used by the tracker. |
| `onCommit` | `() => Promise<void>` | Commit action (delegated to the Git panel). |
| `baseDisabled` | `boolean` | Extra disable condition from the parent (busy, no staged files, empty message). |

**Gate logic**

- `reviewers` empty → open, acts as a normal commit button.
- Any reviewer not `approved` → disabled, with an `aria-label`/tooltip explaining "Waiting for all reviewers to approve".
- All `approved` → active.

## Assignment status values

These are the values the server accepts on `PATCH /api/reviews/[id]/assignments/[assignmentId]` (the `ASSIGNMENT_STATUSES` constant in `web/lib/reviews/review-store-types.ts`):

| Value | Meaning |
|-------|---------|
| `pending` | Reviewer has not acted yet (initial state when the assignment is created). |
| `approved` | Reviewer approved the changes. |
| `changes_requested` | Reviewer asked for modifications. |

The frontend `ReviewStatus` type (`review-status-badge.tsx`) additionally renders an `in_review` visual state. That value is display-only — it is not accepted by the assignment PATCH endpoint.

A review itself has a separate lifecycle (`pending | in_progress | completed | cancelled`), distinct from per-reviewer assignment status.

## API routes

All routes are org-scoped and session-authorized via `requirePermission`. Read access requires `view_chains`; create/update/delete requires `manage_chains`.

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/reviews` | Create a review with one `pending` assignment per reviewer. |
| `GET` | `/api/reviews` | List reviews (filter by `status`, `reviewer_id`, `created_by`, `workspacePath`). |
| `GET` | `/api/reviews/[id]` | Get a review with its assignments and comments. |
| `PATCH` | `/api/reviews/[id]` | Update review fields (title, description, status, due_date, labels, checklist, priority). |
| `DELETE` | `/api/reviews/[id]` | Delete a review. |
| `GET` | `/api/reviews/[id]/assignments` | List assignments for a review. |
| `POST` | `/api/reviews/[id]/assignments` | Add a reviewer (`reviewer_id` in body). |
| `PATCH` | `/api/reviews/[id]/assignments/[assignmentId]` | Set a reviewer's status (`{ status }` ∈ `pending \| approved \| changes_requested`). |
| `DELETE` | `/api/reviews/[id]/assignments/[assignmentId]` | Remove a reviewer. |
| `GET` | `/api/reviews/[id]/comments` | List comments for a review. |
| `POST` | `/api/reviews/[id]/comments` | Add a comment (`file_path`, `line_number?`, `comment`). Author is the session user. |
| `PATCH` | `/api/reviews/[id]/comments/[commentId]` | Update body or resolve (`{ comment? }` or `{ resolved: true }`). |
| `DELETE` | `/api/reviews/[id]/comments/[commentId]` | Delete a comment. |

## Data persistence

Reviews are stored in a per-namespace SQLite database at `~/.mentiko/namespaces/{id}/data/reviews.db`. Tables: `reviews`, `review_assignments`, `review_comments`. The schema is auto-created on first use.

## Related

- [Code Editor](/code) — where the Git panel and review components appear
