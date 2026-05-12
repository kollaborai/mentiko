---
title: Event & Stream Management
type: component
tags: [events, streams, websocket, notifications, typescript]
related: []
---

# Event & Stream Management

## overview

central event and notification infrastructure for the mentiko platform. handles analytics tracking, in-memory event bus for pub/sub, push notifications, offline sync queue, and background process supervision.

### files

- `web/lib/analytics-events.ts` - centralized event definitions for analytics
- `web/lib/event-bus.ts` - in-memory pub/sub event system with history and replay
- `web/lib/platform-events.ts` - canonical registry of all platform events
- `web/lib/background-worker-state.ts` - filesystem state for background worker (pid, status)
- `web/lib/background-worker-control.ts` - worker lifecycle control (start, stop, status check)
- `web/lib/notification-server.ts` - server-side notification creation (fire-and-forget)
- `web/lib/push-notifications.ts` - web push API client with react hook
- `web/lib/sync-queue.ts` - offline request queue with localStorage persistence
- `web/lib/process-manager.ts` - platform supervisor (runs as pid 2, spawns all processes)

## analytics events

### Events constant

all event names defined in one place to avoid typos:

```typescript
export const Events = {
  pageView: "page_view",
  chainView: "chain_view",
  chainCreate: "chain_create",
  agentMessage: "agent_message",
  // ... 30+ events
} as const;
```

### track helpers

convenient typed functions for each event:

```typescript
track.chainView(id, name)           // params: chain_id, chain_name
track.chainRun(id, agentCount)      // params: chain_id, agent_count
track.agentMessage(sessionId, fromUser)  // params: session_id, from: "user"|"agent"
track.error(name, message, context?)     // params: error_name, message, context
```

## event bus

in-memory publish/subscribe system for frontend event coordination.

### event types

```typescript
type EventBusEventType =
  | "agent_started" | "agent_completed" | "agent_failed"
  | "chain_started" | "chain_completed"
  | "event_emitted" | "webhook_sent"
  | "*";  // wildcard

interface AgentStartedEvent {
  type: "agent_started";
  agentId: string;
  agentName: string;
  chainId?: string;
  input?: unknown;
}
```

### subscription

```typescript
const bus = getEventBus();

// subscribe to specific type
const unsub = bus.on("agent_started", (event) => { ... });

// wildcard - all events
bus.onAny((event) => { ... });

// filtered subscription
bus.onFiltered("agent_completed", { chainId: "foo" }, listener);

// multiple types
bus.onMany(["agent_started", "agent_failed"], listener);

// unsubscribe
unsub();  // or bus.off("agent_started", listener)
```

### publishing

```typescript
// generic publish
bus.publish<AgentStartedEvent>({
  type: "agent_started",
  agentId: "reviewer",
  agentName: "Code Reviewer",
  chainId: "code-review"
});

// convenience methods
bus.agentStarted("reviewer", "Code Reviewer", { chainId: "code-review" });
bus.agentCompleted("reviewer", "Code Reviewer", { durationMs: 12000 });
bus.chainCompleted("code-review", "Code Review", { durationMs: 45000 });
```

### history and replay

```typescript
// get history (filtered)
const events = bus.getHistory({ chainId: "foo", since: timestamp });

// replay for late subscribers
bus.replay({ filter: { chainId: "foo" }, limit: 100 });
bus.replaySince(timestamp);  // all events after timestamp

// snapshot/restore
const snap = bus.snapshot();
bus.restore(snap);
```

### stats

```typescript
bus.getStats()  // { totalEvents, listenerCount, eventsByType }
bus.hasListeners()
bus.getCount("agent_started")
```

## platform events registry

canonical catalog of all events emitted by the platform. single source of truth for plugins, webhooks, and triggers.

### event definition shape

```typescript
interface PlatformEventDefinition {
  name: PlatformEventName;           // "chain.started", "agent.completed"
  domain: PlatformEventDomain;       // "chain" | "agent" | "run" | "schedule" | ...
  description: string;
  emitters: string[];                 // what produces this event
  consumers: string[];                // what consumes this event
  payload: PlatformEventPayloadField[];
  example?: Record<string, unknown>;
}
```

### domains

- `chain` - chain lifecycle (started, completed, failed, stopped)
- `agent` - agent lifecycle (started, completed, failed, timed_out)
- `run` - run lifecycle (created, completed, stopped)
- `schedule` - scheduling (triggered, missed)
- `webhook` - inbound/outbound webhooks
- `task` - task store events
- `system` - system errors

### helpers

```typescript
getEventsByDomain("chain")      // all chain events
getEventDefinition("chain.started")  // single event def
getEventDomains()               // all unique domains
```

## background worker

managed by process-manager (not spawned from node). state stored in `config.stateDir`.

### state files

- `background-worker.pid` - process id
- `background-worker.json` - status (running/stopped, startedAt, uptime, lastCheck, etc)

### status interface

```typescript
interface BackgroundWorkerStatus {
  status: "running" | "stopped";
  pid?: number;
  startedAt?: string;
  uptime?: number;  // seconds
  lastCheck?: string;
  checkCount?: number;
  lastReconcile?: string;
  lastReconcileCleaned?: number;
  note?: string;
}
```

### operations

```typescript
// check current status
const status = checkBackgroundWorker();  // or getBackgroundWorkerStatus()

// stop the worker
await stopBackgroundWorker();  // throws if timeout (5s)
```

### lifecycle

- if pid file exists and process is alive → running
- if pid file exists but process dead → cleanup stale state, return stopped
- if no pid file → stopped

## notifications

### server-side creation

fire-and-forget notification creation from API routes. never throws.

