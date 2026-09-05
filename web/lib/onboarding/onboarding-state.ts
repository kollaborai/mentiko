import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "fs";
import path from "path";
import { orgPath } from "@/lib/config";

// Re-exported for existing (server-side) importers. A client component
// should import these from ./onboarding-constants directly — see that
// file's header for why this module itself is never client-safe.
import { CURRENT_SETUP_VERSION, READINESS_DEADLINE_MS, SAMPLE_RUN_DEADLINE_MS } from "@/lib/onboarding/onboarding-constants";
export { CURRENT_SETUP_VERSION, READINESS_DEADLINE_MS, SAMPLE_RUN_DEADLINE_MS };
export type OnboardingStatus = "not_started" | "in_progress" | "needs_attention" | "ready" | "skipped" | "not_available" | "completed" | "unverified";
export type OperationStatus = "queued" | "running" | "in_progress" | "completed" | "failed" | "timed_out" | "cancelled" | "recovered";
export interface OnboardingOperation {
  operationId: string; idempotencyKey: string; requestFingerprint?: string;
  kind: string; status: OperationStatus | string; phase: string;
  createdAt: string; updatedAt?: string; deadlineAt?: string; terminalAt?: string;
  result?: unknown; errorCode?: string; errorMessage?: string;
}
export interface OnboardingRecord {
  schemaVersion: 1; setupVersion: number; revision: number; updatedAt?: string;
  currentStep?: number;
  selectedProfileDisplayName?: string | null; selectedProfileModel?: string | null;
  defaultIntent?: "use_selected" | "keep_current" | "explicit_chain_only";
  defaultVerifiedAt?: string | null; advisorDefaultProfileId?: string | null;
  advisorDefaultVerified?: boolean; authMethod?: "interactive_cli" | "provider_api_key" | "oauth_app";
  authState?: string; inputBarBackend?: string | null; inputBarOperationId?: string | null;
  githubConnectionState?: string; githubAccountLogin?: string | null; githubConnectionId?: string | null;
  selectedRepository?: string | null; selectedBranch?: string | null; workspaceName?: string | null;
  workspaceOperationId?: string | null; readinessRunId?: string | null; readinessOperationId?: string | null;
  sampleChainId?: string | null; sampleRunId?: string | null; sampleOperationId?: string | null;
  activeOperationId?: string | null; lastError?: { code: string; message: string } | null;
  provider: { selectedCli: string | null; selectedProfileId: string | null; defaultVerified: boolean; status: OnboardingStatus; lastError?: string | null };
  inputBar: { status: OnboardingStatus; available: boolean };
  github: { status: string; account: unknown };
  workspace: { status: OnboardingStatus; id: string | null };
  readiness: OnboardingRunMilestone;
  sampleRun: OnboardingRunMilestone;
  operations: Record<string, OnboardingOperation>;
}
/**
 * Derived-status envelope for a run-backed milestone (readiness / sampleRun).
 * `status` is the canonical six-value milestone enum (G7); `runStatus` is the
 * raw run/operation lifecycle detail ("queued" | "running" | "completed" |
 * "failed" | "blocked" | "cancelled" | "stopped" | "stalled" | "timed_out" |
 * "missing"), never surfaced as `status` itself. `lastError` is a short safe
 * reason (e.g. "unverified") — never a secret or raw provider trace.
 */
