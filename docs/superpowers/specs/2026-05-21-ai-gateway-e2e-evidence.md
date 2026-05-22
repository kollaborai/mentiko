# AI Gateway E2E Evidence

## 2026-05-21 Current Gate

Status: blocked for normal hosted tenant users. The standalone gateway data
plane now has a real durable smoke, the platform local proxy has been verified
against that gateway in an isolated local runtime, and the platform job-runner
plus JavaScript chain-runner providerless child-process paths have been verified.
A full hosted tenant agent/chain run on `marco.mentiko.com` has not been
observed yet.

## 2026-05-21 Gateway Service Shell Smoke

Status: green for the local gateway service shell only. This proves the new
service boundary can accept admin token creation and signed `/v1` chat over HTTP
using the in-memory runtime. It does not prove production provider-backed tenant
agent wiring.

Additional gateway service hardening verified after the shell smoke:

- dev memory runtime is explicitly opt-in and blocked in `NODE_ENV=production`
- dev memory runtime now requires `NODE_ENV=development`, requires an explicit
  admin token, does not expose a token hint on health, and does not log tenant
  runtime tokens
- malformed admin quota policies are rejected at the gateway admin boundary
- OpenAI-compatible provider calls run through gateway-owned host allowlisting
  and secret-safe failure handling
- Postgres token and model resolver adapters live in the gateway service and
  avoid selecting token plaintext or provider secrets in lookup paths
- Postgres tenant/token/model adapters now target `gateway_*` tables, not the
  control-plane prototype `ai_gateway_*` tables
- Postgres quota-store contract reserves, commits, and rolls back usage against
  gateway-owned quota, period, reservation, and usage-event tables
- Postgres quota-store now owns `pool.connect()`/`release()` for each
  transaction so row locks, rollback, and commit run on one pinned client
- Gateway runtime factory now assembles tenant/token/model/quota stores,
  Redis nonce protection, and provider adapters behind the data-plane runtime
  interface
- HTTP server boot now goes through the runtime factory: explicit development
  memory mode is still supported, while non-memory mode requires Postgres,
  Redis, provider config JSON, and admin auth
- Gateway package now has a compiled deploy surface: `npm run build` emits
  `dist/http/server.js`, and `npm start` runs the compiled server
- `/health` remains liveness-only; `/ready` reports runtime/dependency
  readiness and returns non-200 when durable dependencies fail
- Durable runtime construction closes Postgres and Redis clients if provider
  validation or runtime assembly fails during startup
- Production admin API now has a gateway-owned Postgres runtime for tenant token
  minting, token revoke, tenant status updates, quota policy writes, and usage
  snapshots
- Durable gateway smoke now applies the gateway migration in Postgres, uses
  Redis nonce protection, starts the compiled production server, mints a tenant
  token through the admin API, runs a real signed z.ai GLM chat completion, and
  verifies usage increments through the admin usage endpoint
- Platform local proxy smoke now runs the current platform API route in an
  isolated local Next.js runtime, calls `/api/ai-gateway/local/v1/chat/completions`
  with the internal local proxy token, reaches the external gateway service, and
  verifies gateway usage increments
- Platform job-runner smoke now creates an isolated namespace with a
  providerless default agent profile, runs the real `lib/job-runner.mjs`, verifies
  inherited server provider credentials are stripped, uses the injected
  OpenAI-compatible local proxy env, reaches the external gateway service, and
  verifies gateway usage increments
- Platform chain-runner smoke now creates an isolated namespace with a
  providerless default agent profile, runs the real `lib/chain-runner.mjs`
  through `PtyManager`, verifies inherited server provider credentials are
  stripped, uses the injected OpenAI-compatible local proxy env, reaches the
  external gateway service, writes run artifacts, and verifies gateway usage
  increments
- The local proxy bearer sent to providerless agents is now a context-derived
  internal token, not the raw `BETTER_AUTH_SECRET`
- Shell gateway env export files now quote values before sourcing, so spaces,
  dollar signs, quotes, and command substitutions in local proxy tokens cannot
  execute or break startup
- Account/admin usage snapshots now expire stale reservations before reading
  usage so active request and reserved-token counters do not stay stuck until
  the next tenant request
- Gateway token and usage counters use Postgres `bigint` to avoid int4 overflow
  at scale while runtime parsing still requires JavaScript safe integers