```typescript
import { createNotification } from "@/lib/notification-server";

createNotification(namespaceId, {
  type: "chain_completed",
  title: "Code review finished",
  message: "All agents completed successfully",
  metadata: { chainId: "code-review", runId: "run_abc" }
});
```

stored in `namespaces/{id}/notifications/notifications.json`. max 200 notifications.

### push notifications

web push api client with react hook.

```typescript
function MyComponent() {
  const push = usePushNotifications();
  // push.supported, push.permission, push.subscribed, push.loading

  const request = () => push.requestPermission();  // Promise<NotificationPermission>
  const subscribe = () => push.subscribe();  // Promise<PushSubscription | null>
  const unsubscribe = () => push.unsubscribe();  // Promise<boolean>
}
```

requires:
- `NEXT_PUBLIC_VAPID_KEY` env var
- service worker registered
- notification permission granted

### local notifications

show notification without push subscription:

```typescript
import { showLocalNotification } from "@/lib/push-notifications";

showLocalNotification("Chain completed", {
  body: "Code review finished in 45s",
  icon: "/icon-192.png"
});
```

## sync queue

offline-first request queue with localStorage persistence.

```typescript
import { syncQueue } from "@/lib/sync-queue";

// add failed request
syncQueue.add({
  url: "/api/chains/run",
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ chainId: "foo" }),
  maxRetries: 3
});

// process queue on reconnect
const result = await syncQueue.process();
// { processed: 5, failed: 2, remaining: 3 }

// react hook
function MyComponent() {
  const { queue, size, processing, process, retry, clear } = useSyncQueue();
}
```

features:
- max 100 queued requests
- skips get/head requests on process
- retries up to maxRetries (default 3)
- subscribable for reactive updates

## process manager

platform supervisor running as pid 2 under tini. spawns and manages all platform processes (pty-mgr, ws-terminal, next.js, background-worker).

### config

reads `processes.json` (dev: `processes.dev.json` first):

```json
{
  "version": 1,
  "processes": [
    {
      "name": "pty-mgr",
      "cmd": "/opt/mentiko/bin/p",
      "args": ["daemon"],
      "readiness": { "type": "socket", "path": "$HOME/.pty-manager/socket" },
      "restart": { "enabled": true, "maxRestarts": 5 },
      "critical": true,
      "order": 1
    }
  ]
}
```

### readiness probes

- `none` - no check
- `timer` - wait fixed duration
- `socket` - check unix socket exists and connects
- `port` - check tcp port connects
- `http` - check http url returns 2xx

### startup order

topological sort based on `dependsOn` field. processes with `order` field sorted first.

### restart policy

exponential backoff with jitter:
- baseDelay * 2^restarts, capped at maxDelay
- jitter +/- 15% by default
- resets after `resetAfter` uptime (default 60s)
- maxRestarts before `failed` status

### graceful shutdown

on sigterm/sigint:
1. mark all processes as stopping
2. send sigterm, wait sigterm_wait (5s prod, 1.5s dev)
3. if still alive, send sigkill, wait sigkill_wait (2s prod, 0.5s dev)
4. hard timeout 15s prod / 10s dev → force exit

### ipc

unix socket at `~/.mentiko-pm/pm.sock`. newline-delimited json.

```typescript
// request
{ "id": "req-1", "cmd": "status" }
{ "id": "req-2", "cmd": "stop", "data": { "name": "pty-mgr" } }
{ "id": "req-3", "cmd": "start", "data": { "name": "foo", "cmd": "/bin/foo", "args": [], ... } }
{ "id": "req-4", "cmd": "restart", "data": { "name": "pty-mgr" } }
{ "id": "req-5", "cmd": "remove", "data": { "name": "foo" } }

// response
{ "id": "req-1", "ok": true, "data": { "processes": [...], "uptime": 12345, "version": 1 } }
{ "id": "req-2", "ok": false, "error": "process not found" }
```

## patterns

### type-safe event names

use `as const` on event name objects to get literal types for type safety:

```typescript
export const Events = { foo: "foo_event" } as const;
type EventName = typeof Events[keyof typeof Events];
```

### singleton with reset

global instance with reset function for testing:

```typescript
let globalInstance: EventBus | null = null;

export function getEventBus(options?: EventBusOptions): EventBus {
  if (!globalInstance) globalInstance = new EventBus(options);
  return globalInstance;
}

export function resetEventBus(): void {
  globalInstance = null;
}
```

### fire-and-forget

server-side notification creation wraps everything in try/catch and never throws:

```typescript
export function createNotification(...) {
  try {
    // ... create and persist
  } catch {
    // notification creation should never break the calling code
  }
}
```

### ssr-safe checks

guard browser apis with `typeof window !== "undefined"`:

```typescript
const PUSH_ENABLED = typeof window !== "undefined" &&
  "serviceWorker" in window.navigator &&
  "PushManager" in window;
```

## gotchas

### event bus is in-memory

history lost on page refresh. for persistent events, use platform events registry and store events to filesystem.

### sync queue skips get/head

get/head requests are not queued because they're idempotent and less critical. only mutator requests (post/put/delete/patch) are queued.

### process manager daemon fork

if process exits with code 0 during readiness check, pm assumes it's a daemon fork and tries to find the forked child pid via pgrep. this can be flaky if multiple processes match the pattern.

### push notification permission

permission must be requested from user gesture (click). cannot request on page load. use `requestNotificationPermission()` in a button click handler.

### background worker not spawned from node

managed by process-manager, not spawned directly from node code. status checks read pid file and verify process is alive via `process.kill(pid, 0)`.

### event bus wildcard

wildcard "*" listeners receive ALL events. use sparingly. prefer filtered subscriptions with specific types or filters.

### notification server max 200

old notifications dropped when limit exceeded. circular buffer (unshift new, splice old).
