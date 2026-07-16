# Schedule System Specification — v2 proposal, NOT IMPLEMENTED

> Status: unbuilt design. This describes a proposed v2 in which schedules point
> at tasks. The shipped system does not work this way and no part of this
> proposal has landed.
>
> What is actually implemented: `lib/schemas/schedule.schema.json` has
> properties `id, chainId, workspaceId, cron, timezone, enabled, goal,
> createdAt, updatedAt`. There is no `taskId` and no embedded `task` — a
> schedule points at a **chain**, not a task, and `web/lib/schedules/
> schedule-storage.ts` has no taskId handling. The `create:` list below names
> three files that were never created (`web/lib/task-generator.ts`,
> `web/app/api/schedules/stats/route.ts`, `web/app/api/schedules/preview/
> route.ts`), and the `delete:` list targets `web/app/api/schedules/next/
> route.ts`, which is still live.
>
> Read this as a proposal. Do not read it as a description of the running
> system.

## overview

proposed: schedules trigger tasks in the native task store which may run chains, agents, or workspace actions.

```
schedule fires
    ↓
create task in task store (if embedded) or load existing task (if taskId ref)
    ↓
create run
    ↓
execute
```

## schema

### Schedule

```typescript
interface Schedule {
  id: string;
  name: string;              // human-readable, e.g. "daily-prod-build"
  description?: string;      // what this schedule does
  workspaceId?: string;      // null = org-scoped, set = workspace-scoped

  // one of these required:
  taskId?: string;           // reference existing task (recurring)
  task?: EmbeddedTask;       // generate task on each run

  cron: string;              // cron expression, e.g. "0 9 * * 1-5"
  timezone: string;          // IANA tz name, e.g. "America/New_York"
  status: ScheduleStatus;
  snoozedUntil?: string | null;  // ISO timestamp, only when status="snoozed"
  retryPolicy?: RetryPolicy;
  createdAt: string;
  updatedAt: string;
  createdBy: string;         // user id
}

type ScheduleStatus = "active" | "disabled" | "paused" | "snoozed";
```

### EmbeddedTask (generated on each run)

```typescript
interface EmbeddedTask {
  title: string;             // base title, timestamp appended at runtime
  description?: string;
  workspace_id: string;      // required - where to run

  // one of these required:
  chain_id?: string;         // run a chain
  agent_id?: string;         // run an agent directly
  // (neither = workspace-only task)

  priority?: number;           // task priority (0-4, 0=highest)
  labels?: string[];
  assignee?: string;
}

interface RetryPolicy {
  maxRetries: number;        // default 0
  backoff: "linear" | "exponential";  // default "exponential"
  baseDelay?: number;        // seconds, default 60
  maxDelay?: number;         // seconds, default 3600
}
```

### ScheduleStats (computed)

```typescript
interface ScheduleStats {
  scheduleId: string;
  lastRun: string | null;
  lastRunStatus: RunStatus;
  lastTaskId: string | null;
  nextRun: string | null;
  avgDuration: number;
  runCount: number;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  conflictDetected: boolean;
  conflictingChains: string[];
}

type RunStatus = "completed" | "failed" | "cancelled" | "running" | "pending";
```

## file structure

### existing files

```
lib/
  scheduler.sh               # bash scheduler (needs rewrite)

web/lib/
  schedule-storage.ts        # read/write schedules
  schedule-utils.ts          # cron parsing, conflicts
  types.ts                   # Schedule interface (line 579)

web/app/api/schedules/
  route.ts                   # GET, POST, PUT, DELETE
  history/route.ts           # GET /history
  next/route.ts              # GET /next
  run/route.ts               # POST /run (manual trigger)

web/components/schedule/
  index.ts
  schedule-editor.tsx
  schedule-history.tsx
  schedule-list.tsx
  schedule-manager.tsx
```

### data directories

```
namespaces/{id}/
  schedules.json             # current: flat array (workspace associations only)

  schedules/                 # current: bash scheduler runtime state
    state.json               # last run timestamps
    history/                 # execution history
      {chainId}.json
    {chainId}.status         # current status
    {chainId}.snooze         # snooze state

  schedules/                 # NEW: org-scoped schedules
    {scheduleId}.json

  schedules/workspaces/      # NEW: workspace-scoped schedules
    {workspaceId}/
      {scheduleId}.json
```

### changes needed