- Enabled quota policies with empty model/use/license allowlists are rejected at
  the admin API boundary before creating gateway tenant rows
- Expired reservations are reclaimed before new reservations for the tenant,
  releasing reserved counters and active request slots
- Gateway migration adds DB-level non-negative and total-token consistency
  constraints for policy, usage periods, reservations, and usage events
- memory runtime enforces quota policy, monthly limits, model/license/use
  allowlists, and active-request concurrency
- chat handling reserves the larger of `max_tokens` and
  `max_completion_tokens`, normalizes both fields upstream, and checks tenant
  status before nonce consumption or provider execution
- Redis nonce store contract uses `SET NX PX` with hashed nonce keys and
  rejects expired nonce claims before writing
- provider response headers are allowlisted before returning to tenants
- replayed signed requests are rejected before provider execution
- quota reservations roll back when provider calls fail
- quota commit failures roll back active reservations so tenant concurrency is
  not left stuck after a successful provider call with failed accounting
- provider-reported output usage above the reserved output cap is rejected,
  rolled back, and retained on the failure usage event instead of being counted
  past the tenant cap
- provider-reported input usage is recorded exactly even when the request-size
  estimate was low; tokenizer-backed input estimation is still needed
- provider responses without trustworthy usage metadata fall back to the
  reserved token estimate; actual output enforcement still depends on either
  provider-reported usage or future stream/token counting
- successful provider calls are not mislabeled as provider failures if
  best-effort token timestamp updates fail after quota commit

Command:

```bash
cd /Users/malmazan/dev/platform/mentiko-ai-gateway
AI_GATEWAY_ADMIN_TOKEN=dev-admin-token \
AI_GATEWAY_PUBLIC_ORIGIN=http://127.0.0.1:4011/v1 \
  npm run dev
```

HTTP probe result:

```text
admin_status=200
token_id=tok_memory_runtime
gateway_url=http://127.0.0.1:4011/v1
chat_status=200
content_type=application/json
set_cookie=null
usage_status=200
usage: inputTokensUsed=7 outputTokensUsed=3 totalTokensUsed=10 requestsUsed=1
```

Latest `npm run dev` smoke after adding the dev-runtime tripwire:

```text
health.ok=true
gateway_url=http://127.0.0.1:4014/v1
chat_status=200
usage_status=200
usage: inputTokensUsed=7 outputTokensUsed=3 totalTokensUsed=10 requestsUsed=1
listener_after_cleanup=none
```

Latest smoke after quota output hard-cap cleanup:

```text
gateway_url=http://127.0.0.1:4015/v1
admin_status=200
chat_status=200
usage_status=200
usage: inputTokensUsed=7 outputTokensUsed=3 totalTokensUsed=10 requestsUsed=1
activeRequests=0
listener_after_cleanup=none
```

Latest smoke after reviewer-accounting cleanup:

```text
gateway_url=http://127.0.0.1:4016/v1
admin_status=200
chat_status=200
usage_status=200
usage: inputTokensUsed=7 outputTokensUsed=3 totalTokensUsed=10 requestsUsed=1
activeRequests=0
listener_after_cleanup=none
```

Latest smoke after server runtime bootstrap:

```text
runtime=dev-memory
gateway_url=http://127.0.0.1:4017/v1
health_status=200
admin_status=200
chat_status=200
usage_status=200
usage: inputTokensUsed=7 outputTokensUsed=3 totalTokensUsed=10 requestsUsed=1
activeRequests=0
listener_after_cleanup=none
```

Latest compiled server smoke:

```text
command=npm run build && npm start
runtime=dev-memory
gateway_url=http://127.0.0.1:4018/v1
health_status=200
ready_status=200
ready: runtime=ok
admin_status=200
chat_status=200
usage_status=200
usage: inputTokensUsed=7 outputTokensUsed=3 totalTokensUsed=10 requestsUsed=1
activeRequests=0
listener_after_cleanup=none
```

Latest compiled server smoke after durable admin runtime:

```text
command=npm run build && npm start
runtime=dev-memory
gateway_url=http://127.0.0.1:4019/v1
ready_status=200
ready: runtime=ok
admin_status=200
quota_status=200
chat_status=200
usage_status=200
usage: inputTokensUsed=7 outputTokensUsed=3 totalTokensUsed=10 requestsUsed=1
activeRequests=0
listener_after_cleanup=none
```

