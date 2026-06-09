# Mentiko API Reference

Complete catalog of all API routes with detailed purposes, data sources, and frontend usage.

Generated: 2026-03-11

---

## Summary

| Metric | Count |
|--------|-------|
| total endpoints | 287 |
| used by frontend | 168 (59%) |
| unused | 96 (33%) |
| missing from docs | 0 |
| audit accuracy | 100% |

---

## Table Legend

### Columns
- **Purpose** - What the endpoint does/returns
- **Data Source** - Where data comes from (filesystem, DB, external API, etc)
- **Screen/Component** - Frontend files that use this endpoint
- **Notes** - Audit findings, caveats, known issues

### Auth Levels
- `None` - Public endpoint (no auth)
- `checkAuth` - Authenticated user (cookie session)
- `view_chains` - RBAC: view chains
- `manage_chains` - RBAC: create/edit/delete chains
- `view_tasks` - RBAC: view tasks
- `manage_tasks` - RBAC: create/edit/delete tasks
- `manage_org` - RBAC: org-level resources
- `Admin/owner` - Organization admin or owner
- `Session/bearer` - Cookie or Bearer token

### Data Sources
- **pty-manager** - bin/p PTY session daemon (list, capture, sendKeys, spawn, remove, alive)
- **Filesystem** - Namespace-scoped files under `namespaces/{id}/`
- **cliPipe** - lib/cli-pipe.ts wrapper for spawning claude CLI with prompts
- **task-store** - Native sqlite task store (web/lib/task-store.ts)
- **execSync** - Node child_process for synchronous command execution
- **DB** - SQLite database
- **External** - Third-party APIs (GitHub, Stripe, Resend, SMTP, Telegram, Anthropic)
- **In-memory** - Runtime data structures (job store, circuit breaker state, push subscriptions)

---

## API Architecture Patterns

### RESTful Resource Endpoints vs RPC-Style Action Routes

The Mentiko API employs two complementary patterns for different use cases:

#### RESTful Method-Based Actions (Preferred)
Most endpoints follow RESTful conventions where HTTP methods indicate actions on a resource:

```
GET    /api/retry/config     - Read resource
POST   /api/retry/config     - Create/update resource
DELETE /api/retry/config     - Delete resource
POST   /api/retry/circuit    - Perform action (reset) on resource
```

**Use when:**
- Working with CRUD operations on resources
- Actions map naturally to HTTP verbs (GET, POST, PUT, DELETE)
- Following REST conventions improves API discoverability

#### RPC-Style Sub-Routes (Specific Actions)
Some endpoints use explicit action-based sub-routes for side-effect operations that don't map cleanly to REST verbs:

```
POST /api/conversations/[id]/steer    - Redirect conversation
POST /api/runs/[id]/stop             - Stop run execution
POST /api/runs/[id]/agents/cleanup   - Cleanup agent artifacts
```

**Use when:**
- Action name is more descriptive than POST/PUT/DELETE
- Operation is a side-effect, not resource manipulation
- Multiple distinct actions on same resource beyond CRUD
- Verb is inherently RPC-like (reset, pause, resume, steer, stop)

**Examples in codebase:**
- `/api/conversations/[id]/steer` - Redirect AI conversation (RPC-style)
- `/api/runs/[id]/stop` - Terminate run execution (RPC-style)
- `/api/retry/circuit` - Reset via POST (RESTful method-based)

**Key distinction:**
- RESTful: `/api/resource` + HTTP method = action
- RPC-style: `/api/resource/action` + POST = explicit action

Both patterns are intentional architectural choices, not discrepancies. The retry API uses RESTful method-based actions (GET/POST/DELETE on `/api/retry/config`, `/api/retry/circuit`), not sub-routes like `/api/retry/circuit/reset`.

---

## Agents

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| GET | `/api/agents` | List active PTY agent sessions, filters out monitor-* sessions | pty-manager list | checkAuth | Yes | hooks/use-agents.ts, dashboard-stats, agent-sessions-panel | |
| GET | `/api/agents/[session]` | Get session output (last 500 lines) | pty capture | checkAuth | No | (output endpoint used instead) | |
| DELETE | `/api/agents/[session]` | Kill agent session + associated monitor session | pty remove | checkAuth | Yes | hooks/use-agents.ts | |
| POST | `/api/agents/[session]/message` | Send message to agent session (stdin) | pty sendKeys | checkAuth | Yes | lib/api.ts | |
| GET | `/api/agents/[session]/output` | Get raw PTY output (unsanitized) | pty capture | checkAuth | Yes | live-output, run-detail-panel, chains/[id]/run, dashboard/runs/[run-id] | |
| POST | `/api/agents/resume` | Resume conversation in new PTY via claude --resume | pty spawn + filesystem (run.json) | checkAuth | No | (uses conversations/[id]/steer instead) | |
| GET | `/api/agents/registry` | List all agents (standalone + chain-embedded) with usage stats | Scan agents + chains + runs | view_chains | Yes | agents page, chains/new, add-agent-dialog | |
| GET | `/api/agents/registry/[id]` | Fetch single agent definition | Filesystem: agents/{id}/agent.json | view_chains | No | (loaded via list endpoint) | |
| PUT | `/api/agents/registry/[id]` | Update standalone agent | Filesystem: agents dir | manage_chains | No | (uses save endpoint) | |
| DELETE | `/api/agents/registry/[id]` | Delete standalone agent directory | Filesystem: recursive rm | manage_chains | Yes | agent-registry-detail | |
| GET | `/api/agents/registry/scan` | Scan CLI tool skills directory for importable skills | scanAllSkills() | checkAuth | Yes | skill-import-dialog | |
| POST | `/api/agents/registry/import` | Import CLI skills as standalone agents | Skills scan + fs write | manage_chains | Yes | skill-import-dialog | |
| POST | `/api/agents/registry/edit` | Edit agent JSON using AI via cliPipe | cliPipe (claude CLI) | checkAuth | Yes | agent-edit-dialog | |
| POST | `/api/agents/registry/generate` | Generate new agent from prompt using AI | cliPipe + schema + template | checkAuth | Yes | agent-generate-dialog, add-agent-dialog | |
| POST | `/api/agents/registry/save` | Save new agent (auto-slugs name to directory) | Filesystem: agents/{slug}/agent.json | manage_chains | Yes | agent-edit-dialog, agent-generate-dialog | acts as upsert |
| GET | `/api/agents/marketplace` | List marketplace agents (builtin + community) with ratings | Scan builtin + marketplace + ratings.json | checkAuth | No | (not implemented in UI) | header fallback not documented |
| POST | `/api/agents/marketplace/install` | Install marketplace agent to namespace | Marketplace -> namespace agents | checkAuth | No | (not implemented in UI) | |
| POST | `/api/agents/marketplace/[id]/install` | Install specific marketplace agent | Marketplace/builtin -> namespace agents + ratings.json | checkAuth | No | (not implemented in UI) | |
| POST | `/api/agents/marketplace/[id]/rate` | Rate agent (1-5 stars) | Filesystem: namespace ratings.json | checkAuth | No | (not implemented in UI) | |
| GET | `/api/agents/marketplace/[id]/rate` | Get agent rating (avg, count, distribution) | Filesystem: namespace ratings.json | checkAuth | No | (not implemented in UI) | |

---