**modify:**
```
web/lib/types.ts
  - update Schedule interface (new schema)
  - add EmbeddedTask interface
  - add ScheduleStats interface

web/lib/schedules/schedule-storage.ts
  - update for new file structure
  - add getScheduleStats()
  - add listSchedulesByWorkspace()

web/lib/schedules/schedule-utils.ts
  - update calculateNextRun()
  - add generateTaskTitle()
  - update detectConflicts()

web/app/api/schedules/route.ts
  - update GET to return {schedule, stats, nextTask}
  - update POST to accept taskId OR task
  - update PUT for new fields
  - add validation (taskId XOR task required)

web/components/schedule/*
  - update for new schema
  - add taskId vs task selection
  - add next task preview display
```

**create:**
```
web/lib/task-generator.ts
  - generateTaskTitle(baseTitle, scheduledFor)
  - createTaskFromSchedule(schedule, scheduledFor)

web/app/api/schedules/stats/route.ts
  - GET /:id/stats

web/app/api/schedules/preview/route.ts
  - GET /:id/preview (next N runs)
```

**delete:**
```
web/app/api/schedules/next/route.ts   # replaced by /:id/preview
```

## scheduler.sh changes

**current flow:**
```
1. scan chains/ dir for chain.json files
2. read config.schedule from each
3. check if time to run
4. execute chain
5. update state files
```

**new flow:**
```
1. scan schedules/*.json and schedules/workspaces/*/*.json
2. read schedule files
3. check if time to run (status=active, not snoozed)
4. if taskId: load task from task store
   if task: create task in task store (generate title with timestamp)
5. create run
6. execute (chain/agent/workspace action based on task)
7. update stats
```

## storage format

### example: chain-based schedule (embedded task)

```json
{
  "id": "sched_001",
  "name": "daily email summary",
  "description": "summarize critical emails every weekday morning",
  "workspaceId": null,
  "task": {
    "title": "daily email summary",
    "description": "find and summarize critical emails from last 24h",
    "workspace_id": "mentiko",
    "chain_id": "email-summarizer"
  },
  "cron": "0 9 * * 1-5",
  "timezone": "America/New_York",
  "status": "active",
  "createdAt": "2026-03-01T10:00:00Z",
  "updatedAt": "2026-03-01T10:00:00Z",
  "createdBy": "user_123"
}
```

### example: agent-based schedule (embedded task)

```json
{
  "id": "sched_002",
  "name": "hourly security scan",
  "workspaceId": "prod-workspace",
  "task": {
    "title": "security scan",
    "description": "scan workspace for security issues",
    "workspace_id": "prod-workspace",
    "agent_id": "security-scanner",
    "priority": 0
  },
  "cron": "0 * * * *",
  "timezone": "UTC",
  "status": "active"
}
```

### example: existing task reference

```json
{
  "id": "sched_003",
  "name": "weekly retro",
  "taskId": "mentiko-task-111",
  "cron": "0 16 * * 5",
  "timezone": "America/Los_Angeles",
  "status": "active"
}
```

## execution flow

### when schedule fires:

**mode 1: taskId exists** (reference existing task)
```
1. load task from task store
2. create run with existing taskId
3. execute
```

**mode 2: task exists** (embedded)
```
1. generate task title: "{title} {YYYY-MM-DD} {HH:mm}"
2. create task in task store with generated title
3. create run with new taskId
4. execute
```

### end-to-end example

```
SCHEDULE FIRES (2026-03-05 09:00 EST):
{
  "id": "sched_001",
  "task": {
    "title": "daily email summary",
    "workspace_id": "mentiko",
    "chain_id": "email-summarizer"
  },
  "cron": "0 9 * * 1-5"
}

↓ CREATES TASK in task store:

{
  "id": "mentiko-task-456",
  "title": "daily email summary 2026-03-05 09:00",
  "description": "find and summarize critical emails from last 24h",
  "status": "in_progress",
  "priority": 2,
  "chainBinding": {
    "chain_id": "email-summarizer",
    "auto_run": true
  },
  "createdAt": "2026-03-05T09:00:00Z",
  "createdBy": "scheduler"
}

↓ CREATES RUN:

{
  "id": "run_abc123",
  "taskId": "mentiko-task-456",
  "chainId": "email-summarizer",
  "workspaceId": "mentiko",
  "scheduleId": "sched_001",
  "status": "running",
  "startedAt": "2026-03-05T09:00:00Z"
}

↓ EXECUTES CHAIN

↓ COMPLETES:
  Task status -> "completed"
  Run status -> "completed"
```

## api

