---
title: Schedule Management Components
type: component
linked_files:
  - web/components/schedule/schedule-create-dialog.tsx
  - web/components/schedule/schedule-editor.tsx
  - web/components/schedule/schedule-history.tsx
  - web/components/schedule/schedule-list.tsx
  - web/components/schedule/schedule-manager.tsx
  - web/components/schedule/snooze/countdown-timer.tsx
  - web/components/schedule/snooze/snooze-button.tsx
  - web/components/schedule/snooze/unsnooze-button.tsx
file_hashes:
  web/components/schedule/schedule-create-dialog.tsx: sha256:1a23a7edb4199e66
  web/components/schedule/schedule-editor.tsx: sha256:375753f5aba7a946
  web/components/schedule/schedule-history.tsx: sha256:c96e7efc7577bba6
  web/components/schedule/schedule-list.tsx: sha256:a6bf71b4b76be16c
  web/components/schedule/schedule-manager.tsx: sha256:e070d0e0af21f704
  web/components/schedule/snooze/countdown-timer.tsx: sha256:25f04bd327c88b46
  web/components/schedule/snooze/snooze-button.tsx: sha256:9781ce95594fa9ff
  web/components/schedule/snooze/unsnooze-button.tsx: sha256:bda05430555c60df
tags: [schedules, cron, snooze, react]
created: 2026-04-07T09:43:17.850380
updated: 2026-04-07T09:43:17.850380
status: current
related: []
---

```yaml
---
title: Schedule Management Components
type: component
tags: schedules, cron, snooze, react
related: [[schedule-utils]], [[calendar-event-card]]
---
```

## overview

the schedule system manages recurring chain execution via cron expressions. eight components provide creation, editing, listing, history, and snooze functionality. schedules control when chains run automatically, with timezone awareness and conflict detection.

## key interfaces

### schedule data model
```typescript
interface Schedule {
  chainId: string;
  chainName: string;
  schedule: string;        // cron expression
  timezone: string;
  enabled: boolean;
  status: "enabled" | "disabled" | "snoozed" | "paused";
  snoozedUntil: string | null;
  lastRun: string | null;
  nextRun: string | null;
  avgDuration?: number;
  runCount?: number;
  conflictDetected?: boolean;
  conflictingChains?: string[];
}
```

### schedule execution
```typescript
interface ScheduleExecution {
  id: string;
  scheduleId: string;
  chainId: string;
  chainName: string;
  startedAt: string;
  completedAt?: string;
  duration?: number;
  status: "running" | "completed" | "failed" | "cancelled";
  error?: string;
  output?: string;
  triggeredBy: "cron" | "manual" | "api";
  workspaceId?: string;
  retryAttempt?: number;
}
```

## component breakdown

### schedule-create-dialog.tsx
4-step wizard for creating new schedules:
1. details (name, description)
2. chain & workspace selection
3. schedule (cron presets + custom)
4. features (enabled toggle, retries, goal)

step navigation uses progress indicator. form validation per-step via `canAdvance()`. timezone list includes user's local timezone if valid but not in defaults.

### schedule-editor.tsx
inline editor for modifying existing schedule. compact version of create dialog's schedule step. shows cron validation status with check/x icons.

### schedule-list.tsx
displays all schedules as `CalendarEventCard` components. handles toggle, run now, snooze, unsnooze actions. workspace-scoped via `useWorkspace()` context.

### schedule-manager.tsx
chain-specific schedule management. displays next run time, calculates via `/api/schedules/next`. shows preset selector or custom cron input.

### schedule-history.tsx
execution history for a schedule. expandable rows show details: id, timestamps, error, output. skeleton loading state.

### snooze components
- countdown-timer.tsx: live countdown to snooze expiry, updates every second
- snooze-button.tsx: duration presets (15m, 1h, 4h, 1d, 1w)
- unsnooze-button.tsx: immediate resume

## control flow

### create schedule
```
schedule-create-dialog opens
  → fetch chains + workspaces
  → user completes 4 steps
  → POST /api/schedules with { name, chainId, cron, timezone, workspacePath, goal, retryCount }
  → onCreated callback
```

### toggle enable
```
user clicks toggle
  → PUT /api/schedules { chainId, enabled }
  → local state update (optimistic)
```

### snooze
```
user clicks snooze → selects duration
  → DELETE /api/schedules?action=snooze&duration=<duration>
  → fetchSchedules refresh
countdown-timer displays live time left
```

## patterns

### step wizard pattern
```typescript
type Step = 1 | 2 | 3 | 4;
const [step, setStep] = useState<Step>(1);

// validation per step
const canAdvance = (): boolean => {
  switch (step) {
    case 1: return name.trim().length > 0;
    case 2: return chainId.length > 0 && workspaceId.length > 0;
    case 3: return isValidCron(cron);
    case 4: return true;
  }
};
```

### timezone handling
```typescript
const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const knownTimezones = getTimezones(); // from schedule-utils
const defaultTz = knownTimezones.includes(userTz) ? userTz : "UTC";
const timezoneList = knownTimezones.includes(userTz) || !isValidTimezone(userTz)
  ? knownTimezones
  : [userTz, ...knownTimezones];
```

### optimistic updates
```typescript
const handleToggle = async (id: string, enabled: boolean) => {
  // update local state immediately
  setSchedules(prev => prev.map(s => s.chainId === id ? { ...s, enabled } : s));
  // then sync with server
  await fetchWithNamespace("/api/schedules", { method: "PUT", ... });
};
```

## gotchas

### cron validation edge cases
- `isValidCron()` from schedule-utils handles standard 5-part expressions only
- custom cron input shows x icon while invalid, saves only when valid
- preset buttons clear `showCustom` flag, switching back from custom mode

### timezone IANA strings
- always use IANA tz database format ("America/Los_Angeles", not "PST")
- `isValidTimezone()` checks against known list + user's timezone

### snooze state persistence
- snooze is server-side state (`snoozedUntil` timestamp)
- countdown-timer is client-side only (recomputes from timestamp)
- unsnooze immediately clears server state

### workspace scoping
- schedule-list filters by `workspacePath` from useWorkspace context
- no workspace = shows all schedules
- create-dialog requires workspace selection

## dependencies

- `@aliimam/icons` - icon set (Clock, Calendar, Check, X, etc)
- `@/lib/schedule-utils` - CRON_PRESETS, getTimezones, isValidCron, getCronDescription
- `@/lib/use-namespace-fetch` - fetch wrapper with namespace headers
- `@/lib/workspace-context` - current workspace path
- `@/components/ui/calendar-event-card` - gaia component for schedule display
- `@/components/shared/time-ago` - relative time formatting