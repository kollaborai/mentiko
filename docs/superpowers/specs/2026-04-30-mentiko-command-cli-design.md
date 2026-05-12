# Mentiko Command CLI and MCP Shared Surface

date: 2026-04-30
status: ready for implementation planning

## Problem

Mentiko currently has two separate command surfaces:

- `bin/mentiko`, a Bash CLI that actively runs chains through
  `lib/chain-runner.sh`, controls PTY sessions, and backs web run/resume paths.
- `bin/mentiko-mcp`, a TypeScript MCP stdio server that exposes Mentiko app
  operations to agents through `/api/mentiko-mcp/ops/*`.

Agents need a normal terminal CLI for app operations such as creating agents,
deleting chains, creating tasks, and checking long-running work. That CLI should
not reimplement MCP logic or use an internal admin bypass. It should use the
same user-scoped authority as MCP and produce stdout that agents can parse.

## Current State

`bin/mentiko run`, `list`, `peek`, `send`, `kill`, and related PTY/session
commands are still active. The web run API spawns `bin/mentiko run ...`, resume
spawns the same command, schedules call `chain-runner.sh`, and completion
routing reinvokes the Bash runner. This path must remain stable.

The MCP server is the better model for app CRUD and control operations. It has
tool schemas, handler modules, session-scoped ops authentication, and a split
between data operations and UI effects. Data operations use bearer session JWTs.
The inbox key is only for UI signaling and must not become a CLI data credential.

## Goals

- Add MCP-style app commands to `mentiko` without breaking existing orchestration
  commands.
- Share the same underlying handler or ops-client code between MCP and CLI.
- Use a user-scoped encrypted CLI config, not `BETTER_AUTH_SECRET` and not an
  inbox-key data bypass.
- Let agents run commands from a project/workspace directory and have Mentiko
  infer namespace, org, and workspace context from config.
- Emit machine-readable stdout and reliable exit codes.
- Return IDs for long-running work and provide status commands to poll them.
- Require every direct chain run to have an explicit objective, while letting
  task-bound runs derive that objective from the task record.

## Non-Goals

- Do not port `chain-runner.sh` in this change.
- Do not replace existing web run/resume/schedule execution.
- Do not add a hidden admin credential for CLI callers.
- Do not make local project directories a new data root. Runtime data remains
  under `MENTIKO_GLOBAL_ROOT`, normally `~/.mentiko`.
- Do not require every MCP UI effect to have a CLI equivalent in the first
  implementation.

## Command Model

Existing commands remain as they are:

```bash
mentiko run <chain.json> --workspace <path>
mentiko list
mentiko peek <session-name> [lines]
mentiko send <session-name> "message"
mentiko kill <session-name>
```

New app commands use MCP tool names as CLI subcommands. The first slice should
support these commands:

```bash
mentiko list_chains
mentiko create_chain_draft --name "string" [--template "string"]
mentiko save_chain_json --name "string" --chain-file ./chain.json [--overwrite]
mentiko rename_chain --id "string" --name "string"
mentiko delete_chain --id "string" --yes

mentiko list_agents
mentiko create_agent --name "string" --prompt "string" [--profile "string"]

mentiko list_tasks [--status open]
mentiko create_task --subject "string" [--desc "string"] [--parent-id "string"]
mentiko generate_tasks --description "string"
mentiko mark_task_done --id "string"

mentiko list_runs
mentiko start_run --chain-id "string" --objective "string" [--task-id "string"] [--workspace-id "string"]
mentiko run_task --task-id "string" [--objective "string"] [--workspace-id "string"]
mentiko run_status --id "run-..."
mentiko cancel_run --id "run-..." --yes
```

Snake case is the canonical command spelling because it matches MCP tool names.
Kebab-case aliases can be added later, but should not be required for the first
implementation.

## Output Contract

Default stdout is compact JSON:

```json
{"ok":true,"command":"create_agent","result":{"id":"agent-id"}}
```

Failures write compact JSON to stderr and exit nonzero:

```json
{"ok":false,"command":"create_agent","error":{"code":"unauthorized","message":"session token expired"}}
```

Exit codes:

- `0`: command succeeded.
- `1`: command failed because Mentiko returned an application/API error.
- `2`: CLI usage error, missing config, missing required flag, invalid JSON.
- `3`: authentication required or token refresh failed.

Human-friendly rendering can be added later with `--text`; JSON remains the
default because agents are the primary caller.

## Architecture

### Entrypoint

Keep `bin/mentiko` as the public executable. Its existing Bash `case` block keeps
known orchestration commands. Unknown MCP-style commands delegate to a Node
runner:

```bash
mentiko create_agent --name "Reviewer" --prompt "Review the diff"
```

Internally:

```text
bin/mentiko
  existing command? -> current Bash path
  app command?      -> node/tsx lib/mentiko-cli/main.ts <args>
```

Development can run the TypeScript source through `tsx`, mirroring
`bin/mentiko-mcp`. Production should bundle the runner with esbuild during the
tenant image build, the same way `mentiko-mcp` is bundled today.

### Shared Operations

The first implementation should reuse the existing MCP handler modules where
possible:

```text
lib/mentiko-cli/main.ts
  parses flags
  loads encrypted config into process env/context
  calls lib/mentiko-mcp/handlers/*
  prints JSON result

lib/mentiko-mcp/server.ts
  keeps MCP protocol, permission UI, and effect dispatch
  continues to call the same handlers
```

This avoids duplicating HTTP route paths and payload shapes. If the handler
modules become awkward for both callers, extract a small shared command registry:

```text
lib/mentiko-command/registry.ts
  command metadata, required args, risk tier, handler function

lib/mentiko-mcp/server.ts
  adapts MCP CallTool to registry

lib/mentiko-cli/main.ts
  adapts argv to registry
```

The registry extraction is allowed if it simplifies implementation, but the
first implementation should avoid rewriting the MCP server wholesale.

## Encrypted CLI Config

### Search Order

The CLI loads config in this order:

1. `MENTIKO_CONFIG`, if set. This points directly to an encrypted config file.
2. `$MENTIKO_CWD/.mentiko/config.json.enc`, if `MENTIKO_CWD` is set.
3. The nearest `.mentiko/config.json.enc` found by walking upward from
   `process.cwd()`.
4. `~/.mentiko/cli/config.json.enc`.

`MENTIKO_CWD` means "workspace directory hint", not code root and not data root.
It gives agents an explicit way to run Mentiko against the project they are
working in.

### Config Shape

Decrypted config:

```json
{
  "version": 1,
  "webUrl": "http://127.0.0.1:3000",
  "engineUrl": "http://127.0.0.1:7433",
  "namespaceId": "default",
  "orgId": "default",
  "userId": "user_...",
  "sessionId": "sess_...",
  "sessionToken": "jwt...",
  "workspaceId": "local",
  "workspacePath": "$MENTIKO_CODE_ROOT",
  "createdAt": "2026-04-30T00:00:00.000Z",
  "updatedAt": "2026-04-30T00:00:00.000Z"
}
```

The CLI maps this config into the environment expected by the existing MCP
ops-client:

```text
MENTIKO_WEB_URL
KOLLABOR_ENGINE_URL
MENTIKO_SESSION_ID
MENTIKO_SESSION_TOKEN
MENTIKO_NAMESPACE_ID
MENTIKO_ORG_ID
```

Task-creation commands should pass `workspacePath` by default when the user did
not provide `--workspace-path`, so CLI-created tasks appear under the correct
workspace filter.

Run commands should use `workspaceId` or `workspacePath` from config by default.
`--workspace-id` is an override for cases where the caller intentionally wants
to run in a different workspace than the one recorded in the encrypted config.

### Encryption

Use AES-256-GCM for `config.json.enc`. The config encryption key is local to the
CLI installation:

- Prefer `MENTIKO_CONFIG_KEY` when present, for CI and agent sandboxes.
- Otherwise use `~/.mentiko/cli/key`, generated once with mode `0600`.
- On macOS, a later improvement may store this key in Keychain; the first slice
  can use the file key for consistency with Linux containers.

This protects against accidental plaintext leakage in prompts, logs, and file
views. It is not a defense against arbitrary code already running as the same
OS user.

### Auth and Refresh

The config is user-scoped. It never stores `BETTER_AUTH_SECRET`,
`INTERNAL_SERVICE_SECRET`, or `MENTIKO_INBOX_KEY` as a data credential.

If `sessionToken` is valid, commands call `/api/mentiko-mcp/ops/*` directly
through the shared ops client.

If the token is expired:

1. Try the existing engine-backed refresh path when `sessionId` and engine token
   are available.
2. Persist the refreshed token back into the encrypted config.
3. If refresh fails, exit `3` and tell the caller to run `mentiko auth login`.

`mentiko auth login` is the setup command for this config. The first version may
reuse the same local web/engine session flow that powers the floating bar. A
future version can add OAuth/device-code login for remote tenants.

## Risk and Permission Policy

The CLI mirrors MCP risk tiers but adapts them for terminal use:

- Tier A read/navigation/context commands run without confirmation.
- Tier B recoverable writes run if the user-scoped token authorizes them.
- Tier C destructive or process-control commands require `--yes` unless the
  config explicitly sets `"allowDestructiveWithoutPrompt": true`.

Tier C in the first command set:

- `delete_chain`
- `cancel_run`

Later Tier C candidates include shell command sending and secret creation.
Secret creation should prefer `--value-env NAME` or stdin over direct
`--value ...` to avoid shell history leaks.

## Long-Running Work

### Run Objectives

Mentiko should not start a chain with an empty goal. Direct chain execution
requires an objective:

```bash
mentiko start_run --chain-id release-review --objective "Review the release branch and report blockers"
```

The CLI sends this as the run's `userPrompt`/goal. If `--task-id` is also
provided, the run is linked to the task for status propagation, but the explicit
objective still describes what the chain is supposed to accomplish.

Task-bound execution is a separate command:

```bash
mentiko run_task --task-id FEAT-123
```

`run_task` executes the chain assigned to the task. It should call the existing
task-chain execution path (`/api/tasks/[id]/run-chain`) or an MCP ops wrapper
around that path. That route already builds the objective from task details:
task ID, title, type, priority, description, acceptance criteria, design notes,
notes, and comments. If `--objective` is provided, it is additional instruction
for this run and should be included with the task context rather than replacing
the task context.

This keeps the two run modes clear:

- `start_run`: "run this chain for this explicit objective."
- `run_task`: "run the chain assigned to this task, using the task as the
  objective."

### Async Results

Commands that start asynchronous work return IDs immediately:

```bash
mentiko start_run --chain-id release-review --objective "Review the release branch and report blockers"
```

stdout:

```json
{"ok":true,"command":"start_run","result":{"runId":"run-1776990944577","status":"running"}}
```

Polling:

```bash
mentiko run_status --id run-1776990944577
```

stdout:

```json
{"ok":true,"command":"run_status","result":{"id":"run-1776990944577","status":"complete"}}
```

Task-bound run stdout:

```json
{"ok":true,"command":"run_task","result":{"taskId":"FEAT-123","runId":"run-1776990944577","status":"running"}}
```

`generate_tasks` can remain synchronous in the first slice because the existing
MCP route already waits for generation with a longer timeout. If this becomes
too slow for shell callers, add `--async` later and return a job ID.

## File and Workspace Behavior

The CLI never assumes `process.cwd()` is the Mentiko code root. Directory roles:

- Code root: where `bin/`, `lib/`, and `web/` live.
- Data root: `MENTIKO_GLOBAL_ROOT`, normally `~/.mentiko`.
- Workspace directory: the project the agent is operating on, from config or
  `MENTIKO_CWD`.

When config workspace context conflicts with the current directory, the config
wins. A later warning can be added if `process.cwd()` is outside
`workspacePath`, but the first implementation should not block on that mismatch.

