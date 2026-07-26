# CLI / ops convergence

Status: phases 1a/1b + 2 + 3 shipped; phase 4 (tasks) shipped, agents/secrets/workspaces deferred (2026-07-26)
Branch: `cli-ops-convergence`

Make `bin/mentiko` reach Mentiko the way the MCP already does — through
`/api/mentiko-mcp/ops/*` under a verified identity — instead of writing to the
filesystem directly.

---

## the problem

There are two implementations of "start a run" and two of "emit an event".

| | MCP / web | CLI |
|---|---|---|
| start a run | `startChainRun` — `web/lib/runs/chain-run-service.ts:292` | `runTypedDirect` — `web/lib/runner-v2/direct-run.ts:97` |
| emit an event | server-owned, behind ops auth | `emitRunnerEvent` — `web/lib/runner-v2/event-emitter.ts:60`, pure `writeFileSync` |

The MCP path is gated by `requireOpsAuth`
(`web/lib/ai-engine/mentiko-mcp-ops-auth.ts:43`), which extracts `userId`,
`sessionId`, `namespaceId`, `orgId`, role and scopes from a signed JWT. The CLI
path reads `NAMESPACE_ID` / `ORG_ID` from the environment, unverified, and
writes to paths derived from them.

What the CLI path therefore does not have: caller identity, workspace
authorization (`resolveAuthorizedWorkspacePath` → `Forbidden`), RBAC,
concurrency admission (`cap_acquire_chain_slot`), attributable audit, and a
minted session token for the agents it launches.

`mentiko emit` is not peripheral to this. It is the completion protocol:
`web/lib/runner-v2/bootstrap-executor.ts:58` interpolates
`mentiko emit <event>` into every agent's prompt, and
`lib/monitor-completion.sh:99-103` nudges stalled agents to run it, telling them
explicitly not to hand-write event files. Every agent, every chain hop.

## the bug it already causes

`web/lib/runner-v2/agent-bootstrap-plan.ts:121` passes
`MENTIKO_SESSION_TOKEN` / `MENTIKO_SESSION_ID` / `MENTIKO_WEB_URL` through to
each agent, defaulting to `""`.

`mintSessionToken` is called from twelve sites, **all under `web/app/api/`** —
never from the CLI. So a run started with `mentiko run` launches agents with an
empty token, and `lib/mentiko-mcp/handlers/ops-client.ts:124` throws
`"MENTIKO_SESSION_TOKEN not set — session auth required"` on their first ops
call. The same chain started from the Run button works.

This is also why the `claude-mentiko-mcp-config.ts` change on `main` (89ccde7)
is wrong: all-three-absent is the CLI-launch case, not a misconfiguration.

## precedent

`lib/mentiko-cli-schedules.mjs` (130 lines) already does this correctly for nine
subcommands — `list_schedules` through `delete_application` — calling
`/api/mentiko-mcp/ops/schedules` and `/ops/applications` with
`Authorization: Bearer ${MENTIKO_SESSION_TOKEN}`.

It proves the shape works from bash-launched node. It has two defects the real
client fixes by reuse: no 401-refresh, no timeout. It is a weaker fork of
`ops-client.ts`, which sits 200 lines away and has both.

`lib/mentiko-cli-decision.mjs` is a third style again — ad-hoc HTTP to a
non-ops route (`/api/decisions/{id}/import`).

## phases

### decided: route through the server

`mentiko run` POSTs to `/api/mentiko-mcp/ops/context/runs` and lets
`startChainRun` do the work — one run creator, every guarantee inherited.

The alternative considered and rejected was "the CLI mints its own token
locally." `mintSessionToken` is an HS256 sign with `resolveAppSecret(...)`
(`web/lib/auth/session-token.ts:10`), derived from `BETTER_AUTH_SECRET` — the
secret that signs every session in the deployment and encrypts the vault. A CLI
holding it could forge any user in any namespace. Not a tradeoff; a hole.

### phase 1 — credential first, then the shared client

**1a. `mentiko auth` (done).** Nothing else is reachable without a credential.
Verified before the work: `mentiko list_schedules` from a normal shell fails
with `MENTIKO_SESSION_TOKEN not set` — the one CLI family already on the ops
endpoints could not be used at all.

- `lib/mentiko-cli-auth.mjs` — device flow against the existing
  `/api/mentiko-mcp/auth/device/{start,poll}` and `/auth/token` endpoints
