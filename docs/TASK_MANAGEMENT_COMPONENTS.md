# Task Management Components

comprehensive task management system built on react, typescript, and sqlite.
19 components provide full-featured task tracking with dependencies, chain integration, ai-powered generation, and visualization.

---

## architecture overview

data layer:
  - web/lib/task-store.ts       native sqlite CRUD (replaced legacy external task system)
  - web/lib/task-store-types.ts type definitions for tasks, comments, activity
  - web/lib/task-transforms.ts  utility functions (mapPriority, timeAgo, etc)

component organization:
  - dialogs: create, edit, generate, dependency picker
  - display: list items, tree view, overview board, detail panel
  - chain integration: assign workflow, agent pipeline, preview card
  - specialized: filters, badges, headers, activity, comments

---

## component catalog

### core dialogs

**task-create-dialog.tsx** (241 lines)
  - modal form for creating new tasks
  - fields: title, description, type (task/feature/bug/chore/epic), priority (P0-P4)
  - optional: parent epic selection, chain assignment with auto-run checkbox
  - fetches available chains via /api/chains/list
  - passes created data back via onCreate callback

**task-edit-dialog.tsx** (251 lines)
  - edit existing task fields
  - editable: title, description, priority, assignee, acceptance criteria
  - chain assignment dropdown with auto-run toggle
  - only submits changed fields (diffs against original task values)

**task-generate-dialog.tsx** (480 lines)
  - ai-powered task generation with two-step workflow
  - step 1: describe -> calls /api/tasks/generate -> polls job status
  - step 2: preview -> shows generated epic + subtasks with deps
  - creates main task + subtasks sequentially with progress bar
  - wires up dependencies between generated subtasks
  - supports epic parent selection, handles partial failures gracefully

**task-dep-picker-dialog.tsx** (144 lines)
  - searchable dialog for adding task dependencies
  - filters: excludes current task, existing deps, closed tasks
  - sorts by priority then title
  - renders type badge, priority badge, truncated id per task

### display components

**task-list-item.tsx** (157 lines)
  - single task row in sidebar list view
  - visual indicators: status dot, chain link, dependency counts, auto-run badge
  - recent run highlighting (last 5 min) with link to run
  - supports selection mode with checkbox for bulk operations

**task-tree-view.tsx** (669 lines)
  - hierarchical tree of tasks grouped by epic
  - drag-drop dependency creation between tasks
  - collapsible epics with progress bars (closed/total)
  - shows hide toggle for completed tasks
  - dependency indicators: blocked-by (red arrow up), blocks (amber arrow down)
  - stats header: open count, closed count, dep count

**task-overview.tsx** (537 lines)
  - kanban-style board with epic columns
  - toolbar: priority filter (All/P0/P0-P1/P2+), compact toggle, hide completed
  - epic column cards show progress bar, task count, closed/total
  - cross-column dependency visualization (small "needs [id]" tags)
  - visual connectors between sequential tasks within columns
  - ready tasks highlighted with green ring (no blockers)

**task-detail.tsx** (175 lines)
  - main detail panel composed of sub-components
  - sections: header, chain, description, acceptance/design/notes (collapsible), subtasks, deps graph, comments, activity
  - renders TaskDetailHeader, TaskChainSection, TaskChildren, TaskDepsGraph, TaskComments, TaskActivity

**task-detail-header.tsx** (316 lines)
  - top section of detail panel
  - copy-to-clipboard task id with feedback
  - metadata grid: owner, assignee, created by, dates, parent link, labels, chain link
  - stats: blocking count, dependents count, comments count, estimate
  - action buttons: edit, run chain, close/reopen
  - decision link badge if task.metadata.decision_id exists

**task-children.tsx** (94 lines)
  - lists subtasks of current task
  - renders per child: status dot, title, description (truncated), meta row (id, run status, badges), stats row
  - click handler to navigate to child task

### chain integration

**chain-assign-workflow.tsx** (1197 lines)
  - multi-step ai-powered chain recommendation workflow
  - steps: idle -> checking_job -> analyzing -> recommendation -> generating -> generated -> error -> stale
  - analyzes task context via /api/jobs (type: recommend)
  - shows recommendation (use existing vs generate new) with alternatives list
  - generation with tweak input, json inspector, save & assign
  - auto-saves generated chains to disk with retry logic (3 attempts)
  - handles stale jobs (expired/404) with reset option
  - manual picker fallback to list all chains

