import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanupPerformanceRuns,
  cleanupRuntimeProfiles,
  endPerformanceAgent,
  endRuntimeProfile,
  formatRuntimeProfileFile,
  formatPerformanceRecordFile,
  formatPerformanceRecord,
  formatRuntimeProfile,
  performanceAgentSession,
  pricePerMillion,
  readPerformanceRecord,
  readRuntimeProfile,
  recordPerformanceApiCall,
  recordPerformanceResource,
  recordRuntimeProfileTokens,
  snapshotRuntimeProfile,
  startPerformanceAgent,
  startRuntimeProfile,
} from "@/lib/runner-v2/runtime-metrics";

function root() { return mkdtempSync(join(tmpdir(), "mentiko-runtime-metrics-")); }

describe("typed runtime profiler and performance metrics", () => {
  it("preserves the runtime profile JSON shape through snapshot, token, and terminal updates", () => {
    const dir = join(root(), "profiles");
    startRuntimeProfile({ profilesDir: dir, session: "writer-run-1", agentId: "writer", agentName: "Writer", runId: "run-1", at: "2026-07-15T00:00:00.000Z", epoch: 10 });
    snapshotRuntimeProfile({ profilesDir: dir, session: "writer-run-1", label: "monitor-check", at: "2026-07-15T00:00:01.000Z", epoch: 20, memoryMb: 42, cpuPct: 12.5 });
    recordRuntimeProfileTokens({ profilesDir: dir, session: "writer-run-1", model: "gpt-4o", inputTokens: 10, outputTokens: 5, durationMs: 8, at: "2026-07-15T00:00:02.000Z" });
    endRuntimeProfile({ profilesDir: dir, session: "writer-run-1", status: "complete", at: "2026-07-15T00:00:03.000Z", epoch: 40 });

    const profile = readRuntimeProfile(dir, "writer-run-1");
    expect(profile).toMatchObject({
      session: "writer-run-1", agent_id: "writer", status: "complete", duration_ms: 30,
      tokens: { total_input: 10, total_output: 5, total: 15, by_model: { "gpt-4o": { input: 10, output: 5, total: 15 } } },
      peak_memory_mb: 42, avg_cpu_pct: 12.5,
      final_snapshot: { memory_mb: 42, cpu_pct: 12.5 },
    });
    expect(formatRuntimeProfile(profile)).toContain("profile: writer-run-1");
    expect(formatRuntimeProfileFile(dir, join(dir, "writer-run-1.json"))).toContain("profile: writer-run-1");
  });

  it("owns performance RMW, price calculation, resources, and summary without shell JSON mutation", () => {
    const dir = join(root(), "metrics");
    startPerformanceAgent({ metricsDir: dir, runId: "run-1", agentId: "writer", session: "writer-run-1", agentName: "Writer", at: "2026-07-15T00:00:00.000Z", startMs: 10 });
    recordPerformanceApiCall({ metricsDir: dir, runId: "run-1", agentId: "writer", model: "gpt-4o", inputTokens: 1_000_000, outputTokens: 500_000, durationMs: 20, at: "2026-07-15T00:00:01.000Z" });
    recordPerformanceResource({ metricsDir: dir, runId: "run-1", agentId: "writer", cpuPct: 5.1, memPct: 2.3, elapsed: "00:01" });
    endPerformanceAgent({ metricsDir: dir, runId: "run-1", agentId: "writer", endMs: 50 });

    const record = readPerformanceRecord(dir, "run-1");
    expect(performanceAgentSession(dir, "run-1", "writer")).toBe("writer-run-1");
    expect(record).toMatchObject({
      run_id: "run-1",
      agents: { writer: { total_calls: 1, total_tokens: 1_500_000, total_cost_usd: 7.5, duration_ms: 40, resource_samples: [expect.objectContaining({ cpu_pct: 5.1, mem_pct: 2.3 })] } },
      summary: { total_calls: 1, total_tokens: 1_500_000, total_cost_usd: 7.5, total_duration_ms: 40 },
    });
    expect(pricePerMillion("gpt-4o", "output")).toBe(10);
    expect(formatPerformanceRecord(record)).toContain("performance report:");
    expect(formatPerformanceRecordFile(dir, join(dir, "run-1", "performance.json"))).toContain("performance report:");
  });

  it("self-heals corrupt performance JSON but never invents a missing record for best-effort calls", () => {
    const dir = join(root(), "metrics");
    expect(recordPerformanceApiCall({ metricsDir: dir, runId: "run-missing", agentId: "writer", model: "gpt-4o" })).toBeUndefined();
    startPerformanceAgent({ metricsDir: dir, runId: "run-1", agentId: "old", session: "old" });
    const path = join(dir, "run-1", "performance.json");
    writeFileSync(path, "not json");
    startPerformanceAgent({ metricsDir: dir, runId: "run-1", agentId: "writer", session: "writer-run-1" });
    expect(readPerformanceRecord(dir, "run-1").agents.writer).toEqual(expect.objectContaining({ session: "writer-run-1" }));
  });

  it("cleans only expired contract records", () => {
    const base = root(); const profiles = join(base, "profiles"); const metrics = join(base, "metrics");
    startRuntimeProfile({ profilesDir: profiles, session: "old", agentId: "old" });
    startPerformanceAgent({ metricsDir: metrics, runId: "run-old", agentId: "old", session: "old" });
    const old = new Date(Date.now() - 3 * 86_400_000);
    utimesSync(join(profiles, "old.json"), old, old);
    utimesSync(join(metrics, "run-old"), old, old);
    expect(cleanupRuntimeProfiles(profiles, 1)).toBe(1);
    expect(cleanupPerformanceRuns(metrics, 1)).toBe(1);
  });

  it("keeps shell wrappers at the OS/PTY collection boundary", () => {
    const profiler = readFileSync(join(process.cwd(), "..", "lib", "profiler.sh"), "utf8");
    const performance = readFileSync(join(process.cwd(), "..", "lib", "performance.sh"), "utf8");
    for (const source of [profiler, performance]) {
      expect(source).toContain("runner-runtime-metrics.js");
      expect(source).not.toMatch(/\bjq\b|\bmv\b|\bmkdir\b|\bfind\b/);
    }
    expect(profiler).toContain("ps -p");
    expect(performance).toContain("transport_pid");
  });
});