Latest durable gateway smoke:

```text
command=npm run smoke:durable
runtime=production
ready_status=200
ready: postgres=ok redis=ok
provider=z.ai
model=glm-4.7
provider_secret_source=.kollab/config.json
chat_status=200
provider_usage: prompt=12 completion=16
gateway_usage: requests=1 input=12 output=16 total=28 active=0
schema=ai_gateway_smoke_1779403432960
```

Latest platform local proxy smoke:

```text
gateway command:
  npm run smoke:durable -- --skip-chat --write-env /tmp/mentiko-ai-gateway-platform-smoke.env --hold-ms 180000
platform runtime:
  isolated temp copy of /Users/malmazan/dev/platform/mentiko/web
  npm run dev:next -- --port 3047 --webpack
script:
  node scripts/ai-gateway-e2e-agent-smoke.mjs --tenant local --tenant-url http://127.0.0.1:3047
result:
  local_proxy_chat=200
  model=glm-4.7
  usage_before: requests=0 total=0
  usage_after: requests=1 total=28
  usage_delta: requests=1 total=28
  status=platform_proxy_chat_ok
cleanup:
  gateway listener stopped
  platform test listener stopped
```

Latest providerless job-runner + chain-runner smoke:

```text
gateway command:
  npm run smoke:durable -- --skip-chat --write-env /tmp/mentiko-ai-gateway-platform-smoke.env --hold-ms 300000
platform runtime:
  isolated temp copy of /Users/malmazan/dev/platform/mentiko/web
  npm run dev:next -- --port 3047 --webpack
script:
  node scripts/ai-gateway-e2e-agent-smoke.mjs --tenant local --tenant-url http://127.0.0.1:3047 --job-runner --chain-runner
result:
  local_proxy_chat=200
  proxy_usage_delta: requests=1 total=28
  job_runner_exit=0
  job_runner_status=complete
  job_runner_agent=providerless-job-runner
  job_usage_delta: requests=1 total=32
  chain_runner_exit=0
  chain_runner_status=completed
  chain_runner_agent_status=completed
  chain_runner_agent=providerless-chain-runner
  chain_usage_delta: requests=1 total=29
  status=providerless_job_runner_ok
  status=providerless_chain_runner_ok
  status=platform_proxy_chat_ok
cleanup:
  gateway listener stopped
  platform test listener stopped
  temp smoke env and temp platform runtime removed
```

Test evidence:

```bash
cd /Users/malmazan/dev/platform/mentiko-ai-gateway
npm test
npm run typecheck
```

Result:

```text
tests=63 pass=63 fail=0
typecheck=pass
build=pass
```

## 2026-05-21 Control-Plane Boundary Hardening

Status: green for local route and helper tests. This prevents the account/admin
quota APIs from silently reading or writing prototype control-plane gateway
tables when gateway admin config is missing. Prototype fallback now requires
`AI_GATEWAY_ALLOW_CONTROL_PLANE_PROTOTYPE=true` and is blocked in production
token minting.

Commands:

```bash
cd /Users/malmazan/dev/platform/mentiko-control-plane
npm test -- lib/__tests__/ai-gateway-refresh-tenant-env.test.ts lib/__tests__/ai-gateway-admin-quota-route.test.ts lib/__tests__/ai-gateway-account-route.test.ts lib/__tests__/ai-gateway-tenant-access.test.ts lib/__tests__/cloud-init-tenant-env.test.ts lib/__tests__/ai-gateway-route-contract.test.ts lib/__tests__/ai-gateway-quota-policy-store.test.ts
npx eslint lib/ai-gateway/admin-client.ts lib/ai-gateway/tenant-access.ts 'app/api/admin/tenants/[id]/ai-quota/route.ts' 'app/api/account/instances/[id]/ai-usage/route.ts' scripts/ai-gateway-refresh-tenant-env.ts lib/__tests__/ai-gateway-refresh-tenant-env.test.ts lib/__tests__/ai-gateway-admin-quota-route.test.ts lib/__tests__/ai-gateway-account-route.test.ts lib/__tests__/ai-gateway-tenant-access.test.ts
npx tsc --noEmit --incremental false --pretty false
```

Result:

```text
control-plane tests=45 pass=45 fail=0
eslint=pass
typecheck=pass
```

Platform regression commands:

