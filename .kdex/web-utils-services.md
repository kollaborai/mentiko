---
title: Web Utilities & Services
type: component
tags: utils, analytics, scheduler, auto-run, typescript
related: [task-store, background-worker, workspace-storage]
---

# Web Utilities & Services

## Overview

The web utilities layer provides shared services and utility functions used throughout the Next.js frontend and background worker. These include analytics abstraction, task auto-run polling, schedule execution, and common utility functions for formatting, colors, and fuzzy search.

## Analytics System

### Architecture

The analytics system provides a unified API for Google Analytics 4 (GA4) and Plausible Analytics, with a no-op fallback when analytics is disabled.

**File:** `web/lib/analytics.ts`

```typescript
// Configuration from environment variables
const config = {
  provider: process.env.NEXT_PUBLIC_ANALYTICS_PROVIDER, // "ga4" | "plausible" | "none"
  ga4MeasurementId: process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID,
  plausibleDomain: process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN,
  plausibleUrl: process.env.NEXT_PUBLIC_PLAUSIBLE_URL,
  disabled: process.env.NODE_ENV === "development" && !process.env.NEXT_PUBLIC_ANALYTICS_DEBUG,
}
```

### Usage

```typescript
import { analytics, useAnalytics } from "@/lib/analytics";

// Initialize on app load
analytics.init();

// Track page view
analytics.pageView("/chains", { title: "Chains" });

// Track custom event
analytics.track({ name: "chain_created", params: { chainId: "abc123" } });

// Track user flow (multi-step processes)
analytics.userFlow({
  flowName: "onboarding",
  stepName: "workspace_setup",
  stepNumber: 1,
  totalSteps: 3,
});

// Set user ID for cross-session tracking
analytics.setUserId("user-123");

// React hook
const analytics = useAnalytics();
```

### Key Differences: GA4 vs Plausible

| Feature | GA4 | Plausible |
|---------|-----|-----------|
| Page views | `gtag("event", "page_view")` | POST to `/api/event` |
| Custom dimensions | `gtag("set", key, value)` | Props per event |
| User ID | Supported via `set_user_id` | Use custom props |
| Debug mode | `debug_mode: true` | Console logging |

## Auto-Run Service

### Purpose

Automatically executes chains for tasks that have `auto_run=true` when all their dependencies are resolved. This enables "one-click" task workflows where dependent tasks run automatically as their prerequisites complete.

**Files:** `web/lib/auto-run-service.ts`, `web/lib/auto-run.ts`

### How It Works

1. Background worker polls every 60 seconds
2. Calls `POST /api/tasks/auto-run`
3. Server scans for tasks where:
   - `status = "open"`
   - `metadata.auto_run = true`
   - All dependencies have status in `["closed", "resolved", "done", "complete"]`
4. For each eligible task, executes its bound chain

### Dependency Check

```typescript
import { isTaskReady, getAutoRunCandidates } from "@/lib/auto-run";

// Check if a specific task is ready
const result = isTaskReady(orgId, taskId);
// { ready: boolean, deps: [], blockingDeps: [] }

// Get all ready candidates
const candidates = getAutoRunCandidates(orgId, workspaceId);
// [{ taskId, title, chainId, chainName, ready }, ...]
```

### Service State

The auto-run service stores state on `globalThis` to survive module reloads in the long-running background worker:

```typescript
state = {
  interval: setInterval(...) | null,
  startedAt: ISO string,
  lastCheck: ISO string,
  checkCount: number,
  running: boolean,
  lastTriggered: number,     // tasks triggered in last check
  lastError: string | null,
  healthy: boolean,          // platform health check status
}
```

### Health Check Integration

Before starting the polling loop, the service waits for the Next.js platform to become healthy by polling `/api/health`. This prevents connection errors during startup.

## Scheduler Service

### Purpose

Executes chains on cron schedules. Reads `schedules.json`, evaluates cron expressions, and spawns `chain-runner.sh` for due schedules.

**File:** `web/lib/scheduler-service.ts`

### Control Flow

```
startScheduler()
  → checkDueSchedules() [every 60s]
    → For each enabled schedule:
      → Check snooze period
      → Check if due (cron nextRun passed)
      → Verify chain file exists
      → fireChain() → spawn chain-runner.sh (detached)
      → Update lastRun, nextRun, runCount
      → On failure: create notification
```

### Cron Evaluation

Uses Python `croniter` library for cron parsing:

```bash
python3 -c "from croniter import croniter; ..."
```

### Schedule File Location

```
{orgRoot}/schedules.json  # Array of Schedule objects
```