## Error Handling

The CLI should normalize common failures:

- Missing config: exit `3`, tell caller to run `mentiko auth login`.
- Decrypt failure: exit `3`, mention wrong `MENTIKO_CONFIG_KEY` or corrupt file.
- Token expired and refresh failed: exit `3`, ask for login.
- HTTP 401/403: exit `3` for auth, `1` for permission denied with valid auth.
- API validation errors: exit `1` with the server message.
- Network unreachable: exit `1` with `webUrl` and command name.
- Unknown command or missing required flags: exit `2`.

All error payloads must redact tokens and config secrets.

## Implementation Files

Likely files to add:

```text
lib/mentiko-cli/main.ts              argv parser, command dispatch, JSON output
lib/mentiko-cli/config.ts            encrypted config load/save/search
lib/mentiko-cli/crypto.ts            AES-256-GCM helpers
lib/mentiko-cli/commands.ts          command metadata and flag mapping
lib/mentiko-cli/output.ts            stdout/stderr/exit-code helpers
```

Likely files to modify:

```text
bin/mentiko                          delegate MCP-style app commands to Node
Dockerfile                           bundle lib/mentiko-cli/main.ts for prod
lib/mentiko-mcp/handlers/*.ts        only if signatures need CLI context
lib/mentiko-mcp/handlers/ops-client.ts optional support for explicit context
web/app/api/mentiko-mcp/ops/context/runs/route.ts require objective for start_run
docs/AUTH_COVERAGE.md                if new API auth endpoints are added
```

Optional API additions:

```text
web/app/api/mentiko-cli/auth/login/route.ts
web/app/api/mentiko-cli/auth/refresh/route.ts
web/app/api/mentiko-mcp/ops/tasks/[id]/run-chain/route.ts
```

Only add these if existing web/engine token minting cannot support CLI login
cleanly, or if the existing task-chain route cannot be called safely from the
session-token ops surface.

## Test Plan

Unit tests:

- Config search order chooses `MENTIKO_CONFIG`, then `MENTIKO_CWD`, then nearest
  project config, then user config.
- Config encrypt/decrypt round trip works and rejects the wrong key.
- Command parser maps flags to MCP handler arguments.
- Tier C commands fail without `--yes`.
- `start_run` fails argument validation without `--objective`.
- `run_task` accepts `--task-id` without requiring `--objective`.
- Output helper writes success JSON to stdout and error JSON to stderr.

Integration tests:

- Mock ops routes and verify `create_agent`, `create_task`, and `delete_chain`
  send the same payloads as MCP handlers.
- Verify `create_task` uses config `workspacePath` when no explicit workspace
  flag is passed.
- Verify `start_run` sends explicit objective as the run goal.
- Verify `run_task` calls the task-bound chain execution path and returns the
  resulting run ID.
- Verify expired token refresh updates encrypted config.

Regression tests:

- `bin/mentiko run --dry-run` still dispatches to `chain-runner.sh`.
- `bin/mentiko list`, `peek`, `send`, and `kill` keep existing behavior.
- Docker build step bundles `mentiko-mcp` and `mentiko-cli` without requiring
  dev-only dependencies at runtime.

## Rollout

1. Add CLI config crypto and command runner behind `bin/mentiko`.
2. Implement read/write app commands for chains, agents, and tasks.
3. Add `start_run`, `run_task`, `run_status`, and `cancel_run`.
4. Add `mentiko auth login` only if manual config seeding is not enough for
   local development.
5. Document the new agent-facing command surface.

The first implementation is successful when an agent can run:

```bash
mentiko create_agent --name "Reviewer" --prompt "Review the current diff"
mentiko create_task --subject "Fix task ordering" --desc "Use dependency-aware ordering"
mentiko start_run --chain-id "review-chain" --objective "Review the task-ordering implementation"
mentiko run_task --task-id "FEAT-123"
mentiko run_status --id "run-..."
```

and all commands use the same user-scoped ops route permissions as MCP.
