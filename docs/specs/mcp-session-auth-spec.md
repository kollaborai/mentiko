# MCP Session Auth & Multi-User Isolation Spec

status: REVISED — incorporating all advisor findings
author: marco opus
date: 2026-04-27

---

## Problem Statement

The current mentiko-mcp architecture has two security gaps:

**Gap 1 — Global bypass key on data routes**
`MENTIKO_INBOX_KEY` is a single process-global shared secret. Any process on
the same machine that knows the key gets full read/write access to all chains,
agents, secrets, tasks, and runs — bypassing all RBAC, namespace isolation,
and audit logging. The 27 ops routes (`/api/mentiko-mcp/ops/*`) use this key
as their only auth mechanism. The original comment in the code called this a
"tenant-singleton model" — it was a shortcut, not a design decision.

**Gap 2 — Global inbox, no session routing**
The SSE inbox (`/api/mentiko-mcp/stream`), dispatch endpoint, and result
store are single global in-memory state. All effects broadcast to every
connected tab. Permission cards (approve/deny) can be answered by any browser
that is connected. Two tabs = race condition on permission prompts.

These two gaps fail enterprise readiness on:
- multi-user isolation
- per-user audit trail
- principle of least privilege
- RBAC enforcement on internal operations

---

## Goals

1. Data ops routes enforce the same namespace/org scoping as public API routes
   — no bypass path for data access.
2. Effects route to the specific browser session that initiated the agent turn.
3. `MENTIKO_INBOX_KEY` is retained only for the signaling channel
   (dispatch/stream/reply) — removed from all data access routes.
4. Structured audit log on every data ops call (userId, orgId, resource,
   action, timestamp, source).
5. Token TTL matches actual turn lifetime (~15 min), not 24h.
6. Results store (permission prompt replies) is per-session, not global.
7. No changes to the public API surface or the LLM turn execution path.
8. Backward compatible: existing single-user dev setup continues to work.
   Hard-fail unauthenticated connections in production (DATABASE_URL set).

---

## Non-Goals

- Full multi-tenancy (multiple orgs on one server). This spec ensures correct
  isolation for the current one-org-per-container model.
- Re-architecting the kollabor-engine or MCP subprocess management.
- Role/permission scope in token (pre-existing gap, separate PR).
- Subprocess env isolation (separate hardening work, committed timeline below).

---

## Accepted Risk (documented, not built in this spec)

**Rate limiting:** A valid session token can call ops routes at MCP tool call
speed. Accepted for now — tokens expire in 15 min and are session-scoped.
Filed as follow-up: add per-token rate limiting at `requireOpsAuth`.

**Subprocess env leakage:** `MENTIKO_SESSION_TOKEN` is visible in
`/proc/<pid>/environ` on Linux to the process owner. The MCP subprocess runs
as the same user as the engine — same trust domain, not a new exposure vector.
However the subprocess also inherits all other engine env vars (database URLs,
stripe keys, etc.). Remediation: env allowlist for MCP subprocess, target Q3.

**Role scoping in token:** Token carries userId/orgId/namespaceId but not
role. All token holders get identical ops-route namespace access. Pre-existing
gap — separate PR to add role claim and per-route permission checks.

---

## Architecture Overview

