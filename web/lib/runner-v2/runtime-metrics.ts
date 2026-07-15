import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, type Dirent } from "node:fs";
import { basename, dirname, join } from "node:path";
import { withExclusiveFileClaim } from "@/lib/runner-v2/file-claim";

type Json = Record<string, unknown>;

export interface RuntimeProfile extends Json {
  session: string;
  agent_id: string;
  agent_name: string;
  run_id: string;
  started_at: string;
  start_epoch: number;
  status: string;
  snapshots: Json[];
  api_calls: Json[];
  tokens: { total_input: number; total_output: number; total: number; by_model: Record<string, { input: number; output: number; total: number }> };
  memory_samples: number[];
  peak_memory_mb: number;
  cpu_samples: number[];
  avg_cpu_pct: number;
}

export interface PerformanceRecord extends Json {
  run_id: string;
  started: string;
  agents: Record<string, Json>;
  summary: { total_calls: number; total_tokens: number; total_cost_usd: number; total_duration_ms: number };
}

export function runtimeProfilerPath(profilesDir: string, session: string): string {
  return join(requireDirectory(profilesDir, "profiles directory"), `${safeSegment(session, "session")}.json`);
}

export function performanceMetricsPath(metricsDir: string, runId: string): string {
  return join(requireDirectory(metricsDir, "metrics directory"), safeSegment(runId, "run id"), "performance.json");
}

export function startRuntimeProfile(input: { profilesDir: string; session: string; agentId: string; agentName?: string; runId?: string; at?: string; epoch?: number }): string {
  const path = runtimeProfilerPath(input.profilesDir, input.session);
  const profile: RuntimeProfile = {
    session: input.session,
    agent_id: input.agentId,
    agent_name: input.agentName || input.agentId,
    run_id: input.runId || "",
    started_at: input.at || nowIso(),
    start_epoch: input.epoch ?? epochNs(),
    status: "running",
    snapshots: [], api_calls: [],
    tokens: { total_input: 0, total_output: 0, total: 0, by_model: {} },
    memory_samples: [], peak_memory_mb: 0, cpu_samples: [], avg_cpu_pct: 0,
  };
  writeJsonAtomic(path, profile);
  return path;
}

export function snapshotRuntimeProfile(input: { profilesDir: string; session: string; label?: string; at?: string; epoch?: number; memoryMb?: number; cpuPct?: number }): RuntimeProfile {
  const path = runtimeProfilerPath(input.profilesDir, input.session);
  return mutateJson(path, parseProfile, (profile) => {
    const memoryMb = finite(input.memoryMb, 0);
    const cpuPct = finite(input.cpuPct, 0);
    const snapshots = [...profile.snapshots, { label: input.label || "snapshot", timestamp: input.at || nowIso(), epoch: input.epoch ?? epochNs(), memory_mb: memoryMb, cpu_pct: cpuPct }];
    const memorySamples = [...profile.memory_samples, memoryMb];
    const cpuSamples = [...profile.cpu_samples, cpuPct];
    return {
      ...profile, snapshots, memory_samples: memorySamples, cpu_samples: cpuSamples,
      peak_memory_mb: Math.max(profile.peak_memory_mb, memoryMb),
      avg_cpu_pct: cpuSamples.reduce((total, value) => total + value, 0) / cpuSamples.length,
    };
  });
}

export function recordRuntimeProfileTokens(input: { profilesDir: string; session: string; model: string; inputTokens?: number; outputTokens?: number; durationMs?: number; at?: string }): RuntimeProfile {
  const path = runtimeProfilerPath(input.profilesDir, input.session);
  return mutateJson(path, parseProfile, (profile) => {
    const inputTokens = integer(input.inputTokens, 0);
    const outputTokens = integer(input.outputTokens, 0);
    const total = inputTokens + outputTokens;
    const previous = profile.tokens.by_model[input.model] || { input: 0, output: 0, total: 0 };
    return {
      ...profile,
      api_calls: [...profile.api_calls, { model: input.model, timestamp: input.at || nowIso(), input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: total, duration_ms: integer(input.durationMs, 0) }],
      tokens: {
        total_input: profile.tokens.total_input + inputTokens,
        total_output: profile.tokens.total_output + outputTokens,
        total: profile.tokens.total + total,
        by_model: { ...profile.tokens.by_model, [input.model]: { input: previous.input + inputTokens, output: previous.output + outputTokens, total: previous.total + total } },
      },
    };
  });
}