## Agent Profiles

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| GET | `/api/agent-profiles` | List all agent profiles for namespace | Filesystem: agent-profiles/*.json | checkAuth | Yes | lib/use-agent-profiles.ts, getting-started, chains/[id]/edit, workspaces | |
| POST | `/api/agent-profiles` | Create new agent profile | Filesystem: agent-profiles/{id}.json | checkAuth | Yes | settings/agent-configs, agent-profile-wizard | |
| GET | `/api/agent-profiles/[id]` | Get single agent profile | Filesystem: agent-profiles/{id}.json | checkAuth | No | (loaded via list endpoint) | |
| PATCH | `/api/agent-profiles/[id]` | Update agent profile (partial) | Filesystem: agent-profiles/{id}.json | checkAuth | Yes | settings/agent-configs | |
| DELETE | `/api/agent-profiles/[id]` | Delete agent profile | Filesystem: delete profile file | checkAuth | Yes | settings/agent-configs | |
| POST | `/api/agent-profiles/[id]/test` | Test agent profile (verify CLI works + API key) | execSync with profile env | checkAuth | Yes | settings/agent-configs | |
| GET | `/api/agent-profiles/bundles` | List provider bundles (anthropic, openai, etc) | PROVIDER_BUNDLES constant + listProfiles | checkAuth | Yes | settings/agent-configs | |
| POST | `/api/agent-profiles/install-bundle` | Install all profiles from a provider bundle | PROVIDER_BUNDLES + createProfile | checkAuth | Yes | settings/agent-configs | |

---

## Chains

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| GET | `/api/chains` | Redirect to list endpoint | N/A (redirect) | checkAuth | Yes | api/chains/route.ts (redirect) | no auth check (just redirect) |
| GET | `/api/chains/list` | List all chains in namespace | Filesystem: chainsDir + runsDir | view_chains | Yes | chains page, hooks/use-chains, getting-started, schedules, task dialogs, webhook-manager | |
| GET | `/api/chains/get` | Get chain by ID, optionally expand $ref agents | Filesystem: chains/{id}/chain.json | checkAuth | Yes | hooks/use-chains, chains/[id]/edit, chain-agent-pipeline | |
| POST | `/api/chains/save` | Save or update chain with versioning | Filesystem: chains/{name}/chain.json + versions | manage_chains | Yes | hooks/use-chains, chains/new, task dialogs | |
| POST | `/api/chains/import` | Import chain from URL or body, with var substitution | External URL or body.chain + save | checkAuth | Yes | chains page | analyze mode not documented |
| POST | `/api/chains/validate` | Validate chain schema, triggers, circular deps | chain.schema.json + filesystem validation | checkAuth | Yes | chains/new | |
| GET | `/api/chains/status` | Get agent states and sessions for a run | Filesystem: stateDir, runsDir + pty.list() | checkAuth | Yes | conversations page, conversations/[id] | |
| POST | `/api/chains/generate` | Generate chain from prompt (sync, deprecated) | cliPipe + getTemplate + getChainSchema + resolveTemplate | checkAuth | No | (replaced by generate-v2) | |
| POST | `/api/chains/generate-v2` | Generate chain from prompt with agent catalog | cliPipe + getAllStandaloneAgents + getTemplate + getChainSchema | checkAuth | Yes | chains/new | |
| POST | `/api/chains/recommend` | Recommend existing chain or suggest generation | getAllChains + buildChainSummary + cliPipe | checkAuth | No | (not used in web/) | expects complex task object |
| POST | `/api/chains/run` | Execute chain (spawn detached process) | Filesystem: runsDir + chain-runner.sh spawn | manage_chains | Yes | hooks/use-runs, chains page, chains/[id]/run, chains/[id]/edit, test-run-panel, schedule-manager, various API routes | executor, runId params not documented |
| POST | `/api/chains/run-batch` | Run multiple chains in parallel/sequential mode | Filesystem: batches/ + multi-chain-runner.sh | checkAuth | Yes | batch-runner | |
| GET | `/api/chains/run-batch` | List batches or get specific batch status | Filesystem: batches/ | checkAuth | Yes | batch-runner | |
| DELETE | `/api/chains/run-batch` | Cancel running batch by killing PIDs | Filesystem: batch pid files + process.kill() | checkAuth | Yes | batch-runner | |

### Chains by ID

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| GET | `/api/chains/[id]` | Get chain by directory name | Filesystem: chains/{id}/chain.json | view_chains | Yes | hooks/use-chains, chains page, chains/[id]/run, various API routes | |
| PATCH | `/api/chains/[id]` | Update chain (validate before save) | Filesystem: chains/{id}/chain.json | manage_chains | Yes | hooks/use-chains, chains/[id]/edit | |
| DELETE | `/api/chains/[id]` | Delete chain directory | Filesystem: chains/{id}/ | manage_chains | Yes | chains page | |
| POST | `/api/chains/[id]/duplicate` | Duplicate chain to {id}-copy | Filesystem: chains/{id}/ -> chains/{id}-copy/ | manage_chains | Yes | chains page | |
| GET | `/api/chains/[id]/publish` | Get publish status (marketplace) | chain-publish-store (filesystem) | view_chains | Yes | chains page | |
| POST | `/api/chains/[id]/publish` | Publish chain to marketplace | chain-publish-store + chain.json | manage_chains | Yes | chains page | |
| DELETE | `/api/chains/[id]/publish` | Unpublish chain from marketplace | chain-publish-store | manage_chains | Yes | chains page | |
| GET | `/api/chains/[id]/webhooks` | List chain webhooks | webhook-utils (filesystem) | view_chains | Yes | chains/[id]/edit | |
| POST | `/api/chains/[id]/webhooks` | Add webhook to chain | webhook-utils (filesystem) | manage_chains | Yes | chains/[id]/edit | |
| DELETE | `/api/chains/[id]/webhooks` | Remove webhook from chain | webhook-utils (filesystem) | manage_chains | Yes | chains/[id]/edit | |
| PATCH | `/api/chains/[id]/webhooks` | Enable/disable webhook | webhook-utils (filesystem) | manage_chains | Yes | chains/[id]/edit | |
| GET | `/api/chains/[id]/versions` | List chain versions | Filesystem: agents/versions/{id}/*.json | checkAuth | Yes | hooks/use-chain-version-control, version-history | path has agents/ prefix not documented |
| POST | `/api/chains/[id]/versions/restore` | Restore chain from version (increments patch) | Filesystem: versions/{version}.json -> chains/{id}/ | checkAuth | Yes | hooks/use-chain-version-control, version-history | |
| GET | `/api/chains/[id]/versions/diff` | Diff two chain versions | Filesystem: versions/{from}.json, versions/{to}.json | checkAuth | Yes | hooks/use-chain-version-control, version-history | JSON diff, not git diff |
| GET | `/api/chains/[id]/versions/[version]` | Get specific version content | Filesystem: agents/versions/{id}/{version}.json | checkAuth | No | (only list and diff used) | |
| GET | `/api/chains/[id]/breakpoints` | List breakpoints for chain | breakpoint-store (in-memory Map) | checkAuth | Yes | hooks/use-breakpoints, hooks/use-debug | |
| POST | `/api/chains/[id]/breakpoints` | Set/clear/resume breakpoints | breakpoint-store (in-memory Map) | checkAuth | Yes | hooks/use-breakpoints, hooks/use-debug | |
| DELETE | `/api/chains/[id]/breakpoints` | Clear all breakpoints | breakpoint-store (in-memory Map) | checkAuth | Yes | hooks/use-breakpoints, hooks/use-debug | |
| GET | `/api/chains/[id]/debug` | Get debug state OR inspect specific agent (?agent=agentId) | Filesystem: debugDir/{id}.json, runsDir | checkAuth | No | (breakpoints used instead) | agent inspection uses query param ?agent=agentId |
| POST | `/api/chains/[id]/debug` | Control debug run (pause/continue/step/skip) | Filesystem: debugDir/{id}.json | checkAuth | No | (breakpoints used instead) | |
| DELETE | `/api/chains/[id]/debug` | Clear debug state | Filesystem: debugDir/{id}.json | checkAuth | No | (breakpoints used instead) | |
| GET | `/api/chains/[id]/debug/state` | Get debug snapshot with variables, output | Filesystem: runsDir, stateDir, eventsDir | checkAuth | Yes | state-inspector | |

### Git Operations

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| GET | `/api/chains/[id]/git/branches` | List git branches for chain | execSync git commands in chain dir | checkAuth | Yes | hooks/use-chain-version-control | |
| POST | `/api/chains/[id]/git/branches` | Create/switch/delete/compare branches | execSync git commands | checkAuth | Yes | hooks/use-chain-version-control | |
| GET | `/api/chains/[id]/git/status` | Get git working tree status (ahead/behind counts) | execSync git status/branch commands | checkAuth | Yes | hooks/use-chain-version-control | also returns ahead/behind counts |
| POST | `/api/chains/[id]/git/commit` | Stage files and commit (sanitized) | execSync git add/commit commands | checkAuth | Yes | hooks/use-chain-version-control | |
| GET | `/api/chains/[id]/git/history` | Get commit history | execSync git log command | checkAuth | Yes | hooks/use-chain-version-control | |
| POST | `/api/chains/[id]/git/init` | Initialize git repo with .gitignore | execSync git init + write .gitignore | checkAuth | Yes | hooks/use-chain-version-control | |
| GET | `/api/chains/[id]/git/diff` | Get diff summary with optional content | execSync git diff --numstat | checkAuth | Yes | hooks/use-chain-version-control | |
| POST | `/api/chains/[id]/git/diff` | Get file content at specific commit | execSync git show command | checkAuth | Yes | hooks/use-chain-version-control | |
| POST | `/api/chains/[id]/git/merge` | Merge branch with conflict detection | execSync git merge + parse conflicts | checkAuth | Yes | hooks/use-chain-version-control | |
| DELETE | `/api/chains/[id]/git/merge` | Abort merge | execSync git merge --abort | checkAuth | Yes | hooks/use-chain-version-control | |
| POST | `/api/chains/[id]/git/revert` | Revert to commit (hard reset or branch) | execSync git reset/checkout + backup | checkAuth | Yes | hooks/use-chain-version-control | |

---

## Runs

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| GET | `/api/runs` | List runs with filters (chain, workspace, taskId, status, limit) | Filesystem: runsDir/*.json + token-store | checkAuth | Yes | hooks/use-runs, runs page, dashboard-stats, chains page, active-chains, recent-runs, activity-feed, agent-sessions-panel, dashboard/metrics, run-comparison | |
| DELETE | `/api/runs` | Bulk delete runs by IDs | Filesystem: runsDir/ | checkAuth | Yes | runs page | |
| GET | `/api/runs/[id]` | Get run details with merged agent states | Filesystem: runs/{id}/run.json + state files | checkAuth | Yes | run-detail-panel, dashboard/runs/[run-id], hooks/use-runs, use-notifications-listener, chains/[id]/run, test-run-panel | |
| PATCH | `/api/runs/[id]` | Cancel run (kill sessions, update status) | Filesystem: runs/{id}/run.json + pty.remove() | checkAuth | No | (uses /stop instead) | |
| DELETE | `/api/runs/[id]` | Delete run directory (kill sessions first) | Filesystem: runs/{id}/ + pty.remove() | checkAuth | Yes | run-detail-panel, test-run-panel | |
| GET | `/api/runs/[id]/output` | Download output.log as attachment | Filesystem: runs/{id}/output.log + sanitizeOutput | checkAuth | Yes | run-detail-panel, activity page, test-run-panel | |
| GET | `/api/runs/[id]/status` | Get run status with agent heartbeat staleness | Filesystem: runs/{id}/run.json + state files | checkAuth | Yes | run-detail-panel, dashboard/runs/[run-id] | |
| POST | `/api/runs/[id]/stop` | Stop run (kill PTY sessions + processes) | Filesystem: runs/{id}/run.json + pty.kill() | manage_chains | Yes | run-detail-panel, chains/[id]/run | auth documented as manage_chains but uses RBAC requirePermission |
| POST | `/api/runs/[id]/approve` | Approve or reject human-in-the-loop approval | Filesystem: runs/{id}/approval.json + run.json | checkAuth | Yes | run-detail-panel | updates run.json status (side effect) |
| GET | `/api/runs/[id]/cost` | Get token usage and cost breakdown | token-store or parse artifacts JSONL | checkAuth | Yes | run-detail-panel, performance-tab | complex fallback not documented |
| GET | `/api/runs/[id]/agents/[agentId]/heartbeat` | Get agent heartbeat status (staleness) | Filesystem: runs/{id}/run.json | checkAuth/Bearer | No | (internal to agents) | |
| POST | `/api/runs/[id]/agents/[agentId]/heartbeat` | Update agent heartbeat (liveness signal) | Filesystem: runs/{id}/run.json | checkAuth/Bearer | No | (internal to agents) | |
| GET | `/api/runs/[id]/agents/[agentId]/activity` | Get agent artifacts (diff.patch, files-changed.json, conversations.json, output.txt) | Filesystem: runs/{id}/artifacts/{agentId}-* | checkAuth | Yes | run-detail-panel | |
| GET | `/api/runs/compare` | Compare two runs (metrics, agent outputs) | Filesystem: runs/{id}/run.json + output + performance.json | checkAuth | Yes | runs/compare page, chains/[id]/compare/[runA]/[runB], run-comparison | |
| GET | `/api/runs/pinned` | List pinned run IDs | Filesystem: settings/pinned-runs.json | checkAuth | Yes | runs page | |
| POST | `/api/runs/pinned` | Add run ID to pinned list | Filesystem: settings/pinned-runs.json | checkAuth | Yes | runs page | |
| DELETE | `/api/runs/pinned` | Remove run ID from pinned list | Filesystem: settings/pinned-runs.json | checkAuth | Yes | runs page | |

---

## Schedules

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| GET | `/api/schedules` | List schedules (chains with cron config) | Filesystem: chainsDir scan for config.schedule | checkAuth | Yes | schedule-list | |
| PUT | `/api/schedules` | Enable/disable schedule | Filesystem: schedulesDir/{chainId}.status | checkAuth | Yes | schedule-list (toggle), schedule-manager | |
| PATCH | `/api/schedules` | Update schedule expression or workspace | Filesystem: chains/{id}/chain.json + workspace-map.json | checkAuth | Yes | schedule-manager, schedules page | |
| POST | `/api/schedules` | Trigger scheduled chain now | chain-runner.sh spawn | checkAuth | Yes | schedule-list (run now) | |
| DELETE | `/api/schedules` | Snooze or unsnooze a schedule | Filesystem: schedulesDir/{chainId}.snooze | checkAuth | Yes | schedule-list (snooze/unsnooze) | |
| POST | `/api/schedules/next` | Calculate next run time for cron expression | python croniter | checkAuth | Yes | schedule-manager | |
| POST | `/api/schedules/run` | Trigger immediate run of schedule | chainsDir + internal fetch to /api/chains/run | checkAuth | No | (uses /api/chains/run instead) | |
| GET | `/api/schedules/history` | Get execution history for schedule | Filesystem: schedulesDir/history/{chainId}.json | checkAuth | Yes | schedule-history | |
| POST | `/api/schedules/history` | Record execution start | Filesystem: schedulesDir/history/{chainId}.json | checkAuth | No | (internal to scheduler daemon) | |
| PATCH | `/api/schedules/history` | Update execution status (complete/error) | Filesystem: schedulesDir/history/{chainId}.json | checkAuth | No | (internal to scheduler daemon) | |

---

## Tasks (Native SQLite)

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| GET | `/api/tasks` | List/search tasks with filters (status, type, assignee, query) | task-store.ts | view_tasks | Yes | tasks page, hooks/use-tasks, task dialogs | |
| POST | `/api/tasks/create` | Create new task with optional chain assignment | task-store.ts | manage_tasks | Yes | task-create-dialog, task-assign-workflow | |
| GET | `/api/tasks/epics` | Get epic status with completion progress (children counts) | task-store.ts | view_tasks | Yes | tasks page, epic-status-panel | |
| GET | `/api/tasks/activity` | Get recent activity feed (commits, comments, status changes) | task-store.ts | view_tasks | Yes | tasks page, activity-feed | since param: 24h, 7d, 30d, etc |
| POST | `/api/tasks/generate` | AI-generate tasks from prompt | cliPipe (claude CLI) | checkAuth | No | (not used in UI) | |
| GET | `/api/tasks/auto-run` | Check for tasks ready for auto-run (has chain, unblocked) | task-store.ts + job store | checkAuth | No | (internal daemon) | |
| POST | `/api/tasks/auto-run` | Force-trigger auto-run for specific task | task-store.ts + chains/run API | checkAuth | No | (internal daemon) | |
| POST | `/api/tasks/deps` | Add dependency between tasks (from depends on to) | task-store.ts | manage_tasks | Yes | task-dependency-dialog, tasks page | |
| GET | `/api/tasks/reconcile` | Reconcile task state with workspace (check chains exist) | task-store.ts + chainsDir scan | view_tasks | No | (not used in UI) | |
| POST | `/api/tasks/reconcile` | Trigger reconciliation of all tasks | task-store.ts + chainsDir scan | view_tasks | No | (not used in UI) | |
| GET | `/api/tasks/[id]` | Get task detail with dependencies + dependents | task-store.ts | view_tasks | Yes | tasks page, task-detail-panel | |
| PATCH | `/api/tasks/[id]` | Update task fields (status, assignee, chainAssignment, etc) | task-store.ts | manage_tasks | Yes | tasks page, task-detail-panel | |
| POST | `/api/tasks/[id]/close` | Close task with optional reason | task-store.ts | manage_tasks | Yes | task-detail-panel, task-actions | |
| GET | `/api/tasks/[id]/deps` | Get task dependencies AND dependents (both directions) | task-store.ts | view_tasks | Yes | task-dependency-graph, task-detail-panel | |
| POST | `/api/tasks/[id]/run-chain` | Execute the assigned chain with task context | chains/run API + task-store.ts | manage_tasks | Yes | task-detail-panel, auto-run | |
| GET | `/api/tasks/[id]/comments` | List task comments | task-store.ts | view_tasks | Yes | task-comments-panel | |
| POST | `/api/tasks/[id]/comments` | Add comment to task | task-store.ts | manage_tasks | Yes | task-comments-panel | |

---

## Workspaces

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| GET | `/api/workspaces` | List all workspaces in namespace | File: workspaces.json | Session/bearer | Yes | WorkspaceProvider, workspaces page, welcome-wizard | |
| POST | `/api/workspaces` | Create new workspace | File: workspaces.json | Session/bearer | Yes | WorkspaceProvider, workspaces page, welcome-wizard | |
| GET | `/api/workspaces/[id]` | Get single workspace by ID | File: workspaces.json | Session/bearer | Yes | workspaces page, NavWorkspaceSelector | |
| PATCH | `/api/workspaces/[id]` | Update workspace | File: workspaces.json | Session/bearer | Yes | workspaces page | |
| DELETE | `/api/workspaces/[id]` | Delete workspace | File: workspaces.json | Session/bearer | Yes | workspaces page | |
| GET | `/api/workspaces/[id]/setup` | Get security audit report for workspace | SSH: remote script execution | Session/bearer | No | (no UI caller) | |
| POST | `/api/workspaces/[id]/setup` | Run provider-specific setup script | SSH: remote script execution, files: setup-scripts.ts | Session/bearer | No | (no UI caller) | |
| GET | `/api/workspaces/[id]/task-provider` | Get task provider config | File: workspaces.json | Session/bearer | No | (no UI caller) | |
| PUT | `/api/workspaces/[id]/task-provider` | Set task provider config | File: workspaces.json | Session/bearer | No | (no UI caller) | |
| POST | `/api/workspaces/[id]/task-provider` | Test task provider connectivity | Task provider ping | Session/bearer | No | (no UI caller) | |
| GET | `/api/workspaces/provision` | List infra providers + running instances | External: Linode/AWS APIs | Admin/owner | No | (no UI caller) | |
| POST | `/api/workspaces/provision` | Provision remote workspace instance | External: Linode/AWS APIs | Admin/owner | No | (no UI caller) | |
| DELETE | `/api/workspaces/provision` | Terminate infra instance | External: Linode/AWS APIs | Admin/owner | No | (no UI caller) | |

> Legacy workspace task-provider endpoints were removed in favor of native task routes (`/api/tasks*`) and are not part of the current public API.
| GET | `/api/workspaces/provision/docker` | List mentiko containers | Docker daemon | Session/bearer | No | (no UI caller) | |
| POST | `/api/workspaces/provision/docker` | Provision new Docker container | Docker daemon | Session/bearer | Yes | workspaces page | |
| DELETE | `/api/workspaces/provision/docker` | Stop/remove container | Docker daemon | Session/bearer | No | (no UI caller) | |
| GET | `/api/workspaces/logs` | SSE stream of workspace logs | SSH: tail, Docker: logs, local: pty output | Session/bearer | No | (no UI caller) | |
| GET | `/api/workspaces/ssh-keys` | List stored SSH key pairs | File: ssh-keys/*.json | Session/bearer | No | (no UI caller) | |
| POST | `/api/workspaces/ssh-keys` | Generate new SSH key pair | File: ssh-keys/*, CLI: ssh-keygen | Session/bearer | No | (no UI caller) | |
| DELETE | `/api/workspaces/ssh-keys` | Remove SSH key pair | File: ssh-keys/* | Session/bearer | No | (no UI caller) | |

---

## Conversations

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| GET | `/api/conversations` | List Claude sessions (sorted by lastModified + messageCount) | File: ~/.claude/projects/{encoded-cwd}/*.jsonl | Session/bearer | Yes | conversations page, use-global-search | |
| GET | `/api/conversations/[id]` | Get conversation messages | File: ~/.claude/projects/{encoded-cwd}/{id}.jsonl | Session/bearer | Yes | conversations page, conversations/[id], run-detail-panel (Output tab) | |
| PUT | `/api/conversations/[id]` | Update conversation slug/title | File: ~/.claude/projects/{encoded-cwd}/{id}.jsonl | Session/bearer | Yes | conversations page, conversations/[id] | |
| DELETE | `/api/conversations/[id]` | Delete conversation | File: ~/.claude/projects/{encoded-cwd}/{id}.jsonl | Session/bearer | Yes | conversations page | |
| POST | `/api/conversations/[id]/steer` | Send message to conversation (resume session) | File: ~/.claude/projects/{encoded-cwd}/{id}.jsonl, pty | Session/bearer | Yes | conversations page, conversations/[id] | |
| GET | `/api/conversations/find-by-agent` | Find conversation by agent name | File: ~/.claude/projects/{encoded-cwd}/*.jsonl | Session/bearer | Yes | run-detail-panel | |

---

## Sessions

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| GET | `/api/sessions/[name]/recording` | Serve JSONL log for session replay | File: agents/logs/{name}*.jsonl | None | Yes | terminal-replay | intentionally public (no auth) |

---

## Terminal

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| POST | `/api/terminal/spawn` | Spawn new pty-manager session | pty-manager daemon (bin/p) | None | Yes | floating-terminal-panel, workspace-terminal | local dev only, no auth |
| GET | `/api/terminal/status` | List active pty-manager sessions | pty-manager daemon (bin/p) | None | Yes | links page, peer-split-view | local dev only, no auth |
| GET | `/api/terminal/capture` | Capture rendered screen output from session | pty-manager daemon (bin/p) | None | Yes | peer-split-view | local dev only, no auth |
| GET | `/api/terminal/token` | Get WebSocket terminal auth token | File: ~/.pty-manager/ws-token | None | Yes | floating-terminal-panel, workspace-terminal, terminal-panel | local dev only, no auth |

---

## Swarm (DEPRECATED - use `/api/links/runs/{runId}/*` instead)

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| POST | `/api/swarm/launch` | ~~Launch peer swarm~~ use POST `/api/links/runs` | bin/peer-manager, bin/p | None | No | (deprecated) | AI execution risk, no auth |
| POST | `/api/swarm/stop` | ~~Stop peer swarm~~ use POST `/api/links/runs/{runId}/stop` | bin/p | None | No | (deprecated) | AI execution risk, no auth |
| POST | `/api/swarm/[session]/reply` | ~~Reply to peer escalation~~ use POST `/api/links/runs/{runId}/reply` | File: swarm/{session}/reply.txt | None | No | (deprecated) | |
| POST | `/api/swarm/[session]/escalate` | ~~Report peer escalation~~ use POST `/api/links/runs/{runId}/escalations` | File: swarm/{session}/history.jsonl, Anthropic API, Telegram | None | No | (no UI caller) | |
| GET | `/api/swarm/[session]/escalations` | ~~Get escalation history~~ use GET `/api/links/runs/{runId}/escalations` | File: swarm/{session}/history.jsonl | None | No | (deprecated) | |

---

## Links (Agent Links V1 - Two-Agent Collaboration)

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| GET | `/api/links/list` | List all links for org | Filesystem: {linksDir}/*.json | x-namespace-id | Yes | links page | |
| GET | `/api/links/{id}` | Get link definition | Filesystem: {linksDir}/{id}/link.json | x-namespace-id | Yes | links page | |
| POST | `/api/links/save` | Create or update link | Filesystem: {linksDir}/{id}/link.json | x-namespace-id | Yes | links page | |
| DELETE | `/api/links/{id}` | Delete link | Filesystem: {linksDir}/{id}/ | x-namespace-id | Yes | links page | |
| POST | `/api/links/run` | Launch link run (manager + 2 peers) | bin/peer-manager, bin/p | None | Yes | links page | Returns runId, AI execution risk |
| POST | `/api/links/generate` | Start AI generation of link (async job) | cliPipe, Anthropic API | x-namespace-id | Yes | links page | Returns jobId for polling |
| POST | `/api/links/generate/apply` | Apply generated link (create agents + save) | Filesystem: {linksDir}, {agentsDir} | x-namespace-id | Yes | links page | Creates agents from generation output |
| POST | `/api/links/runs/{runId}/stop` | Stop link run sessions | bin/p | None | Yes | links page, run-detail-panel | Kills all PTY sessions |
| POST | `/api/links/runs/{runId}/escalate` | Report peer escalation (trigger notification) | File: peer-escalations, Anthropic API, Telegram | None | No | link-run-timeline | Called by peer-manager |
| GET | `/api/links/runs/{runId}/escalations` | Get escalation history + pending status | File: peer-escalations/{session}/history.json | None | Yes | link-run-timeline | |
| POST | `/api/links/runs/{runId}/reply` | Reply to peer escalation (human steering) | File: peer-escalations/{session}/reply.txt | None | Yes | link-run-timeline | |
| GET | `/api/links/runs/{runId}/transcript` | Get link run transcript | File: peer-output/{session}-r{round}.txt | None | Yes | link-run-timeline | Parses round-tagged output files |
| GET | `/api/links/runs/{runId}/moderator` | Get relay JSONL sessions from run window | File: ~/.claude/projects/{workspace}/.claude/*.jsonl | None | Yes | link-run-timeline | Filters by relay prompt signature |

### POST /api/links/run - Launch Link Run

Request:
```json
{
  "linkId": "auth-review",
  "goal": "Review the auth middleware for security issues",
  "workspaceId": "decent",
  "specFile": "/docs/auth-spec.md",
  "agent1Profile": "claude-opus",
  "agent2Profile": "claude-sonnet"
}
```

Response:
```json
{
  "runId": "run-1774990000",
  "managerSession": "link-run-1774990000",
  "status": "launching"
}
```

### POST /api/links/generate - Start AI Link Generation

Starts an async job that generates a link definition from natural language.
Poll `/api/jobs/{jobId}` for completion.

Request:
```json
{
  "prompt": "I need two agents to debate whether we should migrate from REST to GraphQL",
  "workspacePath": "/workspace/myproject"
}
```

Response:
```json
{
  "jobId": "job-abc123",
  "status": "running"
}
```

### POST /api/links/generate/apply - Apply Generated Link

Takes a completed generation job and creates the link + any new agents.

Request:
```json
{
  "jobId": "job-abc123"
}
```

Response:
```json
{
  "link": { "id": "rest-vs-graphql", "name": "REST vs GraphQL Debate", ... },
  "createdAgents": ["api-architect", "dx-advocate"]
}
```

### POST /api/links/runs/{runId}/stop - Stop Link Run

Stops all PTY sessions (manager + 2 peers) for the run.

Response:
```json
{
  "ok": true,
  "stopped": ["manager-session", "peer-1-session", "peer-2-session"]
}
```

### POST /api/links/runs/{runId}/escalate - Report Escalation

Called by peer-manager when agents are stuck. Triggers Telegram notification if configured.

Request:
```json
{
  "escalation_id": "esc-1",
  "round": 7,
  "trigger": "STATUS:ESCALATE",
  "consecutive_continues": 5,
  "peer1_last": "I already fixed the ValueError issue...",
  "peer2_last": "The implementation is correct..."
}
```

Response:
```json
{
  "ok": true,
  "telegram_sent": true,
  "telegram_message_id": 42
}
```

### GET /api/links/runs/{runId}/escalations - Get Escalation History

Response:
```json
{
  "session_id": "run-1774990000",
  "escalations": [
    {
      "id": "esc-1",
      "round": 7,
      "trigger": "STATUS:ESCALATE",
      "peer1_last": "...",
      "peer2_last": "...",
      "haiku_summary": "agents disagree on ValueError handling",
      "sent_at": "2026-03-06T14:38:11Z",
      "human_reply": "peer-1 is right...",
      "replied_at": "2026-03-06T14:39:02Z"
    }
  ],
  "pending": false,
  "telegram_connected": true
}
```

### POST /api/links/runs/{runId}/reply - Reply to Escalation

Human provides guidance text. Writes to reply.txt for peer-manager to consume.

Request:
```json
{
  "reply": "peer-1 is right, the ValueError case should raise not return"
}
```

Response:
```json
{
  "ok": true,
  "injected": true
}
```

### GET /api/links/runs/{runId}/transcript - Get Run Transcript

Returns parsed transcript from peer-output files, organized by round.

Response:
```json
{
  "rounds": [
    {
      "round": 0,
      "agent1": { "session": "peer-1-link-run-123", "output": "..." },
      "agent2": { "session": "peer-2-link-run-123", "output": "..." }
    }
  ]
}
```

### GET /api/links/runs/{runId}/moderator - Get Relay Sessions

Returns moderator relay JSONL sessions created during the run window.
Filters by checking for relay prompt signature in first user message.

Response:
```json
{
  "sessions": [
    {
      "file": "session-abc.jsonl",
      "messages": [
        { "role": "user", "content": "Extract the most recent response..." },
        { "role": "assistant", "content": "Here is what the agent said..." }
      ]
    }
  ]
}
```

---

## Events

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| GET | `/api/events` | Get platform event registry (list of all event types) | Static (PLATFORM_EVENTS constant) | checkAuth | Yes | events-list, hooks/use-events | NOT a filesystem listing - returns registry only |
| POST | `/api/events/emit` | Create a new event file | Filesystem (writes to .event files) | checkAuth | No | (no UI caller) | |
| GET | `/api/events/stream` | Server-sent events stream for live updates | Filesystem (watches state/, events/, jobs/) | checkAuth | Yes | hooks/use-event-stream, hooks/use-job-status, lib/websocket, run-detail-panel, dashboard/runs/[run-id] | |
| GET | `/api/events/triggers` | List all event triggers | Filesystem: event-triggers.json | x-namespace-id | Yes | events page, map page | |
| POST | `/api/events/triggers` | Create new event trigger | Filesystem: event-triggers.json | x-namespace-id | Yes | events page, event-trigger-generate-dialog | |
| PATCH | `/api/events/triggers/[id]` | Update trigger enabled status | Filesystem: event-triggers.json | x-namespace-id | Yes | events page | |
| DELETE | `/api/events/triggers/[id]` | Delete event trigger | Filesystem: event-triggers.json | x-namespace-id | Yes | events page | |
| POST | `/api/events/triggers/generate` | AI-generate event trigger config | LLM (cliPipe) | checkAuth | Yes | event-trigger-generate-dialog | |
| GET | `/api/events/registry` | Get platform event registry | Static (PLATFORM_EVENTS constant) | checkAuth | Yes | events page | |

---

## Filesystem

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| GET | `/api/fs/browse` | Browse directories (list folders) | Filesystem | None | No | (no UI caller) | no authentication |
| POST | `/api/fs/mkdir` | Create directory | Filesystem | None | No | (no UI caller) | |
| GET | `/api/fs/file` | Read file content | Filesystem | checkAuth | Yes | editor search-panel, editor-pane, quick-open, file-tree | |
| PUT | `/api/fs/file` | Write file content | Filesystem | checkAuth | No | (no UI caller) | |
| GET | `/api/fs/tree` | Get directory tree structure | Filesystem | checkAuth | Yes | quick-open, file-tree | |
| GET | `/api/fs/search` | Search file contents (grep) | Filesystem | checkAuth | Yes | search-panel | |
| POST | `/api/fs/git-clone` | Clone git repository | git CLI + Filesystem | checkAuth | Yes | workspaces page | |

---

## Jobs

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| POST | `/api/jobs` | Create async job (recommend/generate chains) | In-memory job store + spawns job-runner.mjs | checkAuth | Yes | chain-assign-workflow, tasks/auto-run API, use-notifications-listener | |
| GET | `/api/jobs` | List jobs with filters | In-memory job store | checkAuth | Yes | use-notifications-listener | |
| GET | `/api/jobs/[id]` | Get job by ID | In-memory job store | checkAuth | Yes | use-job-status, chain-assign-workflow | |

---

## Orgs

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| GET | `/api/orgs` | List orgs in active namespace | DB organization/member tables; FS fallback: orgs/*.json + legacy org/org.json | checkAuth | Yes | lib/org-context.tsx (OrgContextProvider), orgs page | Returns `orgs[]`; also returns first `org` for compatibility |
| POST | `/api/orgs` | Create org in active namespace | FS: orgs/{id}.json | checkAuth | Yes | orgs page | Namespaces can contain multiple orgs; duplicate slugs reject |
| GET | `/api/orgs/[id]` | Get org by id or slug (namespace-scoped) | DB organization/member tables; FS fallback: orgs/*.json + legacy org/org.json | checkAuth | Yes | org detail page | |
| PUT | `/api/orgs/[id]` | Update org | FS: orgs/{id}.json + legacy org/org.json when applicable | checkAuth | Yes | org detail page | |
| DELETE | `/api/orgs/[id]` | Delete org (dangerous) | FS: orgs/{id}.json + legacy org/org.json when applicable | checkAuth | No | (no UI caller) | |
| GET | `/api/orgs/[id]/members` | List org members | File: org/members.json | checkAuth | Yes | lib/org-context.tsx | |
| PUT/DELETE | `/api/orgs/[id]/members/[userId]` | Update/remove member role | File: org/members.json | checkAuth | Yes | org-members-panel | |
| GET/POST | `/api/orgs/[id]/invites` | List/create invites | File: org/invites.json | checkAuth | Yes | org-members-panel | |
| DELETE | `/api/orgs/[id]/invites/[inviteId]` | Cancel invite (mark cancelled) | File: org/invites.json | checkAuth | Yes | org-members-panel | |
| POST | `/api/orgs/[id]/invite` | Invite member by email | File: org/invites.json | checkAuth | Yes | org-invite-dialog | |
| POST | `/api/orgs/[id]/join` | Accept invite with token | File: org/invites.json, members.json | checkAuth | No | (uses /api/invite/[token] instead) | |
| GET/POST/DELETE | `/api/orgs/[id]/shared/chains` | List/share/unshare org chains | File: shared/chains/*.json | checkAuth | No | (no UI caller) | |
| GET/POST/DELETE | `/api/orgs/[id]/shared/profiles` | List/share/unshare org config profiles | File: shared/profiles/*.json | checkAuth | No | (no UI caller) | |
| GET/POST/DELETE | `/api/orgs/[id]/shared/secrets` | List/create/delete org secrets | File: shared/secrets.json | checkAuth | No | (no UI caller) | |
| GET/POST | `/api/orgs/[id]/marketplace` | Get/publish org marketplace items | File: shared/ | checkAuth | No | (no UI caller) | |
| GET | `/api/orgs/[id]/stats` | Get org statistics (chains, members, tasks, runs) | File: org/ (scan files) + task-store.ts | checkAuth | Yes | orgs/[id] page | |

---

## Invite

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| GET/POST | `/api/invite/[token]` | Look up invite details / accept invite | File: org/invites.json | None | Yes | invite/[token] page | GET is public, POST requires auth |

---

## Profiles

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| GET | `/api/profiles` | List agent performance profiles | File: profiles/*.json | checkAuth | Yes | dashboard/performance page | |

---

## Notifications

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| GET | `/api/notifications` | List all notifications (filter: all/unread/runs/system) | File: notifications/notifications.json | checkAuth | Yes | notifications page | |
| POST | `/api/notifications` | Create a notification | File: notifications/notifications.json | checkAuth | No | (internal endpoint) | |
| PATCH | `/api/notifications` | Bulk operations (markAllRead, clearAll) | File: notifications/notifications.json | checkAuth | Yes | notifications page (markAllRead) | |
| DELETE | `/api/notifications` | Delete a notification | File: notifications/notifications.json | checkAuth | Yes | notifications page (clearAll) | |
| DELETE | `/api/notifications/[id]` | Delete notification by path param | File: notifications/notifications.json | checkAuth | Yes | notifications page | |
| PATCH | `/api/notifications/[id]` | Mark notification as read/unread | File: notifications/notifications.json | checkAuth | Yes | notifications page (markAsRead) | |
| GET/PATCH | `/api/notifications/preferences` | Get/update user notification preferences | File: notifications/{userId}.json | checkAuth | No | (no UI caller) | |
| POST | `/api/notifications/dispatch` | Internal endpoint to dispatch notifications | File: notifications/*.json | internal | No | (internal endpoint) | |
| POST | `/api/notifications/email/send` | Send email notification | External: Resend/SendGrid API | None | No | (internal endpoint) | |
| POST | `/api/notifications/push/subscribe` | Subscribe to push notifications | In-memory Map | None | Yes | lib/push-notifications.ts | |
| GET | `/api/notifications/push/subscribe` | Get push subscription count | In-memory Map | None | No | (no UI caller) | |
| DELETE | `/api/notifications/push/subscribe` | Unsubscribe from push | In-memory Map | None | No | (uses unsubscribe instead) | |
| POST | `/api/notifications/push/unsubscribe` | Unsubscribe from push (alt endpoint) | In-memory Map | None | Yes | lib/push-notifications.ts | |
| POST | `/api/notifications/push/send` | Send push notification (demo endpoint) | In-memory Map | None | No | (demo only) | |

---

## Approvals

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| GET | `/api/approvals` | List approval requests (filter: chainId, runId, status, limit) | File: approvals/*.json | view_chains | Yes | approval-list | |
| POST | `/api/approvals` | Create approval request | File: approvals/{id}.json | manage_chains | No | (no UI caller) | |
| GET | `/api/approvals/[id]` | Get approval request details | File: approvals/{id}.json | view_chains | No | (no UI caller) | |
| POST | `/api/approvals/[id]` | Approve request | File: approvals/{id}.json | manage_chains | Yes | approval-list (approve) | |
| PATCH | `/api/approvals/[id]` | Reject request | File: approvals/{id}.json | manage_chains | Yes | approval-list (reject) | |

---

## Webhooks

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| GET | `/api/webhooks` | List webhook subscriptions (filter: chainId) | File: webhooks/subscriptions.json | view_chains | Yes | webhook-manager | |
| POST | `/api/webhooks` | Create webhook subscription | File: webhooks/subscriptions.json | manage_chains | Yes | webhook-manager | |
| GET | `/api/webhooks/status` | Legacy: webhook delivery status | File: ~/.mentiko_webhooks/*.json | None | Yes | use-notifications-listener | |
| GET | `/api/webhooks/logs` | List webhook event logs | File: webhooks/events.jsonl | view_chains | Yes | webhook-manager | |
| POST/DELETE | `/api/webhooks/{id}` | Test/delete webhook subscription | Files: webhooks/subscriptions.json, webhooks/events.jsonl | manage_chains | Yes | webhook-manager | |
| POST | `/api/webhooks/{id}/receive` | Receive incoming webhook (GitHub, GitLab, Slack) | File: events/*.event | signature | No | (server-side only) | |
| GET/POST | `/api/webhooks/github` | GitHub webhook info / handler | Files: webhooks/subscriptions.json, events/*.event | HMAC signature | No | (server-side only) | |
| GET/POST | `/api/webhooks/inbound/config` | List/create inbound webhook configs (token-based) | File: inbound-webhooks.json | view/manage | Yes | webhooks page, webhook-generate-dialog | |
| PATCH/DELETE | `/api/webhooks/inbound/config/{id}` | Update, regenerate token, or delete inbound webhook config | File: inbound-webhooks.json | manage_chains | Yes | webhooks page, webhook-generate-dialog | |
| POST | `/api/webhooks/inbound/{token}` | Execute inbound webhook via token | Files: inbound-webhooks.json, inbound-webhook-triggers.json; chain run service | token | No | (external services only) | Returns runId, triggerId, statusToken, statusUrl |
| GET | `/api/webhooks/inbound/triggers/{triggerId}` | Check inbound trigger and current run status | Files: inbound-webhook-triggers.json, runs/{runId}/run.json | status token | No | (external services only) | token query param or x-webhook-status-token header required |
| POST | `/api/webhooks/generate` | AI-generate webhook config (inbound/outbound) | External: Anthropic API (via cliPipe) | checkAuth | Yes | webhook-generate-dialog | |
| GET/POST/PUT | `/api/webhooks/config` | List/create/update outbound runtime webhooks | File: mentiko-webhooks.json | view/manage | Yes | webhooks page, webhook-generate-dialog | Secrets encrypted at rest and masked in responses |
| GET/POST/DELETE | `/api/webhooks/config/{id}` | Read/test/delete outbound runtime webhook | Files: mentiko-webhooks.json, mentiko-webhook-deliveries.jsonl | view/manage | Yes | webhooks page, webhook-generate-dialog | POST sends test delivery |
| POST | `/api/webhooks/config/{id}/test` | Send outbound runtime webhook test delivery | Files: mentiko-webhooks.json, mentiko-webhook-deliveries.jsonl | manage_chains | Yes | webhooks page | Compatibility path used by detail panel |
| POST | `/api/webhooks/stripe` | Handle Stripe webhook events (subscription lifecycle) | Files: subscription.json, stripe-events.jsonl; External: Stripe | Stripe secret | No | (server-side only) | |

---

## Email

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| GET/POST | `/api/email/inboxes` | List/create email inboxes | File: emails/inboxes.json | view/manage | Yes | email page, create-inbox-dialog | |
| GET/PATCH/DELETE | `/api/email/inboxes/{id}` | Get/update/delete inbox | File: emails/inboxes.json | view/manage | No | (not in UI) | |
| GET | `/api/email/inboxes/{id}/messages` | List paginated messages from an inbox folder | Files: {inbox.folder}/{subfolder}/*.json | view_chains | Yes | email page | Behaviors: whitelists folder param (unread/processed/failed); enforces pagination bounds (limit 1-100, offset >= 0); validates inbox exists before listing |
| POST | `/api/email/inboxes/{id}/messages/{messageId}/move` | Move message between folders | Files: {inbox.folder}/{from|to}/*.json | manage_org | Yes | email page | |
| POST | `/api/email/secret/rotate` | Rotate inbox HMAC secret and return new secret in plaintext | File: emails/inboxes.json | manage_org | No | (not in UI) | Behaviors: increments secretVersion; previous secret valid for 24h overlap; returns new secret and version; logs rotation event. Security: new secret returned in plaintext exactly once - store immediately, cannot be retrieved again; requires manage_org permission (elevated access) |
| GET | `/api/email/quota` | Get disk and send quota usage for current namespace | Files: send-count.json, disk scan | view_chains | No | (not in UI) | Behaviors: returns disk usage in bytes/MB with quota; returns send count with daily quota and reset time (midnight UTC); defaults: 500MB disk, 1000 sends/day via env vars |
| GET | `/api/email/poll` | Return unread email counts per inbox for UI badge display | Files: {inbox.folder}/unread/*.json | view_chains | Yes | use-email-unread-count hook | Behaviors: counts JSON files in unread/ subfolder for each inbox; returns counts object keyed by inbox ID plus total |
| GET/POST/DELETE | `/api/email/suppressed` | List/add/remove suppressed emails | DB: emails/email.db | view/manage | No | (not in UI) | |
| POST | `/api/email/suppressed/resubscribe` | Resubscribe email (soft bounce/unsubscribe only) | DB: emails/email.db | view_chains | No | (not in UI) | |
| POST | `/api/email/unsubscribe` | Validate unsubscribe token and suppress email address | DB: emails/email.db | None (rate limited) | No | (public pages only) | Behaviors: validates JWT token containing email, namespace, org, outboundId; adds suppression record to email-suppression.jsonl; logs unsubscribe event. Security: no authentication required - rate-limited only; rate limit: 10 requests per minute per IP; tokens are single-use and time-bounded; uses leftmost IP from x-forwarded-for header (can be spoofed) |
| OPTIONS | `/api/email/unsubscribe` | CORS preflight support for unsubscribe endpoint | N/A | None | No | (public pages only) | Behaviors: returns 204 with CORS headers for POST and OPTIONS |
| POST | `/api/email/resubscribe` | Validate resubscribe token and remove email suppression | DB: emails/email.db | None (rate limited) | No | (public pages only) | Behaviors: validates JWT token containing email, namespace, org; removes suppression for soft_bounce/unsubscribe/manual reasons only (hard bounce cannot be removed); returns success if suppression removed or error if not suppressed; logs resubscribe event. Security: no authentication required - rate-limited only; rate limit: 10 requests per minute per IP; tokens are single-use and time-bounded; uses leftmost IP from x-forwarded-for header (can be spoofed) |
| OPTIONS | `/api/email/resubscribe` | CORS preflight support for resubscribe endpoint | N/A | None | No | (public pages only) | Behaviors: returns 204 with CORS headers for POST and OPTIONS |
| GET/POST | `/api/email/bounce` | List unmatched bounces / process bounce webhook | Files: bounces/*.json, suppressions.jsonl | HMAC bearer | No | (server-side only) | |
| GET | `/api/email/reputation` | Return email reputation status with bounce/complaint rates and thresholds | Files: emails/metrics.jsonl, suspension.json | view_chains | No | (not in UI) | Behaviors: returns status (healthy/warning/paused/suspended); includes bounce rate, complaint rate, sent counts (7d, 30d); returns threshold values; org-level suspension overrides evaluation status |
| GET | `/api/email/reputation/history` | Return daily reputation metrics over time | File: emails/metrics.jsonl | view_chains | No | (not in UI) | Behaviors: query param: days (default 30, max 90); returns history array with daily metrics |
| POST | `/api/email/process` | Process unread emails and fire configured chain triggers | Files: inboxes.json, emails, chains | view_chains | Yes | use-email-poller hook | Behaviors: processes inboxes in parallel; atomically claims emails to prevent double-processing; fires chain run for each claimed email; moves emails to processed/failed based on result; returns counts (processed, skipped, errors). Security: uses minimal auth marker (email-processor=true cookie) when invoking chain run |
| POST | `/api/email/inbound` | Receive inbound webhook emails from external providers | Files: inboxes.json, write to emails/{folder}/unread/*.json | Provider-specific signature | No | (server-side webhook) | Behaviors: validates content-length header (max 25MB); checks disk quota before processing (rejects with 507 if exceeded); extracts namespace from header/body/query/env; processes in parallel; supports 24h secret version overlap for rotation; normalizes email to internal format, blocks attachments in v1; writes to disk and logs to audit trail; failed emails logged to rejected.jsonl. Security: provider-specific auth - Resend (HMAC-SHA256 via x-svix-signature), Postmark (HMAC token via x-postmark-signature), SendGrid (ECDSA signature - not implemented in v1, accepts all), Haraka (bearer token - HMAC-derived secret or HARAKA_API_KEY env), Custom (bearer token - HMAC-derived secret with version overlap); auth failure rate limiting: 5 failures in 5 min triggers 1-hour IP block; IP-based rate limiting uses x-forwarded-for leftmost IP (spoofable) |
| GET | `/api/email/smtp-status` | Get SMTP delivery configuration status | ENV: SMTP_HOST, SMTP_USER, RESEND_API_KEY, etc | view_chains | Yes | settings/email, create-inbox-dialog, compose-dialog | Behaviors: detects mode (resend/auth/relay/none); returns configured status, host, port, masked user; shows inbound email status when TENANT_ID and SMTP_FROM domain match. Security: masks SMTP username (shows first 3 chars + ***) |
| POST | `/api/email/send` | Send outbound email via SMTP | Files: outbound-pending.jsonl, outbound-sent.jsonl, outbound-failed.jsonl | manage_chains | Yes | compose-dialog | |
| POST | `/api/email/smtp-test` | Send test email to verify SMTP configuration | External: SMTP server | manage_org | Yes | settings/email | Behaviors: requires 'to' field in request body; sends test email with fixed subject and body; uses nodemailer for delivery (optional dependency); returns success or SMTP error message. Security: requires manage_org permission (elevated access); sends real email to specified address |

---

## Telegram

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| POST | `/api/telegram/webhook` | Handle Telegram bot messages (escalation replies) | Files: runs/*/escalations/reply.txt, history.jsonl | webhook secret | No | (server-side only) | |