```
browser (bar)
  │
  │  POST /api/kollabor/engine/sessions   (creates engine session)
  │
  ▼
web proxy  (web/app/api/kollabor/engine/[...path]/route.ts)
  │  validates user session cookie via checkAuth()
  │  on session create only: calls getSessionUser() for namespaceId/orgId
  │  buffers upstream JSON, parses session_id
  │  mints short-lived JWT (15 min, aud=mentiko-mcp-ops)
  │  returns { ...sessionData, session_token: "<jwt>" } to browser
  │
  ▼  (browser stores session_token in memory / sessionStorage)
  │
  │  GET /api/mentiko-mcp/stream?sessionToken=<jwt>
  │
  ▼
SSE stream
  │  verifies JWT → extracts sessionId
  │  in dev (DATABASE_URL unset): fallback to "global" bucket
  │  in prod: hard-fail if no valid token
  │  poll loop: popEffects(sessionId)
  │
  ▼  (bar sends session_token to engine as x-mentiko-session-token header)
  │
  ▼
kollabor-engine  (Python FastAPI, port 7433)
  │  create_session: receives x-mentiko-session-token from proxy
  │  stores on EngineSession.user_token
  │  passes MENTIKO_SESSION_TOKEN + MENTIKO_SESSION_ID to MCP subprocess env
  │
  ▼
mentiko-mcp subprocess (stdio)
  │  data ops  → Authorization: Bearer <session_token>
  │  signaling → X-Mentiko-Inbox-Key (dispatch/reply only)
  │  includes X-Mentiko-Session-Id on dispatch for effect routing
  │
  ▼
ops routes  (/api/mentiko-mcp/ops/*)
  │  requireOpsAuth() verifies JWT → { userId, sessionId, namespaceId, orgId }
  │  namespaceId/orgId from token — no header fallback, no hardcoded "default"
  │  writes structured audit log entry on every call
  │  MENTIKO_INBOX_KEY check REMOVED from all ops routes
```

---

## Token Design

### Format

HMAC-SHA256 signed JWT using `BETTER_AUTH_SECRET` as the signing key.

```json
{
  "iss": "mentiko-web",
  "aud": "mentiko-mcp-ops",
  "sub": "<userId>",
  "jti": "<engineSessionId>",
  "iat": <unix-epoch>,
  "exp": <iat + 900>,
  "ns":  "<namespaceId>",
  "org": "<orgId>"
}
```

TTL: **900 seconds (15 minutes)**. Engine sessions rarely exceed this in
practice. If a turn runs longer (deep chains), the token can be refreshed —
the proxy exposes a `POST /api/kollabor/engine/sessions/:id/refresh-token`
endpoint that re-mints with a new expiry, gated on the original browser
session still being valid.

`aud: "mentiko-mcp-ops"` prevents token reuse against any other route that
validates with the same BETTER_AUTH_SECRET.

### Storage in browser

session_token is stored in **sessionStorage** (not localStorage). Reason:
sessionStorage is cleared when the tab closes and is not accessible to other
tabs on the same origin, reducing XSS blast radius. localStorage persists
across sessions and tabs — unacceptable for a bearer token.

### jose dependency

`jose` v6.1.3 is present as a transitive dep of `better-auth`. Add it
explicitly to `web/package.json` so it cannot be silently dropped:
```
npm install jose
```

---

## Audit Logging

Every ops route call writes a structured log entry. The logging happens inside
`requireOpsAuth` after successful token validation, so it fires on every
authenticated data access — no route can forget it.

Log entry format (JSON, written to stderr — picked up by process-manager):
```json
{
  "level": "info",
  "event": "mcp_ops_access",
  "userId": "<sub>",
  "sessionId": "<jti>",
  "namespaceId": "<ns>",
  "orgId": "<org>",
  "method": "GET",
  "path": "/api/mentiko-mcp/ops/chains",
  "ts": "<ISO-8601>"
}
```

This gives a complete per-request audit trail satisfying SOC2 CC6.1/CC6.3.

---

## Per-Session Inbox

Both the effects buffer and the results store (permission prompt replies)
are keyed by sessionId.

**Buffer eviction:** Each entry has a `lastDrained` timestamp. A cleanup sweep
runs on every `popEffects` call and evicts any session buffer not drained in
the last 10 minutes. This prevents unbounded map growth from abandoned sessions.

**Results store:** Also keyed by sessionId. `storeResult(sessionId, toolId,
result)` and `consumeResult(sessionId, toolId)` — a result for session A
cannot be consumed by session B. The reply endpoint reads sessionId from the
JWT (browser POST) or from the query param (MCP subprocess GET poll).

---

## Touch Points

### 1. `web/lib/session-token.ts` (NEW)

