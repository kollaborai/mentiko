// rate-limit: per-tenant + per-user sliding window rate limiter
// store is an interface — swap to redis later for multi-instance tenants

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec: number;
}

export interface RateLimitStore {
  check(key: string, limit: number, windowMs: number): RateLimitResult;
}

interface Bucket {
  timestamps: number[];
}

export class InMemoryStore implements RateLimitStore {
  private buckets = new Map<string, Bucket>();
  private gcTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // gc sweep every 60s
    this.gcTimer = setInterval(() => this.sweep(), 60_000);
    // don't block process exit
    if (this.gcTimer && typeof this.gcTimer === "object" && "unref" in this.gcTimer) {
      this.gcTimer.unref();
    }
  }

  check(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const cutoff = now - windowMs;

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { timestamps: [] };
      this.buckets.set(key, bucket);
    }

    // slide: drop timestamps outside the window
    bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);

    if (bucket.timestamps.length < limit) {
      bucket.timestamps.push(now);
      return { ok: true, retryAfterSec: 0 };
    }

    // over limit — tell caller when the oldest hit expires
    const oldestInWindow = bucket.timestamps[0];
    const retryAfterMs = oldestInWindow + windowMs - now;
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  private sweep(): void {
    // remove buckets with no recent activity (older than largest practical window)
    const now = Date.now();
    const maxAge = 120_000; // 2 min — covers our 60s window with margin
    for (const [key, bucket] of this.buckets.entries()) {
      const last = bucket.timestamps[bucket.timestamps.length - 1];
      if (!last || last < now - maxAge) {
        this.buckets.delete(key);
      }
    }
  }

  // for testing
  get size(): number {
    return this.buckets.size;
  }

  destroy(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
    this.buckets.clear();
  }
}

// singleton store for the process lifetime
let _store: InMemoryStore | null = null;

export function getStore(): InMemoryStore {
  if (!_store) {
    _store = new InMemoryStore();
  }
  return _store;
}

// limits calibrated to actual app behaviour:
//   ~13 polled endpoints, each called by 1-3 components on mount
//   steady-state polling: ~50 req/min per user at rest
//   page-load burst: ~40-60 req in first 5s (providers + hooks all mounting simultaneously)
export const LIMITS = {
  user:   { limit: 300, windowMs: 60_000 },  // 300 req/min per user
  tenant: { limit: 1500, windowMs: 60_000 }, // 1500 req/min per tenant (5 concurrent users)
  burst:  { limit: 100, windowMs: 10_000 },  // 100 req/10s — covers full dashboard mount burst
} as const;

// opt-out paths — bypass rate limiting for:
//   1. SSE/streaming routes (long-lived, high-frequency by design)
//   2. auth (must never be throttled)
//   3. read-only polling routes the UI depends on for real-time updates
//      (these are GET-only, can't be abused for writes)
// rate limiting still applies to all write endpoints (POST/PUT/DELETE on /api/*)
export const OPT_OUT_PATHS = [
  // streaming / websocket
  "/api/events/stream",          // SSE event bus (long-lived connection)
  "/api/mentiko-mcp/stream",     // MCP SSE stream
  "/api/workspaces/logs",        // SSE log tail
  "/api/kollabor/engine/",       // kollabor engine proxy (streaming)
  "/api/system/web-proxy",       // web proxy (streaming)
  "/api/pty/",                   // PTY session management + websocket terminal
  // auth — must never throttle
  "/api/auth/",                  // better-auth (login, session, oauth)
  // infra probes
  "/api/health",                 // health check
  "/api/kollabor/setup/mentiko", // fixed-path local bootstrap, idempotent and auth-gated
  // read-only polling the UI fires continuously for real-time data
  "/api/events",                 // event log (cache-busted ~500ms, 2+ consumers)
  "/api/workspaces",             // workspace bootstrap (retried on 429, must succeed)
  "/api/decisions",              // decision polling (dashboard + pending-decisions widget)
  "/api/notifications",          // notification polling (15s interval, multiple consumers)
  "/api/config",                 // app config (mounted by editor + workspace + others)
  "/api/mentiko-mcp/current-page", // MCP page context (fires on every route change)
  "/api/schedules/daemon",       // scheduler status (10s + 30s polls from 2 components)
  "/api/pty/sessions",           // PTY session list (polled by terminal panel)
  "/api/jobs",                   // background job polling (10s interval)
  "/api/webhooks/status",        // webhook delivery status (15s interval)
  "/api/agent-profiles",         // agent profiles (mounted by getting-started + others)
  "/api/runs",                   // run list (shared store, workspace-scoped GET)
  "/api/agents",                 // agent list (shared store GET)
  "/api/chains/list",            // chain list (shared store GET)
];