```bash
cd /Users/malmazan/dev/platform/mentiko/web
npm test -- lib/job-runner-launch.test.ts lib/ai-gateway-client.test.ts app/api/ai-gateway/local/v1/chat/completions/route.test.ts
npx eslint lib/job-runner-launch.test.ts lib/ai-gateway-client.ts lib/ai-gateway-client.test.ts app/api/ai-gateway/local/v1/chat/completions/route.ts app/api/ai-gateway/local/v1/chat/completions/route.test.ts
```

Result:

```text
platform tests=16 pass=16 fail=0
eslint=pass
```

Latest platform smoke-script checks:

```text
node --check scripts/ai-gateway-e2e-agent-smoke.mjs = pass
node --check lib/chain-runner.mjs = pass
node --check lib/pty-manager.mjs = pass
node --check scripts/durable-smoke.mjs = pass
platform proxy/env tests=37 pass=37 fail=0
control-plane gateway/cloud-init tests=30 pass=30 fail=0
gateway tests=63 pass=63 fail=0
gateway build=pass
gateway typecheck=pass
diff_check=pass
```

Reviewer finding update: the external gateway service now has real
Postgres/Redis/provider-backed gateway-level verification. This does not clear
the hosted tenant platform E2E gate. Provider callers are currently assembled
from gateway-owned service env while provider/model metadata comes from
gateway-owned tables; a DB-backed provider/model admin surface remains pending.

### Probes

Control-plane public embedded route:

```bash
curl -s -o /tmp/mentiko_app_gateway_probe.txt -w '%{http_code}' \
  -X POST -H 'content-type: application/json' --data '{}' \
  https://app.mentiko.com/api/ai-gateway/v1/chat/completions
```

Result:

```text
404
```

Tenant local proxy route:

```bash
curl -s -o /tmp/mentiko_marco_local_gateway_probe.txt -w '%{http_code}' \
  -X POST -H 'content-type: application/json' --data '{}' \
  https://marco.mentiko.com/api/ai-gateway/local/v1/chat/completions
```

Result:

```text
404
```

Tenant token state:

```bash
./scripts/mk db "select t.slug, q.plan_id, q.enabled, count(tok.id) filter (where tok.status='active') as active_tokens, count(tok.id) filter (where tok.status='revoked') as revoked_tokens from tenant t left join ai_gateway_quota_policy q on q.tenant_id=t.id left join ai_gateway_token tok on tok.tenant_id=t.id where t.slug='marco' group by t.slug,q.plan_id,q.enabled;"
```

Result:

```text
marco | team | enabled | active_tokens=0 | revoked_tokens=1
```

Tenant runtime env:

```bash
sudo awk -F= '/^(TENANT_ID|MENTIKO_AI_GATEWAY_)/{print $1"=set"}' /etc/mentiko/marco.env
```

Result:

```text
TENANT_ID=set
```

### Blockers

- Public control-plane route is not deployed.
- Production `marco` tenant build does not expose the platform local proxy route.
- Production `marco` tenant has no gateway env vars.
- Production `marco` tenant has no active tenant gateway token.
- No full hosted tenant agent/chain run has been observed yet; local isolated
  platform proxy and providerless job-runner child-process paths have been
  verified against the external gateway.
- DB-backed provider/model admin endpoints are still pending; current provider
  caller config is gateway-owned service env, not control-plane hot-path code.
- `/Users/malmazan/dev/platform/mentiko-ai-gateway` is now initialized as its
  own local git repository with service ownership docs, CI, Dockerfile, locked
  checksum migrations, provider/model catalog seeding, and a migration upgrade
  path for the first local gateway DB shape. The gateway repo also has a
  publish-on-main GHCR workflow plus a control-plane overlay compose/Caddy
  deploy runbook, and CI validates the deploy compose overlay. Remote repository
  creation, initial push, image publication, and hosted deployment are still
  pending.
- Input token estimates are still request-size heuristics. Output requests are
  capped upstream and provider-reported overages are rejected, but missing or
  wrong provider usage metadata cannot prove actual output spend yet.

### Required Before Green

- External gateway service is deployed behind `/v1`.
- Control plane mints a tenant runtime token through gateway admin API.
- Hosted tenant env contains gateway URL, token ID, token, and tenant ID.
- Tenant platform build contains local proxy route and agent env helpers.
- Providerless agent call hits local proxy, reaches gateway, returns model output,
  and increments gateway usage.