```typescript
import { SignJWT, jwtVerify } from "jose";

const SECRET = new TextEncoder().encode(process.env.BETTER_AUTH_SECRET!);
const ISSUER  = "mentiko-web";
const AUDIENCE = "mentiko-mcp-ops";
const TTL_SECONDS = 900; // 15 min

export interface SessionTokenClaims {
  sub: string;   // userId
  jti: string;   // engineSessionId
  ns:  string;   // namespaceId
  org: string;   // orgId
}

export async function mintSessionToken(claims: SessionTokenClaims): Promise<string> {
  return new SignJWT({ ns: claims.ns, org: claims.org })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(claims.sub)
    .setJti(claims.jti)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(SECRET);
}

export async function verifySessionToken(token: string): Promise<SessionTokenClaims> {
  const { payload } = await jwtVerify(token, SECRET, {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  return {
    sub: payload.sub as string,
    jti: payload.jti as string,
    ns:  payload["ns"]  as string,
    org: payload["org"] as string,
  };
}
```

### 2. `web/lib/mentiko-mcp-ops-auth.ts` (REPLACE)

`checkOpsAuth` + `getOpsContext` are replaced by a single `requireOpsAuth`
that validates the JWT and writes the audit log. The old functions are
**removed** — no coexistence, no fallback to inbox key.

```typescript
import { NextResponse } from "next/server";
import { verifySessionToken } from "./session-token";

export interface OpsContext {
  userId:      string;
  sessionId:   string;
  namespaceId: string;
  orgId:       string;
}

export async function requireOpsAuth(req: Request): Promise<OpsContext | NextResponse> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const token = authHeader.slice(7);
  let claims;
  try {
    claims = await verifySessionToken(token);
  } catch {
    return new NextResponse("Invalid or expired session token", { status: 401 });
  }

  const ctx: OpsContext = {
    userId:      claims.sub,
    sessionId:   claims.jti,
    namespaceId: claims.ns,
    orgId:       claims.org,
  };

  // structured audit log — every authenticated data ops call
  const url = new URL(req.url);
  console.log(JSON.stringify({
    level: "info",
    event: "mcp_ops_access",
    userId:      ctx.userId,
    sessionId:   ctx.sessionId,
    namespaceId: ctx.namespaceId,
    orgId:       ctx.orgId,
    method:      req.method,
    path:        url.pathname,
    ts:          new Date().toISOString(),
  }));

  return ctx;
}
```

All 27 ops routes change their auth call from:
```typescript
const denial = checkOpsAuth(req);
if (denial) return denial;
const { namespaceId, orgId } = getOpsContext(req);
```
to:
```typescript
const ctx = await requireOpsAuth(req);
if (ctx instanceof NextResponse) return ctx;
const { namespaceId, orgId, userId, sessionId } = ctx;
```

