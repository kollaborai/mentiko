# Floating Bar Enable/Disable — Implementation Spec
# status: revised for scoped YOLO-on default (2026-09-22); live validation pending
# implementation: in progress; see FLOATING_BAR_ENABLE_DISABLE_ACCEPTANCE.md
# scope: user-facing enable/disable for the Mentiko floating bar (Kollabor bar)

## Overview

The Mentiko floating bar is currently controlled by the deployment flag
`NEXT_PUBLIC_KOLLABOR_BAR=0`. This spec adds an authenticated user's persisted
browser-scoped preference, exposed on `/settings/mentiko-agent`, while keeping
the deployment flag authoritative. The settings page also exposes scoped
wide-screen width and expanded-chat backdrop/shape controls. Deployment
operators can seed the width default with `NEXT_PUBLIC_KOLLABOR_BAR_WIDTH`;
saved user values take precedence within the active preference scope.

The effective rule is:

```
effectiveEnabled = deploymentEnabled && userEnabled && storageScopeReady
```

When `effectiveEnabled` is false, the bar renders nothing, starts no engine
runtime, opens no MCP stream, sends no current-page context, and cannot leave a
local turn handling or UI effects running invisibly. Server cancellation is a
separate acknowledged operation: failure must remain visible in settings.

This is a local preference, not a data-erasure feature. Disabling the bar stops
new runtime activity and cancels the active turn, but does not delete the saved
transcript or the stored engine session id. The stored id is inert while the
bar is disabled and cannot be used by UI-control approval. Existing external
UI-control grants are suspended locally, not revoked; they may resume when the
same session is re-enabled before their token expires. This distinction must
appear in the setting's explanatory copy.

## Current implementation verified in source

- `web/app/layout-client.tsx` mounts `FloatingBarStorageScope` inside
  `UserProvider`, outside both the deployment-flag condition and panel-surface
  shell controls. `FloatingKollaborBar` and `UIControlGrant` mount only when the
  deployment flag is on and the document is not a panel surface.
- `web/lib/ai-engine/kollabor-bar-flag.ts` treats only the exact value `"0"`
  as deployment-disabled and parses the bounded
  `NEXT_PUBLIC_KOLLABOR_BAR_WIDTH` default.
- `web/lib/ui/kollabor-bar-store.ts` scopes enabled, YOLO, YOLO-seen, width,
  appearance, transcript, and session preferences. Missing scoped YOLO and
  YOLO-seen values default to true; malformed values fail closed. Explicit
  YOLO opt-out is persisted and marks the first-run choice resolved. Raw legacy
  YOLO values are copied only into an anonymous scope.
- `setKollaborBarStorageScope()` reloads the scoped preference values and
  resets transient runtime state. `FloatingBarStorageScope` resolves the
  authenticated install-plus-user scope, applies it to the bar/engine/MCP
  stores, and withholds readiness on authenticated identity lookup failure
  rather than substituting an anonymous scope.
- The layout-owned scope component captures outgoing scope/session/generation
  before shutdown. The floating bar starts runtime work only after scope
  readiness and availability checks; disable/scope-change cleanup uses the
  shared shutdown path and reports unconfirmed cancellation as recovery.
- `system-status-widget.tsx` uses the shared runtime availability gate before
  showing its bar opener. `ui-control-grant.tsx` rechecks the same gate and
  captured scope/generation before showing approval success.
- `/settings/mentiko-agent` is protected by the existing session redirect. Its
  enablement, YOLO, width, and chat-appearance controls read/write the active
  scoped preference state.
- Panel documents omit floating runtime controls, while the layout scope owner
  remains mounted. `floating-bar-storage-scope.tsx` bridges scoped snapshots and
  preference acknowledgements between the embedded settings iframe and parent.
- `/mcp-auth` distinguishes UI-control grants from ordinary data grants and
  binds a UI approval to the connected scoped session. `MCPBarClient` cancels
  reconnects on close and rejects late token/reply writes from a stale scope.
- The web client and proxy send a stable caller-provided session id and can
  reconcile a lost create response only after `GET /sessions/{id}` can see the
  session in the engine registry or hub discovery. The engine reserves the id
  privately during `initialize()`: a second same-id create gets 409, while GET
  returns 404 until initialization finishes and the session enters the
  registry. Accepted-but-still-initializing creation is not yet reconcilable.
- Engine cancellation remains externally blocked: `POST /sessions/{id}/cancel`
  accepts no turn/cancellation identity and immediately returns
  `{ok: true, session_id}` after scheduling fire-and-forget cancellation. It does not prove
  the old turn and tools are terminal or protect a later turn from delayed
  cancellation.

## Goals

