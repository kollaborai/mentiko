# Task Outcome Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace task outcome option panels with one dashboard backed by task-run AI summary metadata and fresh selected-task provenance.

**Architecture:** Add a `task_run_summary` job type that reuses the core run-summary generation chain with a task-specific prompt. Persist the result into task metadata and render it through a single borderless task outcome dashboard. Refresh selected task detail independently so the dashboard cannot stay stuck on an older run.

**Tech Stack:** Next.js API routes, React task components, SQLite task metadata, Mentiko generation jobs, Jest focused tests, in-app browser verification.

---

### Task 1: Task-Run Summary Plumbing

**Files:**
- Modify: `web/lib/runs/job-store.ts`
- Modify: `web/lib/generation/generation-template-storage.ts`
- Modify: `web/lib/generation/generation-core-chains.ts`
- Modify: `web/app/api/jobs/[id]/complete/route.ts`
- Create: `web/app/api/tasks/[id]/outcome-summary/route.ts`

- [ ] Add `task_run_summary` as a job type.
- [ ] Add a task-run summary template that outputs grounded JSON.
- [ ] Add an API route that creates the summary job from a task and its current run metadata.
- [ ] Persist completed summary jobs into task metadata.

### Task 2: Dashboard UI

**Files:**
- Replace: `web/components/task/task-run-story-panels.tsx`
- Modify: `web/components/task/task-detail.tsx`

- [ ] Rename the rendered concept from five options to one outcome dashboard.
- [ ] Prefer AI summary when it matches `last_run_id`.
- [ ] Fall back to deterministic `last_run_summary`.
- [ ] Show widgets for outcome, journey, evidence, agents, improvement signals, and receipt.
- [ ] Trigger summary generation when a completed selected task has no current AI summary.

### Task 3: Stale Selected Task Fix

**Files:**
- Modify: `web/app/tasks/page.tsx`

- [ ] Add a direct selected-task refresh function.
- [ ] Use it when refreshing periodically and after summary generation.
- [ ] Merge refreshed selected task into the list row and detail pane.

### Task 4: Verification

**Files:**
- Modify: focused tests as needed.

- [ ] Run focused unit tests for task transforms, generation templates, jobs completion, and task detail UI.
- [ ] Run `git diff --check`.
- [ ] Verify `/tasks?task=TASK-070` in the browser shows one dashboard and the final run id.