- shares the sidecar with the MCP bridge at
  `$MENTIKO_GLOBAL_ROOT/mcp/session.json` (0600, atomic rename), so authorizing
  once covers both surfaces
- `resolveToken()` implements the precedence from `ops-client.ts:27` — injected
  `MENTIKO_SESSION_TOKEN` wins (agent runs, CI), then the stored credential,
  refreshed in place when the 24h access token has expired
- subcommands: `auth`, `auth status`, `auth token`, `auth logout`.
  `auth token` prints a valid token to stdout, so headless is
  `export MENTIKO_SESSION_TOKEN=$(mentiko auth token)`
- `tests/cli-auth-sidecar-contract.test.mjs` pins precedence, refresh-absence,
  corrupt-file tolerance, the shared path/shape, and 0600

**1b. one ops client.** Lift `lib/mentiko-mcp/handlers/ops-client.ts` into a
module both the MCP and the CLI import: `opsGet/opsPost/opsPatch/opsDelete`,
401 refresh, device-flow pickup, 15s timeout. `mentiko-cli-schedules.mjs`
currently shares only `resolveToken`; it still has its own `request()` with no
timeout. `mentiko-cli-decision.mjs` moves off its ad-hoc route at the same time.

### phase 2 — `mentiko run` through startChainRun  (SHIPPED)

Route the CLI through the single run creator. A NEW hand-written client
`lib/mentiko-cli-run.mjs` parses `mentiko run`'s flags and POSTs to
`/api/mentiko-mcp/ops/context/runs` with the phase-1a credential; `bin/mentiko`'s
`run)` case dispatches to it. `runTypedDirect` (`direct-run.ts:97`) and its
compiled bundle `runner-v2-direct-run.js` are UNCHANGED — they stay the local
creator for the scheduler, `chain-runner.sh`, `batch-runner.ts`, and next-chain
hops. Turning that bundle into an HTTP client would make the web process POST
back to itself (the scheduler spawns it from inside the web process → loopback
HTTP), so caller #1 became a new file, not a mutation. `--dry-run` delegates to
the bundle (local validate, no run to route); a server unreachable at run start
fails loud via the shared ops client.

The run endpoint awaits the full PTY bootstrap (admission + spawn + readiness),
so the client uses a 120s timeout — the default 15s reported a misleading
"timed out" on runs that actually started.

**Flag reconciliation — read this before designing anything.** The gap is NOT
between the CLI and `startChainRun`; it is between the CLI and the thin ops
wrapper. `startChainRun` already destructures
(`web/lib/runs/chain-run-service.ts:303-311`):

    chainId, userPrompt, debug, workspacePath, workspaceId, taskId,
    executor, agentProfileId

`workspacePath` is accepted alongside `workspaceId` and resolved through
`resolveAuthorizedWorkspacePath` (`:320`) — so "the CLI has a filesystem path,
the endpoint wants a DB id" is already solved by the service.

What drops the fields is `/ops/context/runs`, which forwards only four of them
(`web/app/api/mentiko-mcp/ops/context/runs/route.ts:53-58`):

    body: JSON.stringify({ chain, chainId, userPrompt: task || "", workspaceId })

So the work is widening a passthrough to match the service beneath it, not
designing new API surface.

`mentiko run` parses exactly five flags (`parseDirectRunArgs`):
`--workspace`, `--start`, `--task`, `--dry-run`, `--debug`.

- `--workspace`, `--task`, `--debug` → already supported; just stop dropping them.
- `--dry-run` → stays local. It creates no run by definition, so there is nothing
  to route.
- `--start <agent>` → **the one genuine gap, now closed.** `startChainRun` had no
  start-agent concept. SHIPPED: `startAgent` is a first-class body field
  (`StartChainRunBody`), validated against the resolved chain agents (a bad id is
  a structured `BadRequest`), threaded to the typed launch context as `agentId`.
  The ops wrapper forwards it. Over HTTP a bad `--start` returns 400 and a valid
  one starts the run at that agent — the same `chainAgent()` selection the local
  `runTypedDirect` path uses.
- `parentRunId` is **not a flag.** It is a `DirectRunOptions` field
  (`direct-run.ts:26,117`) used by programmatic chained-run callers. Routing
  `mentiko run` over HTTP must not break those callers — check them before
  changing the signature.

This is what populates `MENTIKO_SESSION_TOKEN` for CLI-launched agents —
`startChainRun` mints it at `chain-run-service.ts:266` and
`agent-bootstrap-plan.ts:121` already forwards it. It also retires the
`claude-mentiko-mcp-config.ts` throw committed on main (89ccde7): once
CLI-started runs carry a session, all-three-absent stops happening in normal
operation.