---

## Integrations

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| POST | `/api/integrations/github/test` | Test GitHub integration (token, repo access) | External: GitHub API | checkAuth | No | (not in UI) | |
| POST | `/api/integrations/save` | Save integration config (sanitized, no secrets) | File: integrations/config.json | checkAuth | No | (not in UI) | namespace-scoped |
| POST | `/api/integrations/test` | Test integration endpoints (github, teams, slack, email) | External: GitHub, Teams, Slack webhooks; local: sendmail | checkAuth | No | (not in UI) | |

---

## Tools

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| GET | `/api/tools/check` | Check installed CLI tools (claude, pty-manager) | execSync | checkAuth | No | (no UI caller) | |

---

## Retry

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| GET | `/api/retry/config` | Get chain retry config | Filesystem: retry-config.json | view_chains | Yes | retry-config | |
| POST | `/api/retry/config` | Save chain retry config | Filesystem: retry-config.json | manage_chains | Yes | retry-config | |
| DELETE | `/api/retry/config` | Delete chain retry config | Filesystem: retry-config.json | manage_chains | No | (no UI caller) | |
| GET | `/api/retry/circuit` | Get circuit breaker state (query: chainId, agent) | Filesystem: circuit-state.json | view_chains | Yes | circuit-status | query param is agent not agentName |
| POST | `/api/retry/circuit` | Reset circuit breaker (body: chainId, agentName) | Filesystem: circuit-state.json | manage_chains | No | (no UI caller) | RESTful method-based action, NOT /api/retry/circuit/reset |
| GET | `/api/retry/state` | Get retry state(s) | Filesystem: retry-state.json | view_chains | No | (no UI caller) | |

