# Floating Bar Enable/Disable Acceptance Ledger

Current status (2026-09-23, after live verification): the latest verifier Jest
matrix passed 22 suites / 192 tests. The full-file Playwright run discovered 23
cases: 3 passed and 20 skipped; the wrapper returned 1 because required
authenticated/deployment-off cases remain skipped. The authenticated
`/settings/mentiko-agent` route is live again in the in-app browser. The
`mentiko-dev` runtime is restored to its original default-on configuration at
`127.0.0.1:3200`, with one listener (Next PID 5118; tmux pane PID 99267).
Health returns HTTP 200 but degraded (8% disk free, Redis absent/unreachable,
0 active sessions). The live off/on, actual iframe, deployment-off surface,
accordion, and viewport observations are recorded below. Primary, scope-B, and
deployment-off Playwright variables remain unset; those repeatable E2E cases
still have no pass result. AC-05/AC-20 still lack safe engine cancellation
acknowledgement/fencing, and AC-07 still lacks accepted-pending session-create
reconciliation. Do not treat the engine listener as proof of either contract.

The `Status` paragraph below is the pre-continuation snapshot. Its connection-
refused and locked-Mac observations are historical and are superseded by the
live evidence in this ledger.

Status (2026-09-23): latest verifier Jest matrix passed 22 suites / 192 tests; the focused settings/layout/approval matrix passed 15 suites / 156 tests, and focused approval surfaces passed 3 suites / 28 tests. The latest full-file Playwright run discovered 23 cases: 3 passed and 20 skipped. Its passes were the unauthenticated login redirect, cross-tab documentation contract, and acceptance-ledger source-name contract; authenticated and deployment-off skips remain skips, not acceptance passes. The repository verifier returned exit 1 because it treats those required skips as incomplete. The same `mentiko-dev` command is listening on `127.0.0.1:3200` (Next PID 93230). `/api/health` returns HTTP 200 with `status=degraded` (8% disk free; Redis absent/unreachable), and the settings route returns 307 to login without a session. The in-app browser still shows a stale connection-refused page; CUA reports the Mac locked, so authenticated browser/iframe checks cannot currently be inspected. E2E primary, scope-B, and deployment-off variables are unset. AC-05/AC-07/AC-20 remain blocked or partial at engine contracts. Unknown-session shutdown is intentionally fail-closed until pending-create reconciliation; Retry stopping is withheld unless safe retry is supported. The A→B E2E scenario is present but skipped because both scope-B variables are unset. Engine PID 43038 at `127.0.0.1:7433` is listener evidence only, not proof of cancellation. The verifier uses `E2E_BASE_URL`, runs only against the existing runtime, and now retains its isolated tmux pane/result reliably.

Fresh authenticated observation (2026-09-23): without navigating, reloading, or
changing a preference, Marco inspected the existing
`http://localhost:3200/settings/mentiko-agent` tab. AX showed the Mentiko Agent
heading, the `Mentiko Agent` sidebar button with `aria-current="page"` and
`bg-foreground/10`, width stepper at 458, floating-bar and YOLO switches on,
both appearance accordions collapsed, and exact status “Saved and active in
this window.” A separate profile request showed 503, the profile label was
`Active profile None`, and the background-worker badge said stopped. Those
profile/worker conditions are separate runtime/service degradation, not proof
that preference scope hydration failed or passed other behavior criteria. This
confirms current top-level scope hydration is not held by the profile-list
failure; it does not prove a reload, preference write, or current iframe parity.

In the same existing authenticated tab, Marco used CDP device-metric overrides
(the viewport capability was a no-op): at 390×844, document and body
`scrollWidth` were both exactly 390; at 820×1180, both were exactly 820. No
horizontal overflow was observed, and the overrides were then cleared. The
scoped width stayed 458px. No setting, preset, or preference was changed. This
is live viewport evidence, not a pass of the named Playwright viewport test.

Latest manual live observation (2026-09-23, reported by Marco): the authenticated
top-level settings route again showed the active Mentiko Agent sidebar item
(`aria-current=page`), scoped width 458px, Custom appearance, and enabled
Floating bar and YOLO switches. At 390×844 and 820×1180, document and body
`clientWidth` equaled their respective `scrollWidth`; the viewport was restored
to default afterward. No preference or appearance value was edited. This is
manual live evidence only; it does not pass an authenticated Playwright case.

This ledger maps every acceptance criterion in
`FLOATING_BAR_ENABLE_DISABLE_SPEC.md` to a repeatable test or live check.
`PASS (unit)` means the contract is covered by an automated test but still
needs the corresponding live-browser proof where the criterion requires it.
`BLOCKED` is reserved for an external prerequisite or an engine contract that
the current implementation cannot prove. Historical live checks are dated;
fresh route visibility is not evidence that a behavior was re-exercised.
The spec lists 27 acceptance bullets without AC labels; this ledger assigns
stable IDs by topic and maps all 27 bullets. AC-25 and AC-29 separately record
the later appearance-preset/width-independence and accordion UX requests; they
are not standalone bullets in the current spec. The IDs therefore are not the
spec's bullet order.

