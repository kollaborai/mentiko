# MCP write-path scoping audit (2026-06-28)

Every MCP tool that creates/mutates was traced tool → ops endpoint → web
endpoint/UI button → scope it sets, and checked against the scope the UI
button sets for the same action. Scope = `namespace_id`, `org_id`,
`workspace_id`, parent/epic, and run↔task tie.

## Scope model (how scope is resolved, applies to ALL tools)

- `namespace_id` / `org_id` — resolved from the session token by
  `requireOpsAuth(req)` → `ctx.namespaceId` / `ctx.orgId`. Every ops route
  uses this. **No tool hardcodes `"default"` or NULL for these.** Correct.
- `workspace_id` — only meaningful for task/run tools (tasks are
  workspace-scoped; chains/agents/schedules/secrets/applications are
  org-scoped and have no workspace column). For task tools it comes from the
  caller's `workspace_path`/`workspaceId`, resolved by
  `resolveAuthorizedWorkspacePath`.
- ops→web delegation passes `Authorization: Bearer BETTER_AUTH_SECRET` +
  `x-namespace-id` / `x-org-id` headers, so the underlying web route runs in
  the same scope.

## Audit table

| Tool | Ops endpoint | Web endpoint / UI button | workspace_id | parent/epic | run↔task tie | Verdict |
|---|---|---|---|---|---|---|
| `create_task` | POST `/api/mentiko-mcp/ops/tasks` | UI quick-add → `/api/tasks/create` (manual) | from `workspacePath`; **now inherits parent** via taskCreate | `parent_id` passed through | n/a | **OK (fixed)** — parent-inherit added; no active-ws fallback (see notes) |
| `generate_tasks` | POST `/api/mentiko-mcp/ops/tasks/generate` | UI "Generate" → `/api/tasks/generate` → async import via `/api/jobs/[id]/complete` | **now resolved**: explicit → parent → **run workspace** (run.json) for parent + every subtask | `parentId` (existing epic) threaded; subtasks get the new parent | generation job/run/chain recorded in metadata | **OK (fixed)** — root-cause fix lives here |
| `run_task_chain` | POST `/api/mentiko-mcp/ops/tasks/run-chain` | UI "Run chain" button → `/api/tasks/[id]/run-chain` | `workspaceId`/`workspacePath` threaded | reads task's own metadata | **writes `last_run_id` + sets in_progress** — mirrors UI button exactly | **OK** (reference fix) |
| `start_run` | POST `/api/mentiko-mcp/ops/context/runs` | UI chain "Run" → `/api/chains/run` | `workspaceId` threaded (optional) | none | **no task tie (by design)** — `task` is free-text prompt only | **OK** — matches contract; use `run_task_chain` for task-tied runs |
| `create_chain_draft` | POST `/api/mentiko-mcp/ops/chains` | UI "New chain" | n/a (org-scoped) | n/a | n/a | **OK** |
| `save_chain_json` | POST `/api/mentiko-mcp/ops/chains` | UI JSON editor save | n/a | n/a | n/a | **OK** |
| `attach_agent_to_chain` | PATCH `/api/mentiko-mcp/ops/chains` (action=attach_agent) | UI chain editor add-agent | n/a | n/a | n/a | **OK** |
| `create_agent` | POST `/api/mentiko-mcp/ops/agents` | UI "New agent" | n/a | n/a | n/a | **OK** |
| `create_schedule` | POST `/api/mentiko-mcp/ops/schedules` | UI /schedules "New" | `workspaceId` accepted on target (generate_tasks/run_task targets) | n/a | n/a | **OK** |
| `register_application` | POST `/api/mentiko-mcp/ops/applications` | UI scheduled-apps | n/a | n/a | n/a | **OK** |
| `create_secret` | POST `/api/mentiko-mcp/ops/secrets` | UI /settings/secrets | n/a (org-scoped vault) | n/a | n/a | **OK** |
| `mark_task_done` | PATCH `/api/mentiko-mcp/ops/tasks` `{done:true}` | UI "Close task" | n/a (no scope change) | n/a | n/a | **OK** |
| `create_workspace` | **none** | UI /workspaces "Add" | — | — | — | **GAP — declared but unimplemented** (see below) |