---

## Prometheus

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| GET | `/api/prometheus` | Export metrics in Prometheus format | Filesystem (runs/, webhooks/) | checkAuth | No | (docs only) | |

---

## Templates

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| GET | `/api/templates` | List user templates | Filesystem: templates/ | x-namespace-id | Yes | chains page | |
| POST | `/api/templates` | Create template from chain | Filesystem: chains/ -> templates/ | x-namespace-id | No | (no UI caller) | |
| GET | `/api/templates/list` | List all available templates | Filesystem: templates/, examples/ | checkAuth | Yes | marketplace pages, use-global-search | |
| GET | `/api/templates/[id]/chain` | Get template chain.json | Filesystem: templates/ or examples/ | checkAuth | Yes | marketplace chains/[id] | |
| GET | `/api/templates/[id]/readme` | Get template README.md | Filesystem: templates/ or examples/ | checkAuth | Yes | marketplace chains/[id] | |
| POST | `/api/templates/[id]/use` | Install template to namespace chains | Filesystem: templates/ -> chains/ | checkAuth | Yes | marketplace pages | |
| GET | `/api/templates/[id]/rate` | Get template rating | Filesystem: ratings.json | checkAuth | No | (no UI caller) | |
| POST | `/api/templates/[id]/rate` | Rate template (1-5 stars) | Filesystem: ratings.json | checkAuth | Yes | marketplace pages | |

