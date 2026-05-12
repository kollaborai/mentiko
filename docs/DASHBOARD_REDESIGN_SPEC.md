# Dashboard Redesign Epic

**status:** specification complete, awaiting implementation
**phase:** phase 1 (mvp) - attention queue + health panel
**last updated:** 2026-03-22

## executive summary

current dashboard: passive stats (5 chains, 3 running, 42 completed). users don't know what to DO.

redesign goal: actionable intelligence that guides users through their mentiko day.

three-layer architecture:
1. **attention queue** - what's broken NOW (acute failures)
2. **health panel** - what's degrading (trends, not snapshots)
3. **optimization opportunities** - low-hanging fruit (one-click fixes + planning items)

framing: "nothing's broken, but this is degrading, here's low-hanging fruit, here's what happened."

## quick links

- [information architecture](#information-architecture) - what goes where
- [API contracts](#api-contracts) - endpoint signatures and response schemas
- [data models](#data-models-typescript) - typescript interfaces
- [component hierarchy](#component-hierarchy) - react components and props
- [visual layout](#visual-layout) - ascii mockup of the dashboard
- [implementation notes](#api-route-implementation-notes) - code examples
- [phase 1 mvp](#phase-1-implementation-plan) - what to build first

---

## overview

current dashboard is passive - shows raw stats (5 chains, 3 running, 42 completed). users land here and don't know what to DO.

redesign goal: actionable intelligence that guides users through their mentiko day.

## what we're building

three-layer information architecture:
1. **attention queue** - what's broken NOW (acute failures)
2. **health panel** - what's degrading (trends, not snapshots)
3. **optimization opportunities** - low-hanging fruit (one-click fixes + planning items)

underneath: activity feed (what happened)

framing: "nothing's broken, but this is degrading, here's low-hanging fruit, here's what happened."

---

## information architecture

### layer 1: attention queue (acute)

ranked by urgency. badges: [URGENT] [MEDIUM] [LOW]

items:
- failed runs (with error type, likely fix)
- stalled agents (>2 hours, likely cause)
- blocked tasks (with what they're waiting on)
- pending decisions (time-sensitive)
- schedule misses (cron didn't fire when expected)
- workspace conflicts (2 sessions in same workspace)

each item has a CTA button:
- [review failed run] → links to run detail output tab
- [unblock task] → links to blocking task
- [approve decision] → links to decision flow
- [fix schedule] → links to schedule edit

empty state:
- "all systems clear" with green checkmark
- show when last attention item was handled (feedback loop)

### layer 2: health panel (trending)

shows WHERE things are going, not just THAT they're going.

metrics (with sparklines or trend indicators):
- chain health: "deploy-chain 95% → 60% success rate (last 7 days)"
- agent performance: "research-agent timeout rate 5% → 15%"
- schedule reliability: "daily-build missed 3 of 7 runs this week"
- dependency bottlenecks: "7 tasks blocked on api-design task"
- workspace health: "prod hasn't had successful run in 3 days"

each metric links to detail:
- chain name → chain editor
- agent name → agent detail page
- schedule name → schedule edit
- task id → task detail

### layer 3: optimization opportunities

two subsections: **instant fixes** (one-click) and **planning items** (needs decision)

#### instant fixes (one-click)
background scans detect these, group them, offer bulk actions:

- cleanup old runs: "2.3GB of runs >90 days old [cleanup 2.3GB]"
  - preview shows what gets deleted
  - one button removes them all

- reconnect stale workspaces: "prod ssh connection dropped [reconnect]"
  - health check pings workspace
  - if no response, show reconnect button (one click)

- fix dangling $refs: "12 chains with broken agent references [fix all]"
  - background scan finds { $ref: "deleted-agent" }
  - bulk remove or replace with working agent

- refresh agent profiles: "5 profiles with expired keys [refresh all]"
  - detected via API test or last-used timestamp
  - prompts for new keys, bulk update

#### planning items (needs human decision)
- quota warning: "78% of monthly quota used (23GB / 30GB)"
  - [upgrade plan] or [reduce usage] links

- notification fatigue: "47 alerts this week, 12 ignored"
  - [tune thresholds] → notification preferences page

- backlog triage: "42 open tasks, 5 stale >7 days"
  - [start triage session] → filtered task list with stale items

- deprecated models: "3 agents using claude-3-opus (deprecated)"
  - [migrate to claude-3.7-sonnet]

### activity feed (bottom)

recent events and runs, time-sorted, workspace-filtered.
existing activity-feed.tsx is fine, just move to bottom.

---

## time-based behavior

### first login of the day (overnight summary)
- show "overnight" banner: "3 failed runs, 1 missed schedule since you left"
- attention queue pre-filtered to last 12 hours
- health panel shows "since yesterday" trends

### mid-day session
- active runs front and center
- attention queue shows current blockers
- health panel shows "today" trends

### returning user
- "what changed since you left" diff
- highlight new items since last login
- show handled items with checkmarks: "you resolved 5 urgent items today"

### progressive disclosure
- day 1 (new user): "create your first chain" prominent
- day 7: show trends, health panel appears
- day 30: full density, optimization section
- explore mode toggle: always show everything (power users)

---

## role-based views

### owner
- billing alerts: "payment due in 3 days"
- invite status: "3 pending member invites"
- org settings: "upgrade plan needed for 5th user"

### admin
- team activity: "marco is working on deploy-chain"
- approval queues: "3 tasks waiting for your approval"
- member performance: "sarah completed 12 tasks this week"

### member
- my tasks: assigned to me, sorted by priority
- shared chains: chains i can run
- team activity (read-only): what the team is working on

### guest
- limited access: only chains explicitly shared
- no team activity visible
- no optimization (can't modify)

---

## collaboration signals

### who's active
- "marco is working on deploy-chain" (live status)
- "sara viewed this task 2m ago" (viewers)
- "3 people in prod workspace" (conflict warning)

### approval queues
- "5 tasks waiting for your approval"
- quick approve/reject buttons from dashboard
- link to full approval queue

### workspace conflicts
- "staging has 2 active sessions"
- "can't start run in prod (session locked by marco)"

---

## workspace scoping

workspace dropdown filters everything:

### all workspaces (aggregated)
- cross-workspace health: "prod is failing, test is fine"
- global optimization: "5 workspaces have old runs to clean up"
- total quota usage across all workspaces

### single workspace (scoped)
- workspace-specific attention: "prod hasn't run in 3 days"
- workspace-specific health: "prod's deploy-chain failing 60%"
- workspace-specific optimization: "prod has 8GB of old runs"
- workspace switcher persists across sessions

---

## technical implementation

### API contracts

#### GET /api/dashboard/attention

fetch attention queue items, ranked by urgency. workspace-scoped via query param.

**query params:**
```
workspace?: string      // filter by workspace id, omit for "all workspaces"
limit?: number          // default 20, max 100
types?: string[]        // filter by type: ["failed-run", "stalled-agent", ...]
```

**response:**
```typescript
{
  urgent: AttentionItem[],
  medium: AttentionItem[],
  low: AttentionItem[],
  lastEmptyAt?: string   // iso timestamp when queue was last empty (feedback loop)
}

interface AttentionItem {
  type: "failed-run" | "stalled-agent" | "blocked-task" | "pending-decision" | "schedule-miss" | "workspace-conflict"
  id: string              // entity id (run id, task id, etc.)
  title: string           // short headline: "deploy-chain failed"
  reason: string          // why it needs attention: "agent timed out after 30m"
  urgency: "urgent" | "medium" | "low"
  cta: string             // button text: "review failed run"
  ctaLink: string         // deep link: "/runs?runId=xxx&tab=output"
  timestamp: string       // iso time when issue occurred
  metadata?: {
    chain?: string         // chain name for context
    workspace?: string     // workspace name for context
    agent?: string         // agent name for context
    errorType?: string     // for failed runs: "timeout", "api-error", etc.
    blockingTask?: string  // for blocked tasks: id of task they're waiting on
    schedule?: string      // for schedule misses: schedule name
    since?: string         // for stalled agents: how long it's been stuck
  }
}
```

**implementation notes:**
- failed runs: query runs table where status in (failed, error), sort by started desc
- stalled agents: runs where status=running AND started < now() - 2 hours
- blocked tasks: query task store for tasks with dependencies, filter where any dep has status=pending
- pending decisions: /api/decisions?status=pending, check createdAt for urgency
- schedule misses: schedules where lastRunAt < expectedNextFire - 1 hour
- workspace conflicts: query active runs, group by workspace, find workspaces with >1 active run
- cache: 30 seconds (stale data acceptable, don't want hammering runs table)

#### GET /api/dashboard/health

fetch health metrics with trends. workspace-scoped.

**query params:**
```
workspace?: string      // filter by workspace id
period?: "7d" | "24h" | "today"   // default "7d"
```

**response:**
```typescript
{
  chainHealth: HealthMetric[],
  agentPerformance: HealthMetric[],
  scheduleReliability: HealthMetric[],
  bottlenecks: HealthMetric[],
  workspaceHealth: HealthMetric[]
}

interface HealthMetric {
  type: "chain-health" | "agent-performance" | "schedule-reliability" | "bottleneck" | "workspace-health"
  id: string              // entity id (chain id, agent id, etc.)
  title: string           // "deploy-chain" or "research-agent"
  current: {
    value: number | string
    label: string         // "60% success rate" or "15% timeout rate"
  }
  previous?: {
    value: number | string
    label: string         // "95% success rate" or "5% timeout rate"
  }
  trend: "up" | "down" | "stable" | "unknown"  // "up" = getting worse (error rate up), "down" = improving
  link: string            // deep link to entity
  period: string          // "last 7 days"
  metadata?: {
    totalRuns?: number
    failedRuns?: number
    lastRun?: string
    worstAgent?: string   // for chain health: which agent is failing most
  }
}
```

**implementation notes:**
- chain health: calculate success rate per chain = completed / (completed + failed). compare current period (last 7d) vs previous period (7-14 days ago)
- agent performance: timeout rate = runs where agent timed out / total runs for that agent
- schedule reliability: missed runs = count where expected fire time but no run created
- bottlenecks: query tasks, count how many are blocked by each task, sort by count desc
- workspace health: most recent run status per workspace, if last run was failed OR last run > 3 days ago
- cache: 5 minutes (trends change slowly)

#### GET /api/dashboard/optimization

fetch optimization opportunities (instant fixes + planning items). workspace-scoped.

**query params:**
```
workspace?: string
```

**response:**
```typescript
{
  instantFixes: OptimizationFix[],
  planningItems: PlanningItem[]
}

interface OptimizationFix {
  type: "cleanup" | "reconnect" | "fix-refs" | "refresh-profiles"
  id: string              // unique fix id
  title: string           // "cleanup old runs" or "reconnect prod workspace"
  impact: string          // "2.3GB" or "12 chains" or "5 profiles"
  action: string          // button text: "cleanup 2.3GB"
  actionLink: string      // deep link or api endpoint: /api/runs/cleanup
  previewLink?: string    // link to preview what gets affected: /api/runs/cleanup/preview
  metadata?: {
    runCount?: number     // for cleanup: how many runs
    sizeBytes?: number    // for cleanup: total size
    chains?: string[]     // for fix-refs: affected chain names
    profiles?: string[]   // for refresh-profiles: profile names
  }
}

interface PlanningItem {
  type: "quota-warning" | "notification-fatigue" | "backlog-triage" | "deprecated-models"
  id: string
  title: string           // "78% quota used" or "47 alerts this week"
  description: string     // "23GB of 30GB monthly quota used. upgrade or reduce usage."
  links: Array<{
    label: string         // "upgrade plan" or "tune thresholds"
    href: string
  }>
  metadata?: {
    used?: number         // for quota: GB used
    limit?: number        // for quota: GB limit
    alertCount?: number   // for notifications: alerts sent
    ignoredCount?: number // for notifications: alerts ignored
    staleCount?: number   // for backlog: tasks stale >7 days
    totalCount?: number   // for backlog: total open tasks
  }
}
```

**implementation notes:**
- cleanup: scan runs table where started < now() - 90 days, sum file sizes
- reconnect: background health check (ping workspace), mark stale if no response
- fix-refs: scan all chains for { $ref: "..." } patterns, check if agent exists in registry
- refresh-profiles: check profile.lastUsed vs key rotation schedule (90 days), or test API key validity
- quota warning: query billing usage api, check against plan limits
- notification fatigue: query notifications table, count sent vs ignored in last 7 days
- backlog triage: query tasks where status=open AND updatedAt < now() - 7 days
- deprecated models: scan agents for deprecated model names
- cache: 5 minutes for optimization, 30 seconds for planning (quota changes faster)

#### POST /api/dashboard/optimization/{fixId}/execute

execute an instant fix (cleanup, reconnect, etc).

**response:**
```typescript
{
  success: boolean
  message: string          // "cleaned up 2.3GB of old runs"
  affected?: {
    runsDeleted?: number
    spaceFreed?: string    // "2.3GB"
    chainsFixed?: number
    profilesUpdated?: number
  }
}
```

**implementation notes:**
- cleanup: rm -rf on run directories, delete from runs table
- reconnect: workspace health check + re-establish connection
- fix-refs: bulk update chains.json, remove or replace dangling refs
- refresh-profiles: prompt for new keys, update profile files
- all actions: log to audit trail, show result on dashboard

#### GET /api/dashboard/overnight?since=<timestamp>

fetch summary of what happened overnight (for first-login banner).

**query params:**
```
since: string            // iso timestamp, defaults to 12 hours ago
workspace?: string
```

**response:**
```typescript
{
  failedRuns: number
  missedSchedules: number
  stalledAgents: number
  since: string
  workspace?: string
}
```

**implementation notes:**
- simple counts for banner display
- cached: 1 minute

#### GET /api/dashboard/activity-diff?since=<timestamp>

fetch activity diff since last login (for "what changed" banner).

**query params:**
```
since: string            // iso timestamp
workspace?: string
limit?: number
```

**response:**
```typescript
{
  newFailedRuns: number
  newBlockedTasks: number
  newPendingDecisions: number
  items: ActivityDiffItem[]
}

interface ActivityDiffItem {
  type: "failed-run" | "blocked-task" | "pending-decision" | "schedule-miss"
  id: string
  title: string
  timestamp: string
  link: string
}
```

#### GET /api/dashboard/who-is-active

fetch currently active users and their work (for collaboration signals).

**response:**
```typescript
{
  users: ActiveUser[]
}

interface ActiveUser {
  userId: string
  email: string
  name?: string
  currentWork: {
    workspace?: string
    chain?: string
    runId?: string
    taskId?: string
    startedAt: string
  }
  lastSeen: string        // iso timestamp
}
```

**implementation notes:**
- query active runs, join with user context (who started the run)
- query task assignments, filter by in_progress status
- cache: 30 seconds (live status, want reasonably fresh)

---

### data models (typescript)

```typescript
// attention queue
interface AttentionItem {
  type: AttentionItemType
  id: string
  title: string
  reason: string
  urgency: "urgent" | "medium" | "low"
  cta: string
  ctaLink: string
  timestamp: string
  metadata?: AttentionMetadata
}

type AttentionItemType =
  | "failed-run"
  | "stalled-agent"
  | "blocked-task"
  | "pending-decision"
  | "schedule-miss"
  | "workspace-conflict"

interface AttentionMetadata {
  chain?: string
  workspace?: string
  agent?: string
  errorType?: string
  blockingTask?: string
  schedule?: string
  since?: string
}

// health panel
interface HealthMetric {
  type: HealthMetricType
  id: string
  title: string
  current: HealthValue
  previous?: HealthValue
  trend: "up" | "down" | "stable" | "unknown"
  link: string
  period: string
  metadata?: HealthMetadata
}

type HealthMetricType =
  | "chain-health"
  | "agent-performance"
  | "schedule-reliability"
  | "bottleneck"
  | "workspace-health"

interface HealthValue {
  value: number | string
  label: string
}

interface HealthMetadata {
  totalRuns?: number
  failedRuns?: number
  lastRun?: string
  worstAgent?: string
}

// optimization panel
interface OptimizationFix {
  type: OptimizationFixType
  id: string
  title: string
  impact: string
  action: string
  actionLink: string
  previewLink?: string
  metadata?: OptimizationFixMetadata
}

type OptimizationFixType =
  | "cleanup"
  | "reconnect"
  | "fix-refs"
  | "refresh-profiles"

interface OptimizationFixMetadata {
  runCount?: number
  sizeBytes?: number
  chains?: string[]
  profiles?: string[]
}

interface PlanningItem {
  type: PlanningItemType
  id: string
  title: string
  description: string
  links: ActionLink[]
  metadata?: PlanningItemMetadata
}

type PlanningItemType =
  | "quota-warning"
  | "notification-fatigue"
  | "backlog-triage"
  | "deprecated-models"

interface ActionLink {
  label: string
  href: string
}

interface PlanningItemMetadata {
  used?: number
  limit?: number
  alertCount?: number
  ignoredCount?: number
  staleCount?: number
  totalCount?: number
}

// collaboration signals
interface ActiveUser {
  userId: string
  email: string
  name?: string
  currentWork: {
    workspace?: string
    chain?: string
    runId?: string
    taskId?: string
    startedAt: string
  }
  lastSeen: string
}

// dashboard state
interface DashboardState {
  attention: {
    urgent: AttentionItem[]
    medium: AttentionItem[]
    low: AttentionItem[]
    lastEmptyAt?: string
  }
  health: {
    chainHealth: HealthMetric[]
    agentPerformance: HealthMetric[]
    scheduleReliability: HealthMetric[]
    bottlenecks: HealthMetric[]
    workspaceHealth: HealthMetric[]
  }
  optimization: {
    instantFixes: OptimizationFix[]
    planningItems: PlanningItem[]
  }
  collaboration: {
    activeUsers: ActiveUser[]
  }
  loading: boolean
  error?: string
}
```

---

### component hierarchy

```
web/app/dashboard/page.tsx
  └─ DashboardLayer (main container, handles time-based/role-based logic)
      ├─ OvernightSummary (first login banner, phase 2)
      ├─ AttentionQueue (layer 1)
      │   ├─ AttentionSection (urgent/medium/low subsections)
      │   │   └─ AttentionItem (individual item)
      │   └─ AttentionEmptyState (all clear with feedback)
      ├─ HealthPanel (layer 2)
      │   ├─ HealthSection (chain/agent/schedule/bottleneck/workspace)
      │   │   └─ HealthMetricCard (individual metric with sparkline)
      │   └─ HealthEmptyState (no data yet)
      ├─ OptimizationPanel (layer 3, phase 2)
      │   ├─ InstantFixesSection
      │   │   └─ OptimizationFixCard (one-click fix)
      │   └─ PlanningItemsSection
      │       └─ PlanningItemCard (planning item with links)
      ├─ ActiveRuns (existing work-mode component, promoted)
      ├─ CollaborationSignals (phase 2: who's active, approval queues)
      └─ ActivityFeed (existing component, moved to bottom)
```

#### DashboardLayer (main container)

**props:**
```typescript
interface DashboardLayerProps {
  workspaceId?: string    // from url query param or context
  userRole: "owner" | "admin" | "member" | "guest"
  isFirstLogin: boolean   // from localStorage check
  lastLoginTime: string   // from user metadata
}
```

**state:**
```typescript
const [dashboardState, setDashboardState] = useState<DashboardState>({
  attention: { urgent: [], medium: [], low: [] },
  health: { chainHealth: [], agentPerformance: [], ... },
  optimization: { instantFixes: [], planningItems: [] },
  collaboration: { activeUsers: [] },
  loading: true,
})

const [timeMode, setTimeMode] = useState<"overnight" | "mid-day" | "returning">("mid-day")
const [exploreMode, setExploreMode] = useState(false)  // phase 3: progressive disclosure
```

**effects:**
- detect time mode on mount (compare lastLoginTime to now)
- fetch all data based on time mode and workspace
- set up polling (attention: 30s, health: 5m, optimization: 5m)
- persist "handled" items to localStorage (feedback loop)

#### AttentionQueue

**props:**
```typescript
interface AttentionQueueProps {
  urgent: AttentionItem[]
  medium: AttentionItem[]
  low: AttentionItem[]
  lastEmptyAt?: string
  onHandled?: (itemId: string) => void  // for feedback loop
}
```

**behavior:**
- group by urgency, render separate sections
- sort within each group by timestamp (newest first)
- show badge count: "[URGENT] 3 items need attention"
- empty state: green checkmark + "all systems clear" + "last handled: 2 hours ago"

#### HealthPanel

**props:**
```typescript
interface HealthPanelProps {
  chainHealth: HealthMetric[]
  agentPerformance: HealthMetric[]
  scheduleReliability: HealthMetric[]
  bottlenecks: HealthMetric[]
  workspaceHealth: HealthMetric[]
  workspaceId?: string
}
```

**behavior:**
- render subsections for each metric type
- each metric card shows title, current value, trend arrow, sparkline
- trend colors: up/worse = red, down/better = green, stable = gray
- links to entity detail pages

#### OptimizationPanel

**props:**
```typescript
interface OptimizationPanelProps {
  instantFixes: OptimizationFix[]
  planningItems: PlanningItem[]
  onExecuteFix?: (fixId: string) => Promise<void>
}
```

**behavior:**
- instant fixes: show impact prominently ("2.3GB"), action button
- planning items: show description, links (upgrade, tune thresholds, etc.)
- after executing fix: optimistic update, show success toast

#### CollaborationSignals

**props:**
```typescript
interface CollaborationSignalsProps {
  activeUsers: ActiveUser[]
  userRole: "owner" | "admin" | "member" | "guest"
  workspaceId?: string
}
```

**behavior:**
- show who's working on what
- "marco is working on deploy-chain" with live indicator
- "sara viewed this task 2m ago" (viewers)
- workspace conflict warnings: "3 people in prod workspace"
- approval queues for admins: "5 tasks waiting for your approval"

---

### caching strategy

**client-side:**
- attention: 30 seconds (stale acceptable, don't hammer runs table)
- health: 5 minutes (trends change slowly)
- optimization: 5 minutes (scans are expensive)
- who-is-active: 30 seconds (live status)

**server-side:**
- use Next.js revalidate for static generation where possible
- for expensive queries (health trends), pre-calculate on schedule (every 10 min)
- cache layer 1: in-memory (globalThis for node server)
- cache layer 2: filesystem (json cache files for complex aggregations)

**cache invalidation:**
- attention: invalidate on run status change (webhook from chain-runner-complete)
- health: invalidate on run completion (batch invalidate every 10 min)
- optimization: invalidate on workspace change, profile update
- collaboration: short cache, always fetch fresh

---

### error handling

**API errors:**
- if attention API fails: show degraded state "couldn't load attention queue", allow retry
- if health API fails: hide health panel, show nothing (not critical)
- if optimization API fails: hide optimization section, log error

**user-facing errors:**
- timeout errors: "taking longer than expected, retry?"
- permission errors: "you don't have access to this workspace"
- network errors: "connection lost, reconnecting..."

**fallback behavior:**
- if workspace doesn't exist: redirect to workspace list
- if user role can't be determined: default to "guest" (limited view)
- if time detection fails: default to "mid-day" mode

---

### performance considerations

**expensive operations:**
- health trend calculations: pre-calculate on schedule, don't query on every page load
- optimization scans: run in background, cache results
- dangling $ref scan: scan chains once, cache, invalidate on chain change

**query optimization:**
- attention: use indexed columns (status, started), limit results
- health: aggregate queries (GROUP BY chain, status), materialized views for complex trends
- optimization: full table scans acceptable (run infrequently, cached)

**lazy loading:**
- activity feed: already paginated, keep as-is
- attention items: limit to 20 per urgency level
- health metrics: only show top 5 per category

---

### background scans (optimization)

**runs cleanup:**
- frequency: on dashboard load (cached 5 min)
- scan: runs table where started < now() - 90 days
- calculate: sum of file sizes (stat on run directories)
- action: rm -rf on directories, delete from runs table

**dangling $refs:**
- frequency: on dashboard load (cached 5 min)
- scan: all chains/*.json files, regex for { \$ref: "..." }
- validate: check if agent id exists in agents registry
- action: bulk update chains, remove or replace refs

**stale workspaces:**
- frequency: every hour (background job)
- scan: all workspaces, health check ping
- ssh: try ssh connect with timeout
- docker: try docker ps, check response
- action: mark stale, show "reconnect" button

**expired profiles:**
- frequency: on dashboard load (cached 5 min)
- scan: all agent-profiles, check lastUsed vs key rotation schedule (90 days)
- validate: optional API test (call Anthropic API with key)
- action: show "refresh profiles" prompt

---

### phase 1 implementation plan

**attention queue (layer 1):**
- API endpoint: /api/dashboard/attention
- Component: AttentionQueue + AttentionItem + AttentionEmptyState
- Data sources: runs table, tasks API, decisions API, schedules API
- Urgency ranking: failed > stalled > blocked > pending
- CTA buttons: deep links to relevant pages

**health panel (layer 2):**
- API endpoint: /api/dashboard/health
- Component: HealthPanel + HealthMetricCard + sparkline rendering
- Data sources: runs aggregated by chain/agent, schedules table, tasks dependencies
- Trend calculation: current period vs previous period
- Pre-calculation: materialized views or scheduled aggregation

**time-based behavior:**
- detect time mode on mount (overnight/mid-day/returning)
- fetch different data based on mode
- show overnight summary banner (phase 1: simple text, phase 2: interactive)
- persist handled items to localStorage

**workspace scoping:**
- workspace dropdown in dashboard header
- all API calls include workspace query param
- "all workspaces" aggregated view
- workspace selection persists in localStorage

**not in phase 1:**
- optimization panel (phase 2)
- collaboration signals (phase 2)
- role-based views (phase 2)
- progressive disclosure (phase 3)

---

## visual layout

```
┌─────────────────────────────────────────────────────────────┐
│  mentiko                          [workspace dropdown ▼]    │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─── overnight summary ──────┐  (first login only)        │
│  │ 3 failed runs, 1 missed    │                            │
│  │ schedule since you left    │                            │
│  └────────────────────────────┘                              │
│                                                               │
│  ┌─── attention queue ─────────────────────────────────┐    │
│  │ [URGENT] 3 items need attention                     │    │
│  │   ┌─ deploy-chain failed ────────────────┐          │    │
│  │   │ agent timed out after 30m            │          │    │
│  │   │ [review failed run] →                 │          │    │
│  │   └───────────────────────────────────────┘          │    │
│  │   ┌─ 5 tasks blocked on dependencies ────┐          │    │
│  │   │ waiting on api-design task           │          │    │
│  │   │ [unblock tasks] →                     │          │    │
│  │   └───────────────────────────────────────┘          │    │
│  │ [MEDIUM] 2 items                                      │    │
│  │ [LOW] 1 item                                         │    │
│  └────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌─ active runs ───┐  ┌─ health panel ──────────────────┐  │
│  │                  │  │                                   │  │
│  │ deploy-chain     │  │ chain health                      │  │
│  │ running 12m      │  │ deploy-chain 95% → 60% ⬇         │  │
│  │ [view] →         │  │                                   │  │
│  │                  │  │ agent performance                 │  │
│  │ test-chain       │  │ research-agent 5% → 15% ⬆        │  │
│  │ pending          │  │                                   │  │
│  │                  │  │ schedule reliability               │  │
│  └──────────────────┘  │ daily-build 3 missed ⬇           │  │
│                       │                                   │  │
│                       └───────────────────────────────────┘  │
│                                                               │
│  ┌─ my tasks ──────┐  ┌─ team activity ────────────────┐  │
│  │ 5 assigned      │  │                                   │  │
│  │ 2 blocking      │  │ marco is working on deploy-chain │  │
│  │ [view all] →    │  │ sara viewed api-design 2m ago    │  │
│  └─────────────────┘  └───────────────────────────────────┘  │
│                                                               │
│  ┌─── optimization opportunities ─────────────────────┐    │
│  │ instant fixes                                        │    │
│  │   [cleanup 2.3GB] old runs >90 days                │    │
│  │   [reconnect] prod workspace dropped               │    │
│  │                                                     │    │
│  │ planning                                            │    │
│  │   78% quota used [upgrade] [reduce usage]          │    │
│  │   47 alerts this week [tune thresholds]            │    │
│  └────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌─── recent activity ───────────────────────────────┐    │
│  │ (existing activity feed, moved to bottom)          │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## API route implementation notes

### route: /api/dashboard/attention

**file:** `web/app/api/dashboard/attention/route.ts`

```typescript
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const workspace = searchParams.get('workspace')
  const limit = parseInt(searchParams.get('limit') || '20')

  // fetch failed runs
  const failedRuns = await fetchFailedRuns(workspace, limit)
  const urgent = failedRuns.map(r => ({
    type: 'failed-run' as const,
    id: r.id,
    title: `${r.chain} failed`,
    reason: r.error || 'unknown error',
    urgency: 'urgent' as const,
    cta: 'review failed run',
    ctaLink: `/runs?runId=${r.id}&tab=output`,
    timestamp: r.started,
    metadata: { chain: r.chain, workspace: r.workspace, errorType: r.errorType }
  }))

  // fetch stalled agents
  const stalledAgents = await fetchStalledAgents(workspace)
  const medium = stalledAgents.map(r => ({
    type: 'stalled-agent' as const,
    id: r.id,
    title: `${r.chain} stalled`,
    reason: `running for ${formatDuration(r.started)}`,
    urgency: 'medium' as const,
    cta: 'view run',
    ctaLink: `/runs?runId=${r.id}`,
    timestamp: r.started,
    metadata: { chain: r.chain, workspace: r.workspace, since: r.started }
  }))

  // fetch blocked tasks via task store
  const blockedTasks = await fetchBlockedTasks(workspace)
  const low = blockedTasks.map(t => ({
    type: 'blocked-task' as const,
    id: t.id,
    title: `${t.title} blocked`,
    reason: `waiting on ${t.blockingTask}`,
    urgency: 'low' as const,
    cta: 'view task',
    ctaLink: `/tasks?taskId=${t.id}`,
    timestamp: t.updatedAt,
    metadata: { blockingTask: t.blockingTask }
  }))

  return Response.json({ urgent, medium, low })
}
```

### route: /api/dashboard/health

**file:** `web/app/api/dashboard/health/route.ts`

```typescript
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const workspace = searchParams.get('workspace')
  const period = searchParams.get('period') || '7d'

  // chain health: success rate trend
  const chainHealth = await calculateChainHealth(workspace, period)
  // returns: [{ id, title, current: { value, label }, previous, trend, link, period }]

  // agent performance: timeout rate trend
  const agentPerformance = await calculateAgentPerformance(workspace, period)

  // schedule reliability: missed runs
  const scheduleReliability = await calculateScheduleReliability(workspace, period)

  // bottlenecks: tasks blocking the most other tasks
  const bottlenecks = await findBottlenecks(workspace)

  // workspace health: last run status per workspace
  const workspaceHealth = await calculateWorkspaceHealth(workspace)

  return Response.json({
    chainHealth,
    agentPerformance,
    scheduleReliability,
    bottlenecks,
    workspaceHealth
  })
}

async function calculateChainHealth(workspace: string | null, period: string) {
  const runs = await fetchRuns(workspace, period * 2) // fetch 2x period for comparison

  const currentPeriodStart = subDays(new Date(), parseInt(period))
  const previousPeriodStart = subDays(currentPeriodStart, parseInt(period))

  const byChain = groupBy(runs, 'chain')
  const health: HealthMetric[] = []

  for (const [chain, chainRuns] of Object.entries(byChain)) {
    const currentRuns = chainRuns.filter(r => new Date(r.started) >= currentPeriodStart)
    const previousRuns = chainRuns.filter(r =>
      new Date(r.started) >= previousPeriodStart && new Date(r.started) < currentPeriodStart
    )

    const currentSuccess = currentRuns.filter(r => r.status === 'completed').length / currentRuns.length
    const previousSuccess = previousRuns.filter(r => r.status === 'completed').length / previousRuns.length

    health.push({
      type: 'chain-health',
      id: chain,
      title: chain,
      current: {
        value: Math.round(currentSuccess * 100),
        label: `${Math.round(currentSuccess * 100)}% success rate`
      },
      previous: previousRuns.length > 0 ? {
        value: Math.round(previousSuccess * 100),
        label: `${Math.round(previousSuccess * 100)}% success rate`
      } : undefined,
      trend: currentSuccess < previousSuccess ? 'down' : currentSuccess > previousSuccess ? 'up' : 'stable',
      link: `/chains?chain=${chain}`,
      period: `last ${period}`,
      metadata: {
        totalRuns: currentRuns.length,
        failedRuns: currentRuns.filter(r => r.status === 'failed').length
      }
    })
  }

  // sort by degradation (worst trend first)
  return health.sort((a, b) => {
    if (a.trend === 'down' && b.trend !== 'down') return -1
    if (b.trend === 'down' && a.trend !== 'down') return 1
    return (a.current.value as number) - (b.current.value as number)
  }).slice(0, 5)
}
```

### route: /api/dashboard/optimization

**file:** `web/app/api/dashboard/optimization/route.ts`

```typescript
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const workspace = searchParams.get('workspace')

  // scan for old runs
  const oldRuns = await scanOldRuns(workspace, 90) // >90 days
  const sizeBytes = await calculateRunsSize(oldRuns)
  const cleanupFix: OptimizationFix = {
    type: 'cleanup',
    id: 'cleanup-old-runs',
    title: 'cleanup old runs',
    impact: formatBytes(sizeBytes),
    action: `cleanup ${formatBytes(sizeBytes)}`,
    actionLink: '/api/dashboard/optimization/cleanup-old-runs/execute',
    previewLink: '/api/dashboard/optimization/cleanup-old-runs/preview',
    metadata: { runCount: oldRuns.length, sizeBytes }
  }

  // scan for dangling $refs
  const danglingRefs = await scanDanglingRefs(workspace)
  const fixRefsFix: OptimizationFix = {
    type: 'fix-refs',
    id: 'fix-dangling-refs',
    title: 'fix broken agent references',
    impact: `${danglingRefs.length} chains`,
    action: 'fix all',
    actionLink: '/api/dashboard/optimization/fix-refs/execute',
    metadata: { chains: danglingRefs.map(r => r.chain) }
  }

  // check quota
  const quota = await fetchQuotaStatus()
  if (quota.used / quota.limit > 0.75) {
    const quotaItem: PlanningItem = {
      type: 'quota-warning',
      id: 'quota-warning',
      title: `${Math.round(quota.used / quota.limit * 100)}% quota used`,
      description: `${formatBytes(quota.used)} of ${formatBytes(quota.limit)} monthly quota used`,
      links: [
        { label: 'upgrade plan', href: '/settings/billing' },
        { label: 'reduce usage', href: '/metrics' }
      ],
      metadata: { used: quota.used, limit: quota.limit }
    }
  }

  return Response.json({
    instantFixes: [cleanupFix, fixRefsFix].filter(Boolean),
    planningItems: [quotaItem].filter(Boolean)
  })
}
```

---

## component implementation notes

### AttentionQueue component

**file:** `web/components/dashboard/attention-queue.tsx`

```typescript
export function AttentionQueue({ urgent, medium, low, lastEmptyAt, onHandled }: AttentionQueueProps) {
  const totalItems = urgent.length + medium.length + low.length

  if (totalItems === 0) {
    return (
      <div className="bg-card rounded-md p-6">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-green-500" />
          <div>
            <h3 className="text-sm font-medium">all systems clear</h3>
            {lastEmptyAt && (
              <p className="text-xs text-muted-foreground mt-1">
                last handled: {formatRelativeTime(lastEmptyAt)}
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {urgent.length > 0 && (
        <AttentionSection
          title="urgent"
          items={urgent}
          badgeColor="text-red-400"
          onHandled={onHandled}
        />
      )}
      {medium.length > 0 && (
        <AttentionSection
          title="medium"
          items={medium}
          badgeColor="text-orange-400"
          onHandled={onHandled}
        />
      )}
      {low.length > 0 && (
        <AttentionSection
          title="low"
          items={low}
          badgeColor="text-yellow-400"
          onHandled={onHandled}
        />
      )}
    </div>
  )
}

function AttentionSection({ title, items, badgeColor, onHandled }: AttentionSectionProps) {
  const [handledItems, setHandledItems] = useState<Set<string>>(new Set())

  const handleItem = (itemId: string) => {
    setHandledItems(prev => new Set(prev).add(itemId))
    onHandled?.(itemId)
  }

  return (
    <div className="bg-card rounded-md overflow-hidden">
      <div className={`px-4 py-3 bg-accent flex items-center justify-between`}>
        <h3 className="text-sm font-medium uppercase">{title}</h3>
        <span className={`text-xs ${badgeColor}`}>{items.length} item{items.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="divide-y divide-muted/40">
        {items.filter(item => !handledItems.has(item.id)).map(item => (
          <AttentionItem key={item.id} item={item} onHandled={() => handleItem(item.id)} />
        ))}
      </div>
    </div>
  )
}
```

### HealthPanel component

**file:** `web/components/dashboard/health-panel.tsx`

```typescript
export function HealthPanel({ chainHealth, agentPerformance, scheduleReliability, bottlenecks, workspaceHealth }: HealthPanelProps) {
  return (
    <div className="bg-card rounded-md p-4">
      <h3 className="text-sm font-medium mb-3">system health</h3>

      <div className="space-y-4">
        {chainHealth.length > 0 && (
          <HealthSection title="chain health" metrics={chainHealth} />
        )}
        {agentPerformance.length > 0 && (
          <HealthSection title="agent performance" metrics={agentPerformance} />
        )}
        {scheduleReliability.length > 0 && (
          <HealthSection title="schedule reliability" metrics={scheduleReliability} />
        )}
      </div>
    </div>
  )
}

function HealthSection({ title, metrics }: HealthSectionProps) {
  return (
    <div>
      <h4 className="text-xs text-muted-foreground mb-2">{title}</h4>
      <div className="space-y-2">
        {metrics.map(metric => (
          <Link key={metric.id} href={metric.link} className="block">
            <div className="flex items-center justify-between p-2 rounded hover:bg-accent/40 transition-colors">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{metric.title}</p>
                <p className="text-[10px] text-muted-foreground">{metric.current.label}</p>
              </div>
              {metric.previous && (
                <div className="flex items-center gap-1 text-[10px]">
                  <span className="text-muted-foreground">{metric.previous.label}</span>
                  {metric.trend === 'down' && <TrendDown className="h-3 w-3 text-red-400" />}
                  {metric.trend === 'up' && <TrendUp className="h-3 w-3 text-green-400" />}
                  {metric.trend === 'stable' && <Minus className="h-3 w-3 text-gray-400" />}
                </div>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
```

---

## testing plan

### unit tests
- attention queue ranking logic
- health trend calculations (current vs previous)
- optimization scan accuracy (old runs, dangling refs)
- time mode detection (overnight, mid-day, returning)

### integration tests
- API endpoints return correct data for workspace scoping
- cache invalidation works (attention updates on run completion)
- error handling (api fails, shows degraded state)

### e2e tests (playwright)
- user lands on dashboard, sees attention queue
- click CTA button, navigates to correct page
- switch workspace, dashboard updates
- execute optimization fix, see success toast

---

## edge cases

### no data scenarios
- new user: no runs, no chains, no tasks → show onboarding (GettingStarted)
- empty workspace: no activity → show "create your first chain" CTA
- all workspaces empty → show workspace setup wizard

### high-volume scenarios
- 1000+ failed runs: limit attention queue to 20 per urgency, show "view all" link
- 100+ chains: show top 5 in health panel, link to full metrics page
- 50+ optimization items: group by type, show counts, expand on demand

### permission errors
- user loses access to workspace: redirect to workspace list, show toast
- guest tries optimization: hide instant fixes, show planning items only
- org limits hit: show upgrade prompt in attention queue

### race conditions
- run completes while dashboard loads: stale cache acceptable (30s), updates on next poll
- two users execute same optimization fix: optimistic update, api returns conflict if needed
- workspace deleted while viewing: show error state, redirect to workspace list

### slow queries
- health trend calculation timeout: pre-calculate on schedule, serve cached
- optimization scan takes >30s: run in background, show progress indicator
- task query slow: timeout after 5s, hide blocked tasks section

---

## open questions

### TBD
- exact threshold for "stalled" agent (currently 2 hours, configurable?)
- quota limit calculation (what counts? runs, storage, api calls?)
- notification fatigue definition (how many ignored = "fatigued"?)
- progressive disclosure triggers (day 1 vs day 7 detection - account age? run count?)

### phase 2 decisions
- how to detect "who's active"? session table? active runs? task assignments?
- approval queue: which tasks need approval? all tasks or just expensive chains?
- role-based permissions: what can guests see? read-only dashboard or hidden?

### phase 3 decisions
- explore mode toggle: show everything, or hide advanced metrics?
- new user onboarding: when to dismiss GettingStarted? after first chain? after first run?
- retention tracking: how to know "day 7" vs "day 30"? account createdAt or firstRun?

---

## metrics and success criteria

### user behavior changes
- time-to-first-action: <5 seconds from dashboard load to clicking CTA
- attention queue resolution rate: % of urgent items handled within 1 hour
- optimization actions: % of users who run cleanup/fix at least once per week

### system health metrics
- attention queue empty rate: % of users with 0 urgent items (goal: >50%)
- health panel accuracy: % of degrading chains caught before total failure (goal: >80%)
- optimization impact: GB freed via cleanup, dangling refs fixed per week

### engagement metrics
- dashboard daily active users: % of users who check dashboard at least once per day
- time-based feature usage: % of users who see overnight summary (first login)
- workspace switching: % of users who view multiple workspaces per session

### quality metrics
- API response time: p95 <500ms for attention, <2s for health, <5s for optimization
- cache hit rate: >90% for health and optimization (expensive queries)
- error rate: <1% API failures, graceful degradation when broken

---

## dependencies

### existing APIs
- /api/runs (list, detail, status)
- /api/tasks (native sqlite task store)
- /api/decisions (pending decisions)
- /api/schedules (schedule status)
- /api/chains/list (chain definitions)
- /api/agents (agent registry)
- /api/agent-profiles (profile management)

### new APIs
- /api/dashboard/attention
- /api/dashboard/health
- /api/dashboard/optimization
- /api/dashboard/overnight
- /api/dashboard/activity-diff
- /api/dashboard/who-is-active
- POST /api/dashboard/optimization/{fixId}/execute

### external services (phase 2)
- billing quota API (stripe or internal)
- notification delivery stats (notification system)
- workspace health checks (ssh, docker)

### background jobs
- health trend pre-calculation (every 10 min)
- workspace health checks (every hour)
- optimization scans (on demand, cached 5 min)

---

## rollout plan

### phase 1 (mvp)
- week 1: API endpoints for attention + health
- week 2: components (AttentionQueue, HealthPanel, DashboardLayer)
- week 3: time-based behavior + workspace scoping
- week 4: testing + bug fixes
- week 5: ship to beta users

### phase 2 (optimization + collaboration)
- week 1: optimization API + background scans
- week 2: OptimizationPanel component + instant fixes
- week 3: collaboration API (who-is-active, approval queues)
- week 4: CollaborationSignals component
- week 5: testing + ship to all users

### phase 3 (progressive disclosure)
- week 1: account aging tracking (day 1/7/30)
- week 2: progressive disclosure logic + explore mode
- week 3: role-based view filters
- week 4: new user onboarding integration
- week 5: testing + final polish

---

## success criteria

### user behavior changes
- users can answer "what should i do?" within 5 seconds of landing
- attention queue items decrease over time (users fix problems)
- optimization actions increase (users proactively clean up)

### metrics
- attention queue empty for >50% of users (most systems healthy)
- health panel catches degrading chains before total failure
- optimization actions reduce disk usage and technical debt

### feedback loop
- "you handled 3 urgent items today" creates momentum
- handled items persist until cleared (user can review progress)
- dashboard becomes the "morning coffee" check for mentiko users

---

## phase 1: mvp (what to build first)

### attention queue (layer 1)
- failed runs, stalled agents, blocked tasks
- urgent/medium/low ranking
- CTA buttons to relevant pages
- empty state with feedback

### health panel (layer 2)
- chain success rate trends
- agent timeout rate
- schedule reliability
- workspace health

### time-based behavior
- overnight summary on first login
- "what changed since last time" for returning users

### workspace scoping
- workspace dropdown filters all panels
- "all workspaces" aggregated view

### phase 2: optimization and collaboration (future)
- one-click fixes (cleanup, reconnect, fix refs)
- planning items (quota, notifications, backlog)
- collaboration signals (who's active, approval queues)
- role-based views (owner/admin/member/guest)

### phase 3: progressive disclosure (future)
- day 1 / day 7 / day 30 disclosure
- explore mode toggle
- new user onboarding prominence
