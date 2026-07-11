// in-memory API endpoint metrics
// tracks per-route timing (p50/p95/p99), call counts, slow queries
// data resets on server restart - this is for dev diagnostics, not production monitoring

const MAX_SAMPLES = 500; // per endpoint, rolling window
const SLOW_THRESHOLD_MS = 500;
const MAX_SLOW_LOG = 100;

interface EndpointStats {
  samples: number[];
  count: number;
  errors: number;
  lastCalled: number;
}

interface SlowEntry {
  route: string;
  method: string;
  duration: number;
  timestamp: number;
  status: number;
}

interface SubTimingEntry {
  samples: number[];
  count: number;
}

// singleton stores (survive hot reloads via globalThis)
const g = globalThis as unknown as {
  __apiMetrics?: Map<string, EndpointStats>;
  __apiSlowLog?: SlowEntry[];
  __apiSubTimings?: Map<string, SubTimingEntry>;
};

if (!g.__apiMetrics) g.__apiMetrics = new Map();
if (!g.__apiSlowLog) g.__apiSlowLog = [];
if (!g.__apiSubTimings) g.__apiSubTimings = new Map();

const metrics = g.__apiMetrics;
const slowLog = g.__apiSlowLog;
const subTimings = g.__apiSubTimings;

// These are concrete /api/tasks routes, not dynamic task IDs. Keep the list
// beside metric normalization so adding a task route cannot silently create a
// fake /api/tasks/[id] time series.
const STATIC_TASK_ROUTE_SEGMENTS = new Set([
  "activity",
  "auto-run",
  "bulk",
  "create",
  "deps",
  "epics",
  "generate",
  "graph",
  "reconcile",
]);
const TASK_ID_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const COMPACT_ID_SEGMENT = /^[a-z]+-[a-z0-9]{2,8}(?:\.\d+)*$/i;

function normalizeRouteSegments(pathname: string): string {
  const segments = pathname.split("/");

  return segments.map((segment, index) => {
    const isTaskRouteSegment =
      index === 3 && segments[1] === "api" && segments[2] === "tasks";
    if (isTaskRouteSegment && STATIC_TASK_ROUTE_SEGMENTS.has(segment)) {
      return segment;
    }
    if (isTaskRouteSegment && TASK_ID_SEGMENT.test(segment)) {
      return "[id]";
    }
    return COMPACT_ID_SEGMENT.test(segment) ? "[id]" : segment;
  }).join("/");
}

// extract route pattern from URL (collapse dynamic segments)
export function extractRoute(url: string): string {
  try {
    const u = new URL(url);
    // strip query params, normalize dynamic segments
    return normalizeRouteSegments(
      u.pathname.replace(
        /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        "/[id]",
      ),
    );
  } catch {
    return "unknown";
  }
}

// record a request timing
export function recordRequest(
  method: string,
  url: string,
  durationMs: number,
  status: number
): void {
  const route = extractRoute(url);
  const key = `${method} ${route}`;

  let entry = metrics.get(key);
  if (!entry) {
    entry = { samples: [], count: 0, errors: 0, lastCalled: 0 };
    metrics.set(key, entry);
  }

  entry.count++;
  entry.lastCalled = Date.now();
  if (status >= 400) entry.errors++;

  // rolling window
  entry.samples.push(durationMs);
  if (entry.samples.length > MAX_SAMPLES) {
    entry.samples = entry.samples.slice(-MAX_SAMPLES);
  }

  // slow log
  if (durationMs >= SLOW_THRESHOLD_MS) {
    slowLog.push({ route: key, method, duration: durationMs, timestamp: Date.now(), status });
    if (slowLog.length > MAX_SLOW_LOG) {
      slowLog.splice(0, slowLog.length - MAX_SLOW_LOG);
    }
  }
}

// record a sub-timing (e.g. "db:query", "db:sql", "fs:readdir")
export function recordSubTiming(label: string, durationMs: number): void {
  let entry = subTimings.get(label);
  if (!entry) {
    entry = { samples: [], count: 0 };
    subTimings.set(label, entry);
  }
  entry.count++;
  entry.samples.push(durationMs);
  if (entry.samples.length > MAX_SAMPLES) {
    entry.samples = entry.samples.slice(-MAX_SAMPLES);
  }
}

// percentile calculation
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function computeStats(samples: number[]) {
  if (samples.length === 0) {
    return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: Math.round(sum / sorted.length),
    p50: Math.round(percentile(sorted, 50)),
    p95: Math.round(percentile(sorted, 95)),
    p99: Math.round(percentile(sorted, 99)),
  };
}

// get all endpoint metrics, sorted by p95 desc (slowest first)
export function getEndpointMetrics() {
  const results: Array<{
    route: string;
    count: number;
    errors: number;
    lastCalled: string;
    timing: { min: number; max: number; avg: number; p50: number; p95: number; p99: number };
  }> = [];

  for (const [route, entry] of metrics) {
    results.push({
      route,
      count: entry.count,
      errors: entry.errors,
      lastCalled: new Date(entry.lastCalled).toISOString(),
      timing: computeStats(entry.samples),
    });
  }

  return results.sort((a, b) => b.timing.p95 - a.timing.p95);
}

// get sub-timing metrics (db calls, fs ops, etc)
export function getSubTimingMetrics() {
  const results: Array<{
    label: string;
    count: number;
    timing: { min: number; max: number; avg: number; p50: number; p95: number; p99: number };
  }> = [];

  for (const [label, entry] of subTimings) {
    results.push({
      label,
      count: entry.count,
      timing: computeStats(entry.samples),
    });
  }

  return results.sort((a, b) => b.timing.p95 - a.timing.p95);
}

// get slow query log (most recent first)
export function getSlowLog() {
  return [...slowLog]
    .reverse()
    .map((e) => ({
      ...e,
      timestamp: new Date(e.timestamp).toISOString(),
    }));
}

// reset all metrics
export function resetMetrics(): void {
  metrics.clear();
  slowLog.length = 0;
  subTimings.clear();
}
