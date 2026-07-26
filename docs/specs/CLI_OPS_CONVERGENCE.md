# CLI / ops convergence

Status: proposed (2026-07-25)
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

### phase 0 — give CLI-started runs an identity (prerequisite)

`runTypedDirect` must obtain a session token before launching agents. Genuine
fork, needs a decision:

- **A. route through the server.** `mentiko run` POSTs to
  `/api/mentiko-mcp/ops/context/runs`; `startChainRun` does the work. Collapses
  two run creators into one and inherits every guarantee immediately. Cost: the
  CLI requires a reachable web process.
- **B. local device identity.** The CLI holds its own credential — the MCP
  sidecar at `~/.mentiko/mcp/session.json` already exists — and mints a run
  token through the existing device-auth flow
  (`docs/specs/MCP_AUTH_RECOVERY.md`). Keeps `mentiko run` working without the
  UI open.

Recommendation: **A**, with the sidecar from **B** as the credential source.
Collapsing the two run creators is the actual prize.

### phase 1 — one ops client, delete the fork (~150 lines, net negative)

Lift `lib/mentiko-mcp/handlers/ops-client.ts` into a module both the MCP and the
CLI import: `opsGet/opsPost/opsPatch/opsDelete`, 401 refresh, sidecar exchange,
device-flow pickup, 15s timeout.

- rewrite `lib/mentiko-cli-schedules.mjs` onto it — net deletion
- rewrite `lib/mentiko-cli-decision.mjs` onto it, adding
  `/ops/decisions/import` if absent

Independently verifiable: both commands keep working and gain refresh.

### phase 2 — move `emit` behind an ops endpoint

Add `POST /api/mentiko-mcp/ops/events`, gated by `requireOpsAuth`, calling the
existing `emitRunnerEvent` server-side. The write stays where it is; what
changes is that namespace and org come from the token rather than the
environment.

- agents already carry the token once phase 0 lands — no prompt or bootstrap
  change needed
- **keep a local fallback.** If `MENTIKO_WEB_URL` is unreachable, write locally
  and log loudly. An agent that cannot signal completion wedges a chain; this
  path degrades, never fails closed.
- leave one runnable check: a chain hop completes over HTTP with a valid token
  and is rejected with an invalid one

### phase 3 — close the surface gap

36 ops endpoints and 106 MCP tools against 19 CLI subcommands. The CLI has no
task, agent, secret or workspace commands. Once the client is shared these are
argument parsers over handlers that already exist — but decide deliberately
which belong on a CLI rather than porting all 106.

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

Interim hardening, independent of the packaging work:

1. `scripts/build-runner-bundles.mjs` — lift the esbuild loop out of
   `tests/runner-typed-bundle-parity.test.mjs`, which is currently the only
   place the command is written down
2. `--banner:js='// GENERATED FROM web/lib/runner-v2/<src>.ts — DO NOT EDIT'`
3. wire the parity test into something that runs — it lives at repo root in
   `tests/*.mjs`, and the one CI workflow runs jest from `web/`, so it is
   currently checked by nothing

## open decisions

1. phase 0: A or B — does `mentiko run` require a reachable web process?
2. package order: CLI first (small, and the immediate irritant) or engine first
   (large, but everything else depends on where it lands)?

## references

- `docs/orchestration/mcp-write-scoping-audit.md` — 2026-06-28, traced every MCP
  tool to its endpoint and scope
- `docs/specs/MCP_AUTH_RECOVERY.md` — device flow, sidecar, refresh tokens
- `docs/orchestration/ENGINE_MAP.md` — engine topology
