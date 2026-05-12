# Dashboard API Contract Spec

## endpoint signatures

### layer 1: attention queue

```
GET /api/dashboard/attention

query params:
  - workspaceId?: string  (filter to single workspace)
  - since?: string        (ISO timestamp, for "since last login" diff)

response:
{
  urgent: AttentionItem[],
  medium: AttentionItem[],
  low: AttentionItem[],
  lastUpdated: string     (ISO timestamp)
}

cache: 2min
```

### layer 2: health panel

```
GET /api/dashboard/health

query params:
  - workspaceId?: string
  - period?: "last-7-days" | "last-24-hours" | "today"  (default: "last-7-days")

response:
{
  chainHealth: HealthMetric[],
  agentPerformance: HealthMetric[],
  scheduleReliability: HealthMetric[],
  bottlenecks: HealthMetric[],
  workspaceHealth: HealthMetric[],
  period: string
}

cache: 5min
```

### layer 3: optimization

```
GET /api/dashboard/optimization

query params:
  - workspaceId?: string

response:
{
  instantFixes: OptimizationFix[],
  planningItems: PlanningItem[],
  lastScanned: string
}

cache: 10min
```

### overnight summary

```
GET /api/dashboard/overnight

query params:
  - since: string  (required, ISO timestamp from last login)

response:
{
  failedRuns: number,
  missedSchedules: number,
  since: string,
  until: string
}

cache: 1min
```

### who is active

```
GET /api/dashboard/who-is-active

response:
{
  activeUsers: Array<{
    user: {
      id: string
      name: string
      email: string
    }
    workspace?: {
      id: string
      name: string
    }
    chain?: {
      id: string
      name: string
    }
    sessionStart: string
  }>
}

cache: 30s
```

---

## data models

### AttentionItem

```typescript
interface AttentionItem {
  type: "failed-run" | "stalled-agent" | "blocked-task" | "pending-decision" | "schedule-miss" | "workspace-conflict"
  id: string
  title: string
  reason: string
  urgency: "urgent" | "medium" | "low"
  cta: string
  ctaLink: string
  timestamp: string
  metadata?: {
    // type-specific metadata
    runId?: string
    chainId?: string
    taskId?: string
    scheduleId?: string
    workspaceId?: string
    errorCode?: string
    blockedBy?: string
  }
}
```

**attention item sources:**

- failed-run: scan runs/ for status=failed, lastModified < 24h
- stalled-agent: query watchdog for agents with no heartbeat >2h
- blocked-task: query task store for tasks with unresolved dependencies
- pending-decision: scan decisions/ for status=pending, sortBy createdAt
- schedule-miss: check schedules/ lastRunAt vs expected cron fire time
- workspace-conflict: pty-manager list for same workspace path

**urgency ranking:**

```
urgent: failed runs (exit code != 0), stalled agents (>2h), workspace conflicts
medium: blocked tasks (P0-P1), pending decisions (>3 days), schedule misses
low: blocked tasks (P2-P4), pending decisions (<3 days)
```

### HealthMetric

```typescript
interface HealthMetric {
  type: "chain-health" | "agent-performance" | "schedule-reliability" | "bottleneck" | "workspace-health"
  title: string
  current: number | string
  previous: number | string
  trend: "up" | "down" | "stable"
  link: string
  period: "last-7-days" | "last-24-hours" | "today"
  metadata?: {
    chainId?: string
    agentId?: string
    scheduleId?: string
    workspaceId?: string
    percentage?: number
    count?: number
  }
}
```

**health metric calculations:**

- chain-health: (successful runs / total runs) * 100, compare period vs previous period
- agent-performance: (runs with timeout / total runs for agent) * 100
- schedule-reliability: (actual runs / expected runs) * 100
- bottleneck: count of tasks blocked by same parent, show highest count
- workspace-health: timestamp of last successful run, calculate days-since

### OptimizationFix

