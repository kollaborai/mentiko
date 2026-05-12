---
title: "API Routes: Events & Notifications"
type: component
linked_files:
  - web/app/api/events/route.ts
  - web/app/api/events/emit/route.ts
  - web/app/api/events/stream/route.ts
  - web/app/api/notifications/route.ts
  - web/app/api/notifications/email/send/route.ts
  - web/app/api/notifications/push/send/route.ts
  - web/app/api/notifications/push/subscribe/route.ts
  - web/app/api/notifications/preferences/route.ts
  - web/app/api/activity/route.ts
  - web/app/api/audit/route.ts
  - web/app/api/conversations/route.ts
  - web/app/api/conversations/[id]/route.ts
  - web/app/api/conversations/[id]/steer/route.ts
  - web/app/api/conversations/find-by-agent/route.ts
file_hashes:
  web/app/api/activity/route.ts: sha256:34d18699662cdc21
  web/app/api/audit/route.ts: sha256:747d92bd418b8c3f
  web/app/api/conversations/[id]/route.ts: sha256:50956c9a916ff8bd
  web/app/api/conversations/[id]/steer/route.ts: sha256:50bbc550a338aa77
  web/app/api/conversations/find-by-agent/route.ts: sha256:0902f0f35de4e747
  web/app/api/conversations/route.ts: sha256:37a0ed17e34d98a1
  web/app/api/events/emit/route.ts: sha256:8ce016eb9331a2ac
  web/app/api/events/route.ts: sha256:0411698f766020ec
  web/app/api/events/stream/route.ts: sha256:5b390bfe4ad7d8e6
  web/app/api/notifications/email/send/route.ts: sha256:48f3d97550681888
  web/app/api/notifications/preferences/route.ts: sha256:0c7ed9c9cc82f19e
  web/app/api/notifications/push/send/route.ts: sha256:04b45bd97c54b804
  web/app/api/notifications/push/subscribe/route.ts: sha256:e000922c3f88e66b
  web/app/api/notifications/route.ts: sha256:d0065eb1ef2b3b54
tags: [api, events, notifications, conversations, activity, routes]
created: 2026-04-07T09:42:55.505717
updated: 2026-04-07T09:42:55.505717
status: current
related: []
---

```yaml
---
title: API Routes: Events & Notifications
type: component
tags: [api, events, notifications, conversations, activity, routes, streaming]
related: [[namespace-config]], [[pty-client]], [[api-auth]]
---
```

## overview

this collection of API routes handles:
- activity feed aggregation (runs, agents, events)
- conversation listing and retrieval from jsonl files
- agent session steering (sending messages to live pty sessions)
- event emission and streaming (server-sent events)
- notification storage and delivery (email, push)
- audit log querying

the routes are next.js app router API handlers, all marked with `export const dynamic = "force-d-dynamic"` to bypass static optimization.

## key interfaces

### activity API

```
GET /api/activity?limit=100&filter=all
```

returns unified activity feed aggregating:
- chain lifecycle events (started, completed, failed) from runs/
- agent lifecycle events from agent state files (.state)
- schedule triggers and system events from events/

response:
```typescript
{
  events: ActivityEvent[]  // sorted by timestamp desc
}
```

### conversation API

```
GET /api/conversations?cwd=/path&limit=20&countAll=false
GET /api/conversations/[id]?mode=tail&tail=50
PUT /api/conversations/[id]  // update slug/title
DELETE /api/conversations/[id]
GET /api/conversations/find-by-agent?name=Solutions+Architect&runId=xxx&agentId=yyy
POST /api/conversations/[id]/steer  // send message to live session
```

conversation summary:
```typescript
interface ConversationSummary {
  sessionId: string
  slug: string
  startTime: string
  lastModified: string
  sizeKb: number
  messageCount: number
  firstMessage: string
  agentRole: string
}
```

### event streaming

```
GET /api/events/stream?run-id=run-xxx
```

returns server-sent events stream for real-time updates:
- `session_status` - agent state changes
- `agent_complete` - agent finished
- `chain_complete` - chain finished
- `job_status` - background job updates
- `keepalive` - connection keepalive

### notifications

```
GET /api/notifications?filter=unread
POST /api/notifications
PATCH /api/notifications  // markAllRead, clearAll
DELETE /api/notifications?id=xxx
POST /api/notifications/email/send
GET/PATCH /api/notifications/preferences
```

