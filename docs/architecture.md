# mentiko architecture

Mentiko is an event-driven AI agent orchestration platform. Users define
chains in JSON, and Mentiko runs each agent in an isolated PTY session with
file-backed run state, event files, and web/API visibility.

This document describes the current platform architecture. For the detailed
chain runner flow, see `docs/orchestration/chain-runner-flow.md`. For the exact
runner-v2 component map and HTTP-to-next-agent lifecycle, see
`docs/RUNNER_V2_ARCHITECTURE.md`; the machine-readable migration contract is
`docs/orchestration/contracts/runner-v2-contract.json`.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                              mentiko system                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────────────────────┐    │
│  │     cli     │     │   web ui    │     │          rest api           │    │
│  │ bin/mentiko │     │ web/app     │     │ web/app/api/**/route.ts     │    │
│  └──────┬──────┘     └──────┬──────┘     └──────────┬──────────────────┘    │
│         │                   │                       │                       │
│         └───────────────────┴───────────────────────┘                       │
│                             │                                               │
│                             ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         launch boundary                              │    │
│  │  cli: bin/mentiko run                                                │    │
│  │  api: /api/chains/run -> web/lib/runs/chain-run-service.ts           │    │
│  └───────────────────────────────┬─────────────────────────────────────┘    │
│                                  │                                          │
│                                  ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                      orchestration layer                             │    │
│  │  lib/chain-runner.sh -> typed completion entrypoint                  │    │
│  │  typed event lifecycle | typed chain watcher | typed watchdog        │    │
│  │  scheduler.sh | routing-lib.sh | run-lib.sh | agent-functions.sh     │    │
│  └───────────────────────────────┬─────────────────────────────────────┘    │
│                                  │                                          │
│                                  ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         execution layer                              │    │
│  │  pty-mgr daemon + session-transport.sh                               │    │
│  │  agent CLIs and custom profile commands                              │    │
│  └───────────────────────────────┬─────────────────────────────────────┘    │
│                                  │                                          │
│                                  ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                           data layer                                 │    │
│  │  data root: ~/.mentiko/namespaces/{namespace}/...                    │    │
│  │  chains, agents, runs, jobs, events, tasks, decisions, auth          │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## source of truth

The runtime truth is code, contracts, and observed state, in that order:

- `bin/mentiko` dispatches `mentiko run` to `lib/chain-runner.sh`.
- `web/app/api/chains/run/route.ts` calls `startChainRun`.
- `web/lib/runs/chain-run-service.ts` prepares run state and spawns the chain
  runner through `/bin/zsh -lc`.
- `docs/orchestration/contracts/runner-v2-contract.json` keeps runner-v2
  side-by-side and shell-default.
- `web/processes.dev.json` and `web/processes.json` describe the supervised
  platform processes, not the chain engine itself.

Do not treat stale references to `lib/chain-runner.mjs` as current. That
runner is retired; production chains run through `lib/chain-runner.sh`.

## entrypoints

### cli

The terminal entrypoint is:

```bash
cd /path/to/mentiko
./bin/mentiko run <chain.json> --workspace /abs/path
```

Important flags:

- `--workspace <path>`: overrides the chain's configured project root.
- `--task <id>`: binds the run to a task.
- `--start <agent-id>`: resumes or starts at a specific agent.
- `--parallel <ids...>`: starts a fan-out branch.
- `--dry-run`: validates and prints the chain graph.
- `--debug`: enables step-through debug behavior.

`bin/mentiko` also exposes session helpers (`list`, `peek`, `send`, `kill`),
chain generation, validation, graph preview, schedule/application CLI helpers,
and import helpers for decisions and generation jobs.

### web and rest api

The primary HTTP launch path is:

```text
POST /api/chains/run
  -> web/app/api/chains/run/route.ts
  -> web/lib/runs/chain-run-service.ts:startChainRun
  -> /bin/zsh -lc "<bin>/mentiko run <run-dir>/chain.json ..."
```