```typescript
interface OptimizationFix {
  type: "cleanup" | "reconnect" | "fix-refs" | "refresh-profiles"
  title: string
  impact: string
  action: string
  actionLink: string
  preview?: () => Promise<{
    items: Array<{
      id: string
      name: string
      size?: string
      date?: string
    }>
    totalSize?: string
    totalCount: number
  }>
}
```

**optimization scan logic:**

- cleanup: find runs/ with createdAt >90d, du -sh for size
- reconnect: health check ping workspaces (ssh test, docker ps)
- fix-refs: scan chains/ for { $ref: "..." }, check if agent exists in agents/
- refresh-profiles: check agent-profiles/ for lastUsed >90d or API test failure

### PlanningItem

```typescript
interface PlanningItem {
  type: "quota-warning" | "notification-fatigue" | "backlog-triage" | "deprecated-models"
  title: string
  description: string
  links: Array<{
    label: string
    href: string
  }>
  metadata?: {
    percentage?: number
    count?: number
    daysStale?: number
  }
}
```

**planning item sources:**

- quota-warning: calculate usage from runs/ total size vs plan limit
- notification-fatigue: count notifications/ created in last 7d, check dismissed vs ignored
- backlog-triage: query task store for open tasks with updatedAt >7d ago
- deprecated-models: scan agents/ for model=claude-3-opus or deprecated flags

---

## component hierarchy

```
web/app/page.tsx (dashboard root)
  └─ DashboardLayer (main container)
      ├─ WorkspaceSwitcher (dropdown, filters all queries)
      ├─ OvernightSummaryBanner (first login only)
      ├─ AttentionQueue (layer 1)
      │   ├─ AttentionSection (urgent/medium/low tabs)
      │   ├─ AttentionItemCard (expandable details)
      │   └─ EmptyState ("all systems clear")
      ├─ HealthPanel (layer 2)
      │   ├─ MetricCard (sparkline, trend indicator)
      │   └─ MetricDetail (click to expand)
      ├─ OptimizationPanel (layer 3)
      │   ├─ InstantFixesSection (one-click actions)
      │   │   └─ FixCard (impact + action button)
      │   └─ PlanningItemsSection (needs decision)
      │       └─ PlanningCard (description + links)
      ├─ ActiveRunsSection (transient)
      │   └─ ActiveRunCard (spinning indicator, view/stop)
      ├─ CollaborationSignals (multi-org only)
      │   └─ WhoIsActiveList (user + workspace + chain)
      └─ RecentActivityFeed (existing component, moved to bottom)
```

**component responsibilities:**

DashboardLayer:
  - handles time-based logic (first login, returning user)
  - manages role-based view (owner/admin/member/guest)
  - coordinates data fetching (attention, health, optimization)
  - handles workspace filter context
  - progressive disclosure logic (day 1/7/30)

WorkspaceSwitcher:
  - dropdown with all workspaces + "all workspaces" option
  - persists selection to localStorage
  - triggers refetch of all dashboard data on change

AttentionQueue:
  - tabs for urgent/medium/low
  - expandable cards with CTA buttons
  - dismiss all button (clears handled items)
  - empty state with "last cleared at" timestamp

HealthPanel:
  - grid layout (2 columns: chain/agent, schedule/workspace)
  - each metric shows current + previous + trend arrow
  - sparkline for last 7 data points
  - click metric name to navigate to entity

OptimizationPanel:
  - split view: instant fixes (top) + planning items (bottom)
  - instant fixes: show impact + one button
  - planning items: description + multiple action links
  - preview modal for destructive actions (cleanup)

---

## data flow

### attention queue

```
1. user lands on dashboard
2. DashboardLayer calls GET /api/dashboard/attention?workspaceId=<selected>
3. route handler:
   a. scan runs/ for failed runs (status=failed, lastModified < 24h)
   b. query watchdog for stalled agents (no heartbeat >2h)
   c. query task store for blocked tasks (unresolved dependencies)
   d. scan decisions/ for pending status
   e. check schedules/ for missed fires (lastRunAt > expected)
   f. detect workspace conflicts (pty-manager list same path)
4. rank by urgency (urgent > medium > low)
5. return grouped by urgency level
6. AttentionQueue renders tabs, shows badges with counts
7. user clicks [view] on item -> navigates to ctaLink
```

