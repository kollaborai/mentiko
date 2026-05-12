# Mentiko Supervised Agent Issue Contract

date: 2026-05-07
status: ready as issue-authoring contract; current implementation experiment is partial

## Purpose

Mentiko sub-agent issues need to be narrow enough for parallel implementation
but exact enough to prevent runtime drift. The floating Kollabor bar and Mentiko
MCP setup work exposed the failure mode: a sub-agent can make a plausible local
fix, prove a TUI path, or see `mcp_connected` and still leave the browser
runtime broken.

This contract is the default issue shape for future supervised implementation
agents that touch Mentiko runtime, MCP, floating-bar, agent-bundle, or
workspace-aware paths.

## Runtime Facts

- Floating bar runtime: `kollabor-engine`.
- Floating bar session profile: `mentiko`.
- Floating bar session agent: `mentiko`.
- Floating bar session MCP servers: `["mentiko"]`.
- Repo-owned Mentiko agent bundle:
  `/Users/malmazan/dev/mentiko/dev/kollab/agents/mentiko`.
- Runtime agent target: `~/.kollab/agents/mentiko`.
- Runtime MCP settings target: `~/.kollab/mcp/mcp_settings.json`.
- Path evidence must report both the expanded absolute path and the
  home-relative normalized path.
- Accept only expanded paths under `$HOME/.kollab`; `~/.kollab` in a prompt is
  shorthand, not the literal value returned by runtime APIs.
- `~/.kollabor-cli` is not a valid target for this app path.
- If `~/.kollabor-cli` exists on the machine, treat it as stale unrelated
  state. You may check that it exists, but do not list, read, diff, copy from,
  or write to it.
- TUI success does not prove browser runtime success.
- `mcp_connected` proves only connection, not a completed tool invocation.
- `tool_start` proves only invocation start, not success.
- The minimum MCP runtime proof is a browser-originated turn that produces a
  successful `tool_result` for the expected Mentiko tool.
- The accepted proof must be from the same browser turn, same engine session,
  same session-token `jti`, and same tool id. A later tool result, a different
  session, or a UI-only result does not count.
- The active `mcp_settings.json` command contract must match the exact shape
  consumed by `kollabor-engine`. If the engine executes `command` directly,
  `command` must be the executable path and env must live in `env`; a single
  command string with spaces, env assignments, or shell syntax is not proof
  unless the engine contract explicitly parses it that way.

## Hard Rules

- Do not use `git reset`, `git restore`, `git checkout`, or stash.
- Do not commit unless Marco explicitly asks.
- Preserve unrelated dirty work.
- Never add `Co-Authored-By` or attribution footers.
- Use `~/.kollab` only. Never write `~/.kollabor-cli`.
- Do not mutate provider profiles or `supports_tools` unless the issue
  explicitly names that as the required behavior and explains why.
- Keep write scope narrow. If the fix requires more files than the contract
  allows, stop and report the expanded scope instead of freelancing.

## Pass, Partial, And Fail Gates

Use these gates when reviewing a supervised implementation. Do not let a
sub-agent choose its own definition of done.

- Pass: focused tests pass and a browser-originated floating-bar turn produces
  the required `tool_start` and matching successful `tool_result` for the same
  `session_id`, with setup/session/path evidence and no forbidden scope drift.
- Partial: static checks or focused tests improved the contract, but live
  browser evidence is missing, blocked, or only proves `mcp_connected`,
  `tool_start`, a TUI turn, or a UI chip without raw SSE evidence.
- Fail: the implementation writes outside `~/.kollab`, mutates provider
  profiles or `supports_tools` without an explicit issue requirement, overwrites
  unrelated MCP servers, reuses a stale session without raw engine capability
  proof, or claims success from non-browser evidence.

## Supervised Run Loop

Use this loop when handing a Mentiko runtime issue to a sub-agent.

1. Give the sub-agent the exact issue contract, not a summary.
2. Require a read-only orientation before edits:
   - `git status --short --branch`
   - named files it plans to touch
   - observed current failure or missing proof
3. Reject output that reports only TUI success, `mcp_connected`, or
   `tool_start`.
4. Personally review the diff before accepting it:
   - scope stayed inside the issue
   - runtime paths are `~/.kollab`
   - profile/provider shared state was not mutated
   - browser-origin `tool_result` evidence is present
5. If the sub-agent cannot produce browser evidence, classify the issue as
   partial and write the next narrower contract from the failure it found.

## Lessons From Current Experiment

### 1. Setup Is A Runtime Contract, Not A Convenience Call

The bar depends on all of these being true at the same time:

- The repo bundle exists and syncs to `~/.kollab/agents/mentiko`.
- `~/.kollab/mcp/mcp_settings.json` contains a `mentiko` server.
- The session is created with profile `mentiko`, agent `mentiko`, and
  `mcp_servers: ["mentiko"]`.
- The browser has a valid session token before opening the MCP SSE stream.
- The session token `jti` matches the engine session id returned to the
  browser. A token minted for a preselected id is not valid proof unless the
  upstream engine actually created or returned that same id.
- The engine must actually read the schema key the setup route writes. If the
  setup route canonicalizes from `mcpServers` to `servers`, verification must
  prove the current engine version reads `servers`.

An issue that asks an agent to "fix the bar" must name each piece and require
evidence for each handoff.

### 2. Session Reuse Must Include Capability Requirements

A stale browser session can look healthy while missing the expected profile,
agent bundle, MCP server, or bundle fingerprint. Future fixes must define the
session reuse signature up front. At minimum, the signature should include:

- `profile`
- `agent`
- sorted `mcp_servers`
- runtime agent bundle fingerprint when bundle freshness matters

Session reuse validation must not rely on `mcp_connected` alone. It must also
verify the stored requirement signature and prove the refreshed session token is
accepted by the MCP SSE route.

For reused sessions, evidence must include the raw
`GET /api/kollabor/engine/sessions/:id` payload proving:

- `profile: "mentiko"`
- `agent: "mentiko"`
- requested `mcp_servers: ["mentiko"]`
- `metadata.mentiko_agent_fingerprint` matching the installed repo bundle

If the engine payload lacks agent, MCP request, metadata, or fingerprint fields,
reuse is failed or partial. Create a fresh session and report the engine
contract gap. Do not accept localStorage signatures, POST request bodies,
`mcp_connected`, or UI state as proof of reused-session capabilities.

If the engine cannot return the requested agent and bundle fingerprint for an
existing session, reuse is forbidden for floating-bar sessions. Create a fresh
session instead of accepting a healthy-looking session with unknown capability
state.

Because the current typed `SessionInfo` may omit `agent` and `metadata`, the
issue must capture both raw POST-create and raw GET-reuse payloads. If neither
payload exposes agent, requested MCP servers, and bundle fingerprint, session
reuse remains partial by definition and the implementation must force fresh
floating-bar sessions.

The implementation must clear only Mentiko bar-owned session keys. It must not
erase unrelated app, auth, or provider state.

### 3. Session Tokens Must Match Engine Reality

The web proxy may mint a session token before forwarding session creation to
`kollabor-engine`. Future issues must prove that these three ids are identical:

- `session_id` returned by `POST /api/kollabor/engine/sessions`
- `jti` inside the returned `session_token`
- `session_id` accepted by `/sessions/:sessionId/message`

If the engine ignores a client-supplied id and returns a different id, the
browser can store a valid-looking token for the wrong session. That breaks
per-session MCP stream routing and can make reply/result evidence meaningless.

The proxy must treat an upstream session-id mismatch as a contract failure.
Either return a server error before storing a token, or mint the token from the
actual upstream `session_id` after proving the MCP subprocess receives that same
id. Do not return a token minted for a preselected id unless the upstream
response proves the engine used that id.

Refresh-token evidence must also prove the refreshed token `jti` matches the
requested engine session id and that the engine still reports that session.
Never accept "token exists" as proof of session-scoped MCP auth.

Refresh-token pass proof must include upstream engine reality for both browser
and internal refresh paths: `GET /sessions/:id` or equivalent engine evidence
must succeed before the token is minted. A nonexistent-session negative test
must fail instead of minting a token for an id that only exists in the URL.

### 4. MCP Schema Shape Is A Compatibility Boundary

The runtime may accept `servers`, `mcpServers`, or both depending on engine
version. An issue that changes MCP settings must state whether it is preserving
legacy keys, migrating to canonical keys, or writing both. It must also prove
other server entries survive the update.

The MCP server command shape is part of this boundary. The issue must capture
the exact `servers.mentiko` entry written to disk and prove the engine can
execute that entry as written. Do not accept a local repo probe that launches
`./bin/mentiko-mcp` directly as proof that the registered entry works.

For schema compatibility, `mcp_connected: ["mentiko"]` is acceptable supporting
evidence that the engine loaded the configured server. It is not acceptable as
final tool-call proof; final proof still requires a matching successful
`tool_result`.

### 5. Tool Scope Is Safer Than Profile Mutation

For the floating bar, limiting the MCP server by `MENTIKO_MCP_TOOL_SCOPE=bar`
is safer than mutating provider profiles or `supports_tools`. Profile changes
are shared state and can silently affect TUI and other agents. Future issues
must prefer runtime-local command/env configuration unless the requested change
is explicitly about profile management.

### 6. Tool Allowlists Can Drift From The Agent Prompt

If runtime config filters tools, the issue must require a diff between:

- documented tools in `dev/kollab/agents/mentiko/sections/03-mcp-tools.md`
- shipped tools in `lib/mentiko-mcp/tools.ts`
- runtime-visible tools when `MENTIKO_MCP_TOOL_SCOPE=bar`

Runtime-visible means the MCP server's `list_tools` result when launched with
`MENTIKO_MCP_TOOL_SCOPE=bar`, not only static parsing of `tools.ts`.

Runtime-visible also means the exact command and env written to the active MCP
settings file. A probe that hardcodes `./bin/mentiko-mcp` is useful only for
repo diagnostics. It does not prove the dev setup, process-manager, or
container registration path unless it was generated from the same written
`mcp_settings.json` entry being reviewed.

Missing tools may be intentional, but the sub-agent must name them and explain
the reason. Silent omissions make the floating bar look smart in the prompt but
unable to do the thing in the browser.

### 7. Dead Setup Fields Create False Confidence

Setup response fields must be produced by the setup route or removed from the
client contract. A client branch such as `profileToolsUpdated` is not evidence
of stale-session invalidation if the setup route never returns it. Future issues
must prove stale sessions are invalidated through an actual returned field,
session signature mismatch, or an explicit versioned storage-key change.

Setup path proof must be part of the actual response contract, not reviewer
interpretation. If verification expects normalized home-relative paths such as
`~/.kollab/agents/mentiko`, the setup route and client type must expose those
fields and tests must assert them. Do not ask reviewers to infer normalized
paths from absolute strings after the fact.

### 8. UI Ask/Permission Flows Need Result Semantics

Ask tools (`ask_confirm`, `ask_input`, `ask_choice`) are UI interactions, not
normal visible tool chips. Hiding their chips is fine only if the prompt still
has an obvious tray or transcript location and the reply path records a result.
Do not mark an ask prompt resolved before the browser reply reaches the MCP
server unless the issue explicitly accepts optimistic UI and documents the
timeout/error fallback.

When an issue touches ask rendering or reply wiring, it must prove the round
trip: browser click/input -> `POST /api/mentiko-mcp/reply` success -> MCP
server consumes the reply -> matching successful `tool_result` or a visible,
recoverable failure state. Local `resolveAsk` UI state is not enough.

Catch-and-ignore reply failures are a fail. If the reply POST fails, the user
must see a recoverable failed-reply state and the MCP turn must not be reported
as a successful ask proof.