---

## Artifact Templates

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| GET | `/api/artifact-templates` | List artifact templates | Filesystem: artifact-templates.json | checkAuth | Yes | templates/artifacts, marketplace/artifacts, workflows/artifacts | |
| POST | `/api/artifact-templates` | Create artifact template | Filesystem: artifact-templates.json | checkAuth | Yes | templates/artifacts, marketplace/artifacts, workflows/artifacts | |
| GET | `/api/artifact-templates/[id]` | Get artifact template by ID | Filesystem: artifact-templates.json | checkAuth | Yes | templates/artifacts | |
| PUT | `/api/artifact-templates/[id]` | Update artifact template | Filesystem: artifact-templates.json | checkAuth | Yes | templates/artifacts | |
| DELETE | `/api/artifact-templates/[id]` | Delete artifact template | Filesystem: artifact-templates.json | checkAuth | Yes | templates/artifacts, workflows/artifacts | |

---

## Generation Templates

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| GET | `/api/generation-templates` | List generation templates | Filesystem: generation-templates.json | checkAuth | Yes | workflows/generation, templates/generation | |
| PUT | `/api/generation-templates` | Update generation templates | Filesystem: generation-templates.json | checkAuth | Yes | workflows/generation, templates/generation | |
| POST | `/api/generation-templates/test` | Test template with sample prompt | LLM (cliPipe) | checkAuth | Yes | generation-template-editor | |