The API route enforces auth and permissions before launch. `startChainRun`
handles workspace authorization, profile resolution, run directory creation,
`run.json` initialization, webhook/audit notification, child environment
construction, and detached process spawning.

Several product surfaces are wrappers around the same launch service:

- task run-chain routes call `/api/chains/run`.
- schedules call `startChainRun` or the same internal API path.
- webhooks load a saved chain and call `startChainRun`.
- decision and generation flows call `startChainRun` with metadata.
- MCP ops routes delegate to existing web routes.

These wrappers are launch surfaces, not separate engines.

### mcp ops

The MCP bridge is a headless control surface for tools, context, tasks,
terminal operations, and run launch. It talks to web ops routes such as:

- `/api/mentiko-mcp/ops/context/runs`
- `/api/mentiko-mcp/ops/tasks/run-chain`
- `/api/mentiko-mcp/ops/tasks/generate`

The bridge is not the chain engine. It delegates to the same HTTP/runtime
paths as the web product.

### process manager

`web/lib/process-manager.ts` supervises long-running platform processes.
It is the app supervisor, not the chain runner.

Dev process config: `web/processes.dev.json`

- `pty-mgr`: repo wrapper, daemonized.
- `ws-terminal`: terminal websocket bridge on port 3099.
- `worker`: background worker.
- `platform`: `next dev` on port 3200.
- `kollabor-engine`: optional local engine on port 7433.

Production process config: `web/processes.json`

- `pty-mgr`: `/usr/local/bin/pty-mgr daemon`.
- `ws-terminal`: compiled websocket bridge.
- `kollabor-engine`: optional service.
- `platform`: standalone Next server.
- `worker`: compiled background worker.

In local development, `npm run dev` runs doctor preflight and then the process
manager. In normal dev sessions this is already owned by tmux `mentiko-dev`;
do not start a second copy without checking the existing session.

## orchestration model

Mentiko's current chain orchestration is hybrid TypeScript/shell and event-driven.

The key point: `chain-runner.sh` is not a long loop over every agent. It
launches one matching agent, starts the required companion monitor, writes
state, and exits. When an agent completes, the monitor invokes the typed
completion launcher. The typed entrypoint processes the handoff and accepts the
next agent or branch before it consumes the parent event.

Core files:

- `lib/chain-runner.sh`: chain validation, agent/profile resolution, run
  initialization, concurrency admission, PTY agent launch.
- `web/lib/runner-v2/completion-entrypoint.ts`: completion capture, event
  matching, artifacts, retries, routing, fan-in/fan-out, and run completion.
- `lib/agent-functions.sh`: PTY session helpers and monitor wiring.
- `lib/session-transport.sh`: transport abstraction over `pty-mgr`.
- `web/lib/runner-v2/event-emitter.ts`: writes validated file-backed events.
- `web/lib/runner-v2/event-lifecycle.ts`: strictly lists, finds, marks, and archives runner events behind one filesystem claim.
- `web/lib/runner-v2/chain-watcher-service.ts`: watches event files and launches chains from the background worker.
- `web/lib/runner-v2/watchdog.ts`: performs stalled-run recovery and scoped cleanup from the background worker.
- `lib/run-lib.sh`: run object creation and locked `run.json` updates.
- `lib/concurrency-cap.sh`: shared chain concurrency gate.
- `lib/scheduler.sh`: schedule evaluation and scheduled launch.
- `lib/routing-lib.sh`: branch and fan-in/fan-out routing helpers.

Flow:

