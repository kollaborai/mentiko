# rate limiting

enterprise-grade rate limiting on the /api/* surface.

## what's limited

all /api/* routes are rate-limited unless explicitly opted out.

limits (per-tenant and per-user):
  user:   120 req/min
  tenant: 600 req/min
  burst:  20 req per 10s spike

rate limits are checked in order: burst -> user -> tenant.
first failure returns 429.

## what's not limited

these routes bypass rate limiting:
  /api/events/stream   — SSE, rate limiting would break the stream
  /api/health          — load balancer probes
  /api/auth/*          — better-auth handles its own throttling
  websocket routes     — handled by ws layer

## 429 response

status: 429
header: Retry-After: N (seconds)
body:   { "error": "rate_limited", "retry_after_seconds": N }

## how it works

- in-memory sliding window (no redis needed for single-instance tenants).
- store is an interface (RateLimitStore) — swap to redis later.
- per-tenant: keyed on namespaceId from session.
- per-user: keyed on userId from session, or IP for unauthenticated requests.
- GC sweep every 60s removes stale buckets.

## tuning

limits are in web/lib/rate-limit.ts (LIMITS object).
adjust values and redeploy.

## monitoring

- 429 responses show up in access logs.
- X-RateLimit-* headers are NOT added by the edge middleware
  (to keep middleware cheap). route-level decorators in security.ts
  still add them for individual endpoints.

## files

  web/lib/rate-limit.ts       — store interface + in-memory impl + limits
  web/middleware.ts            — next.js edge middleware
  web/lib/__tests__/rate-limit-enterprise.test.ts — unit tests