Permission gates are part of the ask contract. If a tool can write files,
secrets, commands, schedules, tasks, templates, or other project state, one
verification path must prove a tier-b permission prompt round trip and one
negative timeout/no-response path. No response must not silently approve
floating-bar writes.

### 9. Browser Runtime Evidence Beats TUI Evidence

The floating bar is a browser runtime. Evidence must come from the browser path:

- setup route response
- engine session metadata
- MCP SSE connection with session token
- user turn sent through the bar
- `tool_start`
- matching successful `tool_result`
- visible UI result or route/data change when the tool has an effect

TUI commands are useful diagnostics, but they are not sufficient acceptance
evidence for this surface.

`get_current_page` is useful as a low-risk data tool, but it does not prove
MCP-to-browser UI effect delivery. A browser-runtime fix that claims UI effects
must also run one effect tool such as `show_toast` or `navigate` and prove the
same-tab visible effect.

The accepted `tool_result` proof must come from the browser-origin
`/sessions/:sessionId/message` SSE response for the same turn. Engine logs,
TUI transcript, or a rendered UI chip are useful supporting evidence, but they
do not replace raw browser-origin SSE evidence containing:

- `session_id`
- `tool_id`
- `tool_name: "get_current_page"`
- `success: true`
- output containing the current route

Workspace-aware tools need their own proof. For `create_task`,
`generate_tasks`, terminal, file, and workspace-scoped context tools, a
successful call must prove the selected/current workspace path entered the MCP
tool, was authorized by the web route, and produced data visible through the
same workspace-scoped UI or API. If that proof is absent, mark those tools
unproven in the runtime scope artifact instead of treating bar visibility as
capability proof.

### 10. Latest Dirty-Diff Red Flags To Carry Forward

The current supervised experiment has useful direction but is still partial.
Future issue prompts should explicitly prevent these exact misses:

- Client-read setup fields such as `profileToolsUpdated` must be either
  returned by `web/app/api/kollabor/setup/mentiko/route.ts` and tested, or
  removed from `web/lib/kollabor-engine-client.ts` and
  `web/components/floating-kollabor-bar.tsx`.
- `KollaborAskPrompt` must not call local `onRespond` before
  `replyToTool(...)` succeeds unless the issue explicitly implements and tests a
  pending state plus visible retry/failure path.
- Browser reply and current-page routes may keep dev diagnostic fallbacks, but
  floating-bar acceptance evidence must not rely on `global` or body-only
  `sessionId`. The proof path must use bearer-token `jti` scoping.
- `bin/docker-entrypoint.sh` must not rewrite
  `~/.kollab/mcp/mcp_settings.json` with a heredoc that drops unrelated
  servers. Container registration needs the same merge-and-preserve behavior as
  the setup route.
- Session reuse cannot be accepted if the client checks only `profile` plus
  `mcp_connected`. The raw engine session payload must prove agent,
  requested MCP servers, and bundle fingerprint, or the bar must create a fresh
  session.
- Session-token creation cannot assume the engine accepted a preselected
  session id. The proxy must verify the upstream `session_id` before returning a
  token whose `jti` is used for MCP routing.
- Static allowlist parsing is only a drift detector. The final proof must also
  include runtime `list_tools` output launched with
  `MENTIKO_MCP_TOOL_SCOPE=bar`.
- `servers.mentiko.command` must be an engine-executable command shape. If the
  entry uses `/usr/bin/env`, the executable and env assignments must be split
  into whatever `command`/`args`/`env` contract the engine actually supports.
  A single string such as
  `"/usr/bin/env MENTIKO_MCP_TOOL_SCOPE=bar /path/bin/mentiko-mcp"` is partial
  until engine execution is proven from that exact settings entry.
- If there are no focused tests for setup response parity, session-token `jti`,
  session reuse rejection, current-page scoping, stream auth, ask reply, and
  MCP settings preservation, the implementation remains partial.

### 11. Evidence Artifact Requirements

For runtime issues, the sub-agent should return small, inspectable artifacts
instead of prose-only claims:

- setup response JSON, redacted if needed
- raw POST-create engine session payload
- raw GET-reuse engine session payload when reuse is attempted
- decoded session-token claims showing `jti`
- browser-origin `/sessions/:sessionId/message` SSE excerpt containing
  `tool_start` and matching `tool_result`
- same-tab UI effect screenshot or DOM/network evidence
- ask reply request/response evidence, including bearer-token session id and
  MCP reply poll `sessionId`
- runtime `list_tools` output for `MENTIKO_MCP_TOOL_SCOPE=bar`

Do not paste secrets, tokens, cookies, provider keys, or full transcripts.
Redacted fields are fine as long as ids needed to prove routing still match.

### 12. Focused Verification Harnesses

Use exact probes where possible so different agents produce comparable
evidence.

#### Runtime Tool List Probe

Run this only as a repo diagnostic from `/Users/malmazan/dev/mentiko`:

```bash
node --input-type=module <<'NODE'
const sdk = "./web/node_modules/@modelcontextprotocol/sdk/dist/esm";
const { Client } = await import(`${sdk}/client/index.js`);
const { StdioClientTransport } = await import(`${sdk}/client/stdio.js`);

const transport = new StdioClientTransport({
  command: "./bin/mentiko-mcp",
  env: {
    ...process.env,
    MENTIKO_MCP_TOOL_SCOPE: "bar",
  },
});
const client = new Client(
  { name: "mentiko-contract-list-tools", version: "0.1.0" },
  { capabilities: {} },
);
await client.connect(transport);
const result = await client.listTools();
console.log(JSON.stringify(result, null, 2));
await client.close();
NODE
```

Pass evidence:

- raw JSON includes `tools`
- `get_current_page`, `show_toast`, and the ask tools are present
- any prompt-documented tool hidden from bar scope has an intentional reason
- workspace-aware visible tools are marked proven only with workspace-path
  authorization and visible workspace-scoped result evidence

