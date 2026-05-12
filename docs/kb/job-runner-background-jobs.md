---
title: Job Runner & Background Jobs
type: component
tags: [job-runner, background-jobs, auto-run, agent-profiles, cli-pipe]
related: [task-store, agent-profiles, decision-flow, generation-templates]
---

## Overview

The job runner system enables long-running AI operations to execute outside the HTTP request lifecycle. When an API route needs to run an AI prompt (chain recommendation, generation, decision research), it spawns a detached `job-runner.mjs` process that survives the API response.

Key components:
- **lib/job-runner.mjs** - Detached process that reads job files, runs CLI prompts, writes results
- **web/lib/job-store.ts** - Filesystem-backed job storage with atomic writes
- **web/app/api/jobs/** - Job CRUD and completion callback endpoints
- **web/hooks/use-job-status.ts** - React hook for polling/SSE job status
- **web/lib/auto-run.ts** - Auto-run candidate detection
- **web/lib/auto-run-service.ts** - Background worker that polls for auto-ready tasks

## Job Lifecycle

```
1. API route (POST /api/jobs)
   ├─ createJob(type, input, taskId)
   ├─ spawn job-runner.mjs detached (child.unref())
   └─ return { jobId } immediately

2. job-runner.mjs (detached)
   ├─ read job file, mark status: "running"
   ├─ resolve agent profile (CLI binary, args, env vars)
   ├─ decrypt {secret:NAME} references from vault
   ├─ spawn claude CLI with stdin (no shell escaping)
   ├─ capture stdout/stderr
   ├─ validate JSON result by type
   ├─ mark status: "complete" or "failed"
   └─ POST /api/jobs/[id]/complete (callback)

3. Frontend (useJobStatus hook)
   ├─ open SSE connection to /api/events/stream?job-id=X
   ├─ fallback to polling if SSE fails twice
   └─ update UI when job reaches terminal state
```

## Key Interfaces

### Job Type (job-store.ts)

```typescript
type JobType =
  | "recommend"           // chain recommendation from task
  | "generate"            // chain generation from prompt
  | "link"                // agent link generation
  | "decision_research"   // decision context research
  | "decision_guided_questions"  // guided flow round 1
  | "decision_guided_options"    // guided flow round 2
  | "decision_guided_plan"       // guided flow round 3
  | "decision_retrospective"
  | "template_test"
  | ...;

type JobStatus = "pending" | "running" | "complete" | "failed";

interface Job {
  id: string;              // job-{timestamp}-{random}
  type: JobType;
  status: JobStatus;
  taskId?: string;         // linked task for metadata updates
  decisionId?: string;     // linked decision
  input: Record<string, unknown>;  // includes resolved prompt
  result?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}
```

### Job Store API

```typescript
createJob(type, input, taskId?, decisionId?): Job
getJob(id): Job | null
updateJob(id, updates): void
listJobs({ taskId?, status?, since? }): Job[]
deleteJob(id): boolean
cleanupOldJobs(maxAgeMs): number  // deletes jobs older than maxAgeMs
```

## How It Works

### 1. Job Creation (web/app/api/jobs/route.ts)

POST /api/jobs creates a new background job:

1. Lazy cleanup: deletes jobs older than 24h
2. For `recommend` jobs: builds chain catalog from filesystem
3. Resolves generation template (stored in `input.prompt`)
4. Creates job file via `createJob()`
5. Persists `jobId` to task metadata (analysis_job_id or generation_job_id)
6. Spawns `job-runner.mjs` detached:
   ```typescript
   spawn(process.execPath, [runnerPath, jobId], {
     detached: true,
     stdio: ["ignore", "ignore", "ignore"],
     env: { ...process.env, JOB_CALLBACK_URL, ... }
   });
   child.unref(); // parent doesn't wait for child
   ```
7. Returns `{ jobId }` immediately (HTTP response closes)

### 2. Job Runner Execution (lib/job-runner.mjs)

The detached process:

1. Reads job file from `JOBS_DIR/{id}.json`
2. Updates status to "running" (atomic write via .tmp + rename)
3. Resolves default agent profile from `AGENT_PROFILES_DIR/`:
   - Finds profile with `isDefault: true`
   - Extracts `cli`, `pipe_flag`, `model`, `extra_args`, `env`
   - Resolves `{secret:NAME}` references to actual values
4. Removes `CLAUDECODE` env var (so CLI doesn't refuse nested sessions)
5. Spawns CLI binary with stdin pipe:
   ```javascript
   spawn(resolvedCli, resolvedArgs, {
     stdio: ["pipe", "pipe", "pipe"],
     timeout: 480000,  // 8 minutes
     env: childEnv
   });
   ```
6. Writes prompt to stdin (avoids shell escaping bugs)
7. Captures stdout/stderr
8. Validates JSON result based on job type:
   - `recommend`: must have `recommendation` field
   - `generate`: must have `name` field
   - `decision_guided_questions`: 5-8 questions expected
   - etc.
9. Writes result back to job file (atomic)
10. Calls callback: POST /api/jobs/[id]/complete
11. Exits with code 0 (success) or 1 (failure)

### 3. Completion Callback (web/app/api/jobs/[id]/complete/route.ts)

Internal endpoint called by job-runner:

1. Auth: requires `BETTER_AUTH_SECRET` or localhost
2. Updates job status in job-store
3. **Chain post-processing** (type=generate):
   - Extracts inline agents from generated chain
   - Writes them to agent registry
   - Rewrites chain with `$ref` references
4. Updates task metadata if `job.taskId` exists:
   - Sets `analysis_status` or `generation_status`
5. Updates decision if `job.decisionId` exists:
   - Auto-applies research results to decision context
   - Auto-applies guided flow results to round1/round2/round3
   - Clears jobId pointers so UI knows job is done

### 4. Frontend Polling (web/hooks/use-job-status.ts)

React hook tracks job status:

1. Opens SSE connection to `/api/events/stream?job-id={id}`
2. Falls back to 2s polling if SSE fails twice
3. Updates `job` state when `job_status` events arrive
4. Stops polling/SSE when job reaches terminal state
5. Returns `{ job, error, setJob, setError }`

## Auto-Run System

Tasks with `auto_run=true` automatically execute when dependencies resolve.

### Flow

```
background-worker.cjs (process-manager spawns)
  ├─ starts auto-run-service.ts
  ├─ waits for /api/health (platform ready)
  ├─ every 60s: POST /api/tasks/auto-run
  └─ for each ready task:
      ├─ spawn chain (via chains/run API)
      └─ create run record
```

### Candidate Detection (web/lib/auto-run.ts)

A task is "auto-ready" when:
1. `status === "open"` (not closed/running)
2. `metadata.auto_run === true`
3. All dependencies have status in `["closed", "resolved", "done", "complete"]`
4. `issue_type !== "epic"` (epics don't run chains directly)

```typescript
isTaskReady(orgId, taskId): ReadyCheckResult
getAutoRunCandidates(orgId, workspaceId?): AutoRunCandidate[]
```

### Background Service (web/lib/auto-run-service.ts)

State stored on `globalThis` to survive module reloads:

- 60s interval (unref'd - doesn't block process exit)
- Health check on startup (waits for /api/health)
- Calls `/api/tasks/auto-run` with `BETTER_AUTH_SECRET` auth
- Returns `{ triggered: N }` count
- 403 response = auto-run disabled in settings (not error)

## Patterns

### Atomic File Writes

All job writes use the POSIX atomic pattern:

```typescript
writeFileSync(tmpPath, JSON.stringify(data), "utf-8");
renameSync(tmpPath, finalPath);  // atomic on POSIX
```

This prevents partial reads if another process reads the job mid-write.

### Secret Resolution

Agent profiles can reference secrets with `{secret:NAME}` syntax:

1. Job runner scans `SECRETS_DIR/` for matching secret name
2. Decrypts using `BETTER_AUTH_SECRET` (AES-256-GCM)
3. Injects resolved value into child process env
4. Secret never appears in logs, terminal output, or UI

### Detached Process Survival

```typescript
const child = spawn(process.execPath, args, { detached: true });
child.unref();  // parent doesn't wait, child survives parent exit
```

Critical for long AI prompts that would exceed HTTP timeout.

### Stale Job Detection

Jobs stuck in "running" status > 5 minutes are auto-marked failed:

```typescript
// in getJob()
if (job.status === "running" && job.startedAt) {
  if (Date.now() - new Date(job.startedAt).getTime() > STALE_MS) {
    job.status = "failed";
    job.error = "Job timed out (stale)";
    writeJobAtomic(id, job);
  }
}
```

### CLAUDECODE Handling

The job runner deletes `CLAUDECODE` from the child environment:

```typescript
const childEnv = Object.assign({}, process.env, profileEnv);
delete childEnv.CLAUDECODE;
```

This prevents the claude CLI from refusing to run inside another claude session.

## Gotchas

1. **Template resolution happens in API route, not job-runner**
   The `/api/jobs` route resolves the generation template and stores the full prompt in `job.input.prompt`. Job-runner just executes whatever prompt it finds.

2. **Agent profile path is agent-profiles/, not config-profiles/**
   Job-runner reads from `AGENT_PROFILES_DIR` (org-level agent-profiles), not config-profiles. This is intentional - agent profiles define execution environment, config profiles are for chain overrides.

3. **Callback failures are non-fatal**
   If `/api/jobs/[id]/complete` fails (network error, 500, etc.), the job result is still written to disk. The UI can poll the job endpoint directly.

4. **SSE may never connect in some environments**
   The `useJobStatus` hook falls back to polling after 2 SSE failures. This handles cases where SSE is blocked by proxies or firewalls.

5. **Decision jobs auto-apply results**
   Unlike task jobs (which only update metadata), decision jobs directly apply results to the decision state. This avoids a second round-trip to the server.

6. **Epics are skipped in auto-run**
   Auto-run only triggers on tasks with `issue_type !== "epic"`. Epics group subtasks but don't execute chains directly.

7. **Job cleanup is lazy**
   Old jobs are only deleted when a new job is created (cleanupOldJobs runs on POST /api/jobs). Not a scheduled cleanup job.

## Dependencies

- **web/lib/config.ts** - Path resolution (JOBS_DIR, AGENT_PROFILES_DIR, SECRETS_DIR)
- **web/lib/task-store.ts** - Task metadata updates
- **web/lib/decision-storage.ts** - Decision state updates
- **web/lib/namespace-config.ts** - Namespace/org context from request
- **web/lib/generation-template-storage.ts** - Template resolution for prompts
- **lib/chain-postprocessor.ts** - Extracts inline agents from generated chains
- **web/app/api/events/stream/route.ts** - SSE events for job status updates