Routes that previously did not use `getOpsContext` (meta/*, notify,
decisions/answer, decisions/approve, decisions/select, context/runs/cancel)
still call `requireOpsAuth` — they just don't use the namespace fields.

### 3. `web/lib/mentiko-mcp-inbox.ts` (REPLACE)

Per-session buffers and results store. Buffer eviction on drain. Results
keyed by (sessionId, toolId).

Key interface changes:
- `pushEffect(kind, payload, sessionId)` — sessionId required
- `popEffects(sessionId)` — returns only that session's effects, evicts stale
- `storeResult(sessionId, toolId, result)` — scoped to session
- `consumeResult(sessionId, toolId)` — cannot cross sessions
- `evictSession(sessionId)` — called on session delete

### 4. `web/app/api/kollabor/engine/[...path]/route.ts` (MODIFY)

Special-case branch for `POST /sessions`. All other paths remain on the
streaming passthrough (no buffering). Only the sessions create path consumes
and reconstructs the response body.

```typescript
// POST /sessions: consume body, mint token, reconstruct response
if (request.method === "POST" && pathParts.join("/") === "sessions") {
  const user = await getSessionUser(request);
  // upstream already validated by checkAuth above
  const upstreamJson = await upstream.json() as Record<string, unknown>;
  const engineSessionId = upstreamJson.session_id as string;

  let session_token: string | null = null;
  if (user && engineSessionId) {
    session_token = await mintSessionToken({
      sub:  user.id,
      jti:  engineSessionId,
      ns:   user.namespaceId ?? "default",
      org:  user.orgId ?? "default",
    });
  }

  return NextResponse.json(
    { ...upstreamJson, ...(session_token ? { session_token } : {}) },
    { status: upstream.status },
  );
}
// all other paths: streaming passthrough (unchanged)
return new Response(upstream.body, { ... });
```

Also adds `POST /api/kollabor/engine/sessions/:id/refresh-token` endpoint
that re-mints the token for a live session, gated on valid browser session.

### 5. `web/app/api/mentiko-mcp/stream/route.ts` (MODIFY)

```typescript
const sessionToken = new URL(req.url).searchParams.get("sessionToken");
const isDev = !process.env.DATABASE_URL;
let sessionId: string;

if (sessionToken) {
  try {
    const claims = await verifySessionToken(sessionToken);
    sessionId = claims.jti;
  } catch {
    return new NextResponse("Invalid session token", { status: 401 });
  }
} else if (isDev) {
  // dev fallback: no token required when DATABASE_URL not set
  sessionId = "global";
} else {
  // production: hard fail
  return new NextResponse("Unauthorized: session token required", { status: 401 });
}
```

Poll loop uses `popEffects(sessionId)`.

### 6. `web/app/api/mentiko-mcp/dispatch/route.ts` (MODIFY)

Extracts `sessionId` from body, passes to `pushEffect`:
```typescript
const { kind, payload, sessionId = "global" } = body;
pushEffect(kind, payload ?? {}, sessionId);
```

### 7. `web/app/api/mentiko-mcp/reply/route.ts` (MODIFY)

GET (MCP subprocess polling): reads sessionId from query param.
POST (browser answering): reads sessionId from JWT in Authorization header
OR from request body `sessionId` field.

Both `storeResult` and `consumeResult` take `(sessionId, toolId)`.

### 8. `web/components/floating-kollabor-bar.tsx` (MODIFY)

- On session create response: extract and store `session_token` in
  **sessionStorage** (not localStorage): `sessionStorage.setItem('mentiko-session-token', token)`
- On SSE connect: append `?sessionToken=<token>` to stream URL
- On token expiry (401 from stream or ops): call refresh-token endpoint,
  update sessionStorage, reconnect

### 9. `lib/mentiko-mcp/handlers/ops-client.ts` (REPLACE)

Remove `X-Mentiko-Inbox-Key`, `X-Mentiko-Namespace-Id`, `X-Mentiko-Org-Id`.
All data ops use Bearer token only. sessionId included for tracing.

```typescript
const SESSION_TOKEN = process.env.MENTIKO_SESSION_TOKEN;
const SESSION_ID    = process.env.MENTIKO_SESSION_ID || "";

function dataHeaders(): Record<string, string> {
  if (!SESSION_TOKEN) throw new Error("MENTIKO_SESSION_TOKEN not set — session auth required");
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${SESSION_TOKEN}`,
    "X-Mentiko-Session-Id": SESSION_ID,
  };
}
```

### 10. `lib/mentiko-mcp/dispatch.ts` (MODIFY)

Include `sessionId` in every dispatch so effects route to the right tab:
```typescript
body: JSON.stringify({ kind, payload, sessionId: SESSION_ID }),
```

### 11. Kollabor-engine (Python)

**sessions.py:** Accept `user_token` from request body. Read
`x-mentiko-session-token` header as fallback (proxy injects it). Store on
`EngineSession`.

**session.py:** `EngineSession.__init__` gains `user_token: Optional[str]`.
Passes `user_token` and `session_id` to `MCPIntegration` at construction.

**mcp_integration.py (kollabor-agent):** `MCPServerConnection.__init__` gains
`extra_env: dict = {}`. `connect()` merges into subprocess env:
```python
env = {**os.environ, **self.extra_env}
self.process = await asyncio.create_subprocess_exec(*cmd, ..., env=env)
```
`MCPIntegration` passes through `extra_env` from session context:
```python
extra_env={
    "MENTIKO_SESSION_TOKEN": self.user_token or "",
    "MENTIKO_SESSION_ID": self.session_id,
}
```

---

## Migration Sequence

All phases ship together — this is not an incremental rollout because
phases 1-3 were only needed to avoid a flag day with the old inbox-key
acceptance. Since we're building it right from the start, we ship the full
implementation and cut over in a single deploy.

Pre-deploy checklist:
- [ ] Kill any in-flight engine sessions before deploying (old MCP subprocesses
      send inbox-key, new ops routes reject it)
- [ ] Verify `BETTER_AUTH_SECRET` is set in all environments
- [ ] `npm install jose` committed to package.json
- [ ] Run `scripts/migrate-orphaned-org-data.sh` before deploying
- [ ] TypeScript build passes: `npx tsc --noEmit`
- [ ] Smoke test: create session → get session_token → stream connects →
      send message → tool runs → effect arrives in correct tab only

---

## Orphaned Data Migration

**file:** `scripts/migrate-orphaned-org-data.sh` (NEW)

Migrates data written to the UUID org path back to the namespace root.

```bash
#!/usr/bin/env bash
set -euo pipefail

UUID_PATH="$HOME/.mentiko/namespaces/default/orgs/a35de8e1-197e-4cdd-af8d-b1d0bd5c2538"
NS_PATH="$HOME/.mentiko/namespaces/default"

for dir in agents secrets agent-profiles config-profiles templates; do
  src="$UUID_PATH/$dir"
  dst="$NS_PATH/$dir"
  [ -d "$src" ] || continue
  mkdir -p "$dst"
  for item in "$src"/*/; do
    name="$(basename "$item")"
    if [ -e "$dst/$name" ]; then
      echo "SKIP (exists): $dir/$name"
    else
      cp -r "$item" "$dst/$name"
      echo "MOVED: $dir/$name"
    fi
  done
  # secrets: enforce 600 on migrated files
  if [ "$dir" = "secrets" ]; then
    find "$dst" -name "*.json" -exec chmod 600 {} \;
  fi
done

# single-file artifacts
for file in artifact-templates.json workspaces.json; do
  src="$UUID_PATH/$file"
  dst="$NS_PATH/$file"
  [ -f "$src" ] || continue
  if [ -e "$dst" ]; then
    echo "SKIP (exists): $file"
  else
    cp "$src" "$dst"
    echo "MOVED: $file"
  fi
done

echo "done. UUID path left in place — remove manually after verifying."
```

---

## Auth-Bridge Double-Lookup Fix

The slug fix (earlier in this session) added two `getFullOrganization()` calls
per authenticated request. Fix: deduplicate by having `getSessionUser` call
`getNamespaceFromSession` internally and pass the org object through, rather
than making a second lookup.

This is not blocking the security spec — session creates are low-frequency.
Filed as follow-up to land in the same PR.

---

## Subprocess Env Isolation (Deferred — Q3 target)

The MCP subprocess inherits the full engine process environment. Remediation:
build an env allowlist in `MCPServerConnection.connect()` that passes only
the explicitly needed vars:
- `MENTIKO_SESSION_TOKEN`
- `MENTIKO_SESSION_ID`
- `MENTIKO_INBOX_KEY`
- `MENTIKO_WEB_URL`
- `PATH`, `HOME`, `NODE_ENV`, and any vars the specific MCP server needs

This removes the blast radius of an RCE in an MCP tool. Target: Q3 2026.

---

## Complete Files Changed

web/TypeScript:
```
web/package.json                                            MODIFIED  (add jose explicitly)
web/lib/session-token.ts                                    NEW
web/lib/mentiko-mcp-ops-auth.ts                             REPLACED  (requireOpsAuth, audit log)
web/lib/mentiko-mcp-inbox.ts                                REPLACED  (per-session buffers+results, eviction)
web/app/api/kollabor/engine/[...path]/route.ts              MODIFIED  (mint token on session create)
web/app/api/kollabor/engine/sessions/[id]/refresh-token/route.ts  NEW
web/app/api/mentiko-mcp/stream/route.ts                     MODIFIED  (session-scoped SSE, prod hard-fail)
web/app/api/mentiko-mcp/dispatch/route.ts                   MODIFIED  (sessionId in pushEffect)
web/app/api/mentiko-mcp/reply/route.ts                      MODIFIED  (per-session results)
web/app/api/mentiko-mcp/ops/chains/route.ts                 MODIFIED  (requireOpsAuth)
web/app/api/mentiko-mcp/ops/agents/route.ts                 MODIFIED  (requireOpsAuth)
web/app/api/mentiko-mcp/ops/tasks/route.ts                  MODIFIED  (requireOpsAuth)
web/app/api/mentiko-mcp/ops/secrets/route.ts                MODIFIED  (requireOpsAuth)
web/app/api/mentiko-mcp/ops/files/route.ts                  MODIFIED  (requireOpsAuth)
web/app/api/mentiko-mcp/ops/fs/route.ts                     MODIFIED  (requireOpsAuth)
web/app/api/mentiko-mcp/ops/templates/route.ts              MODIFIED  (requireOpsAuth)
web/app/api/mentiko-mcp/ops/decisions/route.ts              MODIFIED  (requireOpsAuth)
web/app/api/mentiko-mcp/ops/decisions/answer/route.ts       MODIFIED  (requireOpsAuth)
web/app/api/mentiko-mcp/ops/decisions/approve/route.ts      MODIFIED  (requireOpsAuth)
web/app/api/mentiko-mcp/ops/decisions/select/route.ts       MODIFIED  (requireOpsAuth)
web/app/api/mentiko-mcp/ops/terminal/route.ts               MODIFIED  (requireOpsAuth)
web/app/api/mentiko-mcp/ops/notify/route.ts                 MODIFIED  (requireOpsAuth)
web/app/api/mentiko-mcp/ops/context/route.ts                MODIFIED  (requireOpsAuth)
web/app/api/mentiko-mcp/ops/context/activity/route.ts       MODIFIED  (requireOpsAuth)
web/app/api/mentiko-mcp/ops/context/runs/route.ts           MODIFIED  (requireOpsAuth)
web/app/api/mentiko-mcp/ops/context/runs/cancel/route.ts    MODIFIED  (requireOpsAuth)
web/app/api/mentiko-mcp/ops/context/user/route.ts           MODIFIED  (requireOpsAuth)
web/app/api/mentiko-mcp/ops/context/workspace/route.ts      MODIFIED  (requireOpsAuth)
web/app/api/mentiko-mcp/ops/context/workspaces/route.ts     MODIFIED  (requireOpsAuth)
web/app/api/mentiko-mcp/ops/meta/docs/route.ts              MODIFIED  (requireOpsAuth)
web/app/api/mentiko-mcp/ops/meta/nav/route.ts               MODIFIED  (requireOpsAuth)
web/app/api/mentiko-mcp/ops/meta/settings/route.ts          MODIFIED  (requireOpsAuth)
web/app/api/mentiko-mcp/ops/notifications/prefs/route.ts    MODIFIED  (requireOpsAuth)
web/app/api/mentiko-mcp/ops/system/cli-auth/route.ts        MODIFIED  (requireOpsAuth)
web/app/api/mentiko-mcp/ops/system/cli-status/route.ts      MODIFIED  (requireOpsAuth)
web/components/floating-kollabor-bar.tsx                    MODIFIED  (sessionStorage, token refresh)
scripts/migrate-orphaned-org-data.sh                        NEW
```

kollabor-cli/Python:
```
packages/kollabor-engine/src/kollabor_engine/routes/sessions.py   MODIFIED  (accept user_token)
packages/kollabor-engine/src/kollabor_engine/session.py            MODIFIED  (store user_token)
packages/kollabor-agent/src/kollabor_agent/mcp_integration.py      MODIFIED  (extra_env on subprocess)
```

mentiko-mcp/TypeScript:
```
lib/mentiko-mcp/handlers/ops-client.ts    REPLACED  (Bearer only, remove inbox key + namespace headers)
lib/mentiko-mcp/dispatch.ts               MODIFIED  (include sessionId)
```

---

## What This Does NOT Fix (Committed Timelines)

- **Subprocess env allowlist** (Q3 2026): MCP subprocess inherits full engine
  env. Remediation: explicit allowlist in `MCPServerConnection.connect()`.
- **Role scoping in token** (next sprint): Token carries no role claim. Ops
  routes don't check whether the authenticated user is read-only or admin.
- **Rate limiting on ops routes** (next sprint): Per-token throttle at
  `requireOpsAuth` to prevent runaway subprocesses or replayed tokens from
  DoS-ing the data layer.
- **GDPR erasure for audit logs** (Q3 2026): Audit log entries contain userId.
  Retention policy and right-to-erasure path needed before GA.