| ID | Acceptance criterion | Named test / check | Result |
| --- | --- | --- | --- |
| AC-01 | Authenticated user can turn the bar off, reload, and perform no runtime work. | `does no bar-runtime work when the scoped preference is disabled` in `web/components/app-shell/__tests__/floating-kollabor-bar-gateway.test.tsx`; `authenticated settings route disables runtime across reload without forbidden work` in `web/e2e/tests/floating-bar-enable-disable.spec.ts`. | PARTIAL: gateway unit coverage passed in the latest 15-suite/156-test run. Fresh live off/reload stayed off after scope hydration and the chat input remained absent. No request/session instrumentation was collected during that manual check, so the “no runtime work” portion is not proved live. The named E2E was skipped because `E2E_BAR_EMAIL`/`E2E_BAR_PASSWORD` are unset. |
| AC-02 | Turning the preference on boots immediately when there is no pending cleanup. | `requires deployment, hydrated preference, clean shutdown, and matching connected session` in `web/lib/__tests__/floating-bar-availability.test.ts`; `fetches /api/system/ai-gateway and skips /api/system/codex-token when gatewayEnabled=true` in `web/components/app-shell/__tests__/floating-kollabor-bar-gateway.test.tsx`. | PARTIAL (unit + live): after the live off/reload check, turning it on restored the chat input without another reload and showed “Saved and active in this window.” No turn was sent, so the gateway/session/MCP boot sequence was not observed. The authenticated E2E is skipped because `E2E_BAR_EMAIL`/`E2E_BAR_PASSWORD` are unset. |
| AC-03 | Anonymous, user A, and user B scopes reload enabled/YOLO state independently. | `defaults enabled and persists only under the active scope`; `reloads YOLO booleans in both directions and migrates raw keys only for anonymous scope`; `defaults missing scoped YOLO preferences to enabled with the first-run choice resolved` in `web/lib/__tests__/kollabor-bar-store-enable.test.ts`. | PASS (unit): the named store behaviors passed in the latest 15-suite/156-test run below. |
| AC-04 | Raw YOLO keys do not enter an authenticated user's scope. | `reloads YOLO booleans in both directions and migrates raw keys only for anonymous scope`; `defaults missing scoped YOLO preferences to enabled with the first-run choice resolved` in `web/lib/__tests__/kollabor-bar-store-enable.test.ts`. | PASS (unit): both named store tests passed in the latest 15-suite/156-test run below; authenticated defaults do not copy raw legacy values and anonymous migration remains isolated. |
| AC-05 | Disable during streaming stops locally and only reports server stop after authoritative evidence. | `fails closed when the engine only acknowledges receipt`; `keeps the marker and recovery state on cancellation rejection`; `clears recovery only when cancellation includes terminal, turn, and fence evidence` in `web/lib/__tests__/floating-bar-lifecycle.test.ts`; `does not treat a bodyless or cancelled:true receipt as accepted terminal evidence` in `web/lib/__tests__/kollabor-engine-session-reconciliation.test.ts`; `receipt-only cancellation keeps shutdown recovery blocked`, `cancellation HTTP failure keeps shutdown recovery blocked`, and `embedded settings iframe shares scope and fail-closes a held parent turn on receipt-only cancel` in `web/e2e/tests/floating-bar-enable-disable.spec.ts`. | BLOCKED: upstream `POST /sessions/{id}/cancel` accepts no turn/cancel identity and returns `{ok:true, session_id}` before its fire-and-forget `cancel_turn()` work finishes. There is no authoritative terminal/tool result or fence, so delayed cancellation safety cannot be proven. The coordinator-reported 18/18 engine run and Hubble's 13 focused audit tests do not prove terminal acknowledgement for this endpoint or that browser abort stops server-side work; they are not acceptance passes. Deterministic browser fixtures assert local fail-closed behavior only; the held-turn iframe fixture is auth-skipped. Current `lsof` sees PID 43038 listening on `127.0.0.1:7433`, but no cancellation request was issued; listener presence does not prove the engine contract. |
| AC-06 | Pending permission/ask prompts become non-actionable. | `marks pending permission and ask prompts cancelled without deleting committed transcript` in `web/lib/__tests__/kollabor-bar-store-enable.test.ts`. | PASS (unit): the named store test passed in the latest 15-suite/156-test run below. |
| AC-07 | Rapid off/on cannot activate stale boot results or duplicate sessions; accepted creation is reconciled, including a lost response during initialization. | `keeps a rapid re-enable blocked while cancellation is unresolved`; `keeps one shared creation alive when one caller aborts`; `reconciles a server-accepted creation after the response is lost before retrying`; `retains the same durable create id when an in-flight reservation returns 409 and GET cannot see it`; `does not dispatch a session create when scope changes during token lookup` in `web/lib/__tests__/kollabor-engine-session-reconciliation.test.ts`; `keeps the current pending boot active when scope changes during a null-session create`, `does not revive a null-session boot after disable and fail-closed re-enable`, and `ignores a session-create result that resolves after the bar unmounts` in `web/components/app-shell/__tests__/floating-kollabor-bar-gateway.test.tsx`; `keeps an unknown-session shutdown blocked after re-enable and retry during a pending boot` in `web/components/app-shell/__tests__/floating-bar-storage-scope.test.tsx`; `honors a valid client session id so accepted creates can be reconciled` in `web/app/api/kollabor/engine/[...path]/route.test.ts`; `rapid off/on stays blocked while fixture cancellation is unresolved`, `embedded settings iframe shares scope and fail-closes a held parent turn on receipt-only cancel`, and `A-to-B account change isolates preferences and engine session keys` in `web/e2e/tests/floating-bar-enable-disable.spec.ts`. | PARTIAL: all cited web Jest files passed in the latest 15-suite/156-test run below, including null-session disable/re-enable, unknown-session fail-closed state, 409/404 fixture retention, and pre-dispatch scope fencing. Browser rapid-off/on and iframe cases are skipped for missing auth; A→B is skipped because `E2E_BAR_SCOPE_B_EMAIL`/`E2E_BAR_SCOPE_B_PASSWORD` are unset. That fixture-only browser case now holds an A message across account change, asserts the outgoing request abort, requires the receipt-only shutdown marker to remain under A and absent from B, releases the late A fixture response, then checks B has a distinct session and default first-send behavior. It has not run, and the fixture does not prove engine-side cancellation or recovery. Hubble confirms same-ID POST returns 409 while GET returns 404 until initialization completes: accepted-but-pending creation remains blocked until the engine exposes pending/ready/failed state or same-ID retry joins the pending creation. Delayed-cancel safety remains BLOCKED by AC-05/20. |
| AC-08 | `NEXT_PUBLIC_KOLLABOR_BAR=0` overrides the user preference and removes the dashboard opener. | `keeps a deployment-off preference visible but makes runtime and approval unavailable` in `web/lib/__tests__/floating-bar-availability.test.ts`; `keeps the saved preference visible but disables the switch when deployment is off` in `web/app/settings/mentiko-agent/page.test.tsx`; `does not mount UI-control approval or attach its listeners when deployment disables the bar` in `web/app/layout-client.test.tsx`; legacy `does not mount the approval surface when deployment disables the feature` in `web/components/app-shell/__tests__/ui-control-grant.test.tsx` (direct component render, handler rejection only); `deployment-off build keeps settings visible, authenticates, and hides the dashboard opener` in `web/e2e/tests/floating-bar-enable-disable.spec.ts`. | PARTIAL (unit + live): the layout-level non-mount/listener test passed in the latest 15-suite/156-test run below. The older UIControlGrant test directly renders the component and is not route-omission evidence. In the fresh live deployment-off restart, settings stayed visible with the saved-on switch disabled; `/dashboard` had zero Ask Mentiko buttons, chat inputs, and dialogs. The named authenticated deployment-off E2Es still skipped because `E2E_BAR_OFF_URL` is unset, so they have no pass result. |
| AC-23 | Authenticated settings exposes a scoped width parameter; deployment config seeds the default, saved values apply live, survive reload, and remain responsive. | `seeds width from deployment config and persists scoped user overrides` and `bounds numeric width preferences and rejects malformed storage` in `web/lib/__tests__/kollabor-bar-store-enable.test.ts`; `uses the existing 373px geometry when unset`, `accepts an integer deployment width within the safe bounds`, and `falls back for malformed, fractional, and out-of-range values` in `web/lib/__tests__/kollabor-bar-flag.test.ts`; `renders the scoped settings width while retaining responsive CSS` in `web/components/app-shell/__tests__/floating-kollabor-bar-gateway.test.tsx`; `exposes a scoped width parameter and applies it to the store` in `web/app/settings/mentiko-agent/page.test.tsx`; `settings width parameter updates the live bar and survives reload` in `web/e2e/tests/floating-bar-enable-disable.spec.ts`. | PASS (unit + historical live, 2026-09-21): `373px→480px`, reload persistence, `480px` rendered at a `1398px` viewport, and restoration to `373px` were recorded. Fresh authenticated CUA observed the enabled width input at its existing scoped value of 458px. No value was edited; current value-change/reload E2E remains unrun because isolated auth is unset. |
| AC-24 | Chat backdrop and shape controls are accessible, scoped, bounded, apply live, and can remove the disruptive backdrop/shadow. | `persists scoped appearance controls and bounds malformed numeric values` in `web/lib/__tests__/kollabor-bar-store-enable.test.ts`; `exposes tunable backdrop controls and persists appearance changes` and `starts the backdrop and chat surface accordions collapsed and exposes their controls on demand` in `web/app/settings/mentiko-agent/page.test.tsx`; `settings exposes tunable chat backdrop controls with scoped persistence` in `web/e2e/tests/floating-bar-enable-disable.spec.ts`. | PASS (unit + historical live, 2026-09-21): blur `20→4px`, dimness `22→5%`, ellipse `540x900→300x420`, softness `90→70%`, transcript `78→50vh`, radius `16→6px`, shadow `18→0`; computed style matched and surface shadow became `none`. Fresh settings suite passed 13/13 (2026-09-23). Marco's fresh authenticated top-level CUA showed the accordions collapsed initially, then expanded and collapsed both; backdrop controls rendered at blur/dim/horizontal-reach/vertical-reach/softness `3px/25%/520px/818px/59%`, and chat surface at height/radius/shadow `72vh/19px/17px`. No value was changed; this verifies layout/control visibility, not live application of a new value. Authenticated appearance E2E remains skipped for missing credentials. |
| AC-25 | The settings card exposes Minimal, Balanced, and Focused appearance presets that persist the full scoped appearance without changing width. | `offers three scoped appearance presets without changing width` and `starts the backdrop and chat surface accordions collapsed and exposes their controls on demand` in `web/app/settings/mentiko-agent/page.test.tsx`; `settings offers three appearance presets while keeping width independent` in `web/e2e/tests/floating-bar-enable-disable.spec.ts`. | PARTIAL: the standalone settings suite passed 13/13. Fresh authenticated iframe verification applied Balanced and observed all eight appearance inputs update while width stayed 458px, then restored the exact prior values and Custom label. The repeatable authenticated E2E's full-file run skipped because `E2E_BAR_EMAIL`/`E2E_BAR_PASSWORD` are unset; browser persistence across reload still lacks an E2E pass. |
| AC-26 | Missing scoped YOLO and YOLO-seen keys default to on/resolved, so the first message skips the mode-choice prompt; explicit opt-out survives reload. | `defaults missing scoped YOLO preferences to enabled with the first-run choice resolved` in `web/lib/__tests__/kollabor-bar-store-enable.test.ts`; `names the YOLO switch and explains the new-scope default and approval behavior` and `toggles YOLO mode and persists each scoped value` in `web/app/settings/mentiko-agent/page.test.tsx`; `new scope starts with YOLO enabled and preserves opt-out across reload` in `web/e2e/tests/floating-bar-enable-disable.spec.ts`. | PARTIAL: all cited store/page tests passed in the latest 15-suite/156-test run below. The E2E clears/restores only the two exact authenticated scoped YOLO keys, sends a first message with the missing-key default, asserts no chooser, and checks opt-out across reload. It was skipped before auth, scope lookup, key clearing, or preference mutation because primary credentials are unset. Manual live settings showed YOLO on but did not exercise missing-key/first-send behavior. |
| AC-09 | Authenticated `?surface=panel` settings uses the same scope and preference; parent and iframe converge on acknowledged state. | `hydrates the same authenticated preference scope in a %s` (`top-level document`, `panel iframe`) and `answers a registered panel snapshot and deduplicates preference requests` in `web/components/app-shell/__tests__/floating-bar-storage-scope.test.tsx`; `embedded settings iframe shares scope and fail-closes a held parent turn on receipt-only cancel` and `standalone panel settings route mounts no runtime` in `web/e2e/tests/floating-bar-enable-disable.spec.ts`. | PARTIAL: provider parity unit cases pass (result recorded below). Separate live observations showed top-level and actual iframe settings controls hydrated and each displayed width 458px; neither changed a preference. No scope identity/digest equality was captured, so live parent/iframe scope parity is unverified. The named E2E compares both sibling iframe scopes to the authenticated parent scope and asserts convergence, but is auth-skipped; sibling propagation and post-reload persistence remain unverified by browser automation. |
| AC-10 | Actual embedded settings iframe stops the parent and converges on acknowledgement/errors, including width and appearance updates. | `answers a registered panel snapshot and deduplicates preference requests` and `rejects wrong-origin panel messages` in `web/components/app-shell/__tests__/floating-bar-storage-scope.test.tsx`; `embedded settings iframe acknowledges failed scoped writes to sibling panels` and `embedded settings iframe shares scope and fail-closes a held parent turn on receipt-only cancel` in `web/e2e/tests/floating-bar-enable-disable.spec.ts`. | PARTIAL: live same-origin iframe navigation rendered Mentiko Agent settings; disabling from the iframe removed the parent chat input (1→0) and showed the acknowledged saved-off state. Direct-route reload remained off; top-level re-enable restored the input. No active turn was running, so this does not prove cancellation, sibling convergence, or failed-write behavior. The repeatable iframe E2Es are skipped for missing auth variables; receipt-only fixtures cannot prove engine terminal status. |
| AC-11 | Unauthenticated settings navigation follows the existing login redirect. | `unauthenticated settings navigation follows the login redirect` in `web/e2e/tests/floating-bar-enable-disable.spec.ts`. | PASS (fresh full-file Playwright, 2026-09-23): the named case passed 1/1 as part of 23 collected, 3 passed, 20 skipped, exit 0 against the existing `mentiko-dev` listener. Current curl to `/settings/mentiko-agent` also returns 307 to `/login?redirect=%2Fsettings%2Fmentiko-agent`. This proves unauthenticated routing only; authenticated settings cases are skipped. |
| AC-12 | Cross-tab live synchronization is explicitly out of scope and documented, including shared-session cancellation impact. | `documents cross-tab preferences as refresh-consistent and shared-session cancellation` and `acceptance ledger maps every spec criterion to named evidence and a result` in `web/e2e/tests/floating-bar-enable-disable.spec.ts`; guide contract in `web/docs/user-guide.md` → “Floating bar setting”. | PASS (fresh full-file Playwright, 2026-09-23): both named documentation-contract tests passed in the 23-case run (3 passed / 20 skipped). They assert guide wording and complete AC-row/name/result mapping; they do not claim live cross-tab synchronization. |
| AC-13 | Missing enabled key defaults to on. | `defaults enabled and persists only under the active scope` in `web/lib/__tests__/kollabor-bar-store-enable.test.ts`. | PASS (unit): the named store test passed in the latest 15-suite/156-test run below. |
| AC-14 | Dashboard “ask mentiko” is not a clickable no-op while off. | `requires deployment, hydrated preference, clean shutdown, and matching connected session` in `web/lib/__tests__/floating-bar-availability.test.ts`; `deployment-off build keeps settings visible, authenticates, and hides the dashboard opener` in `web/e2e/tests/floating-bar-enable-disable.spec.ts`; `system-status-widget.tsx` shared availability gate. | PARTIAL (unit + live): in the fresh live deployment-off restart, `/dashboard` showed zero Ask Mentiko buttons, chat inputs, and dialogs; restoring the original default-on runtime followed. The named authenticated deployment-off E2E waits for the widget and asserts the opener is absent, but skipped because `E2E_BAR_OFF_URL` is unset and has no pass result. |
| AC-15 | UI-control paste, shortcut, and approval reject while disabled or stale. | `rejects paste and Cmd/Ctrl+M while the user preference is off`; `rejects a stale session from another scope and targets only the connected scope`; `closes a staged approval when the active scope changes to another approvable session`; `closes a staged approval when logout clears the bound session`; `does not report a data grant as successful UI control`; `ignores a late approval response after disable invalidates its generation`; `ignores a late approval response after logout clears the session` in `web/components/app-shell/__tests__/ui-control-grant.test.tsx`; `rejects a data grant submitted from the UI-control approval surface without minting credentials` in `web/app/api/mentiko-mcp/auth/device/approve/route.test.ts`. | PASS (unit): all cited tests passed in the focused approval run (3 suites / 28 tests). UI approval explicitly requires persisted kind `ui`; a mismatching `data` grant is rejected before either credential is minted. Authenticated live approval remains skipped for missing credentials. |
| AC-16 | `/mcp-auth` gates UI grants by authoritative grant kind and keeps data grants working. | `rejects UI approval while the bar is off even without a ui URL hint`; `keeps ordinary data authorization working when the UI hint is absent or changed`; `binds UI approval to the persisted grant kind and connected session`; `suspends a pending UI approval locally on disable and ignores its late success without revoking`; `ignores a late UI approval after the connected scope changes`; `ignores a late approval after logout instead of showing a connected result` in `web/app/mcp-auth/page.test.tsx`; `routes a persisted UI grant to the target-session approval path regardless of a forged body kind`; `rejects a persisted UI grant without a target session and leaves the request pending`; `rejects a data grant submitted from the UI-control approval surface without minting credentials`; `keeps persisted data approval on the ordinary refresh-token path when the bar is deployment-off`; `denies a persisted data grant without minting either approval credential` in `web/app/api/mentiko-mcp/auth/device/approve/route.test.ts`; `deployment-off build blocks UI-grant approval POST and keeps data approval working` in `web/e2e/tests/floating-bar-enable-disable.spec.ts`. | PARTIAL: cited Jest suites passed. In the live deployment-off run, the saved-on settings switch was disabled with the exact deployment explanation, the chat input was absent, and the dashboard Ask Mentiko button count was 0. No grant was submitted; live `/mcp-auth` UI/data approval remains unverified because `E2E_BAR_OFF_URL` is unset and its named E2E skipped. |
| AC-17 | Existing/in-flight grants suspend locally without revocation and late approval has no success effect. | `suspends an issued grant locally when disabled without revoking it`; `ignores a late approval response after disable invalidates its generation`; `ignores a late approval response after logout clears the session` in `web/components/app-shell/__tests__/ui-control-grant.test.tsx`; `suspends a pending UI approval locally on disable and ignores its late success without revoking`, `ignores a late UI approval after the connected scope changes`, and `ignores a late approval after logout instead of showing a connected result` in `web/app/mcp-auth/page.test.tsx`; `suspends existing UI effect delivery locally after disable without revocation` in `web/lib/__tests__/mentiko-mcp-bar-client-lifecycle.test.ts`. | PASS for local suspension/late-response behavior: all cited web suites passed in the latest 15-suite/156-test run below. These flows assert local suspension and ignore late success; they do not call a revoke endpoint. Deployment-off browser behavior remains separate and skipped under AC-16. |
| AC-18 | Authenticated scope lookup failure stays unresolved/off and retries the original scope. | `keeps authenticated scope unresolved on lookup failure and retries without an anonymous fallback` in `web/components/app-shell/__tests__/floating-bar-storage-scope.test.tsx`; `requires auth before returning the install storage scope` in `web/app/api/system/storage-scope/route.test.ts`. | PASS (unit): both named tests passed in the latest 15-suite/156-test run below. Fresh manual settings hydration at width 458px despite profile-list 503 is separate evidence, not a scope-lookup failure test. Authenticated failure/retry E2E remains skipped/unverified. |
| AC-19 | A→B scope change/unmount stops captured outgoing runtime and cannot write into B. | `resets transient state on A to B scope changes and isolates pending shutdown markers` in `web/lib/__tests__/kollabor-bar-store-enable.test.ts`; `does not write a refresh token into the new scope after an old refresh resolves` and `rejects a reply after its captured scope becomes stale` in `web/lib/__tests__/mentiko-mcp-bar-client-lifecycle.test.ts`; `does not dispatch a session create when scope changes during token lookup` in `web/lib/__tests__/kollabor-engine-session-reconciliation.test.ts`; `invalidates locally and fail-closes the captured runtime when unmounted mid-turn` in `web/components/app-shell/__tests__/floating-kollabor-bar-gateway.test.tsx`; `A-to-B account change isolates preferences and engine session keys` in `web/e2e/tests/floating-bar-enable-disable.spec.ts`. | PARTIAL: all cited web Jest files passed in the latest 15-suite/156-test run below, including active-turn unmount and stale-scope guards. The strengthened A→B E2E holds an A message during sign-out/scope change, asserts its browser request aborts, confirms only A retains the receipt-only shutdown marker, releases the late A fixture response and asserts it does not appear in B, then checks B's distinct engine session and no first-send mode chooser. The current full-file E2E run reports this case skipped because `E2E_BAR_SCOPE_B_EMAIL`/`E2E_BAR_SCOPE_B_PASSWORD` are unset. It is not an engine cancellation proof. The pre-dispatch fence still does not clean up a request already sent to the engine. |
| AC-20 | Delayed cancel cannot affect a new turn; rejection/timeout/logout/reload-marker recovery is explicit. | `keeps a rapid re-enable blocked while cancellation is unresolved`; `keeps recovery blocked when cancellation times out`; `fails closed when the engine only acknowledges receipt`; `keeps the marker and recovery state on cancellation rejection`; `restores fail-closed recovery state from a reload marker`; `clears recovery only when cancellation includes terminal, turn, and fence evidence` in `web/lib/__tests__/floating-bar-lifecycle.test.ts`; `does not reconnect after disconnect cancels a scheduled reconnect` in `web/lib/__tests__/mentiko-mcp-bar-client-lifecycle.test.ts`; `keeps an unknown-session shutdown blocked after re-enable and retry during a pending boot` and `keeps a known-session shutdown marker non-retryable without scoped terminal cancel support` in `web/components/app-shell/__tests__/floating-bar-storage-scope.test.tsx`; `does not offer a no-op shutdown retry when the pending session ID is unknown` and `does not offer unsafe shutdown retry for a known but unverified session` in `web/app/settings/mentiko-agent/page.test.tsx`; `invalidates locally and fail-closes the captured runtime when unmounted mid-turn` in `web/components/app-shell/__tests__/floating-kollabor-bar-gateway.test.tsx`; `rapid off/on stays blocked while fixture cancellation is unresolved`, `receipt-only cancellation keeps shutdown recovery blocked`, `cancellation HTTP failure keeps shutdown recovery blocked`, and `embedded settings iframe shares scope and fail-closes a held parent turn on receipt-only cancel` in `web/e2e/tests/floating-bar-enable-disable.spec.ts`. | BLOCKED: all cited local Jest tests passed in the latest 15-suite/156-test run below. Browser receipt-only and HTTP-failure cases are deterministic fixtures but auth-skipped; they prove local hide/marker/retry-blocking only, not server stop. Hubble's engine audit confirms cancel accepts no turn/cancel identity, returns before fire-and-forget work settles, and has no delayed-call fence; the coordinator-reported 18/18 upstream tests do not prove terminal acknowledgement or browser-abort cancellation. Required engine behavior is turn-scoped idempotent cancellation, authoritative terminal evidence that all tools stopped, and a delayed-cancel fence. A fresh `lsof` sees PID 43038 on `127.0.0.1:7433`, but no cancellation request was issued. |
| AC-21 | Malformed/unreadable storage fails closed; failed save is temporary-tab state and retryable. | `fails closed on malformed or unreadable enabled storage` and `changes this tab on write failure, reports unsaved state, and clears it on retry` in `web/lib/__tests__/kollabor-bar-store-enable.test.ts`; `exposes an accessible scoped switch and persists a local toggle` in `web/app/settings/mentiko-agent/page.test.tsx`; `reports a failed scoped preference write as unsaved and restores the saved value on reload` in `web/e2e/tests/floating-bar-enable-disable.spec.ts`. | PARTIAL: cited unit tests passed in the latest 15-suite/156-test run below. The named browser case blocks only the exact scoped enabled key, asserts temporary off/unsaved state, and verifies reload restores the stored on value; it was skipped because `E2E_BAR_EMAIL`/`E2E_BAR_PASSWORD` are unset. |
| AC-22 | Settings switch is accessible and works at 390px/820px without overflow. | `exposes an accessible scoped switch and persists a local toggle` in `web/app/settings/mentiko-agent/page.test.tsx`; `settings switch is usable at 390px and 820px without horizontal overflow` in `web/e2e/tests/floating-bar-enable-disable.spec.ts`. | PARTIAL: page unit coverage passed. Fresh live checks at 390×844 and 820×900 had document/body scroll widths equal to innerWidth; the enabled switch was visible (36px) and checked at both sizes. The named authenticated E2E remains skipped because auth variables are unset. |
| AC-27 | Pending outgoing cancellation and profile API failure do not stall incoming scope hydration or contaminate incoming shutdown state. | `hydrates the incoming scope and does not dispatch stale cancellation after token lookup` in `web/components/app-shell/__tests__/floating-bar-storage-scope.test.tsx`; `aborts cancellation while token lookup is still pending` and `stops waiting when the cancellation fetch ignores its abort signal` in `web/lib/__tests__/kollabor-engine-session-reconciliation.test.ts`; `keeps preference controls hydrated when the separate profiles endpoint returns 503` in `web/app/settings/mentiko-agent/page.test.tsx`; `profile API failure is separate from authenticated preference-scope hydration` in `web/e2e/tests/floating-bar-enable-disable.spec.ts`. | PASS (unit): all four named tests passed in the latest 15-suite/156-test run below. Manual live observations showed top-level and embedded controls hydrated at width 458px while profile-list loading separately returned 503; this does not compare scope identity or exercise pending cancellation live. The named authenticated E2E is skipped for missing primary credentials and has no pass result. |
| AC-28 | `/settings/mentiko-agent` selects the most-specific Mentiko Agent item in settings navigation. | `highlights the most specific item for a nested settings route` in `web/app/settings/layout.test.tsx`; `settings route marks Mentiko Agent as the active sidebar item` in `web/e2e/tests/floating-bar-enable-disable.spec.ts`. | PARTIAL: the named layout test passed; fresh authenticated live AX observed `aria-current="page"` and selected-item styling on the target route. The named authenticated Playwright case remains skipped because primary credentials are unset. |
| AC-29 | Backdrop and Chat surface accordions start collapsed; each exposes its controls on expansion and collapses again without changing saved values. | `starts the backdrop and chat surface accordions collapsed and exposes their controls on demand` in `web/app/settings/mentiko-agent/page.test.tsx`; `settings backdrop and chat surface accordions expand and collapse without changing values` in `web/e2e/tests/floating-bar-enable-disable.spec.ts`. | PARTIAL: the named page test passed; the live iframe showed both accordions collapsed initially, and expanding/collapsing alone preserved values. The separate Balanced-preset live check then changed and restored the exact appearance values with width unchanged. The named authenticated E2E remains skipped because primary credentials are absent. |

