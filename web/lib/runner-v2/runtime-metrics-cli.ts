#!/usr/bin/env node
import * as metrics from "@/lib/runner-v2/runtime-metrics";

export function runRuntimeMetricsCli(argv: string[], env: NodeJS.ProcessEnv = process.env, write: (line: string) => void = console.log): void {
  const [scope, command, ...args] = argv;
  const profilesDir = env.PROFILES_DIR || joinRoot(env, "profiles");
  const metricsDir = env.METRICS_DIR || joinRoot(env, "metrics");
  if (scope === "profile") {
    if (command === "start") return write(metrics.startRuntimeProfile({ profilesDir, session: required(args, 0), agentId: required(args, 1), agentName: args[2], runId: args[3] }));
    if (command === "snapshot") return write(JSON.stringify(metrics.snapshotRuntimeProfile({ profilesDir, session: required(args, 0), label: args[1], at: args[2], epoch: number(args[3]), memoryMb: number(args[4]), cpuPct: number(args[5]) })));
    if (command === "tokens") return write(JSON.stringify(metrics.recordRuntimeProfileTokens({ profilesDir, session: required(args, 0), model: required(args, 1), inputTokens: number(args[2]), outputTokens: number(args[3]), durationMs: number(args[4]) })));
    if (command === "end") { const session = required(args, 0); metrics.endRuntimeProfile({ profilesDir, session, status: args[1], error: args[2] }); return write(metrics.runtimeProfilerPath(profilesDir, session)); }
    if (command === "get") { const profile = metrics.readRuntimeProfile(profilesDir, required(args, 0)); return write(args[1] === "text" ? metrics.formatRuntimeProfile(profile) : JSON.stringify(profile)); }
    if (command === "format-file") return write(metrics.formatRuntimeProfileFile(profilesDir, required(args, 0)));
    if (command === "list") { const profiles = metrics.listRuntimeProfiles(profilesDir); return write(args[0] === "json" ? JSON.stringify(profiles) : formatProfileList(profiles, args[0])); }
    if (command === "compare") return write(formatProfileCompare(args.map((session) => metrics.readRuntimeProfile(profilesDir, session))));
    if (command === "aggregate") return write(formatProfileAggregate(metrics.listRuntimeProfiles(profilesDir, args[0])));
    if (command === "export") return write(metrics.exportRuntimeProfiles(profilesDir, args[0]));
    if (command === "cleanup") { const days = number(args[0]) ?? 30; metrics.cleanupRuntimeProfiles(profilesDir, days); return write(`  cleaned profiles older than ${days} days`); }
  }
  if (scope === "performance") {
    if (command === "price") return write(String(metrics.pricePerMillion(required(args, 0), args[1] === "output" ? "output" : "input")));
    if (command === "start") return write(JSON.stringify(metrics.startPerformanceAgent({ metricsDir, runId: required(args, 0), agentId: required(args, 1), session: required(args, 2), agentName: args[3] })));
    if (command === "record") return write(JSON.stringify(metrics.recordPerformanceApiCall({ metricsDir, runId: required(args, 0), agentId: required(args, 1), model: required(args, 2), inputTokens: number(args[3]), outputTokens: number(args[4]), durationMs: number(args[5]) }) || {}));
    if (command === "end") return write(JSON.stringify(metrics.endPerformanceAgent({ metricsDir, runId: required(args, 0), agentId: required(args, 1), status: args[2] }) || {}));
    if (command === "session") return write(metrics.performanceAgentSession(metricsDir, required(args, 0), required(args, 1)) || "");
    if (command === "resource") return write(JSON.stringify(metrics.recordPerformanceResource({ metricsDir, runId: required(args, 0), agentId: required(args, 1), cpuPct: number(args[2]) || 0, memPct: number(args[3]) || 0, elapsed: args[4] || "" }) || {}));
    if (command === "report") { const record = metrics.readPerformanceRecord(metricsDir, required(args, 0)); return write(args[1] === "text" ? metrics.formatPerformanceRecord(record) : JSON.stringify(record)); }
    if (command === "format-file") return write(metrics.formatPerformanceRecordFile(metricsDir, required(args, 0)));
    if (command === "list") return metrics.listPerformanceRuns(metricsDir).forEach(({ runId, record }) => write(`${runId} ${JSON.stringify({ id: record.run_id, cost: record.summary.total_cost_usd, tokens: record.summary.total_tokens, agents: Object.keys(record.agents).length })}`));
    if (command === "cleanup") { const days = number(args[0]) ?? 30; metrics.cleanupPerformanceRuns(metricsDir, days); return write(`  cleaned performance data older than ${days} days`); }
  }
  throw new Error("usage: runner-runtime-metrics <profile|performance> <command> ...");
}
function required(values: string[], index: number): string { const value = values[index]; if (!value) throw new Error("required argument missing"); return value; }
function number(value: string | undefined): number | undefined { if (value === undefined || value === "") return undefined; const parsed = Number(value); if (!Number.isFinite(parsed)) throw new Error(`invalid number: ${value}`); return parsed; }
function joinRoot(env: NodeJS.ProcessEnv, child: string): string { const root = env.MENTIKO_PROJECT_ROOT || env.MENTIKO_NAMESPACE_ROOT || env.HOME && `${env.HOME}/.mentiko/namespaces/${env.NAMESPACE_ID || "default"}`; if (!root) throw new Error("runtime root is required"); return `${root}/${child}`; }
function formatProfileList(profiles: metrics.RuntimeProfile[], format?: string): string { const lines = ["", "  profiles:", "  ---"]; for (const p of profiles) { const seconds = Math.floor(Number(p.duration_ms || 0) / 1_000_000_000); if (format === "short" || !format) lines.push(`    ${p.session.padEnd(20)} ${p.agent_name.padEnd(15)} ${p.status.padEnd(10)} ${String(seconds).padStart(4)}s ${String(p.tokens.total).padStart(5)} tokens`); else lines.push(`    ${p.session}\n      agent:     ${p.agent_name}\n      status:    ${p.status}\n      duration:  ${seconds}s\n      tokens:    ${p.tokens.total}\n`); } return lines.join("\n"); }
function formatProfileCompare(profiles: metrics.RuntimeProfile[]): string { return ["", "  comparison:", "  ---", "    session              status         duration     tokens    mem(mb)     cpu(%)", "    ----------------------------------------------------------------------", ...profiles.map((p) => `    ${p.session.padEnd(20)} ${p.status.padEnd(12)} ${`${Number(p.duration_ms || 0) / 1_000_000_000}s`.padStart(10)} ${String(p.tokens.total).padStart(10)} ${String(p.peak_memory_mb).padStart(10)} ${`${p.avg_cpu_pct}%`.padStart(10)}`), ""].join("\n"); }
function formatProfileAggregate(profiles: metrics.RuntimeProfile[]): string { const duration = profiles.reduce((sum, p) => sum + Number(p.duration_ms || 0), 0); const tokens = profiles.reduce((sum, p) => sum + p.tokens.total, 0); const calls = profiles.reduce((sum, p) => sum + p.api_calls.length, 0); const count = profiles.length; return ["", "  aggregate stats:", "  ---", `  sessions:     ${count}`, `  total time:   ${Math.floor(duration / 1_000_000_000)}s`, `  total tokens: ${tokens}`, `  total calls:  ${calls}`, ...(count ? [`  avg time:     ${Math.floor(duration / count / 1_000_000_000)}s`, `  avg tokens:   ${Math.floor(tokens / count)}`] : []), ""].join("\n"); }
if (require.main === module) { try { runRuntimeMetricsCli(process.argv.slice(2)); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; } }