1. An authenticated user can hide or restore the floating bar from
   `/settings/mentiko-agent`.
2. The preference survives reloads and is isolated by the active storage scope.
3. Scope changes (anonymous runtime scope <-> authenticated user scope) reload
   all scope-dependent booleans and cannot carry a turn or approval prompt into
   the next scope.
4. `NEXT_PUBLIC_KOLLABOR_BAR=0` remains a deployment master switch.
5. A disabled bar performs no bar-runtime work: no engine setup/session boot,
   engine ping, MCP SSE, Codex probe, current-page POST, turn send, or delayed
   stale-event state mutation.
6. Disabling during a turn immediately stops local activity, requests server
   cancellation, and removes actionable pending prompts. Unconfirmed server
   shutdown is reported and blocks session reuse.
7. Dashboard entry points and UI-control approval cannot become clickable
   no-ops or bypass the preference.
8. The settings path remains reachable without the bar; the setting is not
   reachable anonymously unless a separate public settings surface is added.
9. An authenticated user can adjust the wide-screen width and expanded-chat
   backdrop/shape controls from the settings page; changes persist in scope,
   apply live, and synchronize through embedded settings panels.

## Non-goals

- Anonymous users editing this preference through the protected settings page.
- Per-workspace or per-organization enablement.
- Server-side persistence of the preference.
- Cross-device synchronization.
- Live cross-tab synchronization in this change. A second tab may retain its
  current runtime until refresh; this limitation must be documented. Parent and
  child panels within one tab are explicitly in scope.
- Revocation of already-issued external UI-control tokens. Disable suspends
  local effect handling; it does not revoke the external agent's credential.
- Deleting transcripts, engine sessions, current-page context, or other history.
- Per-user token-status UI. Width and expanded-chat appearance controls are in
  scope; unrelated panel content and engine presentation remain outside this
  change.

## Data and scope contract

### Preference keys

Add these base keys to `web/lib/ui/kollabor-bar-store.ts`:

```
LS_ENABLED_KEY = "mentiko-kollabor-enabled"
LS_YOLO_KEY = "mentiko-kollabor-yolo"
LS_YOLO_SEEN_KEY = "mentiko-kollabor-yolo-seen"
LS_WIDTH_KEY = "mentiko-kollabor-width"
LS_APPEARANCE_KEY = "mentiko-kollabor-appearance"
```

The store must treat these as base keys. `loadBool(baseKey, defaultValue)` and
`saveBool(baseKey, value)` must always apply `scopedStorageKey(baseKey)` before
reading or writing. Missing values resolve to:

```
enabled: true
yoloMode: true
yoloPromptSeen: true
```

A new preference scope therefore starts in YOLO mode and treats the first-run
mode choice as resolved; the first message does not open the legacy mode-choice
prompt. Turning YOLO off is an explicit scoped opt-out and remains off after a
reload. This default is distinct from an explicit stored `"0"` value.

`LS_WIDTH_KEY` stores the user-selected integer width in CSS pixels. A missing
or malformed value falls back to `getKollaborBarWidth()`, which reads
`NEXT_PUBLIC_KOLLABOR_BAR_WIDTH` and defaults to `373px`; valid user values are
bounded to `240px` through `720px` and clamp to `100vw - 2rem` at render time.

`LS_APPEARANCE_KEY` stores the scoped chat appearance object:

```
backdropEnabled: boolean
backdropBlur: 0..40px
backdropDim: 0..45%
backdropWidth: 240..900px
backdropHeight: 360..1200px
backdropSoftness: 50..100%
transcriptMaxHeight: 35..90vh
surfaceRadius: 0..32px
surfaceShadow: 0..36px
```

The product defaults preserve the current look (`backdropEnabled=true`, blur
`20px`, dim `22%`, ellipse `540x900px`, softness `90%`, transcript `78vh`,
radius `16px`, shadow `18px`). Invalid values are normalized to the nearest
safe bound or the product default when the stored type is malformed.

The store exposes:

```
enabled: boolean
setEnabled(next: boolean): void
preferenceStorageError: string | null
```

Existing dock, offset, scale, and font-scale storage is outside this feature.
It remains device-global unless a separate preference-scope migration is
approved; the implementation must not describe it as user-scoped.

### Storage failures

Boolean wire values are exactly `"1"` and `"0"`. A successfully read missing
enabled key defaults to true. A read exception or malformed enabled value is
not a missing value: keep the runtime off, report the problem in settings, and
offer Retry. Missing scoped YOLO and YOLO-seen values default to true; malformed
values or read failures are not missing values and use false.