## Pre-fix authenticated route observation (2026-09-22)

The existing `mentiko-dev` listener is PID 25136 on `127.0.0.1:3200`; no
server was started or restarted. Marco reported the authenticated
`/settings/mentiko-agent` CUA view has the Mentiko Agent sidebar active, three
appearance presets, Backdrop and Chat surface accordion headers, the width
control, and YOLO-on copy/control. Expanding an accordion shows
`aria-expanded=true`. Preference controls remain disabled and the status stays
Loading after more than five seconds, so scoped preference behavior remains
unverified at that time. The profile-list request separately returned 503; no
causal link to scope hydration was asserted. This observation predates the
hydration-order fix. The authenticated post-fix CUA observation below
supersedes its control-state finding, but did not exercise a preference change.

## Post-fix authenticated iframe observation (2026-09-22)

Marco used the real Settings navigation with **Open Pages in Panels** temporarily
enabled. The AX tree reported an actual settings iframe at
`/settings/mentiko-agent?surface=panel`; its width input and floating-bar/YOLO
switches were enabled, width was 458px, and status read “Saved and active in this
window.” After closing the panel and restoring **Open Pages in Panels** to its
original off state, the direct settings page also showed width 458px and enabled
controls. No floating-bar or YOLO preference was changed. This proves the
embedded route mounts and hydrates post-fix; it does not prove parent-driven
change propagation, persistence after a preference edit, or the YOLO default.
Marco then used CDP device metrics on the authenticated settings page and
cleared them back to default: at 390×844, document/body `scrollWidth=390` and
main width=390; at 820×1180, document/body `scrollWidth=820` and main width=820.
Both screenshots showed no horizontal overflow. The scoped floating-bar width
remained 458px; responsive CSS governs its rendered width. These are live
measurements, not a pass of the named Playwright viewport test. The authenticated
route, iframe, profile-503, and CDP observations in this subsection were reported
by Marco; this lane did not independently reproduce them or change preferences.