This direct repo probe is not acceptance evidence for setup, process-manager,
or container registration. Acceptance evidence must launch the exact
`servers.mentiko.command`, `args`, and `env` written to the active
`mcp_settings.json` entry under review.

For registered-entry proof, use a controlled `$HOME` or the active runtime home
and derive the MCP launch from the settings file:

```bash
node --input-type=module <<'NODE'
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "./web/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "./web/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js";

const settingsPath = path.join(os.homedir(), ".kollab", "mcp", "mcp_settings.json");
const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
const entry = settings.servers?.mentiko;
if (!entry) throw new Error("servers.mentiko missing");
if (typeof entry.command !== "string") throw new Error("mentiko command missing");
if (/\s/.test(entry.command)) {
  throw new Error("mentiko command is shell-like; split executable/args/env first");
}

const transport = new StdioClientTransport({
  command: entry.command,
  args: Array.isArray(entry.args) ? entry.args : [],
  env: { ...process.env, ...(entry.env || {}) },
});
const client = new Client(
  { name: "mentiko-contract-registered-list-tools", version: "0.1.0" },
  { capabilities: {} },
);
await client.connect(transport);
console.log(JSON.stringify(await client.listTools(), null, 2));
await client.close();
NODE
```

If this probe fails because the current engine supports a different command
shape, cite the engine code and update the issue contract before assigning the
implementation.

#### MCP Settings Preservation Probe

For any setup, process-manager, or container MCP registration change, seed a
temporary settings file or controlled home directory with:

```json
{
  "servers": {
    "unrelated_probe": {
      "type": "stdio",
      "command": "/bin/echo",
      "args": ["keep-me"],
      "enabled": true
    }
  }
}
```

Pass evidence requires before/after JSON showing `unrelated_probe` remains
unchanged and `servers.mentiko` is added or updated. A count such as
`preservedServerCount: 1` is supporting evidence only, not proof.

## Current Experiment Reviewer Verdict

status: partial

The current dirty experiment has the right direction, but it is not ready for
supervised acceptance. The known blockers are:

- `web/components/floating-kollabor-bar.tsx` still reads
  `setup.profileToolsUpdated`, but the setup route does not return that field.
- `web/app/api/kollabor/setup/mentiko/route.ts` returns expanded paths, but not
  explicit normalized `~/.kollab/...` path fields required by this contract.
- `web/components/kollabor-ask-prompt.tsx` resolves local UI before
  `replyToTool(...)` succeeds and swallows reply failures. A failed reply must
  not mark the prompt resolved or count as pass.
- `bin/docker-entrypoint.sh` overwrites the whole MCP settings file instead of
  preserving unrelated servers.
- `web/app/api/kollabor/setup/mentiko/route.ts` and related registration paths
  write a shell-like `command` string with spaces. That is partial until the
  engine is proven to execute that exact settings entry.
- Browser-origin SSE evidence with matching `tool_start` and successful
  `tool_result` has not been captured in this run.

## Issue Contract Template

Use this template for sub-agent implementation issues.

```md
# Issue: <imperative title>

## Context

You are working in `/Users/malmazan/dev/mentiko`.

Live runtime facts:
- Floating bar uses `kollabor-engine`.
- Floating bar creates sessions with profile `mentiko`, agent `mentiko`,
  and `mcp_servers: ["mentiko"]`.
- Repo agent bundle source is `dev/kollab/agents/mentiko`.
- Runtime agent target is `~/.kollab/agents/mentiko`.
- MCP settings target is `~/.kollab/mcp/mcp_settings.json`.
- Use `~/.kollab` only. `~/.kollabor-cli` is wrong.

Problem:
<specific current failure, observed symptom, and why it matters>

## Goal

<one measurable behavior that should be true after the change>

## Non-Goals

- Do not commit.
- Do not use `git reset`, `git restore`, `git checkout`, or stash.
- Do not mutate provider profiles or `supports_tools`.
- Do not change unrelated app surfaces.
- Do not treat TUI success as acceptance evidence.

## Write Scope

Allowed files:
- `<exact file>`
- `<exact file>`

Read-only context:
- `<exact file or directory>`

If another file is required, stop and report the proposed scope expansion.

## Implementation Contract

- <specific API/client/schema behavior>
- <specific data path or config preservation behavior>
- <specific browser/session behavior>
- <specific error handling and redaction behavior>
- <specific compatibility rule>

## Verification Ladder

1. Static check:
   `<exact command>`

2. Unit or focused test:
   `<exact command>`

3. Runtime setup probe:
   `<exact command or browser step>`
   Required evidence:
- setup route returns `ok: true`
- agent target expands to `$HOME/.kollab/agents/mentiko`
- MCP target expands to `$HOME/.kollab/mcp/mcp_settings.json`
- normalized paths are `~/.kollab/agents/mentiko` and
  `~/.kollab/mcp/mcp_settings.json`
- unrelated MCP servers are preserved
- `servers.mentiko.command`, `args`, and `env` match the exact shape
  `kollabor-engine` executes

4. Browser runtime probe:
   `<exact browser steps>`
   Required evidence:
   - session uses profile `mentiko`
   - session uses agent `mentiko`
   - session requests `mcp_servers: ["mentiko"]`
   - session-scoped SSE opens only after session token exists

5. MCP tool proof:
   `<exact prompt to send through floating bar>`
   Required evidence:
   - `tool_start` for expected tool
   - matching successful `tool_result`
   - visible UI effect or returned data matches expectation

## Evidence To Return

- Files changed.
- Commands run and exact pass/fail result.
- Browser/runtime probe result.
- Captured setup/session/tool evidence.
- Unresolved risks.
- Any scope expansion requested but not performed.
```

## Reviewer Checklist

Use this before accepting sub-agent output.

