---
title: React Hooks
type: component
linked_files:
  - web/hooks/use-agents.ts
  - web/hooks/use-analytics.ts
  - web/hooks/use-breakpoints.ts
  - web/hooks/use-chain-version-control.ts
  - web/hooks/use-csrf.ts
  - web/hooks/use-debug.ts
  - web/hooks/use-email-poller.ts
  - web/hooks/use-email-unread-count.ts
  - web/hooks/use-event-stream.ts
  - web/hooks/use-events.ts
  - web/hooks/use-job-status.ts
  - web/hooks/use-notifications-listener.ts
  - web/hooks/use-online-status.ts
  - web/hooks/use-runs.ts
  - web/hooks/use-start-page-data.ts
  - web/hooks/use-theme.ts
  - web/hooks/use-translation.ts
  - web/hooks/use-websocket.ts
  - web/hooks/use-chains.ts
  - web/hooks/use-global-search.ts
  - web/hooks/index.ts
file_hashes:
  web/hooks/index.ts: sha256:d427fee747893d8a
  web/hooks/use-agents.ts: sha256:b182ee16d16b82d7
  web/hooks/use-analytics.ts: sha256:ad69ff37054f9a87
  web/hooks/use-breakpoints.ts: sha256:0f32e5939bb17bbd
  web/hooks/use-chain-version-control.ts: sha256:6cee22bcd43778f9
  web/hooks/use-chains.ts: sha256:a79fccf6b2ae87f4
  web/hooks/use-csrf.ts: sha256:9a18d592f0f71613
  web/hooks/use-debug.ts: sha256:0fc0f155d3bcf83d
  web/hooks/use-email-poller.ts: sha256:d6b553f5c85cc8ab
  web/hooks/use-email-unread-count.ts: sha256:ead85f39c35acafa
  web/hooks/use-event-stream.ts: sha256:26b3df67010e783a
  web/hooks/use-events.ts: sha256:8700d4b99327b374
  web/hooks/use-global-search.ts: sha256:9711095c396ec74d
  web/hooks/use-job-status.ts: sha256:476138f3a5cd50ca
  web/hooks/use-notifications-listener.ts: sha256:d99a4f1d8db4d07c
  web/hooks/use-online-status.ts: sha256:abaef43d221409f1
  web/hooks/use-runs.ts: sha256:dde109e9d6c692a1
  web/hooks/use-start-page-data.ts: sha256:3341bac63ae7d81f
  web/hooks/use-theme.ts: sha256:89d9a80b241ec254
  web/hooks/use-translation.ts: sha256:dd24576111a801db
  web/hooks/use-websocket.ts: sha256:afea6173b7bf9d8c
tags: [hooks, react, websocket, events, typescript]
created: 2026-04-07T09:43:20.811303
updated: 2026-04-07T09:43:20.811303
status: current
related: []
---

