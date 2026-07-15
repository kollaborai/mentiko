import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { withExclusiveFileClaim, ExclusiveFileClaimBusyError } from "@/lib/runner-v2/file-claim";

type NumberMap = Record<string, number>;
type Timer = { count: number; total_ms: number; avg_ms: number; min_ms: number; max_ms: number; type: string };
type Timers = Record<string, Timer>;
type WebhookEvent = { total: number; delivered: number; failed: number; total_rt: number };
type Webhooks = { total: number; delivered: number; failed: number; by_event: Record<string, WebhookEvent> };
type MetricKind = "counters" | "gauges" | "timers" | "active-timers" | "webhooks";

export function metricPaths(metricsDir: string, options: { create?: boolean } = {}): Record<MetricKind, string> {
  if (!metricsDir || !isAbsolute(metricsDir)) throw new Error("Configured metrics directory must be absolute.");
  const dir = resolve(metricsDir);
  if (existsSync(dir)) {
    if (lstatSync(dir).isSymbolicLink()) throw new Error("Configured metrics directory must not be a symbolic link.");
  } else if (options.create) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return { counters: join(dir, "counters.json"), gauges: join(dir, "gauges.json"), timers: join(dir, "timers.json"), "active-timers": join(dir, "active-timers.json"), webhooks: join(dir, "webhooks.json") };
}
export function incrementCounter(dir: string, name: string, delta = 1): void { mutate(dir, "counters", numberMap, (state) => ({ ...state, [key(name)]: (state[key(name)] || 0) + number(delta) })); }
export function setGauge(dir: string, name: string, value: number): void { mutate(dir, "gauges", numberMap, (state) => ({ ...state, [key(name)]: number(value) })); }
export function startMetricTimer(dir: string, name: string, startMs: number): void { mutate(dir, "active-timers", numberMap, (state) => ({ ...state, [key(name)]: integer(startMs) })); }
export function endMetricTimer(dir: string, name: string, type: string, endMs: number): number | undefined {
  const timer = key(name); const end = integer(endMs); let start: number | undefined;
  mutate(dir, "active-timers", numberMap, (state) => { start = state[timer]; const { [timer]: _, ...rest } = state; return rest; });
  if (!start) return undefined;
  const duration = Math.max(0, end - start); const timerKey = `${key(type)}_${timer}`;
  mutate(dir, "timers", timers, (state) => { const prior = state[timerKey]; const count = (prior?.count || 0) + 1; const total = (prior?.total_ms || 0) + duration; return { ...state, [timerKey]: { count, total_ms: total, avg_ms: Math.floor(total / count), min_ms: prior ? Math.min(prior.min_ms, duration) : duration, max_ms: prior ? Math.max(prior.max_ms, duration) : duration, type: key(type) } }; });
  return duration;
}
export function recordWebhookMetric(dir: string, event: string, status: string, responseMs = 0): void { mutate(dir, "webhooks", webhooks, (state) => { const delivered = status === "delivered"; const prior = state.by_event[key(event)] || { total: 0, delivered: 0, failed: 0, total_rt: 0 }; return { total: state.total + 1, delivered: state.delivered + Number(delivered), failed: state.failed + Number(!delivered), by_event: { ...state.by_event, [key(event)]: { total: prior.total + 1, delivered: prior.delivered + Number(delivered), failed: prior.failed + Number(!delivered), total_rt: prior.total_rt + number(responseMs) } } }; }); }
export function resetLegacyMetrics(dir: string): void {
  mutate(dir, "counters", numberMap, () => ({}));
  mutate(dir, "gauges", numberMap, () => ({}));
  mutate(dir, "timers", timers, () => ({}));
  mutate(dir, "webhooks", webhooks, () => ({ total: 0, delivered: 0, failed: 0, by_event: {} }));
}
export function readLegacyMetrics(dir: string): { generated: string; counters: NumberMap; gauges: NumberMap; timers: Timers; webhooks: Webhooks } { const paths = metricPaths(dir); return { generated: new Date().toISOString(), counters: read(paths.counters, numberMap), gauges: read(paths.gauges, numberMap), timers: read(paths.timers, timers), webhooks: read(paths.webhooks, webhooks) }; }
export function metricsJson(dir: string): string { return JSON.stringify(readLegacyMetrics(dir)); }
export function formatLegacyMetrics(dir: string): string { const m=readLegacyMetrics(dir); return ["", "  mentiko metrics:", "  ---", "  counters:", ...Object.entries(m.counters).map(([k,v])=>`    ${k}: ${v}`), "", "  gauges:", ...Object.entries(m.gauges).map(([k,v])=>`    ${k}: ${v}`), "", "  timers (avg ms):", ...Object.entries(m.timers).map(([k,v])=>`    ${k}: ${v.avg_ms}ms (${v.count} calls)`), "", "  webhooks:", `    total: ${m.webhooks.total}`, `    delivered: ${m.webhooks.delivered}`, `    failed: ${m.webhooks.failed}`, ""].join("\n"); }
export function prometheusMetrics(dir: string): string { const paths = metricPaths(dir); const c = read(paths.counters, numberMap), g = read(paths.gauges, numberMap), t = read(paths.timers, timers), w = read(paths.webhooks, webhooks); const esc=(v:string)=>v.replace(/\\|"|\n/g,"_"); const lines=["# mentiko metrics", `# generated ${new Date().toISOString()}`, "", "# HELP mentiko_counter Counter metrics", "# TYPE mentiko_counter gauge", ...Object.entries(c).map(([k,v])=>`mentiko_counter{name="${esc(k)}"} ${v}`), "", "# HELP mentiko_gauge Gauge metrics", "# TYPE mentiko_gauge gauge", ...Object.entries(g).map(([k,v])=>`mentiko_gauge{name="${esc(k)}"} ${v}`), "", "# HELP mentiko_timer_ms Timer metrics in milliseconds", "# TYPE mentiko_timer_count gauge", ...Object.entries(t).flatMap(([k,v])=>[`mentiko_timer_count{name="${esc(k)}"} ${v.count}`,`mentiko_timer_avg_ms{name="${esc(k)}"} ${v.avg_ms}`,`mentiko_timer_max_ms{name="${esc(k)}"} ${v.max_ms}`]), "", `mentiko_webhook_total ${w.total}`, `mentiko_webhook_delivered ${w.delivered}`, `mentiko_webhook_failed ${w.failed}`, `mentiko_webhook_success_rate ${w.total ? ((w.delivered / w.total) * 100).toFixed(2) : 0}`, ...Object.entries(w.by_event).flatMap(([k,v])=>[`mentiko_webhook_by_event{event="${esc(k)}",status="delivered"} ${v.delivered}`,`mentiko_webhook_by_event{event="${esc(k)}",status="failed"} ${v.failed}`])]; return lines.join("\n"); }
export function validateRawLegacyMetric(content:string): {valid:boolean; value?:Record<string,unknown>; issue?:string} { if(!content.trim())return {valid:false,issue:"empty-file"}; try { const value=JSON.parse(content); return record(value)?{valid:true,value}:{valid:false,issue:"invalid-root"}; } catch{return {valid:false,issue:"invalid-json"};} }
function mutate<T>(dir:string, kind:MetricKind, parse:(value:unknown)=>T, update:(state:T)=>T):void { const path=metricPaths(dir, { create: true })[kind]; assertSafe(path); assertSafe(`${path}.lock`); try { withExclusiveFileClaim(`${path}.lock`,()=>write(path, update(read(path,parse)))); } catch (error) { if (!(error instanceof ExclusiveFileClaimBusyError)) throw error; } }
function read<T>(path:string, parse:(value:unknown)=>T):T { if (!existsSync(path)) return parse(initial(kindFrom(path))); assertSafe(path); const raw=validateRawLegacyMetric(readFileSync(path,"utf8")); if(!raw.valid||!raw.value) throw new Error(`Invalid raw metrics JSON (${raw.issue}): ${path}`); return parse(raw.value); }
function write(path:string,value:unknown):void { assertSafe(path); const temp=`${path}.${process.pid}.${randomUUID()}.tmp`; try { writeFileSync(temp,`${JSON.stringify(value)}\n`,{flag:"wx",mode:0o600}); renameSync(temp,path); } finally { if(existsSync(temp)) rmSync(temp,{force:true}); } }
function assertSafe(path:string):void{if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw new Error(`Metrics path must not be a symbolic link: ${path}`)}
function initial(kind:MetricKind):unknown { return kind === "webhooks" ? {total:0,delivered:0,failed:0,by_event:{}} : {}; }
function kindFrom(path:string):MetricKind { const name=path.split("/").pop()?.replace(".json",""); if(name === "active-timers") return name; if(name === "counters"||name==="gauges"||name==="timers"||name==="webhooks") return name; throw new Error("Unknown metrics record"); }
function numberMap(value:unknown):NumberMap { if(!record(value)) throw new Error("Invalid normalized metrics number map"); for(const [k,v] of Object.entries(value)) { key(k); number(v); } return value as NumberMap; }
function timers(value:unknown):Timers { if(!record(value)) throw new Error("Invalid normalized timer metrics"); for(const [k,v] of Object.entries(value)){key(k); if(!record(v)||typeof v.type!=="string") throw new Error("Invalid normalized timer metric"); for(const f of ["count","total_ms","avg_ms","min_ms","max_ms"]) number(v[f]);} return value as Timers; }
function webhooks(value:unknown):Webhooks { if(!record(value)||!record(value.by_event)) throw new Error("Invalid normalized webhook metrics"); for(const f of ["total","delivered","failed"]) number(value[f]); for(const [k,v] of Object.entries(value.by_event)){key(k); if(!record(v)) throw new Error("Invalid normalized webhook event metric"); for(const f of ["total","delivered","failed","total_rt"]) number(v[f]);} return value as Webhooks; }
function record(v:unknown):v is Record<string,unknown>{return typeof v==="object"&&v!==null&&!Array.isArray(v)} function key(v:string):string{if(!v?.trim()||v.length>240)throw new Error("Metric key must be non-empty and at most 240 characters.");return v} function number(v:unknown):number{if(typeof v!=="number"||!Number.isFinite(v))throw new Error("Metric value must be finite.");return v} function integer(v:unknown):number{const n=number(v);if(!Number.isSafeInteger(n)||n<0)throw new Error("Metric time must be a non-negative safe integer.");return n}