## Independent authenticated live verification (2026-09-23)

After the starting snapshot above, I independently used the authenticated
in-app browser and the existing `mentiko-dev` workspace/port. The top-level
`/settings/mentiko-agent` page showed Mentiko Agent with
`aria-current="page"`, Floating bar on, YOLO on, width 458px, and one chat
input.

For the real panel flow, I confirmed **Open Pages in Panels** was initially
off, enabled it temporarily, opened Settings from the floating navigation, and
observed a same-origin iframe titled “Settings panel” at
`/settings?surface=panel`. Navigating inside that iframe rendered the Mentiko
Agent settings controls. Both Backdrop and Chat surface began collapsed;
expanding and collapsing them did not change values. I temporarily selected
Balanced and observed blur 20, dimness 22, horizontal reach 540, vertical reach
900, edge softness 90, transcript height 78, corner radius 16, and shadow
strength 18 while width remained 458. I then restored the exact prior
appearance values (3, 25, 520, 818, 59, 72, 19, 17), confirmed the label
returned to Custom, and collapsed both accordions.

Turning the bar off in that iframe changed the parent chat-input count from 1
to 0; the child switch became unchecked and showed “Saved off in this window.”
After closing the panel, the direct authenticated settings route hydrated to
off. Reload kept it off and the chat input absent. Turning it back on from the
top-level settings route restored the chat input without another reload. I
restored the original bar-on and Open Pages in Panels-off preferences; YOLO
remained on and width remained 458px. No user turn was sent, so this does not
prove cancellation of an active turn, sibling-panel convergence, or late
approval behavior.

