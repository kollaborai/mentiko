# AI Gateway Data Plane Design

## Status

This supersedes the prototype shape where `/api/ai-gateway/v1` lived inside the
Mentiko control plane Next.js app. That prototype proved the token, quota, model
catalog, and provider call concepts, but it is not the architecture to scale.

The corrected design has three separate products:

- Mentiko platform: tenant runtime and agent execution.
- Mentiko control plane: tenant/account/admin policy management.
- Mentiko AI gateway: stateless inference data plane.

## Correction From Current Prototype

The current prototype is not wired end to end in production. The standalone
gateway data plane now has a real Postgres/Redis/provider smoke, but the
production `marco` tenant does not currently have `MENTIKO_AI_GATEWAY_*` env
vars, and its deployed platform build does not include the local proxy route or
agent env helpers.

The current control-plane embedded route must be treated as a reference
implementation, not the final data-plane service.

## Goals

- Give hosted Mentiko tenants included AI without exposing provider master keys
  to tenant runtimes.
- Keep self-hosted Mentiko usable with no Mentiko-hosted AI dependency.
- Enforce tenant quotas, request caps, model allowlists, commercial-use rules,
  and concurrency before a provider call is made.
- Scale gateway traffic independently from admin/account UI traffic.
- Keep model catalogs, tool bundles, and agent profiles conceptually separate.
- Produce an end-to-end verification path that proves a normal agent run can use
  included AI before the feature is described as wired.

## Non-Goals

- The gateway is not a general reseller API for arbitrary third-party apps.
- The control plane is not the runtime inference proxy.
- The platform must not receive provider master credentials.
- Tool bundles and agent profiles are not part of the model catalog.

## Ownership Boundaries

### Mentiko Platform

The platform runs tenant workflows. It owns chains, agents, profiles, tool
bundles, local execution, schedule execution, and self-hosted provider config.

The platform may include a small local compatibility proxy:

- Input: OpenAI-compatible local requests from providerless child processes.
- Output: signed request to the external Mentiko AI gateway.
- Secret exposure: only tenant-scoped gateway token and internal local proxy
  token; never provider master keys.
- Self-hosting behavior: disabled unless gateway env/config is present.

If a profile, chain gateway, or self-hosted config contains an explicit provider
key, that explicit user/provider config wins over included AI.

### Mentiko Control Plane

The control plane manages policy and account state. It owns:

- Tenant AI plan selection and enable/disable state.
- Quota policy presets and per-tenant overrides.
- Tenant gateway token issuance, rotation, revocation, and env distribution.
- Admin/account UI for usage, limits, token status, and plan changes.
- Billing hooks and quota reset policy.
- Approved model catalog administration.
- Provider account configuration metadata, but not hot-path provider calls.

The control plane talks to the gateway through admin APIs and receives usage
summaries/events for UI and billing. It must not proxy tenant inference traffic.

### Mentiko AI Gateway

The gateway is the data plane. It owns:

- Tenant token authentication and request signature verification.
- Nonce/replay protection.
- Quota reservation, commit, rollback, and reservation expiry.
- Per-tenant and per-provider concurrency control.
- Model resolution from public model IDs to upstream provider models.
- Provider adapter execution and response streaming.
- Usage event emission and durable accounting.
- Operational metrics, rate limits, abuse controls, and circuit breakers.

The gateway should be stateless at the process level so it can run as N replicas
behind a load balancer.

## Service Topology

```text
tenant agent process
  -> platform local proxy (optional, loopback only)
  -> https://ai.mentiko.com/v1/chat/completions
  -> gateway replica
  -> redis reservation/concurrency gate
  -> provider adapter
  -> upstream model provider

control plane admin/account UI
  -> control plane API
  -> gateway admin API
  -> gateway postgres read/write model
```

## Data Stores

### Gateway Postgres

The gateway owns the hot accounting schema:

- `gateway_tenant`: tenant id, status, hosted/self-hosted flags, billing state
  mirror needed by the gateway.
- `gateway_token`: tenant-scoped token hash, prefix, scopes, status, expiry.
- `gateway_quota_policy`: current effective quota policy per tenant.
- `gateway_usage_period`: durable monthly counters.
- `gateway_reservation`: durable reservation lifecycle.
- `gateway_usage_event`: append-only request outcomes.
- `gateway_provider_config`: provider endpoint metadata and encrypted secret
  references.
- `gateway_model_catalog`: approved model records and legal/commercial flags.

The existing `ai_gateway_*` control-plane prototype tables can become the
initial migration source, but ownership moves to the gateway service.

### Gateway Redis

Redis handles fast-path, short-lived coordination:

- Per-token nonce TTL sets.
- Per-tenant active request counters.
- Per-provider concurrency buckets.
- Provider circuit breaker state.
- Short TTL quota reservation locks.

Redis is not the source of truth for billing. Postgres remains durable.

### Control Plane Postgres

The control plane stores account, tenant, billing, hosting, and admin UI state.
For AI usage it stores either:

- a read replica/materialized summary synchronized from gateway events, or
- cached usage snapshots fetched from gateway admin APIs.

It should not be the write owner for gateway request reservations.

## Request Flow

1. Platform starts an agent run.
2. If hosted gateway config exists and no explicit provider key is selected, the
   platform injects an OpenAI-compatible base URL/API key that points at the
   loopback local proxy.
