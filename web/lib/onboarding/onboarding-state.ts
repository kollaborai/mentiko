import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "fs";
import path from "path";
import { orgPath } from "@/lib/config";

export type OnboardingStatus = "not_started" | "in_progress" | "ready" | "needs_attention" | "unverified" | "completed";
export interface OnboardingRecord {
  schemaVersion: 1; setupVersion: number; revision: number;
  provider: { selectedCli: string | null; selectedProfileId: string | null; defaultVerified: boolean; status: OnboardingStatus };
  inputBar: { status: OnboardingStatus; available: boolean };
  github: { status: string; account: unknown };
  workspace: { status: OnboardingStatus; id: string | null };
  readiness: { status: OnboardingStatus; runId: string | null; operationId: string | null };
  sampleRun: { status: OnboardingStatus; runId: string | null; operationId: string | null };
  operations: Record<string, { operationId: string; idempotencyKey: string; kind: string; status: string; phase: string; createdAt: string; result?: unknown }>;
}
const DEFAULT: OnboardingRecord = { schemaVersion: 1, setupVersion: 10, revision: 0,
  provider: { selectedCli: null, selectedProfileId: null, defaultVerified: false, status: "needs_attention" },
  inputBar: { status: "not_started", available: true }, github: { status: "not_connected", account: null },
  workspace: { status: "not_started", id: null }, readiness: { status: "not_started", runId: null, operationId: null }, sampleRun: { status: "not_started", runId: null, operationId: null }, operations: {} };
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function file(ns: string, org: string) { return orgPath(ns, org, "settings", "onboarding", "state.json"); }
export function readOnboardingState(ns: string, org: string): OnboardingRecord { const f=file(ns,org); if (!existsSync(f)) return clone(DEFAULT); try { return { ...clone(DEFAULT), ...JSON.parse(readFileSync(f,"utf8")) }; } catch { return clone(DEFAULT); } }
export function writeOnboardingState(ns: string, org: string, state: OnboardingRecord, expectedRevision?: number) { const current=readOnboardingState(ns,org); if (expectedRevision !== undefined && current.revision !== expectedRevision) throw new Error("STATE_CONFLICT"); state.revision=current.revision+1; const f=file(ns,org); mkdirSync(path.dirname(f),{recursive:true}); const tmp=`${f}.${process.pid}.tmp`; writeFileSync(tmp,JSON.stringify(state,null,2),{mode:0o600}); renameSync(tmp,f); return state; }
export function operation(ns:string,org:string,kind:string,key:string) { const s=readOnboardingState(ns,org); return Object.values(s.operations).find(o=>o.kind===kind&&o.idempotencyKey===key); }
export function nextOperation(ns:string,org:string,kind:string,key:string,phase:string) { const existing=operation(ns,org,kind,key); if(existing) return { state:readOnboardingState(ns,org), op:existing }; const operationId=`onb_${crypto.randomUUID()}`; const op={operationId,idempotencyKey:key,kind,status:"completed",phase,createdAt:new Date().toISOString()}; const s=readOnboardingState(ns,org); s.operations[operationId]=op; return { state:writeOnboardingState(ns,org,s),op }; }
export function deriveNextAction(s: OnboardingRecord): string { if (s.provider.status!=="ready") return "provider"; if (s.workspace.status!=="ready") return "project"; if (s.readiness.status!=="ready") return "readiness"; if (s.sampleRun.status!=="completed") return "sample"; return "done"; }