For deployment-off, the existing named runtime was restarted serially on the
same port with `NEXT_PUBLIC_KOLLABOR_BAR=0`; no second listener was run. The
authenticated settings page showed the saved-on switch still checked but
disabled, with the exact deployment explanation. The chat input was absent.
On `/dashboard`, the “Ask Mentiko” button count was 0, the chat input count was
0, and no dialog was present. No turn or UI grant was submitted. I then
restarted the same named runtime in the same workspace/port with the flag
unset, restoring its original default-on mode. The current browser is back on
the authenticated settings page with the bar on, YOLO on, width 458px, and the
active sidebar item. Current health is HTTP 200/degraded; disk and Redis
warnings remain separate from this feature.

At 390×844, `innerWidth`, document `scrollWidth`, and body `scrollWidth` were
390; at 820×900, all three were 820. At both sizes the enabled settings switch
was visible (36px) and checked. The viewport override was reset afterward.
These are direct live measurements, not passes of the named authenticated
Playwright tests. The full Playwright run still skips the settings, iframe,
scope-B, and deployment-off cases because the corresponding local test
environment values are unset.

AC-26 test-title note: the two implementation-lane tests are recorded above
under their exact current source titles. Those titles differ from the requested
labels `defaults new scopes to YOLO and resolves the first-run choice` and
`exposes the scoped YOLO default and opt-out`; this lane did not edit their
owned test files.

## Recorded validation runs

- Focused combined web regression run (2026-09-23): from `web/`,
  `npm test -- --runInBand --runTestsByPath` with these 15 paths: `lib/__tests__/kollabor-bar-store-enable.test.ts`, `lib/__tests__/floating-bar-availability.test.ts`, `lib/__tests__/floating-bar-lifecycle.test.ts`, `lib/__tests__/kollabor-engine-session-reconciliation.test.ts`, `lib/__tests__/mentiko-mcp-bar-client-lifecycle.test.ts`, `components/app-shell/__tests__/floating-bar-storage-scope.test.tsx`, `components/app-shell/__tests__/floating-kollabor-bar-gateway.test.tsx`, `components/app-shell/__tests__/ui-control-grant.test.tsx`, `app/settings/mentiko-agent/page.test.tsx`, `app/settings/layout.test.tsx`, `app/layout-client.test.tsx`, `app/mcp-auth/page.test.tsx`, `app/api/mentiko-mcp/auth/device/approve/route.test.ts`, `app/api/system/storage-scope/route.test.ts`, and `'app/api/kollabor/engine/[...path]/route.test.ts'` — 15 suites / 156 tests passed, exit 0 (4.071s), including approval validation. A later, wider 22-suite regression matrix is recorded below; this focused run remains the evidence for its layout-client and persisted approval-route coverage. Neither run alters upstream engine blockers.
- Fresh Playwright discovery and execution (2026-09-23):
  `E2E_BASE_URL=http://127.0.0.1:3200 npx playwright test e2e/tests/floating-bar-enable-disable.spec.ts --list`
  discovered 23 tests. The full command
  `E2E_BASE_URL=http://127.0.0.1:3200 npx playwright test e2e/tests/floating-bar-enable-disable.spec.ts --reporter=line`
  collected 23, passed 3, skipped 20, exit 0 (9.8s) inside the repository verifier. Passed: unauthenticated settings redirect, cross-tab documentation assertion, and the AC ledger/source-name contract. Seventeen authenticated cases skipped for unset `E2E_BAR_EMAIL`/`E2E_BAR_PASSWORD`; A→B skipped for unset `E2E_BAR_SCOPE_B_EMAIL`/`E2E_BAR_SCOPE_B_PASSWORD`; two deployment-off cases skipped for unset `E2E_BAR_OFF_URL`. This used the existing `mentiko-dev` runtime at `127.0.0.1:3200`; `E2E_BASE_URL` disables Playwright `webServer` and global setup/teardown. No setting was mutated by this run.