### GET /api/schedules

response:
```typescript
interface SchedulesListResponse {
  schedules: Array<{
    schedule: Schedule;
    stats: ScheduleStats;
    nextTask?: {
      title: string;
      scheduledFor: string;
    };
  }>;
}
```

### POST /api/schedules

request:
```typescript
interface ScheduleCreateRequest {
  name: string;
  description?: string;
  workspaceId?: string;

  taskId?: string;
  task?: EmbeddedTask;

  cron: string;
  timezone: string;
  retryPolicy?: Partial<RetryPolicy>;
}
```

validation: exactly one of `taskId` or `task` must be provided.

### PUT /api/schedules/:id

### DELETE /api/schedules/:id

### GET /api/schedules/:id/stats

response: `ScheduleStats`

### GET /api/schedules/:id/preview

response:
```typescript
interface SchedulePreviewResponse {
  scheduleId: string;
  nextRuns: Array<{
    scheduledFor: string;
    taskTitle: string;
  }>;
}
```

## implementation

### task title generation

```typescript
function generateTaskTitle(baseTitle: string, scheduledFor: Date): string {
  const date = scheduledFor.toISOString();
  const [datePart, timePart] = date.split('T');
  const time = timePart.slice(0, 5);
  return `${baseTitle} ${datePart} ${time}`;
}
```

### next run calculation

```typescript
import { parseExpression } from 'cron-parser';

function getNextRun(cron: string, timezone: string): string {
  const interval = parseExpression(cron, { tz: timezone });
  return interval.next().toISOString();
}
```

### conflict detection

check if two schedules' next runs overlap within avgDuration window:
```typescript
function detectConflicts(
  scheduleId: string,
  allSchedules: Schedule[]
): string[] {
  const conflicting: string[] = [];
  const schedule = getSchedule(scheduleId);
  const nextRun = getNextRun(schedule.cron, schedule.timezone);

  for (const other of allSchedules) {
    if (other.id === scheduleId) continue;

    const otherNext = getNextRun(other.cron, other.timezone);
    const overlap = checkOverlap(nextRun, otherNext, avgDuration);
    if (overlap) conflicting.push(other.name);
  }

  return conflicting;
}
```

### stats computation

aggregate from runs data:
```typescript
function computeScheduleStats(scheduleId: string): ScheduleStats {
  const runs = listRuns()
    .filter(r => r.scheduleId === scheduleId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  const lastRun = runs[0] || null;
  const successCount = runs.filter(r => r.status === "completed").length;
  const failureCount = runs.filter(r => r.status === "failed").length;

  let consecutiveFailures = 0;
  for (const run of runs) {
    if (run.status === "failed") consecutiveFailures++;
    else break;
  }

  return {
    scheduleId,
    lastRun: lastRun?.startedAt || null,
    lastRunStatus: lastRun?.status || "pending",
    lastTaskId: lastRun?.taskId || null,
    nextRun: getNextRun(schedule.cron, schedule.timezone),
    avgDuration: calculateAvg(runs),
    runCount: runs.length,
    successCount,
    failureCount,
    consecutiveFailures,
    conflictDetected: detectConflicts(scheduleId).length > 0,
    conflictingChains: detectConflicts(scheduleId),
  };
}
```

## retry policy

when a run fails:
1. check if retryPolicy exists
2. if retryCount < maxRetries:
   - calculate delay (baseDelay * 2^retryCount for exponential)
   - schedule retry after delay
   - increment retryCount
3. else:
   - mark run as failed
   - notify (if configured)

## testing

### unit tests
- generateTaskTitle() format
- getNextRun() cron parsing
- conflict detection logic
- stats aggregation
- retry delay calculation
- validation (taskId XOR task)

### integration tests
- create schedule (embedded task)
- create schedule (taskId ref)
- schedule fires -> task created -> run created
- retry on failure
- snooze/resume
- conflict detection

### e2e tests
- create schedule via ui
- verify task created at scheduled time
- verify task has correct title format
- verify run linked to task
- verify stats update
- verify preview shows correct next runs

## open questions

1. **notifications** - how to notify on failures?
2. **conflict window** - use avgDuration or fixed minutes?
3. **stats persistence** - compute on demand or cache?
4. **workspace permissions** - can user A schedule in user B's workspace?
5. **concurrent execution** - what if previous run hasn't finished?
6. **manual trigger** - allow running schedule on-demand via /run endpoint?
7. **schedule ownership** - transfer ownership when user leaves org?