### health panel

```
1. DashboardLayer calls GET /api/dashboard/health?period=last-7-days
2. route handler:
   a. scan runs/ for chain success rate (group by chainId)
   b. parse run.json for agent timeouts (agentStats.timeoutCount)
   c. check schedules/ reliability (lastRunAt vs cron schedule)
   d. query task store for bottlenecks (tasks with same blocking parent)
   e. scan runs/ for workspace health (last successful run per workspace)
3. calculate current vs previous (period vs period-1)
4. determine trend (up/down/stable)
5. return metrics array
6. HealthPanel renders grid with sparklines
7. user clicks metric name -> navigates to entity detail
```

### optimization

```
1. DashboardLayer calls GET /api/dashboard/optimization
2. route handler triggers background scans:
   a. runs/ cleanup: find createdAt >90d, du -sh for size
   b. workspace health: ping ssh/docker, capture failures
   c. dangling refs: scan chains/ for { $ref: "..." }, verify agent exists
   d. stale profiles: check agent-profiles/ lastUsed >90d
3. aggregate results into instantFixes + planningItems
4. return optimization data
5. OptimizationPanel renders fixes with action buttons
6. user clicks [cleanup] -> preview modal -> confirm -> DELETE /api/runs/bulk
```

---

## implementation notes

### caching strategy

- attention: 2min (changes frequently, needs freshness)
- health: 5min (trend data doesn't change fast)
- optimization: 10min (background scans expensive)
- overnight: 1min (user just landed, want fresh data)
- who-is-active: 30s (real-time collaboration)

cache key format: `dashboard:<endpoint>:<workspaceId>`

invalidate on:
- run created/updated/deleted
- task status changed
- schedule fired/missed
- workspace connection changed

### workspace filtering

all endpoints accept optional workspaceId query param:

- if workspaceId provided: scope data to that workspace only
- if workspaceId="all": aggregate across all workspaces
- if workspaceId omitted: use user's selected workspace from context

filter logic:

```typescript
const filterByWorkspace = <T extends { workspaceId?: string }>(
  items: T[],
  workspaceId: string | undefined
): T[] => {
  if (!workspaceId || workspaceId === "all") return items
  return items.filter(item => item.workspaceId === workspaceId)
}
```

### progressive disclosure

DashboardLayer manages component visibility based on user age:

```typescript
const userAge = Date.now() - user.createdAt
const showOptimization = userAge > 30 * 24 * 60 * 60 * 1000  // 30 days
const showHealth = userAge > 7 * 24 * 60 * 60 * 1000         // 7 days
const showBasic = true                                       // day 1

if (exploreMode) {
  // show everything
}
```

### role-based visibility

DashboardLayer filters data based on user role:

```typescript
const canSeeBilling = user.role === "owner"
const canSeeTeamActivity = ["owner", "admin", "member"].includes(user.role)
const canModify = user.role !== "guest"
```

guest users:
- no optimization section (can't modify)
- no team activity (can't see others)
- limited to chains explicitly shared

---

## phase 1 mvp implementation order

1. **api routes** (web/app/api/dashboard/)
   - attention/route.ts
   - health/route.ts

2. **components** (web/components/dashboard/)
   - attention-queue.tsx
   - health-panel.tsx

3. **main container** (web/components/dashboard/)
   - dashboard-layer.tsx (orchestration, time-based logic)

4. **workspace integration**
   - add workspace switcher to top of dashboard
   - filter context provider

5. **testing**
   - puppeteer QA: localhost:3000/dashboard
   - verify attention queue loads
   - verify health panel shows trends
   - verify workspace filter works

---

## success metrics

- attention queue empty for >50% of users (most systems healthy)
- health panel catches degrading chains before total failure
- users can answer "what should i do?" within 5 seconds
- optimization actions reduce disk usage (measure runs/ size before/after)