- Fresh repository verifier (2026-09-23): from the Mentiko repo root,
  `bash -n web/tests/tmux/verify_floating_bar_enable_disable.sh` passed. Then
  `E2E_BASE_URL=http://127.0.0.1:3200 bash
  web/tests/tmux/verify_floating_bar_enable_disable.sh` ran its exact 22-suite
  Jest matrix (192/192 passed) and 23-case Playwright suite (3 passed, 20
  skipped). The wrapper correctly returned exit 1 because required authenticated
  and deployment-off cases were skipped; it did not count skips as acceptance
  passes. This uses a unique temporary tmux socket, starts/stops no web server,
  and cleaned up its test-owned socket/session. The first attempt exposed a
  child-socket re-generation bug and a missing-pane polling hang; both were
  fixed in the wrapper before this final run.
- Fresh approval-surface checks (2026-09-23): from `web/`,
  `npm test -- --runInBand --runTestsByPath app/api/mentiko-mcp/auth/device/approve/route.test.ts app/mcp-auth/page.test.tsx components/app-shell/__tests__/ui-control-grant.test.tsx`
  — 3 suites / 28 tests passed, exit 0. This includes persisted grant-kind
  binding, invalid-decision rejection, and UI-surface response-kind checks.
- Latest static checks (2026-09-23): from `web/`,
  `npx tsc --noEmit --incremental false --pretty false` passed. Scoped ESLint
  passed for `app/api/mentiko-mcp/auth/device/approve/route.ts`, its test,
  `app/mcp-auth/page.tsx`, its test, and both UI-control-grant component/test.
- Fresh production build (2026-09-23): `NODE_OPTIONS=--max-old-space-size=8192
  npm run build` passed. Next webpack compilation, TypeScript validation, and
  generation of 133 static pages completed. The existing `mentiko-dev` runtime
  was then restored on port 3200; no second dev server was started.
- Coordinator-reported fresh shared-tree results: Faraday-owned
  settings/storage-scope/gateway/UI approval/client lifecycle/store suites
  passed 9/9 suites and 108/108 tests. Hubble's layout and persisted-approval
  route tests passed 2/2 suites and 15/15 tests. Upstream engine tests passed
  18/18; they validate existing behavior, not the missing cancellation receipt
  or pending-create reconciliation contracts.
- Earlier independent local rerun of nine focused web suites (2026-09-23,
  superseded by the 15-suite/156-test run above): from
  `web/`, `npm test -- --runInBand app/settings/mentiko-agent/page.test.tsx
  components/app-shell/__tests__/floating-bar-storage-scope.test.tsx
  components/app-shell/__tests__/floating-kollabor-bar-gateway.test.tsx
  components/app-shell/__tests__/ui-control-grant.test.tsx
  lib/__tests__/mentiko-mcp-bar-client-lifecycle.test.ts
  lib/__tests__/kollabor-bar-store-enable.test.ts
  lib/__tests__/floating-bar-lifecycle.test.ts
  lib/__tests__/kollabor-engine-session-reconciliation.test.ts
  lib/__tests__/floating-bar-availability.test.ts` — 9 suites / 105 tests
  passed. This is a separately selected run from the coordinator-reported
  9/108 batch; its exact selection/count is retained rather than merging the
  results.
- Fresh layout/approval route rerun (2026-09-23): from `web/`,
  `npm test -- --runInBand --runTestsByPath app/layout-client.test.tsx
  app/api/mentiko-mcp/auth/device/approve/route.test.ts` — 2 suites / 15 tests
  passed, including the exact AC-08 non-mount test and all four persisted
  grant-kind AC-16 route tests listed in the ledger. The route tests use an
  in-memory database fixture; this is not live authenticated browser evidence.
- Fresh hydration-fix validation (2026-09-22): all 15 targeted Jest suites,
  including the proxy route, passed 104 tests; the standalone settings page
  suite passed 13 tests; scoped ESLint passed; `npx tsc --noEmit` passed.
- Accordion default alignment (2026-09-22): `starts the backdrop and chat
  surface accordions collapsed and exposes their controls on demand` in
  `web/app/settings/mentiko-agent/page.test.tsx` passed in the fresh 13-test
  settings suite. `settings offers three appearance presets while keeping width independent` in `web/e2e/tests/floating-bar-enable-disable.spec.ts`
  asserts the same collapsed default and expand/collapse behavior; a focused
  run against the existing runtime was skipped before login because
  `E2E_BAR_EMAIL`/`E2E_BAR_PASSWORD` are unset.
- Fresh settings-layout suite (2026-09-23): from `web/`,
  `npm test -- --runInBand app/settings/layout.test.tsx` — 1 suite / 4 tests
  passed, including `highlights the most specific item for a nested settings
  route` and panel-surface preservation. The active-sidebar browser check is
  separately named below and requires authenticated E2E credentials.
- Fresh authenticated CUA evidence (2026-09-23): the current in-app tab showed
  the active Mentiko Agent button (`aria-current="page"`, `bg-foreground/10`),
  width 458px, bar and YOLO on, and both appearance accordions collapsed. The
  profile endpoint returned 503, Active profile showed None, and the
  background-worker badge showed stopped; these are separate runtime/profile
  conditions. No preference or preset was changed.
- Earlier HTTP probe (2026-09-23 04:47 UTC; superseded by the post-build probe
  below): `/api/health` returned HTTP 200
  with `status=degraded` (9% disk free; Redis unavailable); the settings route
  returned 307 to `/login?redirect=%2Fsettings%2Fmentiko-agent` without this
  shell's session. Listener PID 25136 remained on 127.0.0.1:3200; no server
  was started or restarted. This health/unauthenticated shell probe does not
  override the authenticated CUA observation above.
- Full `npm run lint` was run and failed on 26 errors/39 warnings in unrelated
  files (for example GitHub integration tests, docs/pulse UI, and runner-v2).
  Scoped ESLint for every touched settings, hydration, lifecycle, engine, and
  Playwright file passed.