- Did the agent stay inside write scope?
- Did the agent preserve unrelated dirty work?
- Did the agent avoid forbidden git commands and stash?
- Did the agent avoid `~/.kollabor-cli`?
- Did the agent avoid provider profile and `supports_tools` mutation?
- Did the agent prove setup path, session creation, and browser runtime?
- Did the agent include successful `tool_result`, not only `mcp_connected` or
  `tool_start`?
- Did the agent test the actual browser path when the issue affects the
  floating bar?
- Did the agent report exact commands and observed outputs?
- Did the agent name remaining risks without pretending they are solved?

## Next Candidate Issue

```md
# Issue: Repair Floating Bar Setup Contract Blockers

## Context

You are working in `/Users/malmazan/dev/mentiko`.

The floating Kollabor bar uses `kollabor-engine` with profile `mentiko`, agent
`mentiko`, and `mcp_servers: ["mentiko"]`. The repo-owned Mentiko agent bundle
is `dev/kollab/agents/mentiko`. Runtime setup must sync that bundle to
`~/.kollab/agents/mentiko` and write MCP config only to
`~/.kollab/mcp/mcp_settings.json`.

The current experiment is partial because it still has contract blockers:

- client code reads setup fields the route does not return
- setup evidence lacks explicit normalized `~/.kollab/...` paths
- ask UI resolves before the browser reply succeeds and hides reply failures
- container MCP setup overwrites unrelated MCP servers
- registered MCP commands may be shell-like strings instead of an
  engine-executable `command`/`args`/`env` shape

## Goal

Make setup, registration, and ask/reply behavior contract-testable so the next
issue can do browser-runtime proof without patching basic contract holes.

## Non-Goals

- Do not commit.
- Do not use `git reset`, `git restore`, `git checkout`, or stash.
- Do not mutate provider profiles or `supports_tools`.
- Do not change the provider bundle defaults.
- Do not claim browser-runtime pass without browser-origin `tool_result`
  evidence.
- Do not read, copy from, diff, list, or write `~/.kollabor-cli`.

## Write Scope

Allowed files:

- `web/app/api/kollabor/setup/mentiko/route.ts`
- `web/lib/kollabor-engine-client.ts`
- `web/components/floating-kollabor-bar.tsx`
- `web/components/kollabor-ask-prompt.tsx`
- `bin/docker-entrypoint.sh`
- `web/lib/process-manager.ts`
- focused tests under matching `web/**/__tests__`, `web/app/**`, or
  script-test locations

Read-only context:

- `dev/kollab/agents/mentiko/**`
- `web/app/api/mentiko-mcp/reply/route.ts`
- `web/app/api/mentiko-mcp/stream/route.ts`
- `web/app/api/mentiko-mcp/current-page/route.ts`
- `web/lib/mentiko-mcp-bar-client.ts`
- `lib/mentiko-mcp/tools.ts`

If another file is required, stop and report the exact scope expansion.

## Implementation Contract

- Setup response fields consumed by the client must be returned by the setup
  route and covered by tests.
- Setup must expose expanded absolute paths and normalized home-relative paths:
  `agent.normalizedTarget: "~/.kollab/agents/mentiko"` and
  `mcp.normalizedPath: "~/.kollab/mcp/mcp_settings.json"`.
- Remove any client dependency on `profileToolsUpdated` unless the setup route
  returns it and tests prove what stale state it invalidates.
- Setup, process-manager, and container registration must preserve unrelated
  MCP servers.
- Registration must use an engine-executable MCP command contract. Prefer
  executable path in `command`, empty or explicit `args`, and
  `MENTIKO_MCP_TOOL_SCOPE=bar` in `env`, unless current engine code proves a
  different shape is required.
- `KollaborAskPrompt` must not mark a prompt resolved before
  `POST /api/mentiko-mcp/reply` succeeds unless it renders a tested pending
  state plus visible retry/failure recovery.
- `replyToTool(...)` failures must surface a recoverable failed-reply state.
  Catch-and-ignore is a fail.

## Verification Ladder

1. Static forbidden-state grep:

   ```bash
   rg -n "\\.kollabor-cli|~/.kollabor-cli|supports_tools|profileToolsUpdated" \
     web lib bin dev/kollab -g '!**/node_modules/**'
   ```

   Expected: no forbidden path, no `supports_tools` mutation, and no stale
   `profileToolsUpdated` client dependency.

2. MCP settings preservation test:

   Seed a controlled settings object with `servers.unrelated_probe`, run the
   setup/registration helper under test, and assert `unrelated_probe` survives
   unchanged while `servers.mentiko` is added or updated.

3. Setup response parity test:

   Required assertions:

   - `ok: true`
   - `agent.target` expands to `$HOME/.kollab/agents/mentiko`
   - `agent.normalizedTarget` equals `~/.kollab/agents/mentiko`
   - `mcp.path` expands to `$HOME/.kollab/mcp/mcp_settings.json`
   - `mcp.normalizedPath` equals `~/.kollab/mcp/mcp_settings.json`
   - every client-read setup field exists in the route response type

4. MCP command-shape test:

   Required assertions:

   - `servers.mentiko.command` is the executable path or another shape proven
     by current engine code
   - `MENTIKO_MCP_TOOL_SCOPE=bar` is present in `env`
   - the test fails if command is a single shell-like string with spaces and no
     engine parser proof

5. Ask/reply component test:

   Required assertions:

   - successful reply waits for `replyToTool(...)` before rendering resolved UI
   - failed reply renders a recoverable failed-reply state
   - failed reply does not call local resolve as if the MCP reply succeeded

## Evidence To Return

- Files changed.
- Exact tests/commands run and pass/fail result.
- Before/after MCP settings JSON showing unrelated server preservation.
- Setup response shape with secrets/tokens redacted.
- Ask/reply success and failure behavior evidence.
- Whether any live browser proof was attempted. If not, report status
  `partial`, not pass.
- Any requested scope expansion.
```

## Final Browser Proof Candidate Issue

```md
# Issue: Prove Floating Bar MCP Browser Runtime

## Context

You are working in `/Users/malmazan/dev/mentiko`.

The floating Kollabor bar must run through browser -> Next.js proxy ->
`kollabor-engine` -> Mentiko MCP -> browser UI effects. The runtime facts are:

- Floating bar uses `kollabor-engine`.
- Floating bar profile is `mentiko`.
- Floating bar agent is `mentiko`.
- Floating bar session requires `mcp_servers: ["mentiko"]`.
- Repo agent bundle source is `dev/kollab/agents/mentiko`.
- Runtime agent target is `~/.kollab/agents/mentiko`.
- Runtime MCP settings target is `~/.kollab/mcp/mcp_settings.json`.
- Use `~/.kollab` only. Never use `~/.kollabor-cli`.

Only assign this after "Repair Floating Bar Setup Contract Blockers" is green.
This issue is for browser-runtime proof plus any tiny fix needed to make that
proof real. If the setup contract still has stale fields, untested path shape,
ask/reply failure swallowing, or MCP settings preservation gaps, stop and return
partial instead of patching all layers here.

## Goal

Prove the floating bar can complete one Mentiko MCP data tool, one MCP-driven
browser UI effect, and one ask-tool reply round trip from the browser. If live
runtime evidence cannot be captured, return a partial report with the exact
blocker and do not broaden the implementation.

## Non-Goals

- Do not commit.
- Do not use `git reset`, `git restore`, `git checkout`, or stash.
- Do not mutate provider profiles or `supports_tools`.
- Do not change provider bundle defaults.
- Do not broaden the feature or redesign the bar UI.
- Do not treat TUI success, `mcp_connected`, or `tool_start` as final proof.

## Write Scope

- `web/app/api/kollabor/engine/[...path]/route.ts`
- `web/app/api/kollabor/engine/sessions/[id]/refresh-token/route.ts`
- `web/lib/kollabor-engine-client.ts`
- `web/lib/session-token.ts`
- `web/lib/mentiko-mcp-bar-client.ts`
- `web/components/floating-kollabor-bar.tsx`
- `web/components/kollabor-ask-prompt.tsx`
- focused tests under the matching `web/lib/__tests__` or `web/components`
  test location

Read-only context:
- `web/app/api/kollabor/setup/mentiko/route.ts`
- `bin/docker-entrypoint.sh`
- `web/lib/process-manager.ts`
- `lib/mentiko-mcp/tools.ts`
- `dev/kollab/agents/mentiko/**`
- `web/app/api/mentiko-mcp/**`
- `web/lib/mentiko-mcp-inbox.ts`
- `docs/specs/mcp-session-auth-spec.md`

If another file is required, stop and report why.

## Implementation Contract

- Setup must sync from `dev/kollab/agents/mentiko` to
  `~/.kollab/agents/mentiko`.
- Setup must write only `~/.kollab/mcp/mcp_settings.json` for MCP config.
- Setup must preserve unrelated MCP server entries.
- Container and process-manager MCP registration must use the same merge
  semantics as the setup route. A shell heredoc that rewrites
  `mcp_settings.json` with only `servers.mentiko` is not acceptable.
- Setup response fields used by the client must be produced by the setup route
  and covered by focused tests. If normalized `~/.kollab/...` paths are
  required as evidence, expose them explicitly instead of relying on reviewer
  inference from absolute paths.
- Normalized response fields must have stable names, such as
  `agent.normalizedTarget` and `mcp.normalizedPath`, and must be asserted by
  route and client contract tests.
- Floating bar session creation must include profile `mentiko`, agent
  `mentiko`, and `mcp_servers: ["mentiko"]`.
- Session-token `jti` must match the engine session id returned to the browser
  and the session id used for `/sessions/:sessionId/message`.
- If the upstream engine returns a different `session_id` than the id the proxy
  requested, the proxy must not return the pre-minted token as success.
- Add or update a negative test proving upstream session-id mismatch fails
  instead of returning a token minted for the wrong session.
- Refresh-token responses must mint a token whose `jti` matches the requested
  engine session id after proving that engine session still exists.
- Refresh-token browser and internal paths must have a nonexistent-session
  negative test. Minting a token for a missing engine session is a fail.
- Session reuse must reject stale sessions that do not satisfy the required
  profile, agent, MCP, and bundle-fingerprint signature.
- If the engine cannot return agent or fingerprint metadata for an existing
  session, the bar must create a fresh session instead of reusing it.
- Add or update a negative test proving reuse is rejected unless raw engine
  payload includes profile, agent, requested MCP servers, and bundle
  fingerprint.
- LocalStorage session signatures are only a fast prefilter. They are not proof
  that the live engine session has the required agent, MCP server request, or
  bundle fingerprint.
- MCP SSE must use a session token and must not open a generic unauthenticated
  stream first.
- Current-page updates used by `get_current_page` must be session-scoped by the
  same session token `jti`. A `global` current-page fallback or body-only
  `sessionId` is not acceptable proof for floating-bar runtime behavior.
- For browser-origin current-page and reply writes, a valid bearer token must
  win over any mismatched body `sessionId`; an invalid bearer token must fail.
  A body `sessionId` fallback is dev-only diagnostic behavior, not acceptance
  evidence.
- Tool scope must be applied through Mentiko MCP runtime config/env, not
  provider profile mutation.
- Runtime-visible tools must be compared against the Mentiko agent prompt and
  shipped tool list. Any hidden or omitted prompt-documented tool must be
  justified.
- The allowlist evidence must be a runtime `list_tools` artifact, not only
  static parsing. Return one row per prompt-documented tool with:
  `tool`, `prompt_documented`, `shipped_in_ALL_TOOLS`,
  `visible_in_bar_scope`, and `intentional_omission_reason`.
- Runtime `list_tools` must launch the exact command/env from the active
  `mcp_settings.json` entry being proven. If dev setup, process-manager, or
  container registration is changed, capture the list from each changed entry
  or mark that path partial.
- Workspace-aware visible tools must include a `workspace_proof_status` column:
  `proven`, `unproven`, or `not_workspace_scoped`. Use `unproven` unless a
  runtime probe shows selected/current workspace path authorization and visible
  workspace-scoped result.
- Stale sessions must be invalidated by a real session signature, returned setup
  field, or versioned storage key. Do not rely on response fields that the setup
  route does not produce.
- Reused-session proof must come from the raw engine session payload. Do not
  accept localStorage signatures, POST request bodies, `mcp_connected`, or UI
  state as capability proof.
- Do not mark an ask prompt resolved before `POST /api/mentiko-mcp/reply`
  succeeds.
- Do not swallow `replyToTool(...)` failures. A catch block that hides the
  failure and leaves the prompt resolved is a fail.
- A failed reply POST must render a recoverable failed-reply state and must not
  call local resolve as if the MCP reply succeeded.
- Ask tools must prove browser reply round trip. If `KollaborAskPrompt` or
  ask handling is touched, the proof must include a successful
  `POST /api/mentiko-mcp/reply` and a matching MCP `tool_result` with the same
  `toolId` and session id. A visible recoverable failure state is useful, but
  it is partial, not a pass.
- Permission-gate ask flows must be proven separately from a generic
  `ask_confirm`. A tier-b write tool must prompt, wait for the browser reply,
  and deny or time out safely when no reply arrives.
- MCP-side reply polling must include the same session id used by effect
  dispatch. Polling `/api/mentiko-mcp/reply?toolId=...` without `sessionId`
  can read the `global` bucket and miss bearer-token browser replies.
- The expected MCP poll URL shape is
  `/api/mentiko-mcp/reply?toolId=<id>&sessionId=<MENTIKO_SESSION_ID>`.
- If setup changes the MCP schema from `mcpServers` to `servers`, runtime
  evidence must prove the engine version can load `servers`. `mcp_connected`
  can prove schema loading only; it does not prove tool-call success.
- If container/process setup files stay in scope, they must preserve existing
  MCP servers and match the setup route contract: `servers.mentiko`,
  `MENTIKO_MCP_TOOL_SCOPE=bar`, and no writes outside `~/.kollab`.

## Verification Ladder

1. Static grep:
   ```bash
   rg -n "\\.kollabor-cli|~/.kollabor-cli|supports_tools|profileToolsUpdated" \
     web lib bin dev/kollab -g '!**/node_modules/**'
   ```

   Expected:
   - no `~/.kollabor-cli`
   - no provider `supports_tools` mutation
   - no stale response fields that imply profile/session mutation unless
     implemented by the setup route

2. Tool-scope diff:
   ```bash
   node <<'NODE'
   const fs = require("fs");
   const prompt = fs.readFileSync(
     "dev/kollab/agents/mentiko/sections/03-mcp-tools.md",
     "utf8",
   );
   const source = fs.readFileSync("lib/mentiko-mcp/tools.ts", "utf8");
   const promptTools = [...prompt.matchAll(/^([a-z][a-z0-9_]*)\(/gm)]
     .map((match) => match[1]);
   const barBlock = source.match(
     /const BAR_TOOL_NAMES = new Set\(\[([\s\S]*?)\]\);/,
   );
   const allBlock = source.match(/const ALL_TOOLS: Tool\[\] = \[([\s\S]*?)\];/);
   const barTools = barBlock
     ? [...barBlock[1].matchAll(/"([a-z][a-z0-9_]*)"/g)]
       .map((match) => match[1])
     : [];
   const allTools = allBlock
     ? [...allBlock[1].matchAll(/name: "([a-z][a-z0-9_]*)"/g)]
       .map((match) => match[1])
     : [];
   const bar = new Set(barTools);
   const all = new Set(allTools);
   console.log(JSON.stringify({
     promptTools: promptTools.length,
     allTools: allTools.length,
     barTools: barTools.length,
     missingFromAll: promptTools.filter((tool) => !all.has(tool)),
     hiddenFromBar: promptTools.filter((tool) => !bar.has(tool)),
     barOnly: barTools.filter((tool) => !promptTools.includes(tool)),
   }, null, 2));
   NODE
   ```

   Expected:
   - static counts are returned as support evidence
   - runtime `list_tools` is also captured with
     `MENTIKO_MCP_TOOL_SCOPE=bar`
   - every prompt-documented browser tool is either runtime-visible in bar scope
     or explicitly documented as intentionally unavailable
   - missing runtime `list_tools` evidence makes verification partial

3. Focused tests:
   Add or update exact contract tests, then run the narrow matching commands.
   Suggested targets:
   - `web/app/api/kollabor/setup/mentiko/route.test.ts`
   - `web/lib/__tests__/kollabor-engine-client.test.ts`
   - `web/lib/__tests__/mentiko-mcp-bar-client.test.ts`
   - `web/components/__tests__/kollabor-ask-prompt.test.tsx`
   - `web/app/api/mentiko-mcp/reply/route.test.ts`
   - `web/app/api/mentiko-mcp/current-page/route.test.ts`
   - `web/app/api/mentiko-mcp/stream/route.test.ts`
   - a scripted or unit check for `bin/docker-entrypoint.sh` and
     `web/lib/process-manager.ts` MCP settings preservation

   Do not use `npm test -- kollabor` as the only test gate unless it is updated
   to include the contract tests above.

   Expected:
   - existing Kollabor-related tests pass, or failures are reported with exact
     failing test names.
   - test coverage includes setup preserving unrelated MCP servers and writing
     only `~/.kollab`
   - test coverage includes setup response/client type parity, with no phantom
     response fields
   - test coverage includes session-token `jti` matching the engine session id
     returned to the browser
   - test coverage includes refresh-token `jti` matching the requested engine
     session id
   - test coverage includes refresh-token rejecting nonexistent engine sessions
     for browser and internal refresh paths
   - test coverage includes session reuse rejecting missing agent/fingerprint
     evidence
   - test coverage includes `MCPBarClient` creating no generic EventSource when
     no session token exists
   - test coverage includes current-page writes scoped by session token and
     rejects `global` fallback as floating-bar proof
   - test coverage includes `tool_start` and matching successful `tool_result`
     updating the same draft tool
   - test coverage includes ask prompt reply calling
     `/api/mentiko-mcp/reply` before resolving local UI, or rendering a
     recoverable failed-reply state when the POST fails
   - test coverage includes MCP-side reply polling with `sessionId`, matching
     browser bearer-token storage under the same `jti`
   - test coverage includes invalid bearer tokens failing for current-page and
     reply writes
   - test coverage includes bearer-token `jti` winning over mismatched body
     `sessionId`
   - test coverage includes upstream engine session-id mismatch failing instead
     of returning a token minted for the wrong session
   - if container files are changed, tests or a scripted check prove existing
     MCP server entries are preserved instead of overwritten

4. Reply poll grep:
   ```bash
   rg -n "reply\\?toolId=|sessionId" lib/mentiko-mcp/dispatch.ts \
     web/app/api/mentiko-mcp/reply/route.ts \
     web/components/kollabor-ask-prompt.tsx
   ```

   Expected:
   - MCP reply polling includes `sessionId=${MENTIKO_SESSION_ID}`
   - browser reply POST uses bearer token from session storage
   - ask prompt does not call local resolve before reply success unless there
     is a tested pending plus retry/failure path
   - no catch block hides `replyToTool(...)` failure while marking the prompt
     resolved

5. Setup probe:
   Start the web dev server if needed, authenticate locally, then call:
   `curl -s -X POST http://localhost:3000/api/kollabor/setup/mentiko | jq .`

   Expected evidence:
   - `ok: true`
   - `agent.target` equals `$HOME/.kollab/agents/mentiko` after expansion
   - `mcp.path` equals `$HOME/.kollab/mcp/mcp_settings.json` after expansion
   - normalized target paths are reported as `~/.kollab/...`
   - `mcp.serverName` equals `mentiko`
   - unrelated MCP servers remain present
   - `~/.kollabor-cli` was not listed, read, diffed, copied from, or written
   - setup response/client type parity is proven; no client-read setup fields
     are absent from the route response
   - the written MCP schema key is proven compatible with the running engine
     by engine evidence that it loaded `mentiko`
   - if container/process files are changed, the same preservation and
     `MENTIKO_MCP_TOOL_SCOPE=bar` contract is proven for that path

6. Browser runtime probe:
   Open `http://localhost:3000/dashboard`, use the floating bar, and send:
   `what page am i on? use the mentiko tool, don't guess`

   Expected evidence:
   - created or reused session has profile `mentiko`
   - session has agent `mentiko`
   - session requested `mcp_servers: ["mentiko"]`
   - returned `session_token` decodes to a `jti` matching that session id
   - stored session signature includes the current agent fingerprint
   - reused sessions include raw engine payload proof for profile, agent,
     requested MCP servers, and metadata fingerprint
   - MCP SSE URL includes a session token
   - no EventSource opens before the session token exists
   - current-page POST/GET evidence uses the same session-token `jti`; a
     `global` bucket response is a failed browser-runtime proof

7. Data tool-result proof:
   Capture the browser-origin `/sessions/:sessionId/message` SSE response for
   the same turn. Do not substitute TUI output or engine logs.

   Expected evidence:
   - `session_id` matches the floating-bar session
   - `session_token` `jti` matches the same `session_id`
   - `tool_start` for `get_current_page`
   - matching `tool_result` has the same `tool_id`
   - `tool_result.success` is `true`
   - `tool_result.output` contains the current route
   - assistant answer reflects the returned page path

8. UI effect proof:
   In the same browser tab, send:
   `show me a toast that says mentiko mcp proof`

   Expected evidence:
   - `tool_start` for `show_toast`
   - matching `tool_result.success` is `true`
   - the toast is visible in the same tab
   - the effect came through `/api/mentiko-mcp/stream` using the session token

9. Ask reply proof:
   Trigger one plain ask tool and one permission-gate ask for a tier-b tool,
   answer them in the browser, and capture the network and engine result.

   Expected evidence:
   - ask prompt appears in the bar or tray for the correct `toolId`
   - browser reply calls `POST /api/mentiko-mcp/reply` with Authorization Bearer
     session token
   - reply returns a success status
   - decoded bearer `jti`, MCP `MENTIKO_SESSION_ID`, and reply poll
     `sessionId` all match the engine session id
   - body `sessionId` is absent or matches the bearer `jti`; a mismatched body
     value cannot route the reply
   - matching MCP `tool_result` is emitted after the reply with the same
     `toolId`
   - permission-gate timeout/no-response denies or fails safely; it does not
     silently approve a write
   - visible recoverable failure state is shown if the POST or poll fails, and
     the issue is reported partial instead of pass

## Evidence To Return

- Files changed.
- Exact commands run and results.
- Whether the browser probe passed or failed.
- Exact focused test files added or updated. If no tests were added, explain
  why this is only partial.
- Raw browser-origin SSE evidence for data-tool `tool_start` and matching
  successful `tool_result`.
- Same-tab UI effect proof for an MCP-driven browser effect.
- Ask reply round-trip proof when ask UI/reply code is in scope.
- Any setup/session mismatch.
- Any unresolved risk in stale sessions, MCP settings compatibility, or ask UI.
- Any prompt/tool-scope mismatch and whether it is intentional.
```

## Readiness Recommendation

Use this contract before handing runtime work to sub-agents. The current
floating-bar/MCP experiment is not acceptable as "done" until a browser-origin
Mentiko tool call produces a successful `tool_result` and the reviewer confirms
the patch did not mutate shared provider/profile state or write outside
`~/.kollab`.