export function endRuntimeProfile(input: { profilesDir: string; session: string; status?: string; error?: string; at?: string; epoch?: number }): RuntimeProfile {
  const path = runtimeProfilerPath(input.profilesDir, input.session);
  return mutateJson(path, parseProfile, (profile) => {
    const endEpoch = input.epoch ?? epochNs();
    return {
      ...profile, status: input.status || "complete", ended_at: input.at || nowIso(), end_epoch: endEpoch,
      duration_ms: endEpoch - profile.start_epoch,
      ...(input.error ? { error: input.error } : {}),
      final_snapshot: { timestamp: input.at || nowIso(), memory_mb: profile.peak_memory_mb, cpu_pct: profile.avg_cpu_pct },
    };
  });
}

export function readRuntimeProfile(profilesDir: string, session: string): RuntimeProfile {
  return parseProfile(readJson(runtimeProfilerPath(profilesDir, session)));
}

export function formatRuntimeProfileFile(profilesDir: string, profilePath: string): string {
  const directory = requireDirectory(profilesDir, "profiles directory");
  const expected = runtimeProfilerPath(directory, basename(profilePath, ".json"));
  if (profilePath !== expected) throw new Error("profile path is outside profiles directory");
  return formatRuntimeProfile(parseProfile(readJson(expected)));
}

export function listRuntimeProfiles(profilesDir: string, runId?: string): RuntimeProfile[] {
  const dir = requireDirectory(profilesDir, "profiles directory");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "export.json")
    .flatMap((entry) => { try { const profile = parseProfile(readJson(join(dir, entry.name))); return !runId || profile.run_id === runId ? [profile] : []; } catch { return []; } });
}

export function exportRuntimeProfiles(profilesDir: string, outputPath?: string): string {
  const target = outputPath || join(requireDirectory(profilesDir, "profiles directory"), "export.json");
  writeJsonAtomic(target, { profiles: listRuntimeProfiles(profilesDir) });
  return target;
}

export function cleanupRuntimeProfiles(profilesDir: string, days: number): number {
  return cleanupChildren(requireDirectory(profilesDir, "profiles directory"), days, (entry) => entry.isFile() && entry.name.endsWith(".json"));
}

export function pricePerMillion(model: string, type: "input" | "output" = "input"): number {
  const prices: Record<string, [number, number]> = {
    "claude-opus-4-6": [15, 75], "claude-sonnet-4-6": [3, 15], "claude-haiku-4-5": [0.8, 4],
    "gpt-4o": [2.5, 10], "gpt-4o-mini": [0.15, 0.6], "o3-mini": [1.1, 11],
  };
  return (prices[model] || [3, 15])[type === "output" ? 1 : 0];
}

export function startPerformanceAgent(input: { metricsDir: string; runId: string; agentId: string; session: string; agentName?: string; at?: string; startMs?: number }): PerformanceRecord {
  const path = performanceMetricsPath(input.metricsDir, input.runId);
  return mutatePerformance(path, (record) => ({
    ...record, run_id: input.runId, started: record.started || input.at || nowIso(),
    agents: { ...record.agents, [input.agentId]: { id: input.agentId, name: input.agentName || input.agentId, session: input.session, started: input.at || nowIso(), start_ms: input.startMs ?? epochNs(), status: "running", api_calls: [], total_calls: 0, total_tokens: 0, total_cost_usd: 0, duration_ms: 0 } },
  }));
}

export function recordPerformanceApiCall(input: { metricsDir: string; runId: string; agentId: string; model: string; inputTokens?: number; outputTokens?: number; durationMs?: number; at?: string }): PerformanceRecord | undefined {
  const path = performanceMetricsPath(input.metricsDir, input.runId);
  if (!existsSync(path)) return undefined;
  return mutatePerformance(path, (record) => {
    const agent = requireAgent(record, input.agentId);
    const inputTokens = integer(input.inputTokens, 0); const outputTokens = integer(input.outputTokens, 0); const total = inputTokens + outputTokens;
    const cost = Number(((inputTokens / 1_000_000) * pricePerMillion(input.model, "input") + (outputTokens / 1_000_000) * pricePerMillion(input.model, "output")).toFixed(6));
    const calls = array(agent.api_calls);
    return { ...record, agents: { ...record.agents, [input.agentId]: { ...agent, api_calls: [...calls, { model: input.model, timestamp: input.at || nowIso(), input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: total, cost_usd: cost, duration_ms: integer(input.durationMs, 0) }], total_calls: integer(agent.total_calls, 0) + 1, total_tokens: integer(agent.total_tokens, 0) + total, total_cost_usd: finite(agent.total_cost_usd, 0) + cost } } };
  });
}

