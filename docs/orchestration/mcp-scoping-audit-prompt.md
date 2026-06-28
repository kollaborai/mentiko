# Agent task: fix task-generation `workspace_id` orphaning + full MCP write-path scoping audit

## Mission
Two related defects surfaced in the Mentiko platform:
1. AI-generated tasks are created with `workspace_id = NULL`, so they exist in the DB but are invisible in the workspace-scoped `/tasks` view (they appear in no workspace).
2. MCP write tools don't always set the same scope/links the equivalent UI button does (e.g. `start_run` never set `run.taskId`, so runs launched "for a task" weren't tied to it).

Fix the root cause of (1), backfill remaining orphans, then perform a FULL audit of every MCP write tool to guarantee each sets the correct scope (workspace/org/namespace) and parent/link relationships exactly like the UI path it mirrors — so nothing else silently orphans or mis-ties.

## Background / evidence (found 2026-06-28)
- Task store: SQLite at `~/.mentiko/namespaces/default/data/tasks.db`, table `tasks`.
  Columns: `id, org_id, workspace_id, title, description, status, priority, issue_type, owner, assignee, parent_id, labels, metadata, acceptance_criteria, design, notes, estimated_minutes, due_at, created_at, created_by, updated_at, closed_at`.
- The `/tasks` UI is workspace-scoped: it filters by the active workspace's `workspace_id`, a path like `/Users/malmazan/.mentiko/namespaces/default/workspace/mentiko`. UI/run-chain-created tasks have it set; AI-generated tasks had it NULL.
- Repro:
  `sqlite3 ~/.mentiko/namespaces/default/data/tasks.db "SELECT COALESCE(workspace_id,'<NULL>') ws, count(*) FROM tasks GROUP BY workspace_id;"`
  → 14 NULL rows, including the entire EPIC-011 "AgentAttempt" tree. The EPIC-011 tree was manually backfilled to the mentiko workspace as a stopgap; the GENERATOR was NOT fixed, so new batches will orphan again.
- Reference fix already done this session: MCP `start_run` passed its `task` arg as prompt text and never set `run.taskId`. A new `run_task_chain` MCP tool was added that delegates to `/api/tasks/[id]/run-chain` (which writes `last_run_id` back onto the task and injects full task context). Use this as the model for "an MCP tool must mirror the UI button's scoping + links."

## Part 1 - Fix the root cause (stamp `workspace_id` at creation)
Find where AI task generation persists task rows and ensure `workspace_id` is set from the run/workspace context at creation, never NULL when a workspace is known.
- Trace: `web/app/api/tasks/generate/route.ts`, `web/app/api/mentiko-mcp/ops/tasks/generate/route.ts`, `web/lib/generation/**` (generation import/backstop), the generation completion path (`web/lib/runner-v2/completion-*`, and `lib/chain-runner-complete.sh` "generation import backstop"), and `web/lib/tasks/task-store.ts` (`taskCreate` - confirm it accepts and persists `workspace_id`).
- The generation run knows its workspace (run.json `workspaceId` / `workspacePath`). Propagate it into every generated task. If generation can legitimately run with no workspace, define the intended fallback (inherit parent/epic workspace, or the run's workspace) instead of NULL.
- Check the other creators too: `create_task` MCP -> ops `/tasks` -> `/api/tasks/create`; decision->task and chain->task flows.

## Part 2 - Backfill remaining orphans
- `sqlite3 <db> "SELECT id,title,parent_id FROM tasks WHERE workspace_id IS NULL;"` - for each, set `workspace_id` from its parent/epic's workspace or the clearly-correct one. Do NOT blanket-assign unrelated tasks. (EPIC-011 tree already backfilled to mentiko; `TASK-059` "codex proof" was intentionally left NULL.)

## Part 3 - FULL MCP write-path scoping audit
For EVERY MCP tool that creates or mutates an entity, verify it sets the same scope + links as the equivalent UI button/endpoint. Deliver a table:
`tool -> ops endpoint -> web endpoint / UI button -> scope fields set (workspace_id, org_id, namespace, parent/epic, run<->task tie) -> correct? -> gap`.

MCP source map:
- `lib/mentiko-mcp/tools.ts` - tool defs + `BAR_TOOL_NAMES` (bar-scope filter).
- `lib/mentiko-mcp/server.ts` - tool handlers + `TIER_C` (permission tiers, `checkPermission`).
- `lib/mentiko-mcp/handlers/*.ts` - `opsGet`/`opsPost` -> ops endpoints.
- `web/app/api/mentiko-mcp/ops/**/route.ts` - ops endpoints: `requireOpsAuth` + `requireOpsPermission`, then call internal `/api/*` with `Authorization: Bearer BETTER_AUTH_SECRET` + `x-namespace-id` / `x-org-id`.
- The matching real web endpoints + UI components are the source of truth for correct scoping.

Audit at least: `create_task`, `generate_tasks`, `run_task_chain`, `start_run`, `create_chain_draft`, `save_chain_json`, `attach_agent_to_chain`, `create_agent`, `create_workspace`, `create_schedule`, `create_secret`, `register_application`, `mark_task_done`. For each confirm: workspace/org/namespace are resolved correctly (not hardcoded "default", not NULL), parent/epic links preserved, and any back-reference the UI writes (e.g. `task.last_run_id`) is also written.
Spot-confirm the known cases: generated tasks now get `workspace_id`; `run_task_chain` sets `run.taskId` AND `task.last_run_id`; `start_run` is correctly NOT task-tied (and its description says so).
Also note (do not necessarily build) task-system actions with NO MCP tool: chain-recommend/analysis, generate-chain-for-task, auto-run toggle, add-task-comment.

## Part 4 - Regression guard
- Add a test/invariant: a task created via any generation/creation path in a workspace context has non-NULL `workspace_id`.
- Consider a startup/repair sweep that logs (or backfills) NULL-workspace tasks, and a test asserting MCP write tools set scope.

## Verify
- Generate a fresh task batch in the mentiko workspace; `SELECT id, workspace_id FROM tasks ORDER BY created_at DESC LIMIT N;` -> all set. `SELECT count(*) FROM tasks WHERE workspace_id IS NULL;` -> only intentional rows.
- If you touch MCP code: `cd ~/dev/platform/mentiko/lib/mentiko-mcp && npm run build` (esbuild -> dist/server.js), `npm run typecheck`. The user must `/mcp` reconnect to load the new dist. Web routes hot-reload in the running dev server - do NOT start a second `npm run dev` (it runs in tmux `mentiko-dev`).

## Constraints
- Shared checkout `~/dev/platform/mentiko` (another Claude session is editing MCP files): stage files explicitly, never switch branches, retry on `index.lock` / "file changed" after a few seconds.
- No emojis anywhere (code, output, commits). No Claude attribution in commit messages.
- Deliverable: the audit table + the implemented fixes (root cause + backfill + regression guard) + a short report of any other orphan/mis-tie risks found.