1. A user, API route, MCP tool, schedule, webhook, or event asks to run a chain.
2. The launch path writes a run directory and chain snapshot.
3. `chain-runner.sh` validates the chain and resolves agent refs/profiles.
4. The independently supervised typed background worker owns the watchdog and chain watcher; chain startup creates no watcher sessions.
5. The runner admits the chain through the concurrency cap.
6. The runner starts exactly the selected agent or agent set in PTY sessions.
7. A companion monitor watches for `AGENT_COMPLETE` or declared event files.
8. The typed completion entrypoint captures output and artifacts.
9. Completion routing either starts the next agent, starts parallel agents,
   retries, blocks, fails, or marks the run completed.

## runner-v2 boundary

Runner-v2 is an opt-in side-by-side migration path. It is not the default
engine.

Current contract:

- `default_runner` is `shell`.
- `MENTIKO_RUNNER_V2=1` enables the initial runner-v2 launch path.
- completion is unconditionally typed; `MENTIKO_RUNNER_V2_COMPLETION=1` is a
  forced compatibility marker, not a selector.
- local typed launch is fail-closed for every unsupported/planning failure;
  SSH/Docker use the direct external `mentiko run` product command only.
- typed completion is always fail-closed; it does not
  fall through to shell completion after a typed error or unsupported result.
- typed routing starts exact same-run targets through
  `runner-v2-launch-agent`, then verifies run agent, session, and `AgentAttempt`
  state before consuming the parent event.

Current web behavior:

```text
startChainRun
  if MENTIKO_RUNNER_V2 enabled:
    try web/lib/runner-v2/controller.ts
  else:
    spawn /bin/zsh -lc "bin/mentiko run ..."
```

The migration invariant is explicit: do not change shell runner behavior when
`MENTIKO_RUNNER_V2` is unset.

## execution layer

Agents run in isolated PTY sessions through `pty-mgr`, reached by
`lib/session-transport.sh` and web PTY clients.

Common agent CLIs include Claude Code, Codex, Antigravity, Kollab, Aider,
Opencode, and custom commands configured through agent profiles.

Why PTY is the normal path:

- CLI agents can keep interactive state.
- Users can inspect and steer sessions.
- Terminal output becomes the paper trail.
- File edits and artifacts happen in the real workspace.
- Monitors can observe live output and declared completion events.

Pipe mode exists for single-turn jobs where the runtime expects stdin/stdout.
That is the job-runner path, not the normal chain-agent path.

## background jobs

`lib/job-runner.mjs` is the detached background job runner for generation,
recommendation, decision research, and other single-turn AI jobs.

Launch path:

```text
web job route or service
  -> create job file under jobs/
  -> web/lib/runs/job-runner-launch.ts
  -> spawn node lib/job-runner.mjs <jobId>
  -> job-runner reads prompt and profile
  -> spawns CLI with stdio ["pipe", "pipe", "pipe"]
  -> validates output and calls callback/import route
```

This runner is intentionally different from chain execution. It is for
detached request/response jobs, not multi-agent PTY chains.

## data hierarchy

Code root and data root are separate.

Code root:

```text
<repo>/
  bin/
  lib/
  web/
  docs/
  scripts/
  tests/
```

Data root:

```text
~/.mentiko/
  namespaces/{namespaceId}/
```

The default org collapses into the namespace root. Non-default orgs live under:

```text
~/.mentiko/namespaces/{namespaceId}/orgs/{orgId}/
```

Common data directories:

- `chains/`: chain definitions.
- `agents/`: standalone agent definitions.
- `agent-profiles/`: runtime profile definitions.
- `workspaces.json`: registered local/remote workspaces.
- `runs/`: run directories and `run.json`.
- `events/`: file-backed event stream.
- `state/`: agent state files.
- `jobs/`: detached background job files.
- `tasks.db`: task store.
- `decisions.db`: decision flow state.
- `auth.db`: better-auth storage.
- `secrets/`: encrypted secret records.
- `runtime/`: daemon and watcher runtime state.

Path resolution sources:

- bash: `lib/config.sh`
- web: `web/lib/config.ts`

Do not use `process.cwd()` or repo-relative guesses for data paths.

## run state

Each run lives under:

```text
$RUNS_DIR/<runId>/
  run.json
  chain.json
  output.log
  artifacts/
  runspace/
  .internal/
```

`run.json` is the user-visible run state. Writers must use the shared lock
protocol, temporary writes, and atomic rename. Readers should tolerate old or
new whole-file snapshots.

Status vocabulary:

- run-level success is `completed`.
- agent-level success is `complete`.
- shell-created runs start as `pending`, then promote to `running`.
- web-created runs may start as `running` or `pending` if queued at capacity.

## events

Mentiko uses file-backed events for chain and cross-chain coordination.

Event file shape:

```text
event: agent-complete
source: reviewer
run_id: run-...
timestamp: 2026-07-03T00:00:00.000Z
processed: false
data: ...
```

Parser rule: split on the first colon. `data` may contain additional colons.

Important distinction:

- declared agent events are handoff signals.
- monitor diagnostic events are not success handoffs.
- stalled/dead/idle does not imply completion.

## web app

The web app is a Next.js App Router application under `web/app`.

Major surfaces:

- `/dashboard`: active work and activity.
- `/chains`: chain list, builder, details, versioning, run launch.
- `/agents`: agent library.
- `/runs`: run history and live run detail.
- `/tasks`: sqlite-backed task management.
- `/decisions`: guided decision workflow.
- `/workspaces`: registered local/remote execution contexts.
- `/code`: file editor.
- `/events`: event log and trigger surfaces.
- `/schedules`: org and workspace schedules.
- `/artifacts`: run artifact browser.
- `/generation`: AI generation tools.
- `/webhooks`: chain webhook triggers.
- `/links`: peer collaboration.
- `/settings`: account, auth, profiles, secrets, system, PTY, logs.
- `/docs`: in-app documentation.

Core server/runtime modules:

- `web/lib/runs/chain-run-service.ts`: web chain launch service.
- `web/lib/runs/job-runner-launch.ts`: detached job launch service.
- `web/lib/pty/pty-client.ts`: PTY manager client/path resolution.
- `web/lib/config.ts`: data/code root resolution.
- `web/lib/auth/*`: better-auth and RBAC.
- `web/lib/tasks/*`: task store.
- `web/lib/decisions/*`: decision store and dispatch.
- `web/lib/runner-v2/*`: typed runner-v2 migration modules.
- `web/server/ws-terminal.ts`: terminal websocket bridge.
- `web/server/background-worker.ts`: background worker process.

## auth and permissions

Auth uses better-auth with sqlite. Route-level permissions are documented in
`docs/AUTH_COVERAGE.md` and checked by the auth coverage script.

Common permission families:

- `view_chains`
- `manage_chains`
- `manage_tasks`
- `manage_settings`

Internal ops routes use dedicated auth helpers and session-token validation.
MCP/device recovery has its own auth flow under `/api/mentiko-mcp/auth/*`.

## chain format

Chains are JSON files with agents, triggers, routing, and runtime config.

Minimal example:

```json
{
  "name": "research-and-review",
  "description": "research a topic and review the result",
  "default_agent_profile": "default",
  "config": {
    "project_root": "auto",
    "max_rounds": 3,
    "monitor": true,
    "monitor_interval": 60
  },
  "agents": [
    {
      "id": "researcher",
      "name": "Researcher",
      "triggers": ["manual-start"],
      "emits": "research-complete",
      "prompt": "Research {TASK} and write findings to artifacts."
    },
    {
      "id": "reviewer",
      "name": "Reviewer",
      "triggers": ["research-complete"],
      "emits": "review-complete",
      "prompt": "Review the research and write recommendations."
    }
  ]
}
```

Agent references:

```json
{ "$ref": "agent-id" }
```

The runner resolves refs before execution so reusable agents can live outside
the chain file.

## profiles and secrets

Agent profiles define CLI, model, args, permission mode, environment, and
runtime behavior. Chain agents run with interactive profile commands, not the
pipe flags used by background jobs.