An explicit toggle updates the current tab and its panels immediately even if
the write fails. Surface an inline error: `Changed for this tab, but could not
save. Reloading may restore your previous setting.` Keep the error until a
successful write; offer Retry saving. Do not report persistence success or
silently roll a failed disable back to on. An explicit enable after a storage
read failure is allowed only after identity scope resolution and acknowledges
the same temporary, unsaved state. Unreadable storage on the next load starts
off again. Helpers must return a write outcome rather than swallowing errors.

### Legacy boolean migration

Existing releases wrote YOLO and YOLO-seen values under raw, unscoped keys.
Migration is additive and must not copy a previous user's safety preference into
another authenticated user's scope:

1. On first read, if the scoped key exists, use it.
2. If the scoped key is missing and the active scope is anonymous, copy the raw
   legacy value into the anonymous scoped key.
3. If the active scope is authenticated and no scoped value exists, use the
   product default (`yoloMode=true`, `yoloPromptSeen=true`); do not inherit a
   raw value whose owner cannot be proven.
4. Keep the raw key untouched so rollback remains non-destructive.

Add tests for missing values, scoped values, raw legacy values, and an
authenticated scope following an anonymous scope.

### Scope switching

Before replacing any scope or session id, the layout owner captures the
outgoing `{scope, sessionId, generation}`, marks readiness false, and invokes
the shared shutdown path against that captured identity. Never look up the
outgoing session from the store after loading the incoming scope. Invalidate
callbacks synchronously, including when both users have enabled=true.

Do not serialize incoming preference hydration behind the outgoing server
shutdown request. Invoke shutdown synchronously far enough to invalidate local
work and persist its outgoing-scope marker, then resolve and hydrate the
incoming identity independently. An unresolved outgoing shutdown remains
associated with its captured scope/session and blocks reuse of that session;
it must neither leave incoming settings controls loading nor write shutdown
state into the incoming scope. The storage-scope request and cancellation
request each retain their own bounded timeout and retry/error path.

`setKollaborBarStorageScope()` must reload, in one state transition:

```
messages
sessionId
drafting: null
enabled
yoloMode
yoloPromptSeen
expanded: false
inputValue: ""
connected: false
connecting: false
error: null
engineReady: false
engineError: null
```

The last group prevents stale connection or prompt state from appearing in a
different user scope. Committed transcript history remains scoped and is loaded
from the new scope.

Apply the bar, engine, and MCP storage scopes before publishing readiness for
the incoming identity. Readiness must be bound to the resolved user id, not a
boolean left true for the first render of a different user. Outgoing cleanup
results must not alter incoming user state. Pending cleanup remains associated
with its original scope/session and is checked before that session is reused.
Reset component-local prompts, credentials, pending first message, request refs,
and tool maps as well as store state. Exercise user A -> user B directly, not
only anonymous/authenticated transitions.

## Scope hydration ownership

Extract the current storage-scope resolution into a small always-mounted
`FloatingBarStorageScope` provider/component under `web/components/app-shell/`
or an equivalent layout-owned module.

It must be mounted inside `UserProvider` but outside `WhenNotPanelSurface` and
outside the deployment-flag condition. It owns:

- anonymous install/tab scope resolution;
- authenticated install-plus-user scope resolution;
- `setKollaborBarStorageScope()`;
- `setKollaborEngineStorageScope()`;
- `setMcpBarStorageScope()`;
- a `storageScopeReady` value for consumers.

The settings page must not allow the toggle to write until
`storageScopeReady=true`. The bar may render only after the same signal is
true. Identity hydration and bounded shutdown/recovery requests described below
are the only bar-related network work permitted while the preference is disabled.

For an authenticated user, failed, unauthorized, malformed, or timed-out
`/api/system/storage-scope` responses keep readiness false. Do not substitute an
anonymous or synthetic install scope. Show `Could not load your bar settings`
with Retry; use a 10-second request timeout and abort obsolete identity requests.
A successful retry loads the original scoped preference before enabling any
runtime. Anonymous fallback applies only after auth has resolved as anonymous.

This provider must still run when:

- `NEXT_PUBLIC_KOLLABOR_BAR=0`;
- the current document is a panel surface;
- the bar preference is false.

## Effective availability

Provide one small shared selector/helper for consumers:

```
deploymentEnabled = isKollaborBarEnabled()
effectiveEnabled = deploymentEnabled && store.enabled && storageScopeReady
runtimeMayStart = effectiveEnabled && preferenceReadResolved && !cleanupBlocked
canApproveUiControl = runtimeMayStart && connected && activeSessionMatchesScope
```

`preferenceReadResolved` means a valid/missing key was read or the user made an
explicit current-tab choice after a read error. `cleanupBlocked` covers pending
or unconfirmed shutdown for the session to be reused. A persisted session id
alone never makes approval available, including during boot or reconnection.