export interface OnboardingRunMilestone {
  status: OnboardingStatus;
  runId: string | null;
  operationId: string | null;
  runStatus?: string;
  deadlineAt?: string | null;
  lastError?: string | null;
}
const DEFAULT: OnboardingRecord = { schemaVersion: 1, setupVersion: CURRENT_SETUP_VERSION, revision: 0,
  provider: { selectedCli: null, selectedProfileId: null, defaultVerified: false, status: "needs_attention" },
  inputBar: { status: "not_started", available: true }, github: { status: "not_connected", account: null },
  workspace: { status: "not_started", id: null }, readiness: { status: "not_started", runId: null, operationId: null },
  sampleRun: { status: "not_started", runId: null, operationId: null }, operations: {} };
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function file(ns: string, org: string) { return orgPath(ns, org, "settings", "onboarding", "state.json"); }
function mergeRecord(raw: Partial<OnboardingRecord>): OnboardingRecord {
  const out = { ...clone(DEFAULT), ...raw } as OnboardingRecord;
  out.provider = { ...DEFAULT.provider, ...(raw.provider || {}) };
  out.inputBar = { ...DEFAULT.inputBar, ...(raw.inputBar || {}) };
  out.github = { ...DEFAULT.github, ...(raw.github || {}) };
  out.workspace = { ...DEFAULT.workspace, ...(raw.workspace || {}) };
  out.readiness = { ...DEFAULT.readiness, ...(raw.readiness || {}) };
  out.sampleRun = { ...DEFAULT.sampleRun, ...(raw.sampleRun || {}) };
  out.operations = { ...(raw.operations || {}) };
  // Older records are re-derived by callers; additive defaults keep reads safe.
  if (!out.setupVersion || out.setupVersion < CURRENT_SETUP_VERSION) out.setupVersion = CURRENT_SETUP_VERSION;
  return out;
}
export function readOnboardingState(ns: string, org: string): OnboardingRecord {
  const f=file(ns,org); if (!existsSync(f)) return clone(DEFAULT);
  try { return mergeRecord(JSON.parse(readFileSync(f,"utf8"))); } catch { return clone(DEFAULT); }
}
// A fresh idempotencyKey per click (client bug, tracked separately) means
// nextOperation() mints a new operation every time instead of reusing one —
// the ledger never GCs on its own. Cap it here so state.json can't grow
// unbounded: keep only the most recent MAX_OPERATIONS_PER_KIND per kind.
const MAX_OPERATIONS_PER_KIND = 20;
function pruneOperations(operations: Record<string, OnboardingOperation>): Record<string, OnboardingOperation> {
  const byKind = new Map<string, OnboardingOperation[]>();
  for (const op of Object.values(operations)) {
    const list = byKind.get(op.kind);
    if (list) list.push(op); else byKind.set(op.kind, [op]);
  }
  const kept: Record<string, OnboardingOperation> = {};
  for (const list of byKind.values()) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const op of list.slice(-MAX_OPERATIONS_PER_KIND)) kept[op.operationId] = op;
  }
  return kept;
}
export function writeOnboardingState(ns: string, org: string, state: OnboardingRecord, expectedRevision?: number) {
  const current=readOnboardingState(ns,org);
  if (expectedRevision !== undefined && current.revision !== expectedRevision) throw new Error("STATE_CONFLICT");
  state.revision=current.revision+1; state.updatedAt = new Date().toISOString();
  state.operations = pruneOperations(state.operations);
  const f=file(ns,org); mkdirSync(path.dirname(f),{recursive:true}); const tmp=`${f}.${process.pid}.tmp`;
  writeFileSync(tmp,JSON.stringify(state,null,2),{mode:0o600}); renameSync(tmp,f); return state;
}
export function operation(ns:string,org:string,kind:string,key:string, fingerprint?: string) {
  const s=readOnboardingState(ns,org);
  const found = Object.values(s.operations).find(o=>o.kind===kind&&o.idempotencyKey===key);
  if (found && fingerprint !== undefined && found.requestFingerprint !== undefined && found.requestFingerprint !== fingerprint) throw new Error("IDEMPOTENCY_CONFLICT");
  return found;
}
export function nextOperation(ns:string,org:string,kind:string,key:string,phase:string, fingerprint?: string, deadlineMs?: number) {
  const existing=operation(ns,org,kind,key,fingerprint);
  if(existing) { const state=readOnboardingState(ns,org); const deadline=existing.deadlineAt ? Date.parse(existing.deadlineAt) : NaN; if ((existing.status === "in_progress" || existing.status === "running" || existing.status === "queued") && Number.isFinite(deadline) && deadline <= Date.now()) { const timedOut={...existing,status:"timed_out",terminalAt:new Date().toISOString(),updatedAt:new Date().toISOString(),errorCode:"DEADLINE_EXCEEDED",errorMessage:"Operation deadline exceeded"}; state.operations[existing.operationId]=timedOut; return { state:writeOnboardingState(ns,org,state), op:timedOut, reused:true }; } return { state, op:existing, reused:true }; }
  const now = new Date(); const operationId=`onb_${crypto.randomUUID()}`;
  const op: OnboardingOperation={operationId,idempotencyKey:key,requestFingerprint:fingerprint,kind,status:"in_progress",phase,createdAt:now.toISOString(),updatedAt:now.toISOString(),deadlineAt:deadlineMs ? new Date(now.getTime()+deadlineMs).toISOString() : undefined};
  const s=readOnboardingState(ns,org); s.operations[operationId]=op; return { state:writeOnboardingState(ns,org,s),op, reused:false };
}
// G4: provider.status only reaches "ready" once readiness proves it (see
// derive-onboarding-state.ts). Gating nextAction on status==="ready" would
// deadlock — the user could never reach the "readiness" step that produces
// that proof. "provider" is next only while genuinely unactivated or failed;
// once activated (in_progress, awaiting proof) nextAction moves on so the
// readiness step itself can run.
export function deriveNextAction(s: OnboardingRecord): string { if (!s.provider.selectedProfileId || !s.provider.defaultVerified || s.provider.status==="needs_attention") return "provider"; if (s.workspace.status!=="ready") return "project"; if (s.readiness.status!=="ready") return "readiness"; if (s.sampleRun.status!=="completed" && s.sampleRun.status!=="ready") return "sample"; return "done"; }
