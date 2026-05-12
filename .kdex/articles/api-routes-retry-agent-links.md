---
title: "API Routes: Retry & Agent Links"
type: component
linked_files:
  - web/app/api/retry/config/route.ts
  - web/app/api/retry/state/route.ts
  - web/app/api/retry/circuit/route.ts
  - web/app/api/links/[id]/route.ts
  - web/app/api/links/generate/route.ts
  - web/app/api/links/runs/[runId]/stop/route.ts
file_hashes:
  web/app/api/links/[id]/route.ts: sha256:8ab2bd2605238d12
  web/app/api/links/generate/route.ts: sha256:55ca21051fde93cb
  web/app/api/links/runs/[runId]/stop/route.ts: sha256:de3d0f6021df2a62
  web/app/api/retry/circuit/route.ts: sha256:a257d65910bd543b
  web/app/api/retry/config/route.ts: sha256:af34aa60fc8173f4
  web/app/api/retry/state/route.ts: sha256:0442ba027f32079e
tags: [api, retry, circuit-breaker, links, peer, routes]
created: 2026-04-07T09:43:42.055289
updated: 2026-04-07T09:43:42.055289
status: current
related: []
---

```yaml
---
title: API Routes: Retry & Agent Links
type: component
tags: api, retry, circuit-breaker, links, peer, routes
related: [[link-types]], [[link-utils]], [[retry-storage]]
---

## Overview

Two distinct API domains that share architectural patterns:

1. **Agent Links API** (`/api/links/*`) - Peer-to-peer agent collaboration with moderator relay
2. **Retry API** (`/api/retry/*`) - Circuit breaker and retry state management for chain execution

Both follow the same Next.js 13+ app router pattern: dynamic routes, RBAC permission checks via `requirePermission`, namespace/org-aware path resolution, and standardized error/response handling.

## Agent Links Routes

### GET/DELETE `/api/links/[id]`

Single link CRUD operations. Links are org-scoped definitions stored at `{orgRoot}/links/{id}/link.json`.

- **GET**: Loads and returns a link definition by ID
- **DELETE**: Removes a link definition from disk
- Permission: `view_chains` (GET), `manage_chains` (DELETE)
- Returns 404 if link doesn't exist via `NotFound` error class

```typescript
// Path resolution pattern used throughout
const linksDir = orgPath(namespaceId, orgId, "links");
const link = loadLink(linksDir, decodedId);
```

### POST `/api/links/generate`

AI-powered link generation from natural language prompts. Creates a background job that spawns a detached node process to run `job-runner.mjs`.

Flow:
1. Validate prompt parameter
2. Fetch all standalone agents for agent catalog
3. Resolve `link_generation` template with USER_PROMPT, AGENT_CATALOG, WORKSPACE_CONTEXT
4. Create job record
5. Spawn detached process with all MENTIKO_* env vars set
6. Return jobId immediately (async execution)

The detached process is unref'd so the parent can terminate without killing the job.

### POST `/api/links/runs/[runId]/stop`

Stops a running link run by killing PTY sessions via `bin/p` (pty-manager CLI).

Stopping sequence:
1. Validate runId format (`run-\d+`)
2. Load run.json, verify type === "link"
3. Kill sessions: managerSession + all agent sessions
4. Update run status to "stopped", propagate to agents
5. Return list of stopped session names

Uses `execFileSync` with timeout (5s) per session kill. Silent failures handled - session may already be dead.

## Retry Routes

Circuit breaker pattern prevents cascading failures by tracking per-agent failures and opening circuits after thresholds.

### GET `/api/retry/circuit?chainId=xxx&agent=yyy`

Query circuit state for a specific chain/agent pair. Returns open/closed state and last failure info.

Permission: `view_chains`

### POST `/api/retry/circuit/reset`

Manually reset a circuit to closed state. Used when the underlying issue is resolved.

Permission: `manage_chains`

### GET/POST/DELETE `/api/retry/config`

Per-chain retry configuration management. Config stored at `{orgRoot}/retry-configs/{chainId}.json`.

- **GET**: Retrieve retry config (maxAttempts, backoffBase, circuitThreshold, etc.)
- **POST**: Save/update retry config for a chain
- **DELETE**: Remove custom config, fall back to defaults

Permission: `view_chains` (GET), `manage_chains` (POST/DELETE)

### GET `/api/retry/state?runId=xxx` or `?chainId=xxx`

Query retry state - either specific run state or all states for a chain.

- With `runId`: returns single retry state document
- With `chainId`: lists all retry states for that chain across runs
- Useful for debugging why an agent was retried or circuit opened

Permission: `view_chains`

## Patterns

### Namespace-aware path resolution

All routes use the same pattern for org-scoped data:

```typescript
const namespaceId = getNamespaceIdFromRequest(request);
const orgId = getOrgIdFromRequest(request);
const dataDir = orgPath(namespaceId, orgId, "<entity>");
```

This ensures multi-tenant isolation - each org sees only its own data.

### RBAC permission gating

```typescript
const perm = await requirePermission(request, "permission_name");
if (perm) return perm;
```

Returns 403 if user lacks permission. View permissions (`view_chains`) for reads, manage permissions (`manage_chains`) for writes/deletes.

### Error response standardization

All routes wrapped in `withErrorHandling`, throw typed errors (`NotFound`, `BadRequest`, `Unauthorized`), return via `apiSuccess()` for happy path.

### Dynamic route params

Next.js 15 requires `await context.params` - params are now promises.

### Session validation

Link stop route validates session names against regex `/^[a-zA-Z0-9][a-zA-Z0-9\-_]{0,99}$/` before passing to `bin/p` to prevent injection.

## Gotchas

- Detached processes (link generation) must set ALL MENTIKO_* env vars explicitly - they don't inherit parent env
- Circuit breaker is per-chain-per-agent - same agent in different chains has separate circuit state
- Link kills are best-effort - already-dead sessions silently ignored
- `bin/p` is the pty-manager CLI at `{codeRoot}/bin/p` - not to be confused with peer binaries
- Route params must be `decodeURIComponent`'d - link IDs can contain special chars

## Dependencies

| Module | Purpose |
|--------|---------|
| `@/lib/rbac-auth` | Permission checking (`requirePermission`) |
| `@/lib/namespace-config` | Namespace/org ID extraction from request |
| `@/lib/config` | Path resolution (`orgPath`, `runsDir`, `binDir`) |
| `@/lib/link-utils` | Link loading/deletion (`loadLink`, `deleteLink`) |
| `@/lib/retry-storage` | Circuit/state/config CRUD |
| `@/lib/api-errors` | Typed error classes (`NotFound`, `BadRequest`, etc.) |
| `@/lib/api-response` | Response wrappers (`withErrorHandling`, `apiSuccess`) |
| `@/lib/agent-loader` | Fetch standalone agents for catalog |
| `@/lib/generation-template-storage` | Template retrieval for link generation |
| `bin/p` | PTY session management (create, remove, list) |
```