- Previously recorded implementation regressions: 14 suites/76 tests, 5 adjacent suites/25 tests, and 3 baseline suites/17 tests passed; explicit store/settings pair: 2 suites/22 tests passed. These are the prior implementation-lane results, not rerun in this documentation/E2E lane.
- Fresh standalone settings page suite (2026-09-23): from `web/`, `npm test -- --runInBand app/settings/mentiko-agent/page.test.tsx` — 1 suite, 13/13 tests passed. This includes the named page tests for profiles-503 hydration, YOLO default/opt-out, scoped width, tunable backdrop, three presets independent of width, collapsed accordions, deployment-off, and storage failure/retry. This is unit evidence, not authenticated browser proof.
- Fresh focused core regressions (2026-09-23): from `web/`, `npm test -- --runInBand lib/__tests__/floating-bar-availability.test.ts lib/__tests__/kollabor-bar-store-enable.test.ts lib/__tests__/floating-bar-lifecycle.test.ts lib/__tests__/kollabor-engine-session-reconciliation.test.ts` — 4 suites / 42 tests passed. These cover unit-level availability, scoped preference defaults, fail-closed lifecycle, and engine-client request fencing; they do not satisfy the upstream cancellation or pending-create engine contracts.
- Fresh storage-scope API and navigation regressions (2026-09-23): from `web/`, `npm test -- --runInBand app/api/system/storage-scope/route.test.ts app/settings/layout.test.tsx` — 2 suites / 6 tests passed, including auth-gated scope API and most-specific settings navigation.
- Fresh bracketed proxy-route regression (2026-09-23): from `web/`, `npm test -- --runInBand --runTestsByPath 'app/api/kollabor/engine/[...path]/route.test.ts'` — 1 suite / 2 tests passed, including `honors a valid client session id so accepted creates can be reconciled`. Coordinator reported that the plain path-pattern invocation collected zero tests; that invocation is not counted as evidence.
- Historical full-file Playwright result (2026-09-23): the 19-case result before docs-ledger and accordion cases, followed by the 21-case result, is superseded by the latest 23-case run at the top of this section.
- Hubble-reported earlier AC-15/16/17 focused audit: 6 suites / 54 tests passed on the then-current test surface. That audit correctly noted that the old deployment-off UIControlGrant test directly renders the component and that persisted grant-kind route coverage was missing at that time. The later `app/layout-client.test.tsx` and `app/api/mentiko-mcp/auth/device/approve/route.test.ts` cases have now passed in the exact 2-suite/15-test rerun above; browser-level authenticated/deployment-off behavior remains skipped and is not counted as passed.
- Fresh Faraday reconciliation/settings regression run (2026-09-23): from `web/`, `npm test -- --runInBand app/settings/mentiko-agent/page.test.tsx components/app-shell/__tests__/floating-bar-storage-scope.test.tsx components/app-shell/__tests__/floating-kollabor-bar-gateway.test.tsx` — 3 suites / 44 tests passed. Includes `keeps an unknown-session shutdown blocked after re-enable and retry during a pending boot`, `does not revive a null-session boot after disable and fail-closed re-enable`, `ignores a session-create result that resolves after the bar unmounts`, `invalidates locally and fail-closes the captured runtime when unmounted mid-turn`, `does not offer a no-op shutdown retry when the pending session ID is unknown`, and `does not offer unsafe shutdown retry for a known but unverified session`. These verify local fail-closed and affordance behavior, not server-side cancellation or create reconciliation.
- Fresh engine-client reconciliation suite (2026-09-23): from `web/`, `npm test -- --runInBand lib/__tests__/kollabor-engine-session-reconciliation.test.ts` — 1 suite, 16/16 tests passed, including `does not dispatch a session create when scope changes during token lookup`. This proves the stale-scope fence prevents dispatch before a request is sent; it does not cancel or clean up a request already sent.
- Prior focused regression snapshot before Faraday's latest additions (2026-09-23): from `web/`, `npm test -- --runInBand components/app-shell/__tests__/floating-bar-storage-scope.test.tsx components/app-shell/__tests__/floating-kollabor-bar-gateway.test.tsx lib/__tests__/kollabor-engine-session-reconciliation.test.ts` — 3 suites / 40 tests passed. It includes `rejects an older panel revision without overwriting the owner and acknowledges a fresh snapshot` and `keeps the current pending boot active when scope changes during a null-session create`. The latter covers A→B scope change while create is pending, not disable-then-re-enable during a null-session create. This is not the result for Faraday's newly added regressions.
- Fresh read-only Kollab contract recheck (2026-09-23): the current Kollab worktree is clean. In `packages/kollabor-engine/src/kollabor_engine/routes/messages.py:867-874`, `POST /sessions/{session_id}/cancel` calls `session.cancel_turn()` and immediately returns `{ok: true, session_id}`. `EngineSession.cancel_turn` (`session.py:287-293`) schedules `state.cancel_current_request()` as a task without awaiting it; that method (`kollabor/llm/llm_coordinator.py:1572-1589`) targets whichever request is currently processing and schedules tool cancellation in the background, with no turn/cancel identity or terminal receipt. A targeted search found no direct cancel-route test under `packages/kollabor-engine/tests`. Re-ran `.venv/bin/python -m pytest packages/kollabor-engine/tests/test_session_creation.py::test_in_flight_session_id_reservation_conflicts_before_second_spawn -q` — 1 passed in 0.35s, and `.venv/bin/python -m pytest packages/kollabor-engine/tests/test_assistant_route.py::test_assistant_transport_cancellation_cancels_daemon packages/kollabor-engine/tests/test_session_creation.py::test_cancelled_initialize_shuts_down_and_releases_reservation -q` — 2 passed in 0.47s. These code-level tests do not prove endpoint terminal acknowledgement, delayed-cancel fencing, or fetch-abort server cancellation; no Kollab files were edited.
- Fresh typecheck (2026-09-23): `npx tsc --noEmit --incremental false --pretty false` passed, followed by a fresh `npx tsc --noEmit` pass. An earlier incremental invocation reported eight nullable-key diagnostics in the E2E file; the clean non-incremental and subsequent standard invocations passed without source edits. `npm run build` passed with `NODE_OPTIONS=--max-old-space-size=8192`; default Node heap was insufficient. Repository-wide lint remains blocked by 26 errors in unrelated dirty-tree files.
- Latest scoped ESLint (2026-09-23): from `web/`, `npx eslint e2e/tests/floating-bar-enable-disable.spec.ts` — passed.
- Acceptance-ledger source audit (2026-09-23): the named-evidence Playwright contract asserts complete AC-01..AC-29 ID coverage, scans local Jest/Playwright source files to confirm each row's named multiword test/check label exists, and requires an explicit result state. The contract passed in the latest 23-case full-file run.
- Fresh post-live-ledger source audit (2026-09-23): from `web/`, `E2E_BASE_URL=http://127.0.0.1:3200 npm run test:e2e -- --workers=1 --grep 'acceptance ledger maps every spec criterion to named evidence and a result'` — 1 passed (4.3s), exit 0 after the current live results and AC row updates.
- Acceptance-ledger contract rerun after the final continuation evidence and AC-08/AC-14 corrections (2026-09-23): the same named Playwright test — 1 passed, exit 0; all 29 criterion IDs still resolve to named evidence and an explicit recorded state.
- Prior Playwright discovery (21 tests) and full-file run (21 collected, 3 passed, 18 skipped) are superseded by the 23-case result above. The write-failure iframe case is included in that 23-test discovery and was skipped for missing authentication.
- Current focused docs/accordion run (2026-09-23): from `web/`, `E2E_BASE_URL=http://127.0.0.1:3200 npx playwright test e2e/tests/floating-bar-enable-disable.spec.ts --grep 'acceptance ledger maps every spec criterion to named evidence and a result|documents cross-tab preferences as refresh-consistent and shared-session cancellation|settings backdrop and chat surface accordions expand and collapse without changing values' --reporter=line` — 2 passed, 1 skipped, exit 0. The ledger/source contract and cross-tab documentation contract passed; the accordion interaction test skipped before navigation because primary authenticated credentials are absent.
- Historical full-file Playwright run (21 collected, 3 passed, 18 skipped, exit 0) is superseded by the 23-case latest run at the start of this section.
- Historical focused live-route run (2026-09-23): `E2E_BASE_URL=http://127.0.0.1:3200 npx playwright test e2e/tests/floating-bar-enable-disable.spec.ts --grep 'unauthenticated settings navigation follows the login redirect' --reporter=line` — 1 passed (2.9s), exit 0 against the then-existing PID 99162. The PID 93230 post-build runtime is independently probed below; authenticated cases remain skipped, not inferred from this route result.
- Focused active-sidebar browser case (2026-09-23): `E2E_BASE_URL=http://127.0.0.1:3200 npx playwright test e2e/tests/floating-bar-enable-disable.spec.ts --grep 'settings route marks Mentiko Agent as the active sidebar item' --reporter=line` — 1 skipped because `E2E_BAR_EMAIL`/`E2E_BAR_PASSWORD` are unset; the test skips at login before preferences are read or changed.
- Previous full-file run details (19 cases; superseded by the 23-case run above): unauthenticated redirect and cross-tab documentation contract passed; authenticated cases skipped for missing credentials and deployment-off skipped for missing `E2E_BAR_OFF_URL`.
- Focused YOLO/deployment-off/docs/redirect execution — 2 passed, 2 skipped: docs-contract and unauthenticated redirect passed; new-scope YOLO skipped because `E2E_BAR_EMAIL`/`E2E_BAR_PASSWORD` are unset; deployment-off skipped because `E2E_BAR_OFF_URL` is unset. A separate latest focused YOLO execution also reported 1 skipped. The skip occurred before scope snapshot, key clearing, or preference mutation.
- Rapid-off/on, receipt-only, cancellation-HTTP-failure, A→B, accordion, iframe, settings, width, appearance, presets, and 390px/820px browser cases are discovered but remain skipped in the latest full-file run for the env reasons above. The deterministic cancellation and storage fixtures do not make an engine-contract pass.
- Fresh local listener probe (2026-09-23 09:41 UTC): `lsof -nP -iTCP:7433 -sTCP:LISTEN` found PID 43038 (`python3.1`) on `127.0.0.1:7433`. No cancellation request was issued; no direct engine-cancel behavior was exercised. The previously reported no-listener result is historical.
- Latest Marco-reported MANUAL LIVE evidence (2026-09-23): the authenticated top-level settings route showed scoped width 458px, Custom appearance, Floating bar and YOLO enabled, and Mentiko Agent selected with `aria-current=page`. At 390×844 and 820×1180, document/body `clientWidth` equaled `scrollWidth`; viewport was restored to default and no preference was edited. This is not a Playwright acceptance pass and does not prove reload, iframe propagation, preset application, or cancellation behavior.
- Historical live `mentiko-dev` checks from 2026-09-21 covered authenticated settings, width/appearance changes, disabled reload, no-turn rapid toggle, dashboard opener, actual iframe, and 390px/820px. Keep them historical; they do not replace the current skipped E2Es.
- Post-build same-runtime probe (2026-09-23): `lsof -nP -iTCP:3200 -sTCP:LISTEN`
  found PID 93230 bound to `127.0.0.1:3200`; `/api/health` returned HTTP 200
  with `status=degraded`; `/settings/mentiko-agent` returned HTTP 307 to the
  expected login redirect without a session. The health warning reports 8% free
  disk and absent/unreachable Redis. At that point CUA reported the Mac locked,
  so that probe could not inspect the authenticated app or iframe. This was
  superseded by the continuation check below; it did not satisfy authenticated
  acceptance cases.

