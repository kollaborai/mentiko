# MCP Session-Token Auth Recovery — Design Spec

Status: **APPROVED — decisions locked 2026-06-27, no code yet**
Author: Claude (paired with Marco)
Date: 2026-06-27

---

## 1. Problem

MCP ops calls (`/api/mentiko-mcp/ops/*`) authenticate with a short-lived HS256 session
JWT (`web/lib/auth/session-token.ts`). When that token becomes invalid, the MCP client
gets an opaque `401 Invalid or expired session token` with **no recovery path** and no
guidance to the user.

Two ways the token goes bad:

1. **Expiry — routine.** `mintSessionToken` TTL is **24h** (`session-token.ts:7`). Every
   engine/MCP session token expires daily. This is not an edge case; it is the default
   daily experience.
2. **Secret drift / rotation — occasional.** Tokens are signed with the raw
   `BETTER_AUTH_SECRET` (via the legacy single-arg path in `resolveAppSecret`). Rotating
   the secret invalidates every token at once. (This is exactly what bit us on
   2026-06-27: the stored Claude-Code token was minted under an old secret and 401'd.)

### Why the existing auto-refresh does not cover it

The bridge already self-heals on 401 — `handlers/ops-client.ts:33-50,86-101`: on a 401 it
calls `refreshToken()`, which reads the sidecar `~/.kollab/engine.token` and calls
`GET {KOLLABOR_ENGINE_URL}/sessions/{id}/token` for a fresh JWT, then retries once.

**That path requires the kollab engine.** It only works for sessions the engine spawned
(chain runs, the in-app agent bar) where `~/.kollab/engine.token` + `KOLLABOR_ENGINE_URL`
are present.

A **standalone MCP client** — Claude Code wired as the user-scope `mentiko` MCP server —
has only `MENTIKO_WEB_URL`, `MENTIKO_SESSION_ID`, `MENTIKO_SESSION_TOKEN`. No engine
token, no engine URL. So `refreshToken()` cannot run, the 401 is terminal, and the user
is dead in the water until someone hand-mints a JWT and re-wires `~/.claude.json` (what we
did manually today). **That is the gap this spec closes.**

---

## 2. Goals / Non-goals

**Goals**
- A standalone MCP client can recover from an expired/invalid token **without** manual
  token minting or editing `~/.claude.json`.
- On auth failure the user gets an **actionable** message (a magic link / a `reconnect`
  command), not a raw 401.
- Recovery **survives bridge restart** (no Claude Code restart required after the first
  reconnect).
- Reuse existing conventions (`mintSessionToken` claim shape, the `start`→`poll` contract,
  the ops→system proxy + `INBOX_KEY` pattern) rather than inventing parallels.
- Introduce the **revocation lever** that is currently missing.

**Non-goals (this phase)**
- Replacing the kollab-engine refresh path for engine-spawned sessions (it works; leave it).
- A full OAuth2 authorization-server implementation. We implement the device-grant shape,
  not the full RFC 6749 surface.
- Per-token blocklist for *all* token types (we add revocation for the new refresh token only).

---

## 3. Current state (grounded)

| Piece | Location | Notes |
|---|---|---|
| Token mint | `web/lib/auth/session-token.ts:22` | HS256, iss `mentiko-web`, aud `mentiko-mcp-ops`, **TTL 24h**, claims `{sub,jti,ns,org,role?,scopes?}` |
| Token verify | `session-token.ts:38` | enforces sig+iss+aud+expiry |
| Decode-skip-expiry | `session-token.ts:61` | refresh-only; still verifies signature |
| Signing key | `resolveAppSecret("session-token")` → legacy path → raw `BETTER_AUTH_SECRET` | `secrets/dev-secret.ts:131-139` |
| Ops auth gate | `web/lib/ai-engine/mentiko-mcp-ops-auth.ts:37` `requireOpsAuth` | JWT only, **no dev bypass**, always validates |
| Existing refresh route | `POST /api/kollabor/engine/sessions/[id]/refresh-token` | internal-secret branch + browser-cookie branch; re-mints via `mintSessionToken` |
| Bridge token state | `handlers/ops-client.ts:23` | `currentToken` in memory, seeded from env, self-heals on 401 (engine only) |
| Bridge error funnel | `server.ts:754-764` | single catch; toasts (needs INBOX_KEY) + `errorResult(msg)` |
| Signaling plane | `dispatch.ts` → `POST /api/mentiko-mcp/dispatch`, `X-Mentiko-Inbox-Key` | UI effects to the browser bar |
| Device-flow precedent | CLI-auth `start_cli_auth`/`poll_cli_auth` | **PTY-scraping, not a real device grant** — borrow contract shape only |
| Revocation | none | `session-token.ts:7` "follow-up work"; ops-auth comment claiming "15min/revocable" is **inaccurate** |

**Two surfaces to support:**
- **A. Standalone** (Claude Code as MCP server): no INBOX_KEY, no browser tab. The only
  channel back to the user is the **tool-result text**. This is the gap surface.
- **B. Engine-spawned** (in-app agent bar): has INBOX_KEY + an open browser tab; can show a
  toast + a "Reconnect" button. Already has engine refresh, but should get the friendly
  message + button too.

---

## 4. Design

Three layers. Layer 1 is a quick, isolated win; Layers 2–3 are the real feature.

### Layer 1 — Friendly auth-failure message (bridge)

At the error funnel `server.ts:754-764`, classify the error. If it is an auth failure
(`401`, `"session auth required"`, `"Invalid or expired session token"`):

- Return a tool result that tells the user what to do, e.g.:
  > 🔑 Your Mentiko session has expired. Run the **`reconnect`** tool to get a sign-in
  > link, or open `<verificationUrl>` and approve in the app.
- Surface A: the message **is** the tool result (no INBOX_KEY → toast no-ops).
- Surface B: also `dispatchEffect("show_toast", …)` + (new) a bar "Reconnect" affordance.

This alone removes the dead-end even before reconnect exists. Small, low-risk, shippable
independently.

### Layer 2 — Refresh token (the durable credential)

Root cause for standalone clients: **the access token is the only credential, so when it
dies there's nothing to refresh with.** Fix: give the client a long-lived **refresh token**
it can exchange for short-lived access tokens — the OAuth refresh pattern.

- **Refresh token**: opaque, high-entropy, long-lived (**90d**, fixed — D4), **revocable**,
  stored server-side (hash only) in a new `mcp_refresh_token` SQLite table — keyed to
  `{userId, ns, org, role, scopes, label, createdAt, lastUsedAt, revokedAt}`. (Precedent:
  `web/lib/api/refresh-rate-limiter.ts` already creates/uses a SQLite table.)
- **Exchange endpoint**: `POST /api/mentiko-mcp/auth/token` with
  `{ refresh_token }` → `{ session_token, expires_in }`. Mints a 24h access JWT via
  `mintSessionToken` using the refresh token's stored identity/claims. Rate-limited.
- **Bridge change** (`ops-client.ts`): add a second refresh source. On 401, if the engine
  path is unavailable, read the refresh token from the **sidecar file** (Layer 3) and call
  the exchange endpoint; swap `currentToken`; retry once. This makes daily expiry
  **invisible** to standalone clients — no user action after the initial reconnect.
- **Revocation lever** (closes the §3 gap): revoking the refresh token (Settings UI / admin)
  kills the standalone client's ability to refresh. Access tokens still expire within 24h.

### Layer 3 — Device-flow reconnect (the magic link, bootstraps Layer 2)

A `reconnect` MCP tool that runs an OAuth-2.0-device-grant-shaped flow to issue the
refresh token, authenticated by the user's existing browser session.

**New MCP tool** `reconnect` (alias `authenticate`):
1. `POST /api/mentiko-mcp/auth/device/start` (system route, callable without a valid ops
   JWT — that's the point) → `{ device_code, user_code, verification_url, interval, expires_in }`.
2. Returns to the user: *"Open `<verification_url>` and approve. I'll pick up the session
   automatically."* `verification_url` = `{WEB_URL}/mcp-auth?code={user_code}` (the magic
   link; `{WEB_URL}` is the tenant URL in prod).
3. Bridge polls `GET /api/mentiko-mcp/auth/device/poll?device_code=…` →
   `{ status: "pending"|"approved"|"denied"|"expired", refresh_token?, session_token? }`.
4. On `approved`: bridge writes `refresh_token` (+ a bootstrap `session_token`) to the
   **sidecar file**, swaps `currentToken` in memory, and resumes. Done — no restart.

**Auto-start on 401 (D3):** the Layer 1 handler does not just *tell* the user to reconnect —
when there is no usable refresh token it **auto-calls `device/start`** and embeds the live
`verification_url` directly in the error message, so the user gets a clickable link in one
step instead of having to invoke `reconnect` first.

**Approve page** `/mcp-auth`:
- Requires a logged-in better-auth session (the security anchor — only the real user can
  approve). If not logged in → normal login redirect, return to `/mcp-auth?code=…`.
- Shows: client label ("Claude Code"), the `user_code` to confirm, and the **scopes/role**
  being granted (default **`ops:*`** — D2 — surfaced here for confirmation). Approve / Deny
  buttons (CSRF-protected POST).
- On approve: marks the device code approved, mints + stores the refresh token bound to the
  logged-in user's `{id, ns, org, role}` and the confirmed scopes.

**Device-code store**: new `mcp_device_code` SQLite table (D1) —
`{device_code(hash), user_code, status, userId?, refreshTokenId?, expiresAt}`, TTL ~10 min,
single-use, poll rate-limited.

### Sidecar token file (kills restart + the `~/.claude.json` clobber problem)

Store the credential in a file the bridge reads at runtime, **not** baked into the static
MCP env config:

- Path: `~/.mentiko/mcp/session.json` (mode 0600) — `{ refresh_token, session_token, updatedAt }`.
  `session-store.ts` validates the physical JSON and required token fields, rejects
  symlinks, preserves refresh credentials during access-token rotation, and publishes
  replacement bytes by atomic rename. Invalid bytes fail closed; they are never
  interpreted as an empty or absent credential.
- Bridge precedence (`ops-client.ts` seed + `ensureToken`): **sidecar file → env
  `MENTIKO_SESSION_TOKEN` → engine refresh**. So after one reconnect, the sidecar is the
  source of truth; `~/.claude.json` only needs `MENTIKO_WEB_URL` + `MENTIKO_SESSION_ID`.
- This is the same shape the bridge already uses for `~/.kollab/engine.token` — we're adding
  a sibling, not a new mechanism.

---

## 5. New API surface

Unify the divergent CLI-auth response shapes (the system-route `pending/complete/failed`
vs ops-route `waiting/url_ready/complete/failed` asymmetry the audit flagged). One contract:

```
POST /api/mentiko-mcp/auth/device/start
  → 200 { device_code, user_code, verification_url, interval, expires_in }

GET  /api/mentiko-mcp/auth/device/poll?device_code=…
  → 200 { status: "pending" }                                  // keep polling
  → 200 { status: "approved", refresh_token, session_token }   // once, then consumed
  → 200 { status: "denied" }
  → 410 { status: "expired" }
  → 429 { error: "slow_down" }                                 // rate limit

POST /api/mentiko-mcp/auth/token        { refresh_token }
  → 200 { session_token, expires_in }                          // silent refresh
  → 401 { error: "invalid_grant" }                             // revoked/unknown → re-run device flow

Page /mcp-auth?code=USER_CODE          (cookie-authed approve/deny UI)
POST /api/mentiko-mcp/auth/device/approve  { user_code, decision }   (cookie + CSRF)
```

All `/auth/*` data routes live under `/api/mentiko-mcp/` and do **not** use `requireOpsAuth`
(they exist precisely to mint the token that requireOpsAuth wants). Their own guards:
cookie session (approve), device-code possession (poll), refresh-token possession (token),
plus rate limits.

---

## 6. Security model

- **Authentication anchor**: issuing a refresh token requires an authenticated browser
  session on the approve page. No browser login ⇒ no token. The MCP client never handles
  the user's password.
- **Device code**: high-entropy `device_code` (server-secret, used by the poller),
  short human `user_code` (shown on the link/page for confirmation), ~10 min TTL,
  single-use, poll rate-limited (reuse `refresh-rate-limiter` pattern).
- **Refresh token**: stored as a hash, 90d, revocable, scoped to one identity. Shown
  to the client once. Compromise ⇒ revoke (the new lever).
- **Access token**: unchanged — 24h, `requireOpsAuth` validates as today.
- **Scopes**: `ops:*` default, surfaced on the approve page for confirmation.
- **Prod / self-hosted**: `verification_url` must be the tenant's public URL
  (`{WEB_URL}`), not `127.0.0.1`. Over HTTPS in prod. Loopback-only relaxations (as in the
  engine refresh route) do **not** apply here since this is user-cookie-authed.

---

## 7. Build plan (phases)

Decided sequence (D5): **Phase 1 ships standalone, then 2 → 3 → 4.** Layer→phase mapping:
Layer 1 = Phase 1; Layer 3 = Phase 2; Layer 2 = Phase 3; revocation introduced in Phase 2's
data model, surfaced in Phase 4.

### Phase 1 — Friendly auth-failure message (Layer 1) · smallest, independent
- **Touches**: `lib/mentiko-mcp/server.ts` (classify error at :754-764) + a small helper. Bridge only, no web changes.
- **Delivers**: opaque 401 → actionable guidance. Removes the dead-end immediately.
- **Note**: message is generic ("re-authenticate in the app") until Phase 2 adds the live link; then it carries the magic link.
- **Ship**: rebuild bridge (`npm run build` in `lib/mentiko-mcp`).

### Phase 2 — Device flow + refresh-token issuance (Layer 3) · the big one
- **Web**: routes `POST /auth/device/start`, `GET /auth/device/poll`, `POST /auth/device/approve`, `POST /auth/token`; the `/mcp-auth` approve page; SQLite tables `mcp_device_code` + `mcp_refresh_token`.
- **Bridge**: new `reconnect` MCP tool; sidecar file (`~/.mentiko/mcp/session.json`) write + read; precedence wiring in `ensureToken`.
- **Delivers**: end-to-end magic-link reconnect that issues the revocable refresh token. After this, manual token wiring is gone.
- **Ship**: rebuild bridge + deploy web.

### Phase 3 — Silent auto-exchange (Layer 2 + D3 auto-start) · makes expiry invisible
- **Bridge**: `ops-client.ts` reads the sidecar refresh token and auto-exchanges on 401 via `/auth/token` (retry once); the Phase 1 handler auto-starts the device flow + embeds the link when no refresh token exists.
- **Delivers**: 24h expiry becomes invisible — reconnect needed only on first run or after a revoke.
- **Ship**: rebuild bridge.

### Phase 4 — Revocation UI + doc-fix · the lever
- **Web**: Settings UI to list/revoke MCP refresh tokens (`web/app/settings/security` or a new `/settings/mcp` page).
- **Doc-fix** (independent, can land anytime): correct the inaccurate comment in `mentiko-mcp-ops-auth.ts:9-11` ("15 min expiry", "logout kills them") → "24h, no per-token revocation today".

**Build notes**: bridge changes require `npm run build` in `lib/mentiko-mcp` (esbuild →
`dist/server.js`; dev runs `.ts` via tsx); ships in the tenant image (`Dockerfile:145-156`).
SQLite tables created on demand (like `refresh_rate_limit`).

---

## 8. Decisions (resolved 2026-06-27)

- **D1 — store**: **SQLite tables** (`mcp_device_code`, `mcp_refresh_token`), created on demand.
- **D2 — default scopes**: **`ops:*`**, surfaced on the approve page for confirmation.
- **D3 — auto-start on 401**: **yes** — the friendly error auto-starts the device flow and embeds the live link.
- **D4 — refresh-token TTL**: **90d fixed**; rotation deferred.
- **D5 — v1 scope**: **Phase 1 (friendly error) ships standalone**; then Phases 2 → 3 → 4.

---

## 9. Out of scope / future

- General per-token (`jti`) blocklist for engine/chain/webhook tokens (this spec only makes
  the new MCP refresh token revocable).
- Replacing `BETTER_AUTH_SECRET`-as-signing-key with the HKDF-derived `session` key
  (would decouple session-token signing from the root secret; separate change).
- Unifying the existing CLI-auth `start`/`poll` shapes (we define a clean contract here;
  retrofitting CLI-auth onto it is optional cleanup).