The settings page may display the stored user preference separately from the
deployment override. When the deployment flag is off, the switch is disabled,
the effective state is shown as off, and the copy says:

```
Your deployment has disabled the Mentiko bar. Your saved preference will apply
if the deployment enables it again.
```

## Bar runtime gating and disable lifecycle

Gate inside `FloatingKollaborBar`:

```
// After all hooks; never conditionally change hook order.
if (!runtimeMayStart) return null;
```

Because this does not unmount the component, every bar-owned effect must guard
its body and cleanup. While disabled, the bar must not:

- call `ensureMentikoAgentInstalled`, `enginePing`, or `getOrCreateSession`;
- start or reconnect `MCPBarClient` / `EventSource`;
- probe `/api/system/ai-gateway` or `/api/system/codex-token`;
- POST `/api/mentiko-mcp/current-page`;
- attach bar-only keyboard, pointer, wheel, or resize listeners;
- process MCP effects, send turns, or write delayed async results to the store.

The scope provider is exempt because it establishes the identity needed to read
the preference. Current-page requests also require a connected session matching
the active scope and generation, with abortable request cleanup.

On disable, outgoing scope change, or bar unmount (including entry into a panel
surface), run one idempotent `stopFloatingBarRuntime(outgoingIdentity)` path.
Deduplicate by captured scope/session/generation; the owner must survive bar
unmount so cleanup and its result do not depend on a hidden component:

1. Capture the outgoing identity and synchronously invalidate its generation,
   disable send/approval handlers, and abort local boot, send, probe, and
   current-page requests. Do not await the server before stopping local work.
2. Record pending shutdown for that captured session and call
   `engineCancelTurn(sessionId)` when a turn may be active, including an
   uncertain send outcome. Reuse the cancellation API, not `handleStop()`'s
   draft-commit behavior. Never cancel the incoming scope's session.
3. Stop the ping interval and disconnect the MCP client. The interval must be
   owned by a ref or by the enabled-dependent effect cleanup; a separate effect
   must not pretend a local closure timer is reachable.
4. Set `sendingRef=false`, `connected=false`, `connecting=false`,
   `engineReady=false`, and clear transient engine errors. Keep shutdown errors
   separately so this reset cannot hide them.
5. Discard the active draft and clear pending tool bookkeeping. Preserve
   already-committed transcript messages.
6. Remove or mark unresolved permission/ask prompts as cancelled so they cannot
   be answered after re-enable. Clear any pending first message.

### Cancellation acknowledgement and recovery

Persist a scoped pending-shutdown marker before requesting cancellation so a
reload cannot silently reuse an uncertain session. Clear it only after the
request has settled successfully and the engine contract confirms the old turn
and its tool execution are terminal. Verify that contract during implementation;
if the cancel response only acknowledges receipt, use an authoritative status
check. Mocking a successful HTTP response is not proof of termination.

Use a 10-second cancellation request timeout. On timeout, rejection, or an
unverifiable outcome, keep local activity off and show in settings:
`Bar hidden. Could not confirm the active turn stopped.` Provide Retry stopping;
do not clear the marker, report success, create a replacement session, or send a
new turn as an automatic recovery. A marker write failure must also be surfaced;
cross-reload recovery cannot be guaranteed when storage is unavailable.

Serialize re-enable behind pending shutdown. The switch may save enabled=true,
but show `Waiting for the previous turn to stop` and block boot/send/approval
until recovery completes. A late cancellation must never hit a newly started
turn on the same session. Retrying after an uncertain timeout must reconcile
the original request or use a turn-specific/idempotent server contract; observing
an idle session alone does not prove an earlier cancellation cannot arrive later.
If the current engine cannot provide this guarantee, treat that contract as an
implementation blocker rather than silently weakening the requirement.

Unexpected document destruction cannot guarantee delivery of an async cancel
request. Attempt bounded cleanup, retain the pending marker where possible,
and reconcile on next load. Do not claim reliable server termination on browser
crash, offline shutdown, or logout that has already revoked cancellation access.
An unrelated tab may share a stored engine session; cancellation can affect its
turn. Cross-tab isolation is not promised by this local preference.

On re-enable with cleanup complete, boot immediately from the enabled-dependent
effect. It must not wait for the 30-second ping interval. A cancelled boot/send from the previous
generation must not reconnect or mutate state after re-enable.

### Client-helper ownership and late results

Include `web/lib/ai-engine/kollabor-engine-client.ts` and
`web/lib/ai-engine/mentiko-mcp-bar-client.ts` in implementation scope. Component
guards alone cannot protect side effects inside these helpers.

- Capture scope/generation at request creation. Check validity before every
  continuation that writes storage, returns an active session, or starts work.
  Never write an old user's token under the mutable new scope.
