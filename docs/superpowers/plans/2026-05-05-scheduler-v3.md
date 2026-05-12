# Scheduler V3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production slice of Scheduler V3: typed schedule targets, API/MCP/CLI entry points, and dispatcher support for generated tasks and raw executables.

**Architecture:** Keep existing chain schedules compatible. Add a focused target helper module, then thread `target` through schedule storage/API/MCP. The background worker normalizes legacy records and dispatches by target type.

**Tech Stack:** Next.js route handlers, TypeScript, Jest, Node `spawn`, existing task generation and schedule storage modules.

---

### Task 1: Target Helpers

**Files:**
- Create: `web/lib/schedule-targets.ts`
- Test: `web/lib/__tests__/schedule-targets.test.ts`

- [x] **Step 1: Write failing tests**

Run: `npm test -- schedule-targets.test.ts --runInBand`
Expected: fail because `../schedule-targets` does not exist.

- [x] **Step 2: Implement helpers**

Add normalization for legacy chain schedules, validation for target types,
template rendering, and job-group admission.

- [x] **Step 3: Run focused tests**

Run: `npm test -- schedule-targets.test.ts --runInBand`
Expected: pass.

### Task 2: Schedule Types And API

**Files:**
- Modify: `web/lib/types.ts`
- Modify: `web/lib/validators.ts`
- Modify: `web/app/api/schedules/route.ts`

- [x] **Step 1: Extend types**

Add `ScheduleTarget`, `ScheduleTrigger`, and `JobGroup` without breaking legacy
`chainId` consumers.

- [x] **Step 2: Accept target creates**

Allow `POST /api/schedules` bodies with `target` and fill legacy chain fields
for compatibility.

- [x] **Step 3: Accept target patches**

Allow `PATCH /api/schedules` to update `target`, `trigger`, and `jobGroupId`.

### Task 3: Dispatcher Slice

**Files:**
- Create: `web/lib/schedule-dispatcher.ts`
- Modify: `web/lib/scheduler-service.ts`

- [x] **Step 1: Dispatch chain_run**

Move existing chain spawn behavior behind a target dispatcher while preserving
legacy behavior.

- [x] **Step 2: Dispatch raw_exec**

Use `spawn(executable, args, { shell: false })`, timeout, cwd, and success exit
code handling.

- [x] **Step 3: Dispatch generate_tasks**

Call the existing task generation endpoint or shared helper with `autoRun`.

### Task 4: MCP And CLI Surface

**Files:**
- Modify: `lib/mentiko-mcp/tools.ts`
- Modify: `lib/mentiko-mcp/server.ts`
- Create: `lib/mentiko-mcp/handlers/schedules.ts`
- Create: `web/app/api/mentiko-mcp/ops/schedules/route.ts`
- Create: `web/app/api/mentiko-mcp/ops/schedules/run/route.ts`

- [x] **Step 1: Add MCP tools**

Expose `list_schedules`, `create_schedule`, `update_schedule`,
`delete_schedule`, and `run_schedule_now`.

- [x] **Step 2: Add ops routes**

Back tools with user-scoped ops auth and existing schedule storage APIs.

- [x] **Step 3: Add CLI parity**

When the MCP-style CLI dispatcher exists, map the same tool names to schedule
handlers. Until then, document that these commands are available through MCP and
ready for the shared CLI surface.

### Task 5: Verification

**Files:**
- Test: `web/lib/__tests__/schedule-targets.test.ts`

- [x] **Step 1: Run focused tests**

Run: `npm test -- schedule-targets.test.ts --runInBand`
Expected: pass.

- [x] **Step 2: Type-check touched scheduler files**

Run: `npx tsc --noEmit --pretty false`
Expected: no new errors from touched files.

- [x] **Step 3: Inspect diff**

Run: `git diff --check`
Expected: no whitespace errors.

### Task 6: Scheduler UI

**Files:**
- Create: `web/components/schedule/schedule-create-payload.ts`
- Test: `web/components/schedule/__tests__/schedule-create-payload.test.ts`
- Modify: `web/components/schedule/schedule-create-dialog.tsx`
- Modify: `web/app/(workflows)/schedules/page.tsx`

- [x] **Step 1: Add target/trigger payload tests**

Cover generated task schedules, raw executable file triggers, chain compatibility
fields, and argv parsing.

- [x] **Step 2: Expand schedule creation**

Allow the UI to create chain, generated task, raw executable, registered
application, and task-run targets with cron or file triggers and optional job
groups.

- [x] **Step 3: Update list/detail display**

Show target and trigger metadata, route manual runs through `/api/schedules/run`,
and avoid opening the legacy chain editor for non-chain targets.
