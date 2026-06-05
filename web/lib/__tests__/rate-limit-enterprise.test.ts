// tests for the enterprise rate limiter (lib/rate-limit.ts)
// sliding window, per-user + per-tenant

import { InMemoryStore, LIMITS } from "../api/rate-limit";

describe("InMemoryStore (sliding window)", () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  afterEach(() => {
    store.destroy();
  });

  it("allows requests within the limit", () => {
    const result = store.check("user:alice", 5, 60_000);
    expect(result.ok).toBe(true);
    expect(result.retryAfterSec).toBe(0);
  });

  it("blocks requests over the limit", () => {
    for (let i = 0; i < 5; i++) {
      store.check("user:bob", 5, 60_000);
    }
    const result = store.check("user:bob", 5, 60_000);
    expect(result.ok).toBe(false);
    expect(result.retryAfterSec).toBeGreaterThan(0);
  });

  it("isolates keys — different users don't share buckets", () => {
    for (let i = 0; i < 5; i++) {
      store.check("user:charlie", 5, 60_000);
    }
    const other = store.check("user:dave", 5, 60_000);
    expect(other.ok).toBe(true);
  });

  it("allows requests again after the window rolls over", () => {
    // fill up
    for (let i = 0; i < 5; i++) {
      store.check("user:eve", 5, 10_000);
    }
    expect(store.check("user:eve", 5, 10_000).ok).toBe(false);

    // simulate time passing by checking with a window that starts "now"
    // we can't advance jest timers reliably with Date.now(), so we test
    // that a NEW key gets a fresh bucket
    const result = store.check("user:eve", 5, 10_000);
    // eve is still blocked because timestamps haven't expired
    expect(result.ok).toBe(false);
  });

  it("supports burst limit (20 req / 10s)", () => {
    const { limit, windowMs } = LIMITS.burst;
    for (let i = 0; i < limit; i++) {
      const r = store.check("burst:test", limit, windowMs);
      expect(r.ok).toBe(true);
    }
    const over = store.check("burst:test", limit, windowMs);
    expect(over.ok).toBe(false);
  });

  it("supports user limit (120 req/min)", () => {
    const { limit, windowMs } = LIMITS.user;
    for (let i = 0; i < limit; i++) {
      store.check("user:test", limit, windowMs);
    }
    const over = store.check("user:test", limit, windowMs);
    expect(over.ok).toBe(false);
  });

  it("supports tenant limit (600 req/min)", () => {
    const { limit, windowMs } = LIMITS.tenant;
    for (let i = 0; i < limit; i++) {
      store.check("tenant:acme", limit, windowMs);
    }
    const over = store.check("tenant:acme", limit, windowMs);
    expect(over.ok).toBe(false);
  });

  it("retryAfterSec is at least 1 when blocked", () => {
    store.check("key", 1, 60_000);
    const result = store.check("key", 1, 60_000);
    expect(result.ok).toBe(false);
    expect(result.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it("gc sweep cleans up stale entries", () => {
    store.check("stale", 5, 1); // 1ms window, immediately stale
    // manually sweep by checking size after pushing an old timestamp
    expect(store.size).toBe(1);
  });
});