export function endPerformanceAgent(input: { metricsDir: string; runId: string; agentId: string; status?: string; endMs?: number }): PerformanceRecord | undefined {
  const path = performanceMetricsPath(input.metricsDir, input.runId);
  if (!existsSync(path)) return undefined;
  return mutatePerformance(path, (record) => {
    const agent = requireAgent(record, input.agentId); const endMs = input.endMs ?? epochNs();
    const next = { ...agent, status: input.status || "complete", end_ms: endMs, duration_ms: endMs - integer(agent.start_ms, endMs) };
    return { ...record, agents: { ...record.agents, [input.agentId]: next }, summary: summarizeAgents({ ...record.agents, [input.agentId]: next }) };
  });
}

export function performanceAgentSession(metricsDir: string, runId: string, agentId: string): string | undefined {
  const path = performanceMetricsPath(metricsDir, runId); if (!existsSync(path)) return undefined;
  const agent = parsePerformance(readJson(path)).agents[agentId]; return typeof agent?.session === "string" && agent.session ? agent.session : undefined;
}

export function recordPerformanceResource(input: { metricsDir: string; runId: string; agentId: string; cpuPct: number; memPct: number; elapsed: string; at?: string }): PerformanceRecord | undefined {
  const path = performanceMetricsPath(input.metricsDir, input.runId); if (!existsSync(path)) return undefined;
  return mutatePerformance(path, (record) => { const agent = requireAgent(record, input.agentId); return { ...record, agents: { ...record.agents, [input.agentId]: { ...agent, resource_samples: [...array(agent.resource_samples), { timestamp: input.at || nowIso(), cpu_pct: finite(input.cpuPct, 0), mem_pct: finite(input.memPct, 0), elapsed: input.elapsed }] } } }; });
}

export function readPerformanceRecord(metricsDir: string, runId: string): PerformanceRecord { return parsePerformance(readJson(performanceMetricsPath(metricsDir, runId))); }
export function listPerformanceRuns(metricsDir: string): Array<{ runId: string; record: PerformanceRecord }> { const dir = requireDirectory(metricsDir, "metrics directory"); if (!existsSync(dir)) return []; return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name.startsWith("run-")).flatMap((entry) => { try { return [{ runId: entry.name, record: readPerformanceRecord(dir, entry.name) }]; } catch { return []; } }); }
export function cleanupPerformanceRuns(metricsDir: string, days: number): number { return cleanupChildren(requireDirectory(metricsDir, "metrics directory"), days, (entry) => entry.isDirectory() && entry.name.startsWith("run-")); }

export function formatRuntimeProfile(profile: RuntimeProfile): string { return `\n  profile: ${profile.session}\n  agent:   ${profile.agent_name}\n  status:  ${profile.status}\n  ---\n  duration:    ${Math.floor(integer(profile.duration_ms, 0) / 1_000_000_000)}s\n  api calls:   ${profile.api_calls.length}\n  tokens:      ${profile.tokens.total}\n  peak memory: ${profile.peak_memory_mb}MB\n  avg cpu:     ${profile.avg_cpu_pct}%\n`; }
export function formatPerformanceRecord(record: PerformanceRecord): string { const rows = Object.entries(record.agents).map(([id, agent]) => `    ${String(agent.name || id)}:\n      id:        ${String(agent.id || id)}\n      status:    ${String(agent.status || "")}\n      calls:     ${integer(agent.total_calls, 0)}\n      tokens:    ${integer(agent.total_tokens, 0)}\n      cost:      $${finite(agent.total_cost_usd, 0)}\n      duration:  ${integer(agent.duration_ms, 0) / 1_000_000_000}s`).join("\n"); return `\n  performance report:\n  ---\n\n  summary:\n    api calls:     ${record.summary.total_calls}\n    tokens:        ${record.summary.total_tokens}\n    cost:          $${record.summary.total_cost_usd.toFixed(4)}\n    duration:      ${Math.floor(record.summary.total_duration_ms / 1_000_000_000)}s\n\n  agents:\n${rows}\n`; }
export function formatPerformanceRecordFile(metricsDir: string, path: string): string { const directory = requireDirectory(metricsDir, "metrics directory"); const runId = basename(dirname(path)); if (path !== performanceMetricsPath(directory, runId)) throw new Error("performance record path is outside the metrics directory"); return formatPerformanceRecord(readPerformanceRecord(directory, runId)); }