- MCP clients own and clear every reconnect timer, abort their refresh request,
  and reject connect/message/refresh callbacks after disconnect. Check closed
  state inside timer callbacks and at the start of `connect()`.
- Boot cancellation must preserve per-scope session-creation deduplication;
  passing an AbortSignal currently bypasses the existing shared-bootstrap map.
  Specify ownership in the helper so React effect restarts cannot double-create.
- Aborting fetch cannot undo a session creation already accepted by the server.
  Do not adopt or persist a stale result as active. The web stable-id plus GET
  reconciliation covers only registered or hub-discoverable sessions; it does
  not cover an accepted create while `initialize()` is pending. The engine must
  either expose pending/ready/failed state by stable id or make a same-id retry
  join/wait for the pending create and return its eventual result. Until then,
  accepted-but-pending create recovery is an implementation blocker. Preserve
  inert sessions rather than deleting history. A session may exist server-side
  after disable, but it must not start a turn, connect SSE, or become available
  to approvals through a stale generation.

### Existing and in-flight UI-control grants

Disable suspends local effect consumption, including queued effects from the old
generation. It does not revoke the existing 12-hour signaling token. Re-enable
may allow an existing external grant to act again on the same session; display
this behavior in settings and user documentation. This feature is not a server
authorization boundary or a replacement for credential revocation.

Approval handlers capture scope/session/generation and recheck availability
before sending. Abort approval requests on disable or identity change and ignore
late UI completions, including success toasts. A request already accepted by the
server may still issue a grant; its effects remain suspended locally until a
valid runtime resumes. Do not claim that aborting the request revokes it.

## Deployment flag and adjacent surfaces

`NEXT_PUBLIC_KOLLABOR_BAR=0` remains the master switch:

- `FloatingKollaborBar` is not mounted;
- `UIControlGrant` is not mounted or attaches no listeners;
- the dashboard “ask mentiko” control is absent;
- the settings card is visible but disabled;
- the saved user preference is retained for a future enabled deployment.

When the deployment is enabled but the user preference is false:

1. `system-status-widget.tsx` must subscribe to the store and hide the
   “ask mentiko” button, or render a genuinely disabled control with the exact
   recovery path `Settings -> Mentiko Agent`.
2. `ui-control-grant.tsx` must gate both opening and approval on
   `canApproveUiControl`. Paste and Cmd/Ctrl+M must not open an actionable dialog while
   disabled. If an already-open dialog becomes disabled, approval must be
   rejected with:

   ```
   The Mentiko bar is off - enable it in Settings -> Mentiko Agent.
   ```

3. `web/app/mcp-auth/page.tsx` must apply the same approval gate for UI-control
   requests, including deployment-off, disabled, booting, and wrong-scope states.
   Read the current connected session from the shared scope-aware runtime state;
   remove the scan across localStorage session keys. Never select another user's
   or another stored session as a fallback. Keep ordinary MCP data authorization
   and denial working. Determine grant kind from authoritative device-info data
   (extend its response if needed), not solely the editable `ui=1` URL parameter.
4. The external-consumer sweep must cover bar openers, UI approval submitters,
   current-page producers, and reconnect callers. Future consumers must use the
   shared availability helper. An enabled but disconnected runtime displays a
   connection/recovery explanation rather than the misleading bar-off message.

## Parent and panel consistency

One top-level document owns the current-tab runtime and preference revision.
An embedded same-origin settings panel sends a scoped preference-change request
to that owner; the owner applies the change, persists it once, and distributes
the result to its registered panels. The panel renders the acknowledged value,
pending state, and persistence/shutdown errors. It must not present success while
the parent continues running.

Use the existing panel bridge if suitable, otherwise a narrow `postMessage`
protocol. Require exact same-origin checks, registered parent/child window
identity checks, a validated payload, current scope, request id, and monotonically
increasing owner revision. Reject wrong-origin, wrong-source, stale-scope, and
out-of-order updates. A newly loaded panel requests a snapshot after hydration;
do not rely on a localStorage event to update the source document or parent.
Deduplicate requests and avoid rebroadcast loops.

While waiting for acknowledgement, disable repeat toggles. After 5 seconds show
`Could not update the bar in this window` and offer retry with the same request
id; do not boot a second runtime or claim a saved value in the child. If the
owner applied the request but acknowledgement was lost, retry returns its
current authoritative state. Rescope/reload invalidates pending requests.

A standalone top-level `?surface=panel` document owns its local preference but
still mounts no bar runtime. Separate top-level tabs retain the documented
refresh-only consistency. Test the embedded iframe case, not only direct
navigation to a panel URL.

## Settings UI

