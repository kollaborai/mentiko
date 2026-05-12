---
title: "API Client & HTTP Layer"
type: component
linked_files:
  - web/lib/api.ts
  - web/lib/api-client.ts
  - web/lib/api-middleware.ts
  - web/lib/api-response.ts
  - web/lib/api-errors.ts
  - web/lib/api-metrics.ts
  - web/lib/websocket.ts
  - web/lib/webhook-storage.ts
  - web/lib/webhook-utils.ts
file_hashes:
  web/lib/api-client.ts: sha256:81996094a85eca2d
  web/lib/api-errors.ts: sha256:3b4798b1d4fd1957
  web/lib/api-metrics.ts: sha256:eb648b8f3d846c3e
  web/lib/api-middleware.ts: sha256:7fce20358898b864
  web/lib/api-response.ts: sha256:bcee701735a172df
  web/lib/api.ts: sha256:fcd68e6c7cdb0921
  web/lib/webhook-storage.ts: sha256:d9fc78fe916549e1
  web/lib/webhook-utils.ts: sha256:ea68f7b9ab43d50f
  web/lib/websocket.ts: sha256:6ecdc895ddb1b0bd
tags: [api, http, websocket, webhook, typescript]
created: 2026-04-07T09:41:12.409267
updated: 2026-04-07T09:41:12.409267
status: current
related: []
---

```yaml
---
title: API Client & HTTP Layer
type: component
tags: [api, http, websocket, webhook, typescript]
related: []
---

## overview

the http layer for mentiko's web ui. typed fetch wrappers, error handling, metrics, and realtime streaming. split into two concerns:

1. **server-side**: route handler utilities (api-response, api-errors, api-middleware, api-metrics) - used in `/api/*` route.ts files
2. **client-side**: api client (api.ts), websocket client, webhook utilities - used from react components

## key interfaces

### api-response (server)

`apiSuccess(data, requestId?, status?)` - wrap successful responses
`apiError(error, requestId?)` - convert errors to consistent json
`withErrorHandling(handler)` - route wrapper that adds timing, request ids, metrics

### api-errors (server)

typed error classes with http status codes:
- `BadRequest`, `Unauthorized`, `Forbidden`, `NotFound`
- `Conflict`, `ValidationError`, `RateLimitExceeded`
- `InternalServerError`, `ServiceUnavailable`, `Gone`

all extend `ApiError` base with `toJSON()` for consistent response shape.

### api-metrics (server)

in-memory per-endpoint metrics (p50/p95/p99 latency, call counts, error rate, slow log).
survives hot reloads via `globalThis` singleton. resets on server restart.

### api-client (client)

`unwrapApiData(payload)` - extract `{data}` wrapper or return payload as-is
`getApiErrorMessage(payload, fallback)` - extract error message from various shapes

### api.ts (client)

typed fetch wrappers organized by domain:
- `chainsApi` - list, get, run, save, validate, import, generate, versions, breakpoints, batch
- `agentsApi` - list, getOutput, deleteSession, sendMessage
- `runsApi` - list, get, compare
- `eventsApi` - list, stream
- `schedulesApi` - list, setEnabled, update, trigger
- `templatesApi` - list, getReadme, use, rate, getChain

### websocket.ts (client)

`WebSocketClient` class - eventsource (sse) client for `/api/events/stream`
`useWebSocket(options)` - react hook with auto-reconnect

### webhook-*.ts (server)

`webhook-storage` - file-based persistence for webhook subscriptions (encrypted secrets)
`webhook-utils` - fire-and-forget webhook delivery for chain events

## how it works

### server request flow

```
request arrives
  -> withErrorHandling wraps handler
  -> generate request id (x-request-id header)
  -> start timer
  -> handler executes
    -> throw new NotFound("Chain", id)  // or return apiSuccess(data)
  -> catch error -> apiError converts to json
  -> record timing to api-metrics
  -> add x-response-time header
  -> return response
```

### client request flow

```
component calls chainsApi.get(id)
  -> fetchJson adds base url, content-type
  -> fetch with timeout
  -> unwrapApiData extracts {data} wrapper
  -> throws ApiError if !res.ok
  -> returns typed data
```

### websocket flow

```
useWebSocket({ runId })
  -> creates WebSocketClient
  -> connects to /api/events/stream?run-id=xxx
  -> eventsource receives server-sent events
  -> parse and emit to listeners
  -> on "session_status" -> update agent state
  -> on "agent_complete" -> refresh run data
  -> on error -> exponential backoff reconnect
```

### webhook delivery

```
chain completes
  -> fireWebhooks(namespaceId, orgId, chainId, "completed", {runId})
  -> read chain.json metadata.webhooks
  -> filter enabled + matching events
  -> build payload with hmac signature
  -> fetch(url, {method: POST, signal: AbortSignal.timeout(10000)})
  -> fire-and-forget (logged but non-blocking)
```

## patterns

### consistent response shape

all api responses follow:
```typescript
// success
{ success: true, data: T, requestId: string }

// error
{ success: false, error: {code, message, details?}, requestId: string }
```

### error-first api routes

throw typed errors from handlers, let `withErrorHandling` convert:
```typescript
export const GET = withErrorHandling(async (req) => {
  const chain = await loadChain(id);
  if (!chain) throw new NotFound("Chain", id);
  return apiSuccess(chain);
});
```

### route collapsing for metrics

dynamic segments collapsed to normalize metrics:
- `/api/chains/abc123-def4` -> `/api/chains/[id]`
- `/api/chains/mentiko-2eb.18` -> `/api/chains/[id]`

prevents metric explosion from uuids/slugs.

### offline queue

mutating requests (post/put/patch/delete) queued when `!navigator.onLine`.
sync-queue adds request with retry config, replays on reconnect.

## gotchas

### api-client.ts vs api-errors.ts

two different `ApiError` classes:
- `api.ts` exports client-side `ApiError` (status, body, message)
- `api-errors.ts` exports server-side `ApiError` (code, statusCode, details)

don't confuse them - client catches server errors, server throws them.

### eventsource vs websockets

`websocket.ts` uses `EventSource` (sse), not actual websockets.
- server-sent events only (server -> client)
- no binary support
- auto-reconnect handled by browser

### metrics survive hot reloads

`globalThis.__apiMetrics` persists across next.js hot reloads in dev.
but full server restart clears everything - this is for dev diagnostics, not production monitoring.

### webhook secrets encrypted at rest

`webhook-storage` encrypts secrets before writing to disk.
`webhook-utils` reads plaintext from chain.json (metadata.webhooks).
two different webhook systems with different security models.

### request id propagation

`withErrorHandling` generates request id if missing, adds to response header.
client should read `x-request-id` from response for tracing.

## dependencies

- `next/server` - NextResponse, NextRequest for route handlers
- `crypto` - randomUUID for request ids, hmac for webhook signatures
- `fs/promises` - webhook storage file operations
- `sync-queue` - offline request queueing
- `config.ts` - orgPath for webhook file locations
- `secrets-store.ts` - encrypt/decrypt for webhook secrets

## related

none yet - this is a foundational layer.
```