### Firing Chains

Chains execute in detached mode (fire-and-forget):

```typescript
spawn("bash", [chainRunner, chainFile, "--workspace", wsPath], {
  detached: true,
  stdio: "ignore",
  env: { /* namespace/org paths */ },
})
```

## Utility Functions

### Common Utils (`web/lib/utils.ts`)

```typescript
// Tailwind class merging (clsx + tailwind-merge)
cn("px-4 py-2", isActive && "bg-accent", className)

// Date formatting (relative: "5m ago", "2h ago", "3d ago")
formatDate(date)

// Duration formatting (ms → human readable)
formatDuration(12345678)  // "3h 25m 45s"

// Byte formatting
formatBytes(1536)         // "1.5 KB"

// ID generation
generateId("chain", 8)    // "chain_abc12345"
generateUUID()            // "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"

// Function decorators
debounce(fn, 300)
throttle(fn, 1000)

// Object operations
deepClone(obj)
deepEqual(a, b)

// String operations
slugify("Hello World!")   // "hello-world"
```

### Clipboard (`web/lib/copy-to-clipboard.ts`)

Safe clipboard write that works in non-secure contexts:

```typescript
import { copyToClipboard } from "@/lib/copy-to-clipboard";

copyToClipboard("text to copy");
// Uses navigator.clipboard.writeText when available
// Falls back to textarea + execCommand for older browsers
```

### Fuzzy Search (`web/lib/fuzzy-search.ts`)

Simple fuzzy search without external dependencies:

```typescript
import { fuzzySearch, fuzzySearchMulti, highlightMatches } from "@/lib/fuzzy-search";

// Single field search
const results = fuzzySearch(items, "chr", (item) => item.name);

// Multi-field search
const results = fuzzySearchMulti(items, "chr", (item) => [item.name, item.description]);

// Highlight matches in UI
const highlighted = highlightMatches("Christopher", "chr");
// "<mark>Chr</mark>istopher"
```

Scoring considers:
- Match ratio (more chars matched = higher score)
- Consecutive match bonus
- Position penalty (earlier matches are better)
- Exact prefix bonus

### Color Utils (`web/lib/utils/colorUtils.ts`)

Color parsing and contrast calculation:

```typescript
import { parseColor, getLuminance, getContrastColor } from "@/lib/utils/colorUtils";

// Parse any color format
const rgb = parseColor("#ff0000");        // { r: 255, g: 0, b: 0 }
const rgb = parseColor("red");            // { r: 255, g: 0, b: 0 }
const rgb = parseColor("rgb(255, 0, 0)"); // { r: 255, g: 0, b: 0 }
const rgb = parseColor("hsl(0, 100%, 50%)"); // { r: 255, g: 0, b: 0 }

// Calculate luminance (WCAG relative luminance)
const lum = getLuminance(rgb);

// Get contrasting text color
const textColor = getContrastColor(lum);  // "#000000" or "#ffffff"
```

### Version Utils (`web/lib/version-utils.ts`)

Semver utilities for chain versioning:

```typescript
import {
  parseSemVer,
  formatSemVer,
  incrementPatch,
  incrementMinor,
  incrementMajor,
} from "@/lib/version-utils";

const ver = parseSemVer("1.2.3");  // { major: 1, minor: 2, patch: 3 }

incrementPatch("1.2.3")  // "1.2.4"
incrementMinor("1.2.3")  // "1.3.0"
incrementMajor("1.2.3")  // "2.0.0"
```

## Gotchas

### Analytics in Development

Analytics is **disabled by default in development**. Set `NEXT_PUBLIC_ANALYTICS_DEBUG=true` to enable local testing.

### Scheduler and Auto-Run Coexistence

Both services run in the background worker:
- **Scheduler**: Time-based (cron)
- **Auto-Run**: Dependency-based (task deps resolved)

They operate independently but both use `chain-runner.sh` for execution.

### Module Reload State

Services store state on `globalThis` because Next.js in development hot-reloads modules. Without this, the interval would be lost and services would restart on every file change.

### Cron Dependency

The scheduler requires Python 3 with `croniter` installed. This is available in the Docker image but may not be present in local dev environments (falls back gracefully).

### Clipboard Fallback

The `execCommand` fallback for clipboard is synchronous and may flash a visible textarea. It's a last resort for older browsers or non-secure contexts.

## Related Components

- [[task-store]] - Auto-run depends on task metadata for chain binding
- [[background-worker]] - Host process for scheduler and auto-run services
- [[workspace-storage]] - Provides workspace paths for chain execution