Profile resolution is layered:

1. agent-level profile
2. chain default profile
3. workspace default profile
4. namespace default profile
5. legacy inline fallback

Secrets are stored encrypted under the org/namespace data root and resolved
into child environments only when needed. Do not inline secrets in chain files,
docs, or process configs.

## task and decision flows

Tasks are sqlite-backed and can link to chains, decisions, workspaces, and runs.
Task run-chain routes are wrappers around the same chain launch service.

Decision flows use guided or classic modes. Approved decisions can create tasks
or dispatch chains with decision metadata. Decision/generation import tokens are
written into run-private `.internal/` files when needed.

## marketplace and public repo boundary

Marketplace support installs and syncs reusable chains, agents, templates, and
artifacts. The platform repo must remain generic and self-hoster safe.

Keep in this repo:

- product code
- self-hosting docs
- generic runtime docs
- schemas, tests, and public examples

Keep out of this repo:

- customer or tenant details
- private hostnames or IPs
- billing/control-plane implementation details
- deployment runbooks for a specific private environment
- credentials, tokens, or environment-specific secret names

See `REPO_BOUNDARY.md`.

## deployment shape

Development:

```bash
cd web
npm run dev
```

This runs doctor preflight and starts `web/lib/process-manager.ts`, which then
starts the dev process set from `web/processes.dev.json`.

Production:

- build uses the platform release workflow and Dockerfile.
- platform code is assembled under `/opt/mentiko`.
- process manager runs the supervised process set from `web/processes.json`.
- the container includes the web app, `bin/`, `lib/`, websocket bridge,
  background worker, PTY manager, and supported agent CLIs.

Releases do not auto-deploy tenants. Tenant rollout is handled by the separate
control plane.

## observability

Runtime observability comes from:

- `run.json` status and agent state.
- PTY session output.
- `output.log` in run directories.
- event files and archive.
- watchdog diagnostics.
- notifications.
- audit log events.
- web run detail and activity surfaces.

For runtime claims, prefer exact run ids, paths, session names, logs, and route
responses over task labels or stale docs.

## environment variables

Important roots:

- `MENTIKO_GLOBAL_ROOT`: data root, usually `~/.mentiko`.
- `MENTIKO_CODE_ROOT`: code checkout root.
- `MENTIKO_PROJECT_ROOT`: current org/project data root.
- `MENTIKO_ORG_ROOT`: org data root.
- `MENTIKO_NAMESPACE_ROOT`: namespace data root.
- `NAMESPACE_ID`: namespace id, default `default`.
- `ORG_ID`: org id, default `default`.

Runner flags:

- `MENTIKO_RUN_ID`: current run id.
- `MENTIKO_CLI`: runtime CLI override.
- `MENTIKO_RUNNER_V2`: opt-in initial runner-v2 launch.
- `MENTIKO_RUNNER_V2_COMPLETION`: opt-in typed completion re-entry.
- `MENTIKO_CAP_DISABLED`: disables concurrency gate when explicitly set.
- `MENTIKO_CAP_MAX_WAIT_SECS`: max wait for chain capacity admission.

Auth and app:

- `BETTER_AUTH_SECRET`: auth/session/internal request secret.
- `BETTER_AUTH_URL`: public auth URL.
- `DATABASE_URL`: database connection when configured.
- `INTERNAL_SERVICE_SECRET`: internal service auth for sidecar services.

PTY:

- `PTY_MGR_BIN`: explicit PTY manager binary override.
- `MENTIKO_PTY_MGR_BIN`: Mentiko-specific PTY manager override.
- `PTY_DAEMON`: daemon/socket name.

Child process hygiene:

- unset or override tool-specific parent-session vars when launching nested
  agent CLIs if the child CLI refuses nested execution.

See `docs/ENV_VARS.md` for the full catalog.