## Gaps found

### GAP 1 — `create_workspace` is declared but does nothing (functional bug)
`create_workspace` is in `tools.ts` (def + `workspace_path` arg) and the
`TIER_C` permission list (`server.ts:72`), but there is **no dispatch branch**
for it in `server.ts`. It falls through to the catch-all
`await dispatchEffect(name, args)` (line 826) — a fire-and-forget UI effect
named `create_workspace`, which the bar does not handle, so the call silently
no-ops and returns "Effect dispatched: create_workspace". No workspace is
created.

Recommended fix (separate change): add a `handlers/workspaces.ts` +
`POST /api/mentiko-mcp/ops/workspaces` that calls the existing
`createWorkspace` in `web/lib/workspaces/workspace-storage.ts`, plus a
`server.ts` dispatch branch (`checkPermission` → handler → navigate).

### GAP 2 — no active-workspace fallback for `create_task` / `generate_tasks`
Both stamp `workspace_id` only from an explicit `workspace_path` (now plus
parent/run fallbacks for generate). If a caller passes neither a workspace nor
a parent/run with a workspace, the task is genuinely global (NULL). That is
correct/honest, but the server cannot know the bar's active workspace (it's
localStorage-only; `ops/context/workspace` guesses the first workspace). So an
agent that forgets `workspace_path` still orphans the task out of the
workspace filter.

The root-cause fix narrows this to the truly-no-context case: explicit →
parent → run covers every case where a workspace IS knowable. Mitigations if
we want zero NULL-on-forget: (a) persist last-selected workspace server-side
(`/mcp-auth` inbox already receives `select_workspace` effects — wire a store),
or (b) default `create_task`/`generate_tasks` to the first/only workspace when
exactly one exists. Not implemented here — flagged.

## Task actions with NO MCP tool (coverage gaps, by design or oversight)

- **chain-recommend / analysis** (`POST /api/tasks/[id]/...` recommend job) —
  no MCP tool. Auto-run uses it internally; an agent cannot trigger a
  recommendation explicitly.
- **generate-chain-for-task** (generate a chain for a task's binding) — no MCP
  tool. Agent can `save_chain_json` then it must manually wire `chain_id` into
  task metadata; no "assign this generated chain to task X" tool.
- **auto-run toggle** (`POST /api/tasks/[id]/auto-run`) — no MCP tool. Agent
  cannot turn a task's auto-run on/off.
- **add-task-comment** (`POST /api/tasks/[id]/comments`) — no MCP tool. Agent
  cannot post a comment that `run_task_chain` would later inject into the
  prompt (the UI run-chain path reads comments; MCP can only set them via raw
  write_file to the DB, which it shouldn't).

These are the natural next MCP tools if agent-driven task ops need parity with
the UI.

## Other orphan / mis-tie risks

- `taskAddDep` enforces same-workspace for both ends when scoped — a generated
  tree whose parent and a cross-tree dep land in different workspaces would
  throw. Not currently reachable (generated deps are intra-tree), but if
  `generate_tasks` ever accepts cross-epic `depends_on`, scope must match.
- `start_run` + `run_task_chain` both pre-generate/accept a runId; if a run
  starts but the task metadata write in `/api/tasks/[id]/run-chain` races the
  chain start, `last_run_status` could read stale. Existing double-submit
  guard mitigates; no change needed.
- The `/api/jobs/[id]/complete` import path now reads run.json for the
  workspace fallback — if a generation run's run.json is missing/unreadable
  (e.g. run dir cleaned up before the async completion fires), it falls back
  to parent or NULL rather than throwing. Defensive by design.
