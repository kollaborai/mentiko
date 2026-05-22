# AI Gateway Prototype File Audit

## Control Plane

### Keep In Control Plane

- `/Users/malmazan/dev/platform/mentiko-control-plane/app/account/instances/[id]/ai-usage/page.tsx`
  - Account UI belongs in the control plane. Change its data source to gateway
    admin usage snapshots.
- `/Users/malmazan/dev/platform/mentiko-control-plane/app/api/account/instances/[id]/ai-usage/route.ts`
  - Account API belongs in the control plane. It should read from gateway admin
    API or a synchronized usage summary, not mutate request accounting.
- `/Users/malmazan/dev/platform/mentiko-control-plane/app/api/admin/tenants/[id]/ai-quota/route.ts`
  - Admin quota controls belong in the control plane. It should write effective
    policy to the gateway through service auth.
- `/Users/malmazan/dev/platform/mentiko-control-plane/components/ai-gateway/quota-card.tsx`
  - UI-only usage/quota display belongs in the control plane.
- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/ai-gateway/plan-catalog.ts`
  - Plan presets are control-plane policy. Gateway receives the effective quota
    policy, not billing plan semantics.
- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/ai-gateway/tenant-access.ts`
  - Keep the tenant bootstrap concept, but rewrite implementation to call the
    gateway admin token API.
- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/ai-gateway/ui-format.ts`
  - UI formatting belongs with control-plane/account UI.
- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/infra/cloud-init.ts`
  - Keep tenant env generation here, but point env at the external gateway
    domain and support existing-tenant env refresh.
- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/infra/provisioner.ts`
  - Keep provisioning orchestration here, but replace in-process token/table
    writes with gateway admin API calls.

### Move To Gateway Service

- `/Users/malmazan/dev/platform/mentiko-control-plane/app/api/ai-gateway/v1/[...path]/route.ts`
  - This is inference data plane and should not live in the admin/control app.
    Current status: prototype-only, blocked in production and behind
    `AI_GATEWAY_ALLOW_CONTROL_PLANE_PROTOTYPE=true`; keep hardened tests until
    the external gateway fully owns this surface, then retire it.
- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/ai-gateway/nonce-ledger.ts`
  - Runtime replay protection belongs in the gateway. First scalable target is
    Redis with TTL, not control-plane Postgres.
- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/ai-gateway/provider-adapter.ts`
  - Provider calls and provider secret handling belong in the gateway.
- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/ai-gateway/provider-catalog.ts`
  - Provider runtime catalog belongs in the gateway. Control plane can manage
    approved records through admin API.
- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/ai-gateway/provider-lease-store.ts`
  - Runtime provider concurrency belongs in the gateway. First scalable target
    is Redis leases/counters.
- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/ai-gateway/provider-store.ts`
  - Model/provider resolution belongs in the gateway hot path.
- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/ai-gateway/provider-settings.ts`
  - Split: control-plane UI metadata can stay, provider secrets and runtime
    config move to gateway.
- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/ai-gateway/quota-store.ts`
  - Reservation/commit/rollback is data-plane accounting.
- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/ai-gateway/quota.ts`
  - Quota decision logic belongs with gateway accounting.
- `/Users/malmazan/dev/platform/mentiko-control-plane/scripts/ai-gateway-seed-glm.ts`
  - Provider seed script is gateway ops.
- `/Users/malmazan/dev/platform/mentiko-control-plane/scripts/ai-gateway-smoke-glm.ts`
  - Real provider smoke belongs with gateway deployment verification.

### Split Into Shared Contract

- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/ai-gateway/gateway-auth.ts`
  - HMAC canonicalization must be shared. Signing client helpers can be shared
    with the platform; verification stays in gateway.
- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/ai-gateway/types.ts`
  - Split request/usage/admin DTOs into shared contract types; keep internal
    gateway persistence types inside the gateway.

### Replace Or Retire

- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/tenant-db.ts`
  - Current `ai_gateway_*` tables are prototype-owned by the control plane.
    Gateway-owned tables should move to gateway migrations. The control plane
    may keep cached usage summary fields if needed.
- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/control-plane-schema.ts`
  - Remove gateway-owned DDL from the control-plane schema check after gateway
    migrations exist.
- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/__tests__/ai-gateway-route-contract.test.ts`
  - Move to gateway service route tests.
- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/__tests__/ai-gateway-nonce-ledger.test.ts`
  - Move and rewrite for Redis TTL behavior.
- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/__tests__/ai-gateway-provider-adapter.test.ts`
  - Move to gateway service tests.
- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/__tests__/ai-gateway-provider-lease-store.test.ts`
  - Move and rewrite for Redis lease semantics.
- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/__tests__/ai-gateway-provider-store.test.ts`
  - Move to gateway service tests.
- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/__tests__/ai-gateway-quota-store.test.ts`
  - Move to gateway service tests.
- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/__tests__/ai-gateway-quota.test.ts`
  - Move to gateway service tests.
- `/Users/malmazan/dev/platform/mentiko-control-plane/lib/__tests__/ai-gateway-smoke-glm.test.ts`
  - Move to gateway service verification.

## Mentiko Platform

### Keep In Platform

- `/Users/malmazan/dev/platform/mentiko/web/lib/ai-gateway-client.ts`
  - Tenant runtime signing client belongs in the platform. Update it to target
    external gateway paths such as `https://ai.mentiko.com/v1`.
- `/Users/malmazan/dev/platform/mentiko/web/app/api/ai-gateway/local/v1/chat/completions/route.ts`
  - Local loopback compatibility proxy belongs in platform. It should stay
    small and only sign/forward; no provider secrets or quota logic.
- `/Users/malmazan/dev/platform/mentiko/web/lib/ai-gateway-local-proxy-env.ts`
  - Platform launch helper belongs in platform. It enables included AI only
    when tenant gateway config exists.
- `/Users/malmazan/dev/platform/mentiko/lib/ai-gateway-agent-env.sh`
  - Shell child-process env injection belongs in platform runtime.
- `/Users/malmazan/dev/platform/mentiko/lib/ai-gateway-agent-env.mjs`
  - JS child-process env injection belongs in platform runtime.
- `/Users/malmazan/dev/platform/mentiko/web/app/api/chains/run/route.ts`
  - Keep gateway env injection at run launch.
- `/Users/malmazan/dev/platform/mentiko/web/app/api/chains/run-batch/route.ts`
  - Keep gateway env injection at batch launch.
- `/Users/malmazan/dev/platform/mentiko/web/app/api/runs/[id]/resume/route.ts`
  - Keep gateway env injection on resume.
- `/Users/malmazan/dev/platform/mentiko/web/app/api/schedules/route.ts`
  - Keep gateway env injection for scheduled runs.
- `/Users/malmazan/dev/platform/mentiko/web/lib/job-runner-launch.ts`
  - Keep local proxy env construction at launch boundary.
- `/Users/malmazan/dev/platform/mentiko/web/lib/sanitize-output.ts`
  - Keep redaction for tenant gateway tokens and local proxy tokens.
- `/Users/malmazan/dev/platform/mentiko/lib/chain-runner.sh`
  - Keep providerless shell agent injection, but verify local/ssh/docker
    workspace behavior.
- `/Users/malmazan/dev/platform/mentiko/lib/job-runner.mjs`
  - Keep providerless PTY/job runner injection.
- `/Users/malmazan/dev/platform/mentiko/lib/chain-runner.mjs`
  - Keep providerless JS runner injection.
- `/Users/malmazan/dev/platform/mentiko/lib/pty-manager.mjs`
  - Keep platform PTY runtime support. It must resolve runtime dependencies from
    the packaged platform web dependency tree when invoked from repo-level JS
    runners.

### Keep Platform Tests

- `/Users/malmazan/dev/platform/mentiko/web/lib/ai-gateway-client.test.ts`
- `/Users/malmazan/dev/platform/mentiko/web/app/api/ai-gateway/local/v1/chat/completions/route.test.ts`
- `/Users/malmazan/dev/platform/mentiko/web/lib/ai-gateway-agent-env.test.ts`
- `/Users/malmazan/dev/platform/mentiko/web/lib/ai-gateway-agent-env-shell.test.ts`
- `/Users/malmazan/dev/platform/mentiko/web/lib/chain-runner-ai-gateway-source.test.ts`
- `/Users/malmazan/dev/platform/mentiko/web/lib/job-runner-ai-gateway-source.test.ts`
- `/Users/malmazan/dev/platform/mentiko/web/lib/job-runner-ai-gateway-source.test.ts`

These tests need path updates after the external gateway URL changes. They do
not prove production wiring by themselves.

## First Keeper Rule

Anything that handles provider master credentials, provider calls, runtime quota
mutation, nonce consumption, or provider concurrency is not control-plane code.
Anything that presents/administers tenant plans, usage, billing, or env
provisioning is control-plane code. Anything that launches tenant jobs or adapts
providerless child processes is platform code.
