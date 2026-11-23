// issue #136 / codex rev2 P1: the pm's critical platform readiness probe polls
// /api/health and fails the platform on 503 — but the worker starts only after
// the platform is ready. A stale dead worker owner from a previous run must not
// 503 the platform that is about to start the replacement worker.
import { NextRequest } from "next/server";
import { GET } from "../route";
import { readinessHealthStatus, runAllHealthChecks, type HealthChecks } from "@/lib/system/health-checks";

// jest.setup.js replaces the global Request with a plain mock that NextRequest
// cannot subclass — build requests the way the other route tests do.

jest.mock("@/lib/system/health-checks", () => {
  const actual = jest.requireActual("@/lib/system/health-checks");
  return {
    ...actual,
    detectMode: () => "standalone" as const,
    runAllHealthChecks: jest.fn(),
  };
});

const mockChecks = runAllHealthChecks as jest.MockedFunction<typeof runAllHealthChecks>;

function passingChecks(overrides: Partial<HealthChecks> = {}): HealthChecks {
  const base = Object.fromEntries(
    [
      "database", "auth", "pty_daemon", "directories", "sessions",
      "disk", "memory", "metrics", "runs", "redis", "audit_queue", "background_worker",
    ].map((key) => [key, { status: "pass" as const }]),
  );
  return { ...base, ...overrides } as HealthChecks;
}

function request() {
  return new Request("http://localhost/api/health") as unknown as NextRequest;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /api/health readiness vs worker health", () => {
  it("returns 200 with a failing background worker past the grace period (cold start, stale owner)", async () => {
    jest.spyOn(process, "uptime").mockReturnValue(60);
    mockChecks.mockResolvedValue(passingChecks({
      background_worker: { status: "fail", message: "background worker pid 999 is not the registered process (stale owner)" },
    }));

    const res = await GET(request());
    expect(res.status).toBe(200);

    const body = await res.json();
    // the body still tells the full truth: the worker is down
    expect(body.status).toBe("unhealthy");
    expect(body.checks.background_worker.status).toBe("fail");
    // but the platform itself is ready — the worker starts after it
    expect(body.readiness).toBe("healthy");
  });

  it("still returns 503 when a platform check fails past the grace period", async () => {
    jest.spyOn(process, "uptime").mockReturnValue(60);
    mockChecks.mockResolvedValue(passingChecks({
      database: { status: "fail", message: "sqlite error" },
    }));

    const res = await GET(request());
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.status).toBe("unhealthy");
    expect(body.readiness).toBe("unhealthy");
  });

  it("keeps the grace-period downgrade for platform failures during cold start", async () => {
    jest.spyOn(process, "uptime").mockReturnValue(5);
    mockChecks.mockResolvedValue(passingChecks({
      database: { status: "fail", message: "warming up" },
    }));

    const res = await GET(request());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("degraded");
    expect(body.grace_period).toBe(true);
  });
});

describe("readinessHealthStatus", () => {
  it("excludes only the background worker from the readiness verdict", () => {
    const checks = passingChecks({
      background_worker: { status: "fail", message: "down" },
    });
    expect(readinessHealthStatus(checks)).toBe("healthy");

    const degraded = readinessHealthStatus(passingChecks({
      background_worker: { status: "fail", message: "down" },
      redis: { status: "warn", message: "not configured" },
    }));
    expect(degraded).toBe("degraded");
  });
});
