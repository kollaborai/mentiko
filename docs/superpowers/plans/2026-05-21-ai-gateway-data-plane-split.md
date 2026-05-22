# AI Gateway Data Plane Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Mentiko included-AI from the control-plane prototype into an explicit gateway data-plane boundary that can scale independently.

**Architecture:** The control plane owns policy, tokens, provisioning, billing, and UI. The gateway service owns tenant request auth, replay protection, quota/concurrency, provider calls, streaming, and usage events. The platform owns only tenant runtime glue: local loopback proxy and providerless child-process env injection.

**Tech Stack:** TypeScript, Next.js control-plane and platform, Node.js gateway service, Postgres for durable accounting, Redis for hot nonce/quota/concurrency state.

## Progress Snapshot

- Task 1 is implemented and verified locally. Hosted tenant env now targets an
  external `/v1` gateway URL instead of a control-plane route.
- Task 2 is implemented and verified locally. Platform signing now targets
  external `/v1/chat/completions`.
- Task 3 is implemented as a gateway service shell and verified locally with
  admin token creation, signed chat, replay protection, quota rollback, header
  sanitization, admin policy validation, gateway-owned quota enforcement,
  OpenAI-compatible provider caller tests, Redis nonce-store contract, tenant
  status gate, gateway-owned Postgres tenant/token/model adapter contracts,
  gateway-owned Postgres quota-store contract, pinned transaction handling,
  expired reservation reclaim, provider-reported output overage rollback,
  failure usage evidence, durable runtime factory assembly, tests, and
  typecheck. The HTTP server now boots through the runtime factory and can only
  use memory mode in explicit development mode. Durable admin APIs now write to
  gateway-owned Postgres contracts for status, token mint/revoke, quota policy,
  and usage snapshots, including stale reservation reconciliation before usage
  reads. The compiled production gateway now has a real durable smoke using
  Postgres, Redis, and z.ai GLM with usage increment verification. DB-backed
  provider/model admin remains the next production slice.
- Task 4 is partially implemented and verified locally. Control-plane account
  and admin quota routes now require gateway admin config unless explicit
  non-production prototype fallback is enabled.
- Task 5 has dry-run inspection, pure helper tests, and a local isolated platform
  proxy smoke that sends a real OpenAI-compatible request through the platform
  local proxy into the external gateway and verifies usage increments. It now
  also has a providerless job-runner child-process smoke that exercises the real
  `lib/job-runner.mjs` env injection path plus a providerless JavaScript
  chain-runner smoke that exercises `lib/chain-runner.mjs` through `PtyManager`;
  both verify gateway usage increments. Full hosted tenant runtime verification
  on `marco.mentiko.com` is still pending.
- Real production tenant wiring is still blocked. The current green evidence is
  gateway data-plane plus local platform proxy evidence, not proof that
  `marco.mentiko.com` can run an agent through included AI.
- Gateway service ship ownership is no longer blocked locally:
  `/Users/malmazan/dev/platform/mentiko-ai-gateway` is initialized as its own
  git repository with service ownership docs, CI, Dockerfile, locked checksum
  migrations, provider/model catalog seeding, and a migration upgrade path for
  the first local gateway DB shape. The gateway repo also has a publish-on-main
  GHCR workflow plus a control-plane overlay compose/Caddy deploy runbook.
  CI validates the deploy compose overlay. Remote repository creation, initial
  push, image publication, and hosted deployment are still pending.

---

## File Structure

### Design And Coordination

- `/Users/malmazan/dev/platform/mentiko/docs/superpowers/specs/2026-05-21-ai-gateway-data-plane-design.md`
  - Corrected architecture spec and verification gates.
- `/Users/malmazan/dev/platform/mentiko/docs/superpowers/specs/2026-05-21-ai-gateway-prototype-file-audit.md`
  - Current file classification: keep, move, split, retire.
- `/Users/malmazan/dev/platform/mentiko/docs/superpowers/plans/2026-05-21-ai-gateway-data-plane-split.md`
  - This implementation plan.

### Control Plane

- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/ai-gateway/tenant-access.ts`
  - Change default gateway URL resolution from control-plane `/api/ai-gateway/v1` to external `/v1`.
- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/infra/cloud-init.ts`
  - Validate hosted gateway URLs ending in `/v1`, not control-plane `/api/ai-gateway/v1`.
- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/__tests__/ai-gateway-tenant-access.test.ts`
  - Verify external gateway URL default and no control-plane fallback.
- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/__tests__/cloud-init-tenant-env.test.ts`
  - Verify tenant env allows `/v1` and rejects old embedded control-plane path once migration is active.
- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/__tests__/cloud-init-image.test.ts`
  - Update generated env expectations to `/v1`.

### Platform

- `/Users/malmazan/dev/platform/mentiko/web/lib/ai-gateway-client.ts`
  - Validate external gateway `/v1` URL.
- `/Users/malmazan/dev/platform/mentiko/web/lib/ai-gateway-client.test.ts`
  - Verify signed requests go to `/v1/chat/completions`.
- `/Users/malmazan/dev/platform/mentiko/web/app/api/ai-gateway/local/v1/chat/completions/route.ts`
  - Keep local route unchanged; it signs and forwards to the external `/v1` gateway.

### Gateway Service

- `/Users/malmazan/dev/platform/mentiko-ai-gateway/package.json`
  - New service package shell.
- `/Users/malmazan/dev/platform/mentiko-ai-gateway/tsconfig.json`
  - TypeScript config for the gateway service.
- `/Users/malmazan/dev/platform/mentiko-ai-gateway/src/http/body.ts`
  - Streamed request body limit helper.
- `/Users/malmazan/dev/platform/mentiko-ai-gateway/src/http/server.ts`
  - Node HTTP service exposing `/health` and `/v1/chat/completions`.
- `/Users/malmazan/dev/platform/mentiko-ai-gateway/src/contracts/gateway-auth.ts`
  - Shared HMAC/token canonicalization contract copied from prototype without Next.js imports.
- `/Users/malmazan/dev/platform/mentiko-ai-gateway/src/contracts/types.ts`
  - Public tenant request and quota/usage DTOs.
- `/Users/malmazan/dev/platform/mentiko-ai-gateway/src/runtime/interfaces.ts`
  - Interfaces for token store, nonce store, quota store, model resolver, provider caller, and usage emitter.
- `/Users/malmazan/dev/platform/mentiko-ai-gateway/src/runtime/chat-completions.ts`
  - Framework-neutral data-plane handler.
- `/Users/malmazan/dev/platform/mentiko-ai-gateway/src/runtime/gateway-runtime.ts`
  - Durable runtime factory that composes Postgres stores, Redis nonce
    protection, quota transactions, and provider adapters.
- `/Users/malmazan/dev/platform/mentiko-ai-gateway/src/http/server-runtime.ts`
  - Server boot selector for explicit dev-memory mode vs durable runtime env.
- `/Users/malmazan/dev/platform/mentiko-ai-gateway/src/runtime/node-clients.ts`
  - Node Postgres and Redis client adapters for the durable runtime.
- `/Users/malmazan/dev/platform/mentiko-ai-gateway/src/runtime/postgres-admin-runtime.ts`
  - Gateway-owned admin runtime for token minting, quota policy writes, and
    usage snapshots.
- `/Users/malmazan/dev/platform/mentiko-ai-gateway/src/runtime/memory-runtime.ts`
  - Dev-only in-memory runtime used by the service shell tests.
- `/Users/malmazan/dev/platform/mentiko-ai-gateway/test/*.test.ts`
  - Node test runner tests for body limits, auth contract, and handler boundaries.

## Task 1: Stop Defaulting Hosted Tenants To Control Plane Route

**Files:**
- Modify: `/Users/malmazan/dev/platform/mentiko-control-plane/lib/ai-gateway/tenant-access.ts`
- Modify: `/Users/malmazan/dev/platform/mentiko-control-plane/lib/infra/cloud-init.ts`
- Modify: `/Users/malmazan/dev/platform/mentiko-control-plane/lib/__tests__/ai-gateway-tenant-access.test.ts`
- Modify: `/Users/malmazan/dev/platform/mentiko-control-plane/lib/__tests__/cloud-init-tenant-env.test.ts`
- Modify: `/Users/malmazan/dev/platform/mentiko-control-plane/lib/__tests__/cloud-init-image.test.ts`

- [ ] **Step 1: Write failing tests**

Update expectations so `AI_GATEWAY_PUBLIC_ORIGIN=https://ai.mentiko.com` resolves to:

```text
https://ai.mentiko.com/v1
```

Cloud-init tests should accept:

```text
MENTIKO_AI_GATEWAY_URL=https://ai.mentiko.com/v1
```

and reject:

```text
MENTIKO_AI_GATEWAY_URL=https://app.mentiko.com/api/ai-gateway/v1
```

- [ ] **Step 2: Run targeted tests and confirm failures**

```bash
cd /Users/malmazan/dev/platform/mentiko-control-plane
npm test -- lib/__tests__/ai-gateway-tenant-access.test.ts lib/__tests__/cloud-init-tenant-env.test.ts lib/__tests__/cloud-init-image.test.ts
```

Expected before implementation: tests fail on old `/api/ai-gateway/v1` path expectations.

- [ ] **Step 3: Implement URL contract**

In `tenant-access.ts`, default to `/v1` and require explicit gateway env:

```ts
return new URL("/v1", `${parsed.origin}/`).toString().replace(/\/$/, "");
```

In `cloud-init.ts`, require normalized path `/v1`:

```ts
if (normalizedPath !== "/v1") {
  throw new Error("MENTIKO_AI_GATEWAY_URL must use /v1");
}
```

- [ ] **Step 4: Run targeted tests**

```bash
cd /Users/malmazan/dev/platform/mentiko-control-plane
npm test -- lib/__tests__/ai-gateway-tenant-access.test.ts lib/__tests__/cloud-init-tenant-env.test.ts lib/__tests__/cloud-init-image.test.ts
```

Expected: all targeted tests pass.

## Task 2: Update Platform Gateway Client To External `/v1`

**Files:**
- Modify: `/Users/malmazan/dev/platform/mentiko/web/lib/ai-gateway-client.ts`
- Modify: `/Users/malmazan/dev/platform/mentiko/web/lib/ai-gateway-client.test.ts`

- [ ] **Step 1: Write failing tests**

Update test config:

```ts
gatewayUrl: "https://ai.mentiko.com/v1"
```

and expected signed request URL:

```text
https://ai.mentiko.com/v1/chat/completions
```

- [ ] **Step 2: Run targeted test and confirm failure**

```bash
cd /Users/malmazan/dev/platform/mentiko/web
npm test -- lib/ai-gateway-client.test.ts
```

Expected before implementation: validation rejects `/v1`.

- [ ] **Step 3: Implement URL validation**

Change the path guard:

```ts
if (parsed.pathname.replace(/\/$/, "") !== "/v1") return false;
```

- [ ] **Step 4: Run targeted test**

```bash
cd /Users/malmazan/dev/platform/mentiko/web
npm test -- lib/ai-gateway-client.test.ts
```

Expected: test passes.

## Task 3: Create Gateway Service Shell

**Files:**
- Create: `/Users/malmazan/dev/platform/mentiko-ai-gateway/package.json`
- Create: `/Users/malmazan/dev/platform/mentiko-ai-gateway/tsconfig.json`
- Create: `/Users/malmazan/dev/platform/mentiko-ai-gateway/tsconfig.build.json`
- Create: `/Users/malmazan/dev/platform/mentiko-ai-gateway/src/http/body.ts`
- Create: `/Users/malmazan/dev/platform/mentiko-ai-gateway/src/http/server-runtime.ts`
- Create: `/Users/malmazan/dev/platform/mentiko-ai-gateway/src/http/server.ts`
- Create: `/Users/malmazan/dev/platform/mentiko-ai-gateway/src/contracts/gateway-auth.ts`
- Create: `/Users/malmazan/dev/platform/mentiko-ai-gateway/src/contracts/types.ts`
- Create: `/Users/malmazan/dev/platform/mentiko-ai-gateway/src/runtime/interfaces.ts`
- Create: `/Users/malmazan/dev/platform/mentiko-ai-gateway/src/runtime/chat-completions.ts`
- Create: `/Users/malmazan/dev/platform/mentiko-ai-gateway/src/runtime/memory-runtime.ts`
- Create: `/Users/malmazan/dev/platform/mentiko-ai-gateway/test/gateway-auth.test.ts`
- Create: `/Users/malmazan/dev/platform/mentiko-ai-gateway/test/body.test.ts`
- Create: `/Users/malmazan/dev/platform/mentiko-ai-gateway/test/chat-completions.test.ts`

- [ ] **Step 1: Add package shell**

Create a private package with scripts:

```json
{
  "name": "mentiko-ai-gateway",
  "version": "0.1.0",
  "private": true,
    "type": "module",
    "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "dev": "NODE_ENV=development AI_GATEWAY_DEV_MEMORY_RUNTIME=true tsx src/http/server.ts",
    "start": "node dist/http/server.js",
    "typecheck": "tsc --noEmit",
    "test": "tsx --test test/*.test.ts"
  },
  "dependencies": {
    "ioredis": "^5",
    "pg": "^8"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/pg": "^8",
    "tsx": "^4.21.0",
    "typescript": "^5"
  }
}
```

- [ ] **Step 2: Add contract and runtime interfaces**

Copy the pure HMAC canonicalization/token hash behavior from the prototype into
`src/contracts/gateway-auth.ts`. Do not import from Next.js or the control
plane.

- [ ] **Step 3: Add request body limiter**

Implement a streamed body reader that rejects more than 1 MiB without depending
on `content-length`.

- [ ] **Step 4: Add framework-neutral chat handler**

The handler must:

- accept only `POST /v1/chat/completions`
- require tenant token, tenant id, token id, timestamp, nonce, and signature
- verify token hash/scope/status through a token store interface
- verify HMAC and nonce through a nonce store interface
- require a model string
- reserve quota through a quota store interface before provider call
- call a provider interface
- commit actual usage from provider response usage when present
- roll back reservation on provider failure

- [ ] **Step 5: Add dev server**

Expose:

```text
GET /health
POST /v1/chat/completions
```

with the memory runtime. The memory runtime is only for local contract tests.

- [ ] **Step 6: Run gateway tests**

```bash
cd /Users/malmazan/dev/platform/mentiko-ai-gateway
npm test
npm run typecheck
```

Expected: gateway service shell tests and typecheck pass.

## Task 4: Control-Plane Facade Boundary

**Files:**
- Create: `/Users/malmazan/dev/platform/mentiko-control-plane/lib/ai-gateway/admin-client.ts`
- Modify: `/Users/malmazan/dev/platform/mentiko-control-plane/lib/ai-gateway/tenant-access.ts`
- Modify: `/Users/malmazan/dev/platform/mentiko-control-plane/app/api/admin/tenants/[id]/ai-quota/route.ts`
- Modify: `/Users/malmazan/dev/platform/mentiko-control-plane/app/api/account/instances/[id]/ai-usage/route.ts`
- Add/modify tests under `/Users/malmazan/dev/platform/mentiko-control-plane/lib/__tests__/`

- [ ] **Step 1: Add gateway admin client contract**

The client reads:

```text
AI_GATEWAY_ADMIN_URL
AI_GATEWAY_ADMIN_TOKEN
AI_GATEWAY_PUBLIC_ORIGIN
```

and exposes:

```ts
createTenantRuntimeToken(tenantId: string): Promise<{ tokenId: string; token: string; gatewayUrl: string }>
setTenantQuotaPolicy(tenantId: string, policy: AiGatewayQuotaLimits): Promise<void>
getTenantUsage(tenantId: string): Promise<AiGatewayQuotaSnapshot>
```

- [ ] **Step 2: Update tenant access bootstrap**

Replace direct `ai_gateway_token` writes with admin client token creation. Keep
local fallback only behind:

```text
AI_GATEWAY_ALLOW_CONTROL_PLANE_PROTOTYPE=true
```

- [ ] **Step 3: Update quota and usage routes**

Admin/account routes should use the admin client when configured. Direct
control-plane table reads remain prototype fallback only.

- [ ] **Step 4: Run control-plane targeted tests**

```bash
cd /Users/malmazan/dev/platform/mentiko-control-plane
npm test -- lib/__tests__/ai-gateway-tenant-access.test.ts lib/__tests__/ai-gateway-account-route.test.ts lib/__tests__/ai-gateway-quota-policy-store.test.ts
```

Expected: tests pass with admin-client mocked.

## Task 5: Existing Tenant Runtime Refresh

**Files:**
- Create: `/Users/malmazan/dev/platform/mentiko-control-plane/scripts/ai-gateway-refresh-tenant-env.ts`
- Add test: `/Users/malmazan/dev/platform/mentiko-control-plane/lib/__tests__/ai-gateway-refresh-tenant-env.test.ts`

- [ ] **Step 1: Add dry-run first**

Script input:

```bash
npx tsx scripts/ai-gateway-refresh-tenant-env.ts --tenant marco --dry-run
```

Dry run prints whether the tenant has runtime gateway env in:

```text
/etc/mentiko/<slug>.env
systemd environment
podman container env
```

It must redact tokens.

- [ ] **Step 2: Add apply mode**

Apply mode writes or updates only:

```text
MENTIKO_AI_GATEWAY_ENABLED
MENTIKO_AI_GATEWAY_URL
MENTIKO_AI_GATEWAY_TOKEN_ID
MENTIKO_AI_GATEWAY_TOKEN
```

It does not overwrite unrelated tenant env.

- [ ] **Step 3: Verify against marco only after dry-run output is reviewed**

Run:

```bash
cd /Users/malmazan/dev/platform/mentiko-control-plane
npx tsx scripts/ai-gateway-refresh-tenant-env.ts --tenant marco --dry-run
```

Expected current evidence: missing gateway vars.

## Task 6: End-To-End Verification Gate

**Files:**
- Create: `/Users/malmazan/dev/platform/mentiko/scripts/ai-gateway-e2e-agent-smoke.mjs`
- Create: `/Users/malmazan/dev/platform/mentiko/docs/superpowers/specs/2026-05-21-ai-gateway-e2e-evidence.md`

- [ ] **Step 1: Add a platform smoke script**

The script must:

- launch or target a tenant platform runtime
- create a providerless agent/profile call
- verify child process receives `OPENAI_BASE_URL` pointing to local proxy
- make a real request
- read gateway usage before and after
- fail if usage does not increment

- [ ] **Step 2: Run local smoke**

```bash
cd /Users/malmazan/dev/platform/mentiko
node scripts/ai-gateway-e2e-agent-smoke.mjs --tenant marco --local
```

Expected before deployment/env refresh: fail with explicit missing runtime env
or missing deployed platform build.

- [ ] **Step 3: Record evidence**

Write exact commands, timestamps, tenant, model, usage before/after, and failure
or success reason to the evidence doc.

No user-facing claim of production wiring is allowed unless this gate succeeds.

## Task 7: Review And Regression

**Files:**
- All files touched above.

- [ ] **Step 1: Run targeted test suite**

```bash
cd /Users/malmazan/dev/platform/mentiko-control-plane
npm test -- lib/__tests__/ai-gateway-tenant-access.test.ts lib/__tests__/cloud-init-tenant-env.test.ts lib/__tests__/cloud-init-image.test.ts
cd /Users/malmazan/dev/platform/mentiko/web
npm test -- lib/ai-gateway-client.test.ts app/api/ai-gateway/local/v1/chat/completions/route.test.ts
cd /Users/malmazan/dev/platform/mentiko-ai-gateway
npm test
npm run typecheck
```

- [ ] **Step 2: Request reviewer agents**

Dispatch one architecture reviewer and one implementation reviewer. Required
focus:

- no provider calls in control-plane hot path
- no provider master secrets in tenant env
- platform self-hosting still works without Mentiko gateway
- `/v1` contract consistent across control-plane, gateway, and platform
- end-to-end evidence doc does not overclaim

- [ ] **Step 3: Fix critical and high findings**

Critical and high findings block any deployment or "wired" claim.

## Stop Rules

- Stop and report if applying env refresh would require overwriting unrelated
  tenant env lines.
- Stop and report if gateway provider credentials are not available in a
  gateway-owned service context.
- Stop and report if a real end-to-end call cannot be run because the tenant
  platform build is missing the local proxy route.
- Keep working on docs/tests/service split if production runtime is blocked.