**chain-agent-pipeline.tsx** (229 lines)
  - visualizes agents in a chain with per-agent status
  - fetches chain definition and last run data
  - shows: agent name, role, triggers, emits, model, timeout, description
  - per-agent status badge: complete (green), running (blue), failed (red), pending (gray)
  - run timing: started/completed timestamps

**chain-preview-card.tsx** (35 lines)
  - compact card showing chain summary
  - displays: name, description (truncated), agent pipeline (arrow-separated), agent count
  - used in recommendations and generated previews

**task-chain-section.tsx** (302 lines)
  - embedded in task detail panel
  - unassigned: show assign button or chain assign workflow
  - generation job tracking with status indicator and spinner
  - assigned view: chain name link, last run status, run button, auto-run toggle
  - links to all runs view and specific run detail
  - embeds ChainAgentPipeline for agent visualization

### dependencies

**task-deps-graph.tsx** (348 lines)
  - two-mode dependency visualization: chain view (vertical) or list view
  - chain view: shows 2 blocking tasks above, 2 blocked tasks below, current task centered
  - list view: separate "blocked by" and "blocks" sections with add button
  - integrates TaskDepPickerDialog for adding dependencies
  - fetches dep graph via /api/tasks/{id}/deps?format=graph

### specialized components

**task-filters.tsx** (136 lines)
  - sidebar control bar using gaia ui components
  - elements: search input, status segmented control, type segmented control, count display
  - bulk operations: select mode toggle, bulk close, bulk delete buttons
  - sort dropdown: priority/updated/created/title

**type-badge.tsx** (22 lines)
  - colored badge for task type (task/feature/bug/chore/epic)
  - uses typeBgColor from task-transforms for background color

**priority-badge.tsx** (30 lines)
  - colored badge for priority (P0-P4)
  - uses priorityBgColor from task-transforms
  - displays raw number if provided

**epic-group-header.tsx** (37 lines)
  - collapsible epic section header in list view
  - dot color indicates progress: amber (none started), sky (in progress), emerald (all done)
  - shows meta: "closed/total done"
  - wraps gaia WorkflowSidebarSectionHeader

**task-activity.tsx** (76 lines)
  - activity log for task (last 7 days)
  - expands to show activity entries with symbol, message, timestamp
  - fetches from /api/tasks/activity?since=7d, filters by task id

**task-comments.tsx** (76 lines)
  - comment thread with add input
  - displays: author, timestamp, text (whitespace-preserved)
  - enter key submits, send button with disabled state

---

## type system

key types from web/lib/task-store-types.ts:
  - task: id, title, description, type, priority (0-4), status, owner, assignee, parentId
  - chainBinding: chain_id, chain_name, auto_run, last_run_id, last_run_status, analysis/generation jobs
  - comment: id, issue_id, text, author, created_at
  - activity: issue_id, symbol, message, timestamp

issue types: epic, feature, task, bug, chore
priorities: 0 (critical) to 4 (none), displayed as P0-P4
statuses: open, in_progress, closed

---

## data flow

task creation:
  1. TaskCreateDialog collects form data
  2. calls onCreate callback (from parent)
  3. parent POSTs to /api/tasks
  4. task-store.ts inserts row into sqlite
  5. parent refreshes task list

dependency management:
  1. task-deps-graph fetches /api/tasks/{id}/deps?format=graph
  2. returns nodes + links representation
  3. drag-drop or picker dialog calls /api/tasks/deps POST
  4. task-store.ts inserts dep row (from_task, to_task)

chain assignment workflow:
  1. user clicks "assign chain" -> opens ChainAssignWorkflow
  2. idle state -> click "analyze task" -> POST /api/jobs (type: recommend)
  3. job runs async, workflow polls via useJobStatus hook
  4. on complete -> recommendation state with action + alternatives
  5. if action=generate_new -> click generate -> POST /api/jobs (type: generate)
  6. on complete -> generated state, auto-saves chain via /api/chains/save
  7. user clicks "assign to task" -> PATCH /api/tasks/{id} with chainId

ai task generation:
  1. user enters prompt in TaskGenerateDialog
  2. POST /api/tasks/generate -> returns jobId
  3. poll /api/jobs/{jobId} until complete/failed
  4. result contains epic + subtasks array with depends_on indices
  5. sequential create: main task first, then each subtask with parent=epicId
  6. wire deps: POST /api/tasks/deps for each depends_on relationship
  7. progress bar shows "creating x of y"

---

## hooks and utilities

useJobStatus (web/hooks/use-job-status.ts):
  - tracks job status via SSE or polling
  - returns { job, setJob } with status, result, error, activity