On `/settings/mentiko-agent`, keep the floating-bar controls together in this
order: the Chat backdrop and shape card, the Floating bar width card, the
existing Agent Text Size card, the Floating bar enable/disable card, and YOLO
mode. The appearance and width cards are user-facing parameters, not merely
deployment-time constants:

```
[icon] Chat backdrop and shape
       Backdrop visibility, blur, dimness, horizontal/vertical reach,
       edge softness, transcript height, corner radius, and shadow strength.
       Saved for this preference scope and applied live when expanded.
       Presets: Minimal, Balanced, and Focused. Presets change appearance only;
       floating-bar width remains an independent setting.

[icon] Floating bar width
       Wide-screen width in pixels; narrow screens remain responsive.
       Deployment config seeds the default; a saved scoped value wins.
```

The enable/disable card remains:

```
[icon] Floating bar
       Show the Mentiko assistant bar across the app.
       Toggle it back on here any time.
                                      [switch]
       Hiding the bar suspends external control in this tab. Existing grants
       may resume when you turn it back on.
```

Requirements:

- `role="switch"`, `aria-checked`, an explicit accessible name such as
  `aria-label="Enable floating bar"`, and keyboard activation;
- `setEnabled(!enabled)` writes only after scope hydration is ready;
- no toast for a successful local toggle;
- scope-not-ready state is disabled and non-interactive;
- deployment-off state is disabled with the override copy above;
- the Chat backdrop and shape card exposes an accessible toggle and bounded
  controls for blur, dimness, horizontal/vertical reach, edge softness,
  transcript height, corner radius, and shadow strength;
- the Chat backdrop and shape card exposes three accessible appearance presets:
  Minimal, Balanced, and Focused. Applying a preset persists the full scoped
  appearance object without changing the independent width preference;
- the settings nav remains usable when the bar is hidden.
- inline identity, persistence, panel-acknowledgement, and shutdown status remains
  visible here even when the bar is absent; errors use an accessible live region.
- distinguish saved preference from effective runtime state during recovery.

## Acceptance criteria

- Authenticated user, env unset: toggle off, reload, and verify no bar render,
  engine setup, session bootstrap, ping, MCP SSE, Codex probe, current-page
  POST, or turn send occurs. With no pending shutdown, the scope provider may
  perform only its identity hydration request; a pending shutdown permits only
  the bounded recovery requests specified above.
- Toggle on without reload with no pending cleanup: the bar appears and boots
  immediately; pending cleanup instead shows the waiting/recovery state.
- Scope matrix: anonymous runtime scope -> user scope -> anonymous runtime
  scope reloads `enabled`, `yoloMode`, and `yoloPromptSeen` independently.
- A new scope with no scoped YOLO keys starts with YOLO enabled and the
  first-run mode choice resolved, so the first message skips the legacy choice
  prompt. Turning YOLO off is a scoped opt-out that remains off after reload.
- Existing raw YOLO keys are never copied into a different authenticated user's
  scope.
- Disable during streaming: local activity stops synchronously, cancellation is
  acknowledged, and authoritative engine evidence confirms the old turn and
  tools terminated. No draft or actionable prompt remains. Failed or uncertain
  cancellation shows recovery status and blocks reuse rather than claiming stop.
- Disable while a permission or ask prompt is pending: the prompt becomes
  non-actionable and does not reappear as an approval for the cancelled turn.
- Rapid off/on during boot: no stale result becomes active, no duplicate
  creation is issued, and no old MCP client reconnects. A server-accepted
  creation with a lost response must be reconciled before another boot. The
  current web stable-id plus GET behavior covers only registered or
  hub-discoverable sessions; accepted-but-still-initializing creates remain
  blocked until the engine exposes pending/ready/failed by id or same-id retry
  joins the pending create.
- `NEXT_PUBLIC_KOLLABOR_BAR=0`: bar and UI-control grant are absent, the
  dashboard opener is absent, and the settings switch is disabled with the
  deployment explanation.
- `NEXT_PUBLIC_KOLLABOR_BAR_WIDTH` seeds the wide-screen bar width from
  deployment config, defaults to `373px`, rejects malformed/out-of-range values
  by falling back to the default, and clamps to `100vw - 2rem` on narrow
  viewports. A scoped settings override takes precedence, and drag clamping
  uses the resulting effective width.
- The settings page exposes scoped controls for backdrop visibility, blur,
  dimness, horizontal/vertical reach, edge softness, transcript height, corner
  radius, and shadow strength. Bounds are enforced, changes apply live, and
  disabling the backdrop removes the page-obscuring overlay.
- Settings opened as `/settings/mentiko-agent?surface=panel` uses the same
  authenticated storage scope and persists the same preference.