```yaml
---
title: React Hooks
type: component
tags: hooks, react, websocket, events, typescript
related: []
---

## Overview

The React hooks directory provides data fetching, real-time updates, and state management for the Mentiko web UI. All hooks are client-side ("use client") and follow consistent patterns for API communication, polling, and WebSocket connections.

## Key Hooks

### Core Data Hooks

- `useAgents()` - Active PTY agent sessions with polling (default 5s)
- `useChains()` - Chain definitions with optional polling
- `useRuns(chainId?, limit, pollInterval)` - Chain execution history
- `useEvents(dir?, pollInterval)` - Event log viewer

### Real-time Hooks

- `useWebSocket(options)` - WebSocket client for live run updates
- `useEventStream(runId)` - Server-sent events for run completion
- `useJobStatus(jobId)` - Background job status with SSE + polling fallback
- `useNotificationsListener()` - Global notification system (webhooks, runs, jobs)

### Git/Version Control

- `useChainVersionControl(chainId)` - Full git operations (init, commit, branches, merge, diff)
- `useChainVersions(chainId)` - Non-git versioning (create, restore, diff)

### Debug/Breakpoints

- `useBreakpoints(chainId, pollInterval)` - Chain breakpoints for debugging
- `useDebug(chainId, pollInterval)` - Alias for breakpoint management

### Utility Hooks

- `useGlobalSearch()` - Cmd+K search (pages, chains, agents, runs, tasks)
- `useOnlineStatus()` - Network online/offline detection
- `useTheme()` - Dark/light theme wrapper around next-themes
- `useCsrfToken()` - CSRF token from cookies
- `useEmailPoller()` - Email processing poller
- `useEmailUnreadCount()` - Unread email counts
- `useStartPageData(enabled)` - Dashboard attention/happening/gone sections
- `useAnalytics` hooks - Event tracking (useTrackEvent, useTrackClick, useTrackForm, etc.)
- `useTranslation()` - i18n translations

## Patterns

### Namespace Fetching

All API calls use `useNamespaceFetch()` for multi-tenancy:

```typescript
const { fetchWithNamespace } = useNamespaceFetch();
const res = await fetchWithNamespace("/api/chains/list");
```

### Response Unwrapping

API responses are wrapped in `{ data: {...} }` structure:

```typescript
import { unwrapApiData } from "@/lib/api-client";
const raw = await res.json();
const data = unwrapApiData<{ chains?: Chain[] }>(raw);
setChains(data.chains || []);
```

### Polling Pattern

Hooks with polling accept `pollInterval` parameter (0 = disabled):

```typescript
useEffect(() => {
  fetchData();
  if (pollInterval > 0) {
    const interval = setInterval(fetchData, pollInterval);
    return () => clearInterval(interval);
  }
}, [fetchData, pollInterval]);
```

### Return Type Pattern

All hooks return a consistent interface:

```typescript
interface UseXReturn {
  // data
  items: T[];
  // state
  loading: boolean;
  error: string | null;
  // actions
  refresh: () => Promise<void>;
  // CRUD operations
  create: (...) => Promise<void>;
  update: (...) => Promise<void>;
  delete: (...) => Promise<void>;
}
```

## WebSocket / SSE Patterns

### useWebSocket

- Uses `WebSocketClient` from `@/lib/websocket`
- Maintains connection state, reconnection logic
- Buffers last 500 events
- Tracks per-agent session status

### useEventStream

- Server-Sent Events for run updates
- Auto-reconnect on disconnect
- Emits: connected, session_status, event, agent_complete, chain_complete
- Integrates with notification system via `notifyAgentEvent()`

### SSE Fallback

`useJobStatus` implements fallback strategy:

1. Primary: SSE connection
2. After 2 failures: Fall back to polling every 2s
3. Stop polling when job reaches terminal state

## Global Search

`useGlobalSearch()` provides Cmd+K palette:

- Static page registry (40+ pages)
- Dynamic search via `/api/search` (chains, agents, runs, tasks)
- Recent searches persisted to localStorage
- Keyboard navigation (arrows + enter)
- Filter toggles by entity type

## Analytics Hooks

Dedicated tracking hooks:

- `useTrackEvent()` - Generic event tracking
- `useTrackClick(eventName)` - Click handler
- `useTrackForm(formName)` - Start/submit with duration
- `useTrackFeature(featureName)` - Feature usage
- `useTrackError()` - Error tracking with stack truncation
- `useTrackSearch(searchType)` - Search queries
- `useTrackEngagement()` - Time on entity
- `useTrackModal(modalName)` - Modal interactions
- `useTrackChain()` - Chain lifecycle (view, create, save, delete, run)
- `useTrackAgent()` - Agent session tracking
- `useTrackTemplate()` - Template usage

## Notifications System

`useNotificationsListener()` polls multiple sources:

1. **Webhooks** - Failed deliveries (every 15s)
2. **Runs** - Status changes: running -> completed/failed (every 10s)
3. **Jobs** - Background job status (every 10s)
4. **Custom events** - Via `window.dispatchEvent("agent-notification")`

Notifications are stored in Zustand store (`@/lib/notifications-store`) and displayed via toast.

## Start Page Data

`useStartPageData(enabled)` builds dashboard sections:

- **Attention**: Pending decisions, failed runs, unread notifications, ready tasks
- **Happening**: Active runs (with agent progress), next scheduled job
- **Gone**: Completed runs, approved decisions, recent read notifications

Uses 30s in-memory cache to avoid redundant fetches.

## Gotchas

### SSR Safety

Hooks that access `window`/`document` check for SSR:

```typescript
const [isOnline, setIsOnline] = useState(() => {
  if (typeof window === "undefined") return true;
  return navigator.onLine;
});
```

### ESLint Hooks Exhaustive Deps

Some hooks intentionally disable warnings due to circular references or forward refs:

```typescript
// eslint-disable-next-line react-hooks/exhaustive-deps
```

Do NOT refactor these without understanding the dependency cycle.

### CSRF Token

CSRF token is stored in cookie `csrf-token`. Use `useCsrfToken()` or `fetchWithCsrf()` for POST requests.

### Locale Translation

`useTranslation()` returns `{ locale, t }` where `t` accepts optional params:

```typescript
const { t } = useTranslations();
t("key") -> "value"
t("key", { name: "foo" }) -> "value with {name}"
```

## Dependencies

- `@/lib/types` - Core type definitions (Chain, Agent, Run, etc.)
- `@/lib/api-client` - `unwrapApiData()` for response unwrapping
- `@/lib/use-namespace-fetch` - Multi-tenant fetch wrapper
- `@/lib/workspace-context` - Current workspace context
- `@/lib/notifications-store` - Zustand store for notifications
- `@/lib/analytics` - Analytics tracking utilities
- `@/lib/websocket` - WebSocketClient class
- `@/lib/i18n` + `@/lib/locale-store` - Translation system
- `next-themes` - Theme management
```