- Fresh continuation check (2026-09-23): the original `mentiko-dev` tmux
  session was present at `/Users/malmazan/dev/platform/mentiko/web` (pane PID
  99267), and exactly one listener (Next PID 5118) remained on
  `127.0.0.1:3200`. `/api/health` returned HTTP 200 with `status=degraded`
  (8% free disk, Redis absent/unreachable, zero active sessions). The existing
  authenticated in-app tab loaded `/settings/mentiko-agent`; AX reported
  `aria-current="page"` on Mentiko Agent, width 458px, Floating bar on, YOLO
  on, and both appearance accordions initially collapsed. Expanding each
  accordion exposed its expected controls; collapsing them restored the
  collapsed state. No preference values were changed, and no iframe was open
  during this particular check.

- Fresh focused Jest rerun (2026-09-23): the 15 owned regression suites named
  above completed with 15 suites / 156 tests passed, exit 0 (22.309s).
- Fresh full Playwright rerun (2026-09-23):
  `E2E_BASE_URL=http://127.0.0.1:3200 npx playwright test
  e2e/tests/floating-bar-enable-disable.spec.ts --reporter=line` collected 23,
  passed 3 and skipped 20, exit 0 (18.5s). The passes were the unauthenticated
  login redirect, cross-tab documentation contract, and AC ledger/source-name
  contract. Authenticated primary/scope-B credentials and `E2E_BAR_OFF_URL`
  remain absent, so the authenticated, A-to-B, and deployment-off E2Es have no
  pass result. The three passing cases did not change settings.

- Fresh top-level UI evidence (2026-09-23): the same authenticated settings
  tab reported document/body scroll widths of 1280 at a 1280px viewport and
  preserved width 458px plus appearance values (blur 3, dim 25, horizontal
  reach 520, vertical reach 818, softness 59, transcript 72, radius 19,
  shadow 17) through accordion expand/collapse. Temporarily switching the bar
  off showed “Saved off in this window”; after reload and completed scope
  hydration, the switch remained off and the floating chat input was absent.
  Re-enabling restored the input without another reload. An immediate off/on
  cycle ended enabled with exactly one chat textbox. Health showed zero active
  sessions and no user turn was sent, so this does not prove active-turn
  cancellation or cancellation-failure behavior. CDP viewport checks at
  390×844 and 820×1180 again showed document/body widths exactly matching the
  viewport, with the settings switch visible; the device-metric override was
  cleared back to 1280px. The earlier live iframe and deployment-off checks
  remain separate evidence; named authenticated Playwright cases remain
  skipped.

## Engine contract blockers

The engine source was inspected read-only. The latest coordinator-reported
upstream run passed 18/18 engine tests. They validate existing behavior; none
proves terminal acknowledgement from the session-cancel endpoint or that
aborting a browser request stops server-side work. Engine unit results below
are code-level evidence only, not acceptance passes.

### Cancellation: AC-05 and AC-20

`POST /sessions/{id}/cancel` in
`packages/kollabor-engine/src/kollabor_engine/routes/messages.py` accepts no
turn/cancel identity. It calls `session.cancel_turn()`, which schedules
`cancel_current_request()` fire-and-forget, then returns `{ok:true, session_id}`
before that work settles. The call is not fenced against a delayed
cancellation affecting a later turn. A successful HTTP receipt does not prove
the turn or its tools are terminal, and browser fetch abort is not evidence
that server work stopped.

Smallest required engine behavior: accept a turn-scoped idempotent cancellation
identity, fence cancellation to that turn, and return or expose authoritative
terminal status that includes all tools stopped before session reuse. Until
that exists, AC-05 and AC-20 remain blocked. A 2026-09-23 read-only
`lsof -nP -iTCP:7433 -sTCP:LISTEN` probe found PID 43038 (`python3.1`) on
`127.0.0.1:7433`; no cancellation request was issued, so engine cancellation
remains unprobed live.

### Accepted session creation: AC-07

The engine accepts caller `session_id`, but `_reserve_session_id()` returns
409 while that ID is pending. The ID becomes GET-visible only after
`initialize()` completes; until then `GET /sessions/{id}` checks hub discovery
and otherwise returns 404. There is no pending/ready/failed result for an
accepted-but-still-initializing create. The existing source test
`test_in_flight_session_id_reservation_conflicts_before_second_spawn` asserts
one spawn and 409 on a second same-ID create during initialization; its
project-venv run passed 1/1 in 0.39s. This demonstrates the reservation
behavior, not successful reconciliation. An earlier system-Python attempt did
not execute because pytest was unavailable; the project-venv result is the
valid run.

Two additional Kollab `.venv` code-level regressions passed 2/2 in 0.36s:
`test_assistant_transport_cancellation_cancels_daemon` in
`packages/kollabor-engine/tests/test_assistant_route.py` covers assistant
stream transport cancellation only, not `POST /sessions/{id}/cancel`; and
`test_cancelled_initialize_shuts_down_and_releases_reservation` in
`packages/kollabor-engine/tests/test_session_creation.py` covers cleanup only
when the server handler receives `CancelledError`. Neither proves that aborting
a browser fetch stops server work. A local engine listener is present, but no
cancellation request was issued; this is not a live cancellation probe. These
are not acceptance passes for AC-05/20.

The web client writes a scoped stable pending ID and the proxy forwards it;
GET-based reconciliation covers registered or hub-discoverable creates only.
The smallest engine change is to expose pending/ready/failed state by stable
ID, or make same-ID retry join/wait for the pending create and return its
eventual result. Until then, accepted-but-pending reconciliation remains an
AC-07 blocker. The browser keeps the scoped marker and blocks reuse when
cancellation is unconfirmed.

## Unknown-session shutdown classification

When disable captures a create before receiving a session ID, the client keeps
an unknown-session marker and blocks session reuse. This is intentionally
fail-closed, not recoverable client-side: the engine cannot currently report
that pending create's state. The settings UI now explains the blocked state and
withholds **Retry stopping** unless safe retry is supported for a known
session. The current focused run passed `keeps an unknown-session shutdown
blocked after re-enable and retry during a pending boot`, `keeps a known-session
shutdown marker non-retryable without scoped terminal cancel support`, `does
not offer a no-op shutdown retry when the pending session ID is unknown`, and
`does not offer unsafe shutdown retry for a known but unverified session`.
These are client fail-closed and affordance tests, not an engine recovery pass.
The user guide now states that an unidentified session remains blocked until
its state can be confirmed and that retry is only offered when safe.