3. The local proxy accepts loopback-only JSON requests with an internal token.
4. The local proxy signs the request using the tenant gateway token.
5. Gateway verifies token hash, tenant status, signature, timestamp, and nonce.
6. Gateway resolves the public model ID against the approved model catalog.
7. Gateway reserves quota and concurrency before contacting the provider.
8. Gateway calls the upstream provider adapter.
9. Gateway commits actual usage from provider usage metadata, rejects
   provider-reported output usage above the reserved output cap, or rolls back
   on rejected/failed requests.
10. Gateway emits usage events for control-plane UI, billing, and support.

## API Contracts

### Tenant Invoke API

Base URL:

```text
https://ai.mentiko.com/v1
```

Supported first endpoint:

```text
POST /v1/chat/completions
```

Required headers:

```text
authorization: Bearer mtk_ai_...
x-mentiko-ai-tenant-id: <tenant uuid>
x-mentiko-ai-token-id: tok_...
x-mentiko-ai-timestamp: <iso timestamp>
x-mentiko-ai-nonce: <uuid>
x-mentiko-ai-signature: <hmac sha256>
```

Compatibility rule:

- The tenant-facing path is OpenAI-compatible.
- Mentiko auth/signature headers are additive.
- Provider-specific upstream request transforms happen only inside the gateway.

### Gateway Admin API

The admin API is not public tenant runtime API. It is used by the control plane
with service-to-service auth.

Required endpoints:

- `PUT /admin/tenants/:tenantId/status`
- `PUT /admin/tenants/:tenantId/quota-policy`
- `POST /admin/tenants/:tenantId/tokens`
- `POST /admin/tokens/:tokenId/revoke`
- `GET /admin/tenants/:tenantId/usage`

Planned provider/model administration endpoints:

- `PUT /admin/providers/:providerId`
- `PUT /admin/models/:modelId`

Current bootstrap note: provider callers are assembled from gateway-owned
service env, while provider/model metadata is read from gateway-owned tables.
The DB-backed provider/model admin surface is not implemented yet.

## Scaling Model

The gateway scales horizontally:

- Gateway replicas are stateless.
- Redis absorbs concurrency/nonce/circuit-breaker coordination.
- Postgres is the durable accounting ledger.
- Provider adapters use per-provider timeout, concurrency, and circuit breaker
  settings.
- Control-plane UI traffic and gateway inference traffic have separate deploys,
  autoscaling, logs, and incident blast radius.

At 1,000 tenants, the expected bottlenecks are provider quota/concurrency and
durable accounting writes, not Next.js admin page rendering.

Mitigations:

- Batch or async-copy usage events to control-plane summaries.
- Keep reservation commits indexed by tenant/period/status.
- Use per-provider concurrency leases in Redis, not Postgres row contention.
- Add provider pools before tenant growth requires it.
- Prefer streaming pass-through with accounting hooks, not buffering entire
  responses.

## Self-Hosted Semantics

Self-hosted Mentiko has three valid states:

- No gateway: platform uses explicit profile/provider config only.
- External Mentiko gateway: tenant operator configures gateway URL/token.
- Private gateway: tenant operator runs their own gateway-compatible service.

The platform must not assume `ai.mentiko.com` exists. The control plane may
provision hosted tenants with that default, but platform code only reads config.

## Migration From Prototype

Keep:

- Platform local proxy pattern, with loopback-only and internal auth guard.
- Platform child-process env injection, with explicit provider keys winning.
- HMAC signed tenant request format.
- Quota reservation/commit/rollback model.
- Provider adapter contracts and model catalog metadata.
- Control-plane AI usage/account/admin UI concepts.

Move to gateway service:

- Public `/api/ai-gateway/v1` route implementation.
- Provider adapters and provider secret access.
- Nonce ledger.
- Quota reservation and usage ledger.
- Provider lease/concurrency logic.
- Runtime request logging and gateway metrics.

Remove from control-plane hot path:

- Tenant inference proxying.
- Provider upstream calls.
- Per-request quota mutations.
- Provider lease acquisition.

Add to control plane:

- Gateway admin client.
- Tenant token bootstrap/rotation using gateway admin API.
- Env/config refresh for existing hosted tenants.
- Usage snapshot read path from gateway admin API or event summaries.

## Verification Gates

No claim that included AI is wired until these pass:

1. Hosted tenant has `MENTIKO_AI_GATEWAY_ENABLED=true`, gateway URL, token ID,
   token, and tenant ID in its runtime env.
2. Deployed tenant platform build contains the local proxy route and agent env
   helper.
3. A providerless profile/agent run makes a real OpenAI-compatible request to
   the platform local proxy.
4. The local proxy signs and forwards to the external gateway service.
5. Gateway returns a real provider response.
6. Tenant usage increments in gateway accounting.
7. Control-plane account AI usage view reflects the same usage.
8. Explicit provider-key profiles still bypass included AI.
9. Self-hosted/no-gateway config runs without hidden Mentiko dependency.

## Initial Implementation Slices

1. Write an audit that classifies current prototype files as keep, move, or
   remove.
2. Extract pure gateway modules into a service-neutral package/folder without
   Next.js imports.
3. Add a gateway service shell that exposes `/v1/chat/completions`.
4. Point control-plane provisioning at the external gateway URL/token admin
   contract, not an in-app route.
5. Keep platform local proxy but point it at the external gateway base URL.
6. Add an existing-tenant env refresh/redeploy path.
7. Run the end-to-end agent verification gate against a real model.

## Open Decisions

- Whether the gateway service lives in a new repository or a new top-level
  workspace under `/Users/malmazan/dev/platform`.
- Whether the first deployment uses the same Postgres server with separate
  gateway credentials or a dedicated gateway Postgres instance.
- Whether gateway usage snapshots are pulled by the control plane or pushed by
  gateway event workers.