- Disable through an actual embedded settings iframe stops the parent turn and
  bar without reload. Parent and sibling panels converge on acknowledged state,
  including failed persistence; standalone panel documents mount no runtime.
- Unauthenticated navigation to `/settings/mentiko-agent` follows the existing
  `/login` redirect; no anonymous-access claim is made.
- A second tab's stale state is documented as out of scope; refresh loads the
  current stored preference.
- Fresh browser with no enabled key defaults to enabled.
- Dashboard “ask mentiko” is never a clickable no-op while disabled.
- UI-control paste, shortcut, and approval all reject while disabled, including
  when a stale session id remains.
- `/mcp-auth` cannot approve a UI grant while off, booting, cleanup-blocked, or
  carrying a session from another scope. Ordinary data authorization and denial
  still work, including when the UI URL hint is absent or modified.
- Existing and in-flight grants produce no local effects while off. Late
  approval responses produce no success toast; re-enable may resume existing
  unexpired grants, as documented. No server-revocation claim is made.
- Authenticated scope lookup failure never changes the storage key or enables a
  disabled bar. Recovery reads the original preference before boot.
- A pending outgoing cancellation or profile API failure cannot stall incoming
  preference-scope hydration. Incoming controls become usable after their own
  authenticated scope read; unresolved cleanup stays fenced to the outgoing
  session, and profile failure remains a separate profile error.
- A -> B scope changes and unmount during a turn stop the captured outgoing
  runtime; late token refresh cannot write into B's storage or reconnect.
- A delayed cancel cannot affect a new turn after rapid off/on. Rejection,
  timeout, logout, and reload with a pending marker have explicit recovery state.
- Missing enabled key defaults on; unreadable/malformed enabled storage starts
  off. Failed save changes this tab and its panels but reports unsaved status;
  retry and reload behave according to the Storage failures contract.
- Settings switch has an accessible name and works at 390px and 820px without
  overflow.
- The settings sidebar marks the most-specific current route as active; on
  `/settings/mentiko-agent`, Mentiko Agent has `aria-current="page"` and the
  selected-item styling.

## Test plan

### Store and scope unit tests

- enabled default/persist under scoped keys;
- `defaults missing scoped YOLO preferences to enabled with the first-run choice resolved` in
  `web/lib/__tests__/kollabor-bar-store-enable.test.ts`;
- `names the YOLO switch and explains the new-scope default and approval behavior` and
  `toggles YOLO mode and persists each scoped value` in
  `web/app/settings/mentiko-agent/page.test.tsx`;
- `new scope starts with YOLO enabled and preserves opt-out across reload` in
  `web/e2e/tests/floating-bar-enable-disable.spec.ts`;
- yoloMode and yoloPromptSeen reload on both scope directions;
- legacy raw-key migration and authenticated-scope non-inheritance;
- ordered outgoing shutdown and runtime-state reset on scope switch, including
  A -> B with both enabled, stale identity responses, and scope readiness;
- identity endpoint 401/500, timeout, invalid payload, successful retry;
- valid/missing/malformed booleans, read exception, write failure, explicit
  temporary choice, retry saving, and reload;
- configured floating-bar width default, valid bounds, malformed/out-of-range
  fallback, scoped settings override, responsive viewport clamp, and
  drag-clamp alignment;
- scoped appearance defaults, malformed storage, numeric bounds, backdrop
  toggle, live mask/blur/dimness/shape updates, transcript height, surface
  radius/shadow, and parent/panel acknowledgement;
- pending-shutdown markers, failed marker persistence, and scope isolation.

### Bar runtime tests

- disabled initial mount makes no engine/gateway/Codex/current-page request and
  creates no EventSource;
- re-enable boots immediately only after pending cleanup completes;
- disable calls server cancellation, aborts the stream, disconnects MCP, clears
  the interval, and ignores late events;
- pending permission/ask prompts are cancelled;
- rapid off/on cannot create duplicate sessions or SSE clients;
- delayed/rejected/timed-out cancellation blocks reuse; test a late cancel
  against a subsequent send and authoritative tool termination;
- unmount, scope change, lost creation response, and pending cleanup on reload;
- helper-level delayed refresh, closed-client connect, cancelled reconnect
  timers, token scope capture, and bootstrap deduplication with abort signals.

### Adjacent-surface tests

- system-status opener hidden/disabled for user-off and env-off;
- UI-control paste, shortcut, stale-session approval, user-off, and env-off;
- settings card scope-ready, user toggle, scoped width and appearance controls,
  deployment override, accessibility, and panel-surface behavior.
- `/mcp-auth` scoped connected-session targeting and UI-vs-data grant behavior;
- approval in flight across disable/scope change, existing grant suspension,
  and documented resumption after re-enable;