function mutatePerformance(path: string, change: (record: PerformanceRecord) => PerformanceRecord): PerformanceRecord { return mutateJson(path, parsePerformance, change, true); }
function mutateJson<T>(path: string, parse: (value: unknown) => T, change: (value: T) => T, selfHeal = false): T { return withExclusiveFileClaim(`${path}.lock`, () => { let current: T; try { current = existsSync(path) ? parse(readJson(path)) : selfHeal ? parsePerformance({}) as unknown as T : (() => { throw new Error(`runtime metrics record not found: ${path}`); })(); } catch (error) { if (!selfHeal) throw error; current = parsePerformance({}) as unknown as T; } const next = change(current); writeJsonAtomicUnlocked(path, next); return next; }, { waitTimeoutMs: 5_000 }); }
function writeJsonAtomic(path: string, value: unknown): void { withExclusiveFileClaim(`${path}.lock`, () => writeJsonAtomicUnlocked(path, value), { waitTimeoutMs: 5_000 }); }
function writeJsonAtomicUnlocked(path: string, value: unknown): void { mkdirSync(dirname(path), { recursive: true }); const temp = `${path}.tmp-${process.pid}-${Date.now()}`; writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); renameSync(temp, path); }
function readJson(path: string): unknown { return JSON.parse(readFileSync(path, "utf8")) as unknown; }
function parseProfile(value: unknown): RuntimeProfile { const v = record(value); if (!v || typeof v.session !== "string" || typeof v.agent_id !== "string") throw new Error("invalid runtime profiler record"); const tokens = record(v.tokens) || {}; return { ...v, session: v.session, agent_id: v.agent_id, agent_name: string(v.agent_name, v.agent_id), run_id: string(v.run_id, ""), started_at: string(v.started_at, ""), start_epoch: integer(v.start_epoch, 0), status: string(v.status, "running"), snapshots: array(v.snapshots), api_calls: array(v.api_calls), tokens: { total_input: integer(tokens.total_input, 0), total_output: integer(tokens.total_output, 0), total: integer(tokens.total, 0), by_model: record(tokens.by_model) as RuntimeProfile["tokens"]["by_model"] || {} }, memory_samples: array(v.memory_samples).map((item) => finite(item, 0)), peak_memory_mb: finite(v.peak_memory_mb, 0), cpu_samples: array(v.cpu_samples).map((item) => finite(item, 0)), avg_cpu_pct: finite(v.avg_cpu_pct, 0) }; }
function parsePerformance(value: unknown): PerformanceRecord { const v = record(value) || {}; const summary = record(v.summary) || {}; return { ...v, run_id: string(v.run_id, ""), started: string(v.started, ""), agents: (record(v.agents) || {}) as Record<string, Json>, summary: { total_calls: integer(summary.total_calls ?? summary.total_api_calls, 0), total_tokens: integer(summary.total_tokens, 0), total_cost_usd: finite(summary.total_cost_usd, 0), total_duration_ms: integer(summary.total_duration_ms, 0) } }; }
function summarizeAgents(agents: Record<string, Json>): PerformanceRecord["summary"] { const values = Object.values(agents); return { total_calls: values.reduce((total, agent) => total + integer(agent.total_calls, 0), 0), total_tokens: values.reduce((total, agent) => total + integer(agent.total_tokens, 0), 0), total_cost_usd: values.reduce((total, agent) => total + finite(agent.total_cost_usd, 0), 0), total_duration_ms: values.reduce((total, agent) => total + integer(agent.duration_ms, 0) , 0) }; }
function requireAgent(record: PerformanceRecord, agentId: string): Json { const agent = record.agents[agentId]; if (!agent) throw new Error(`performance agent not found: ${agentId}`); return agent; }
function cleanupChildren(dir: string, days: number, include: (entry: Dirent) => boolean): number { if (!existsSync(dir)) return 0; const cutoff = Date.now() - Math.max(0, days) * 86_400_000; let removed = 0; for (const entry of readdirSync(dir, { withFileTypes: true })) { if (!include(entry)) continue; const path = join(dir, entry.name); if (statSync(path).mtimeMs < cutoff) { rmSync(path, { recursive: entry.isDirectory(), force: true }); removed += 1; } } return removed; }
function requireDirectory(path: string, label: string): string { if (!path || !path.startsWith("/")) throw new Error(`${label} must be absolute`); return path; }
function safeSegment(value: string, label: string): string { if (!value || value.includes("/") || value.includes("\\") || value === "." || value === "..") throw new Error(`${label} is invalid`); return value; }
function nowIso(): string { return new Date().toISOString(); } function epochNs(): number { return Date.now() * 1_000_000; } function record(value: unknown): Json | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Json : undefined; } function array(value: unknown): Json[] { return Array.isArray(value) ? value.filter((item): item is Json => Boolean(record(item))) : []; } function integer(value: unknown, fallback: number): number { const parsed = typeof value === "number" ? value : Number(value); return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback; } function finite(value: unknown, fallback: number): number { const parsed = typeof value === "number" ? value : Number(value); return Number.isFinite(parsed) ? parsed : fallback; } function string(value: unknown, fallback: string): string { return typeof value === "string" ? value : fallback; }