mapPriority (web/lib/task-transforms.ts):
  - converts raw priority number to TaskPriority enum
  - 0->critical, 1->high, 2->medium, 3->low, 4->none

timeAgo (web/lib/task-transforms.ts):
  - human-readable relative time: "5m ago", "2h ago", "3d ago"

priorityBgColor / typeBgColor:
  - returns tailwind classes for badge backgrounds
  - priority: red (P0), orange (P1), yellow (P2), blue (P3), gray (P4)
  - type: green (feature), blue (task), red (bug), gray (chore), purple (epic)

---

## api integration

task api routes (web/app/api/tasks/):
  - GET  /api/tasks/list              - list with filters (status, type, search)
  - GET  /api/tasks/[id]             - get single task with deps + comments
  - GET  /api/tasks/[id]/deps        - get dependencies (graph or list format)
  - POST /api/tasks                  - create new task
  - POST /api/tasks/deps             - add dependency between tasks
  - POST /api/tasks/generate         - ai generation (returns job id)
  - GET  /api/tasks/activity         - activity log (since query param)
  - GET  /api/tasks/graph            - full graph (nodes, deps, links) for visualizations

chain api routes (integrated):
  - GET  /api/chains/list            - list all chains
  - GET  /api/chains/[id]            - get chain with expanded agents
  - POST /api/chains/save            - save chain to disk (returns chain id)
  - GET  /api/jobs/[id]              - job status polling
  - POST /api/jobs                   - create job (analyze or generate)
  - DELETE /api/jobs/[id]            - delete stale job

---

## patterns and conventions

namespace-aware fetch:
  - all api calls use useNamespaceFetch hook
  - automatically injects org context into requests

optimistic updates:
  - chain metadata updated via onMetadataUpdate callback
  - parent component patches task.chainBinding, triggers re-render

error boundaries:
  - fetch errors caught with try/catch, displayed as inline error messages
  - stale job detection (pending >5min) shows amber warning with retry button

loading states:
  - WaveSpinner component for async operations
  - "generating..." with rotating icon during long-running jobs

bulk operations:
  - select mode toggles checkbox on each task list item
  - bulk close/delete operates on selected set
  - deselect after operation completes

---

## dependency resolution

blocked/blocks calculation:
  - build map from deps array: blockedBy.set(to, [from...])
  - build map from deps array: blocks.set(from, [to...])
  - lookup by task id for display

epic grouping:
  - find root epic via parent_id links or legacy dot-notation hierarchy
  - walk up parent chain until epic found or root reached
  - fallback to dot-notation: "mentiko-2eb.18.1" -> check "mentiko-2eb.18", "mentiko-2eb"

ready task detection:
  - blockedBy.length === 0 && status !== "closed"
  - highlighted with green ring in overview board

---

## sqlite schema

tasks table:
  - id (text primary key) - short-uuid or dot-notation
  - title, description, type, priority (int), status
  - owner, assignee, created_by (text)
  - parent_id (fk -> tasks.id)
  - created_at, updated_at, closed_at (timestamps)
  - chain_binding (json) - chain_id, chain_name, auto_run, last_run_id, last_run_status, analysis/generation job ids
  - metadata (json) - decision_id, custom fields
  - labels (json array), due_date, estimate (int)

task_dependencies table:
  - id (int pk)
  - from_task_id (fk -> tasks.id) - the blocker
  - to_task_id (fk -> tasks.id) - the blocked
  - created_at timestamp

task_comments table:
  - id (int pk)
  - issue_id (fk -> tasks.id)
  - text, author, created_at

---

## integration with other systems

decision flow:
  - tasks created from decision approval link back via metadata.decision_id
  - task detail header shows "decision" badge linking to decision detail

chains:
  - chainBinding stores relationship + run state
  - auto-run: when deps resolve, chain executes automatically via scheduler
  - last_run_id links to run detail for live terminal view

workspace context:
  - all components consume workspace from useWorkspace hook
  - api calls include workspace query param for scoping

runs:
  - last_run_status: running (blue), complete (green), failed (red), pending (amber)
  - click "run chain" -> POST /api/chains/run -> updates last_run_id

---

## future extensions

planned enhancements (not yet implemented):
  - task templates (preset structures for common task types)
  - recurring tasks (cron-based task creation)
  - task attachments (file references, screenshots)
  - time tracking (actual vs estimate)
  - sprint/milestone grouping (beyond epic hierarchy)
  - task cloning with dep remapping
  - drag-drop in overview board to change priority/epic