### phase 3 — move `emit` behind an ops endpoint  (SHIPPED)

`POST /api/mentiko-mcp/ops/events`, gated by `requireOpsAuth`, calls the existing
`emitRunnerEvent` server-side with `eventsDir = orgPath(ctx.ns, ctx.org, "events")`
— namespace and org come from the token claims, not the environment. The write is
unchanged; what changed is who decides where it lands.

- NEW `lib/mentiko-cli-emit.mjs` routes `mentiko emit` through it; `bin/mentiko`
  dispatches there. The `runner-event-emitter.js` bundle stays as the local
  fallback and for `run-lib.sh`'s bash-engine callers (catch #3).
- **degrade, never fail closed.** Any HTTP failure (unreachable, 4xx, 5xx) falls
  back to the local typed write with a loud log — an agent that cannot signal
  completion wedges a chain hop. (`run` fails loud because origination has no
  prior auth; `emit` degrades because it is mid-flight.)
- proven live: valid token → 200 (event written to the token's ns/org);
  bogus/missing token → 401; unreachable → local fallback writes + logs.

### phase 4 — close the surface gap  (tasks SHIPPED; agents/secrets/workspaces deferred)

36 ops endpoints and 106 MCP tools against 19 CLI subcommands. The CLI had no task,
agent, secret, or workspace commands. NEW `lib/mentiko-cli-tasks.mjs` ships the
mission-critical surface — `list_tasks / get_task / create_task / update_task /
close_task / comment_task / link_task / unlink_task` over the ops endpoints, under
the verified session (same shape as the schedules CLI; `close` requires `--yes`).

Deliberate scope: tasks drive the auto-run mission. agents / secrets / workspaces
follow the identical pattern — argument parsers over `opsRequest` — deferred
rather than ported wholesale, per "decide deliberately which belong on a CLI."
Proven live: `list_tasks` → 200, `create_task` → `TASK-###` with `owner` from the
token.

## packaging (separate track, informs phase 1)

`lib/mentiko-mcp/` is already a real package: `@mentiko/mentiko-mcp`, public,
own `package.json`, lockfile, tsconfig, LICENSE, `.npmignore`, and an esbuild
build script that sets a banner. It is the model.

| package | source today | size | state |
|---|---|---|---|
| `@mentiko/mcp` | `lib/mentiko-mcp/` | 24 files, 3,684 lines | exists |
| `@mentiko/cli` | `bin/mentiko`, `lib/*.sh` | 38 files, 3,071 lines | to extract |
| `@mentiko/engine` | `web/lib/runner-v2/` | 132 files, 53,336 lines | to extract |
| `@mentiko/web` | `web/app`, `web/components` | 785 files | to extract |

Engine coupling, measured: 388 internal imports vs ~95 external — roughly 80%
cohesion. The external tail is dominated by `@/lib/config` (28) and `@/lib/runs`
(26), both plausibly part of the engine. Nothing in `runner-v2` is
Next-specific; it is a node program parked in `web/`, so extraction is mostly a
path rewrite.

Related tax: 53 esbuild bundles are committed to `lib/*.js` — 218,917 lines of
generated code in git, with no build script and no banner. The Dockerfile
rebuilds all 52 from `.ts` at image build (lines 122+), so the committed bytes
never reach a tenant; they serve local dev only. A package with a real build
step removes this.

Interim hardening, independent of the packaging work (SHIPPED with phase 2):

1. `scripts/build-runner-bundles.mjs` — the single esbuild source; the parity
   test imports `buildBundle()` from it so there is one invocation, not two
2. every committed `lib/*.js` carries a `// GENERATED FROM ...` banner
3. `tests/runner-typed-bundle-parity.test.mjs` is wired into
   `.github/workflows/engine-tests.yml` (folded into the jest step, which already
   installs deps); regen exposed several stale bundles local dev had been running

## open decisions

1. package order: CLI first (small, and the immediate irritant) or engine first?
2. package order: CLI first (small, and the immediate irritant) or engine first
   (large, but everything else depends on where it lands)?

## references

- `docs/orchestration/mcp-write-scoping-audit.md` — 2026-06-28, traced every MCP
  tool to its endpoint and scope
- `docs/specs/MCP_AUTH_RECOVERY.md` — device flow, sidecar, refresh tokens
- `docs/orchestration/ENGINE_MAP.md` — engine topology