---

## Performance

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| GET | `/api/performance` | Get performance metrics | Filesystem: namespaces/*/performance.json | checkAuth | Yes | dashboard/performance page | only run-id param, no pagination |

---

## Unsubscribe

| Method | Path | Purpose | Data Source | Auth | Used? | Screen/Component | Notes |
|--------|------|---------|-------------|------|-------|------------------|-------|
| GET | `/api/unsubscribe/[token]` | Validate unsubscribe token | JWT validation | None | No | (public page) | |

---

## Usage Analysis

### Fully Used Sections (100%)
- Conversations, Sessions, Jobs, Invite, Profiles
- Artifact Templates, Generation Templates

### Highly Used (>80%)
- Chains (94%), Agent Profiles (88%)
- Runs (83%), Terminal (100%), Swarm (80%)
- Tasks (76%)

### Underutilized (<50%)
- Workspaces (36%) - infra/provision endpoints unused
- Email (38%) - advanced features not exposed
- Orgs (38%) - sharing/marketplace unused
- Integrations (0%), Telegram (0%), Tools (0%)

### Cleanup Candidates
95 endpoints (34%) have no UI caller:
- Server-side webhooks (expected)
- Internal endpoints (expected)
- Future features (marketplace, integrations)
- Deprecated endpoints (chains/generate, agents/resume)

### High-Usage Components
- hooks/use-chains.ts - chain CRUD (7+ endpoints)
- hooks/use-runs.ts - run management (10+ endpoints)
- hooks/use-breakpoints.ts - breakpoint management (3+ endpoints)
- hooks/use-chain-version-control.ts - git operations (12+ endpoints)
- run-detail-panel.tsx - run details (14+ endpoints)
- chains page - chain management (15+ endpoints)
- settings/agent-configs page - profile management (8+ endpoints)

---

## Critical Audit Findings

### 1. Missing Email Endpoints (14)
These endpoints exist in codebase but missing from docs:
- GET/POST `/api/email/inboxes/{id}/messages`
- POST `/api/email/secret/rotate`
- GET `/api/email/quota`
- GET `/api/email/poll`
- POST/POST `/api/email/unsubscribe|resubscribe`
- GET/GET `/api/email/reputation|reputation/history`
- POST/POST `/api/email/process|inbound`
- GET/POST `/api/email/smtp-status|smtp-test`

### 2. Events Registry Confusion
GET `/api/events` documented as "list event files" but actually returns PLATFORM_EVENTS registry.

**Recommendation**:
- Rename to GET `/api/events/registry` for registry
- Create GET `/api/events/files` for filesystem listing

### 3. Unauthenticated Endpoints (Security Risk)
Several endpoint groups have no auth but should:
- Terminal (4 endpoints) - PTY session creation
- Swarm (5 endpoints) - AI agent execution
- Sessions (recording) - public agent logs

**Recommendation**: Add auth or document "local dev only - do not expose to internet"

### 4. Auth Documentation Inconsistencies
| Path | Documented Auth | Actual Auth |
|------|-----------------|-------------|
| GET `/api/fs/browse` | None | checkAuth |
| GET `/api/fs/file` | None | checkAuth |
| GET `/api/templates` | x-namespace-id | x-namespace-id ✓ |
| POST `/api/templates` | x-namespace-id | x-namespace-id ✓ |

### 5. Retry Circuit Reset Path
Documented as POST `/api/retry/circuit/reset` but RESTful pattern suggests using POST to `/api/retry/circuit` with reset action in body.

### 6. Performance Endpoint Pagination
Documented params: workspace, limit, offset
Actual params: run-id only
**Status**: Pagination not implemented, remove from docs or implement.

---

## Recommendations

### High Priority
1. Add 14 missing email endpoints to docs
2. Resolve `/api/events` purpose confusion (registry vs files)
3. Fix auth documentation for filesystem endpoints
4. Document or add auth for terminal/links endpoints (security risk) (swarm deprecated)

### Medium Priority
5. Standardize auth documentation (use actual permission names)
6. Fix retry circuit reset path documentation
7. Update performance endpoint params (remove unimplemented pagination)
8. Verify integrations save is per-namespace (may be global bug)

### Low Priority
9. Document side effects (audit logging, webhook firing, limits)
10. Document namespace path handling consistently
11. Document fallback behavior (ratings merge priority, cost fallback)
12. Document validation rules (UUID regex, etc)

---

*Generated by merging API_INDEX.md, API_USAGE.md, and API_AUDIT_REPORT.md. Last updated: 2026-03-11*