- actual parent/iframe propagation, snapshot handshake, sibling convergence,
  invalid source/origin/scope/revision, lost acknowledgement, duplicate request,
  and standalone panel behavior.

### Integration and runtime checks

Run from `web/`:

```
npm run lint
npm run build
npm test -- --runInBand \
  lib/__tests__/kollabor-bar-flag.test.ts \
  lib/__tests__/kollabor-bar-store*.test.ts \
  app/settings/mentiko-agent/page.test.tsx \
  app/layout-client.test.tsx
```

The command above is the existing baseline, not the complete regression suite.
Add and execute targeted suites for every new lifecycle/helper/approval/panel
contract listed above, plus the existing floating-bar gateway tests. Record the
exact new test paths and commands with implementation evidence.

Add a Playwright or equivalent browser check for the real authenticated route,
normal surface, panel surface, deployment-off build, the scoped YOLO default and
opt-out, the active Mentiko Agent sidebar state, and 390px/820px viewports.
After implementation, verify the running `mentiko-dev` route; tests alone do
not prove the live layout or browser storage behavior.

The repeatable Playwright coverage in
`web/e2e/tests/floating-bar-enable-disable.spec.ts` also names and exercises:

- `highlights the most specific item for a nested settings route` in
  `web/app/settings/layout.test.tsx`;
- `settings route marks Mentiko Agent as the active sidebar item` in the
  Playwright suite;
- `new scope starts with YOLO enabled and preserves opt-out across reload`;
- `profile API failure is separate from authenticated preference-scope hydration`;
- `rapid off/on stays blocked while fixture cancellation is unresolved`;
- `receipt-only cancellation keeps shutdown recovery blocked`;
- `cancellation HTTP failure keeps shutdown recovery blocked`;
- `A-to-B account change isolates preferences and engine session keys`; and
- `documents cross-tab preferences as refresh-consistent and shared-session cancellation`.

The cancellation scenarios use deterministic route interception and assert
fail-closed client behavior only. They do not simulate authoritative turn/tool
termination or prove delayed-cancel fencing; AC-05/AC-20 remain blocked until
the engine contract supplies that proof. The cross-tab test is a docs contract
check, not evidence of live cross-tab synchronization.
The profile-503 case is route-intercepted and tests that profile loading cannot
own or block authenticated preference-scope hydration.

## Documentation changes

1. `web/docs/user-guide.md`: explain the authenticated setting, deployment
   override, scope behavior, parent/panel synchronization, failed saves, shutdown
   recovery, external-grant suspension/resumption, and cross-tab limits (including
   cancellation affecting another tab that shares the engine session).
2. `web/lib/ai-engine/kollabor-bar-flag.ts`: point to the user preference and
   state that the deployment flag wins.
3. `docs/ENV_VARS.md`: document `NEXT_PUBLIC_KOLLABOR_BAR`, its precedence, and
   `NEXT_PUBLIC_KOLLABOR_BAR_WIDTH`.
4. `CHANGELOG.md` under `Unreleased`: describe the user-visible setting.

## Rollout and rollback

- The new enabled key defaults to true, so existing users retain visibility;
  missing scoped YOLO preferences default to on and skip the first-run mode
  choice, while an explicit scoped opt-out remains off.
- Boolean migration is additive and leaves raw legacy keys untouched.
- Pending-shutdown markers are additive and scoped; do not erase them merely
  because the preference is enabled again.
- Rollback is a code revert; old code ignores the new enabled key and returns to
  deployment-only behavior. It also ignores pending-shutdown markers and restores
  the previous approval behavior, so rollback does not preserve this feature's
  opt-out or recovery guarantees. No destructive local-storage operation is
  required. If implementation needs a server cancellation/idempotency contract
  extension, document its backward compatibility before release.

## Decisions recorded

- The settings control is authenticated-only because the existing page route is
  protected. Anonymous preference editing requires a separate public-surface
  spec.
- Disable stops local activity immediately and confirms server cancellation
  before session reuse. Failure remains visible and recoverable from settings.
- Retain transcripts and inert session ids. Existing UI-control grants are
  suspended locally and may resume on re-enable; token revocation is excluded.
- Cross-tab live synchronization is deferred; parent/iframe synchronization
  within one tab is required. Session cancellation may affect a sharing tab.
- Scope hydration is layout-owned and must not depend on the bar being mounted.
- Authenticated scope-resolution failure keeps the runtime off without selecting
  an alternate scope. Persistence failure produces explicit temporary-tab state.
- Engine cancellation acknowledgement, delayed-request safety, and accepted
  session-creation reconciliation must be proven against the actual engine
  contract before declaring the implementation complete.
