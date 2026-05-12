# Scheduler V3 Design

date: 2026-05-05
status: implementation started

## Problem

Mentiko schedules currently execute chains. The scheduler stores chain-centric
records, validates `chainId`, checks for `chains/{chainId}/chain.json`, and
spawns `lib/chain-runner.sh`. That is too narrow for the product direction.

Users need schedules that can:

- Generate tasks from a prompt on a cadence and optionally mark them for auto-run.
- Run an existing task.
- Run a chain.
- Run a registered application.
- Run a raw executable with a working folder and argv-style arguments.
- React to files landing in watched folders and pass file metadata to the target.
- Share job groups so only a bounded number of related jobs run at once.
- Be created and managed from the web UI, MCP tools, and `bin/mentiko`.

## Goals

- Keep existing chain schedules working.
- Add a generic schedule target model.
- Support both registered applications and raw executable targets.
- Use structured argv arrays for raw execution; raw shell strings are not the
  default execution model.
- Add cron/manual target execution first, with file-trigger schema included and
  watch-loop execution as a follow-up slice.
- Add concurrency groups with simple policies.
- Keep MCP and CLI parity for schedule CRUD and run-now operations.
- Preserve workspace authorization and code-root/data-root separation.

## Non-Goals

- Do not rewrite `chain-runner.sh`.
- Do not replace task auto-run.
- Do not make arbitrary shell snippets the primary API.
- Do not implement a full workflow engine in this slice.
- Do not add UI-heavy file-trigger editing until the target/dispatcher layer is
  stable.

## Target Model

```ts
type ScheduleTarget =
  | { type: "chain_run"; chainId: string; goal?: string; workspaceId?: string }
  | { type: "generate_tasks"; prompt: string; workspacePath?: string; autoRun?: boolean }
  | { type: "run_task"; taskId: string; workspaceId?: string; workspacePath?: string }
  | { type: "registered_app"; appId: string; args?: string[]; workspaceId?: string }
  | {
      type: "raw_exec";
      executable: string;
      args?: string[];
      workingDirectory?: string;
      env?: Record<string, string>;
      envSecretRefs?: Record<string, string>;
      timeoutMs?: number;
      successExitCodes?: number[];
    };
```

Legacy schedules without `target` normalize to:

```ts
{ type: "chain_run", chainId: schedule.chainId, goal: schedule.goal }
```

## Trigger Model

```ts
type ScheduleTrigger =
  | { type: "cron"; cron: string; timezone: string }
  | { type: "interval"; everyMs: number }
  | {
      type: "file";
      directory: string;
      glob: string;
      events: Array<"created" | "modified">;
      debounceMs: number;
      stableForMs: number;
      passFileAs?: "template_context" | "first_arg";
    };
```

The current cron fields remain on `Schedule` for compatibility. New schedules
can also carry a `trigger`; cron schedules mirror `trigger.cron` into `cron`.

## Template Context

Targets can include `{{...}}` placeholders. Initial supported values:

- `{{triggeredAt}}`
- `{{file.path}}`
- `{{file.name}}`
- `{{file.directory}}`
- `{{file.extension}}`

File triggers pass this context to prompts and argv values. Cron triggers pass
only `triggeredAt`.

## Raw Execution Safety

Raw execution is allowed, but it is still structured:

- `executable` must be one binary path or command name, not a shell command.
- `args` must be an array of strings.
- `workingDirectory`, if present, must be absolute.
- Environment variables are explicit. Secrets use secret refs rather than inline
  values.
- Execution uses `spawn(executable, args, { shell: false })`.
- Output is captured to schedule execution history.
- `timeoutMs` kills long-running processes.
- `successExitCodes` defaults to `[0]`.

## Job Groups

```ts
interface JobGroup {
  id: string;
  name: string;
  maxConcurrent: number;
  policy: "queue" | "skip" | "replace" | "coalesce";
}
```

The first implementation supports the admission decision and queue/skip
metadata. Durable queue draining can be added after the dispatcher is stable.

## API Surface

Existing `/api/schedules` remains but accepts `target`, `trigger`, and
`jobGroupId`. Chain fields remain in responses for compatibility.

Add MCP ops routes:

- `GET /api/mentiko-mcp/ops/schedules`
- `POST /api/mentiko-mcp/ops/schedules`
- `PATCH /api/mentiko-mcp/ops/schedules`
- `DELETE /api/mentiko-mcp/ops/schedules?id=...`
- `POST /api/mentiko-mcp/ops/schedules/run`

Add MCP tools and CLI commands:

- `list_schedules`
- `create_schedule`
- `update_schedule`
- `delete_schedule`
- `run_schedule_now`
- `list_job_groups`

## Dispatcher Flow

```text
scheduler loop
  -> read schedules
  -> normalize trigger
  -> due?
  -> normalize target
  -> validate target
  -> job group admission
  -> dispatch target
  -> write history and next-run state
```

Target dispatch:

- `chain_run`: existing chain path.
- `generate_tasks`: call the task-generation path with `autoRun`.
- `run_task`: call the task run-chain path.
- `registered_app`: resolve app config and execute the stored command.
- `raw_exec`: spawn executable with argv.

## Testing

- Unit-test target normalization, validation, template rendering, and job-group
  admission.
- Unit-test schedule API create validation for new target shapes.
- Integration-test `generate_tasks` dispatch with `autoRun: true`.
- Integration-test raw exec with a harmless Node/Python command.
- Regression-test legacy chain schedules.

## Rollout

1. Add target types and helpers.
2. Update schedule API create/update/list for target records.
3. Add dispatcher support for legacy chains, generated tasks, and raw exec.
4. Add MCP tools and ops handlers.
5. Add CLI command mappings through the shared MCP/CLI command surface.
6. Add file-trigger watch loop and UI editing as a second slice.