notification types:
```typescript
type NotificationType =
  | "agent_complete" | "agent_error"
  | "chain_complete" | "chain_failed" | "chain_started"
  | "webhook_failed" | "webhook_delivered"
  | "job_started" | "job_complete" | "job_failed"
  | "info" | "warning" | "error"
```

## how it works

### activity aggregation

the activity route reads three sources:

1. **run.json files** - parses chain runs, extracts:
   - chain_started from run.started
   - chain_completed/chain_failed from run.completed + status
   - agent events from run.agents array

2. **.state files** - parses key:value state files:
   ```
   status:completed
   session:mentiko-xxx
   agent_id:solutions-architect
   started:2026-04-07T...
   completed:true
   ```

3. **.event/.md files** - parses event format:
   ```
   event: schedule_triggered
   timestamp: 2026-04-07T...
   data: chain-name
   ```

all events get a generated id (timestamp-random), are sorted by timestamp desc, then filtered by type.

### conversation parsing

jsonl files (claude conversation format) are line-delimited JSON. each line:
```typescript
{
  type: "user" | "assistant",
  sessionId: string,
  slug: string,
  timestamp: string,
  message: {
    content: string | ContentBlock[]
  }
}
```

content blocks:
- `text` - plain message text
- `tool_use` - agent tool invocation (name, input, id)
- `tool_result` - tool output (content, id)

the parser extracts:
- summary from first 50 lines (slug, messageCount, firstMessage, agentRole)
- full message count via second pass if countAll=true
- tail mode streams last N messages for live watching

### agent steering

steering sends a message to the correct live pty session:

1. extract conversation metadata (slug, agentRole) from jsonl
2. list active pty sessions via pty-client
3. match session using priority:
   - exact sessionId match
   - starts with sessionId
   - contains sessionId
   - contains slug
   - contains agent role

4. if no match, spawn new session with `claude --resume <id>`
5. send message via `pty.sendKeys()`

### event streaming

uses node.js `fs.watch()` on three directories:
- stateDir/ - watches .state files for agent completion
- eventsDir/ - watches .event/.md files for system events
- jobsDir/ - watches .json files for job status changes

each watcher dedupes events using lastStates/lastEvents sets, sends sse on change.

plus a 2s poll on run.json for chain status (completed/failed).

## patterns

### file-based state

most data is read from files, not a database:
- runs/{runId}/run.json - chain execution state
- state/{agent}.state - agent status files
- events/{source}-{event}.event - event queue
- conversations/{id}.jsonl - claude conversation history

### graceful degradation

all routes use try/catch with silent failure:
```typescript
try {
  const entries = readdirSync(dir)
  // process entries
} catch {
  // skip this source, continue with others
}
```

this allows partial results even if some sources are missing/corrupt.

### auth wrapper

every route uses:
```typescript
if (!(await checkAuth(request))) {
  throw new Unauthorized();
}
```

### namespace isolation

namespace/org comes from request headers:
```typescript
const namespaceId = getNamespaceIdFromRequest(request)
const orgId = getOrgIdFromRequest(request)
```

paths resolve via namespace-config:
```typescript
const namespaceConfig = await getNamespaceConfig()
const runsDir = namespaceConfig.runsDir
```

## gotchas

### jsonl parsing is expensive

conversation parsing scans entire file. countAll=true triggers second pass. for large conversations, this is slow. tail mode is faster for live updates.

### session matching fuzzy

steering matches sessions by substring, not exact. `solutions-architect` matches `mentiko-solutions-architect-reviewer`. can be ambiguous if multiple sessions have similar names.

### event streams can leak

the activeStreams map holds controller references. cleanup on abort is critical, otherwise connections accumulate.

### notification backfill

notifications are generated from runs if store is empty. actionUrl is backfilled if missing via resolveActionUrl(). this patches old notifications to have working links.

### push notifications are stubbed

push route uses in-memory storage (map). doesn't actually send webpush. would need vapid keys + web-push lib for production.

## dependencies

- lib/api-auth.ts - checkAuth()
- lib/namespace-config.ts - getNamespaceConfig(), namespace paths
- lib/config.ts - claudeProjectPath(), path resolution
- lib/pty-client.ts - pty.spawn(), pty.sendKeys(), listSessionNames()
- lib/api-response.ts - withErrorHandling(), apiSuccess()
- lib/api-errors.ts - error constructors (Unauthorized, BadRequest, etc)
- lib/notification-prefs.ts - loadPrefs(), savePrefs()
- lib/auth-bridge.ts - getSessionUser()