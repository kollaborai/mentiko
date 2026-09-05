// -------------------------------------------------------------------
// derive-onboarding-state.ts — turn a run/operation pointer into real status.
// -------------------------------------------------------------------
// onboarding-state.ts's readiness/sampleRun records are POINTERS written once
// at operation start ("in_progress" + a runId). Nothing else ever reads the
// run back, so a run that finished (or died) minutes ago still reads
// "in_progress" forever. Per the spec's "Derived status" section: the record
// is a pointer to the last action, not permission to claim success.
//
// deriveOnboardingState re-derives readiness/sampleRun from the live run
// record on every read (readRunRecordAt/readAgentStates/mergeAgentStates —
// the same helpers app/api/runs/[id]/route.ts uses), and — only when that
// changes the milestone's terminal status — persists it back (CAS) so the
// operations ledger actually closes instead of dangling in_progress.
//
// Readiness additionally requires proof the CLI startup readiness policy
// actually passed (classifyCliReadiness, forced fail-closed regardless of the
// ambient MENTIKO_READINESS_FAIL_CLOSED flag — spec G4 / Phase 2): a chain
// that merely reached "completed" is not enough when its profile's readiness
// was disabled, unconfigured, or never proven. A disabled/unknown/
// no_ready_signal result is needs_attention with reason "unverified" here —
// never "ready". The sample run has no such extra gate: its own completion
// (with its one agent genuinely "complete") is the whole proof.
// -------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import config from "@/lib/config";
import { resolveLinkRunsDir } from "@/lib/links/link-run-runtime";
import { getProfile } from "@/lib/agents/agent-profile-storage";
import { classifyCliReadiness } from "@/lib/runner-v2/readiness-policy";
import { readRunRecordAt, type RunRecord } from "@/lib/runs/run-record";
import { readAgentStates, mergeAgentStates } from "@/lib/runs/run-state";
import {
  readOnboardingState,
  writeOnboardingState,
  type OnboardingOperation,
  type OnboardingRecord,
  type OnboardingRunMilestone,
  type OnboardingStatus,
} from "@/lib/onboarding/onboarding-state";

const AGENT_ID_RE = /^[A-Za-z0-9_-]{1,120}$/;

/** Raw RunStatus values that resolve->needs_attention with no further evidence needed. */
const NEEDS_ATTENTION_RUN_DETAIL: Record<string, string> = {
  failed: "failed",
  blocked: "blocked",
  cancelled: "cancelled",
  stopped: "cancelled",
  stalled: "timed_out",
};

interface MilestoneDeriveOptions {
  /** Milestone status on a genuinely-proven terminal success. */
  successStatus: "ready" | "completed";
  /** Only the readiness milestone re-checks the CLI startup readiness policy. */
  requireReadinessProof: boolean;
  /**
   * Facts 6/8: the proof is bound to the selected profile. When set, a run
   * whose resolved agentProfileId no longer matches the live selection is
   * needs_attention/"profile_changed" regardless of its own status — belt
   * and braces alongside provider/complete resetting the pointer outright
   * on a profile switch.
   */
  expectedProfileId?: string | null;
}

interface RunEvidence {
  run: RunRecord;
  runDir: string;
  agents: Array<{ id: string; status: string; lastMessage?: string; statusReason?: { reason: string } }>;
}

function loadRunEvidence(namespaceId: string, orgId: string, runId: string): RunEvidence | null {
  const runsDir = resolveLinkRunsDir(namespaceId, orgId);
  try {
    const run = readRunRecordAt(runsDir, runId);
    const agentStates = readAgentStates(config.stateDir, runId);
    const agents = mergeAgentStates(run.agents || [], agentStates, run.status);
    return { run, runDir: join(runsDir, runId), agents };
  } catch {
    return null; // missing / corrupt / escapes the runs root: treat as "no evidence"
  }
}

/** The one durable artifact bootstrap-executor.ts writes when the live launch-time readiness gate actually failed or timed out (never written on a real pass). */
function readStartupReadinessFailure(runDir: string, agentId: string): { status: string; reason: string } | null {
  if (!AGENT_ID_RE.test(agentId)) return null;
  const path = join(runDir, "artifacts", `${agentId}-startup-readiness.json`);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed && typeof parsed === "object" && typeof parsed.status === "string" && typeof parsed.reason === "string") {
      return parsed as { status: string; reason: string };
    }
  } catch {
    /* partial/corrupt artifact: fall through to "no evidence" rather than throw */
  }
  return null;
}

/**
 * Corroborating evidence only — classifyCliReadiness stays the gate. The
 * completion pipeline writes "Status: <state>" into artifacts/{agentId}-
 * summary.md; a summary that exists but reports anything other than
 * "complete" (failed/blocked/error) is a real signal the probe did not
 * actually finish cleanly, even if the startup transcript looked fine.
 * No summary file at all is not corroborating evidence either way.
 */
function readAgentSummaryStatus(runDir: string, agentId: string): string | null {
  if (!AGENT_ID_RE.test(agentId)) return null;
  const path = join(runDir, "artifacts", `${agentId}-summary.md`);
  if (!existsSync(path)) return null;
  try {
    const match = readFileSync(path, "utf8").match(/^Status:\s*(.+)$/mi);
    return match ? match[1].trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Fail-closed readiness-policy verdict for the run's effective profile.
 * classifyCliReadiness alone can only prove the negative from empty output
 * (missing profile, or readiness disabled/unconfigured -> unknown |
 * no_ready_signal); it cannot prove a positive pass without the real launch
 * transcript. So a real pass also requires: readiness enabled on the profile,
 * AND no durable startup-readiness failure artifact for this agent.
 */
function evaluateReadinessProof(
  namespaceId: string,
  orgId: string,
  run: RunRecord,
  agentId: string,
  runDir: string,
): { verified: boolean; lastError: string } {
  const profileId = typeof run.agentProfileId === "string" ? run.agentProfileId : null;
  const profile = profileId ? getProfile(namespaceId, orgId, profileId) : null;
  const gate = classifyCliReadiness({
    readiness: profile?.readiness ?? null,
    profileMissing: !profile,
    output: "",
    failClosed: true, // onboarding is fail-closed regardless of the ambient env flag
  });
  if (gate.status !== "ready" && gate.status !== "unknown") {
    // no_ready_signal (disabled/unconfigured/no ready_patterns): never "ready".
    return { verified: false, lastError: `unverified: ${gate.reason}` };
  }
  if (!profile) return { verified: false, lastError: "unverified: agent profile not found" };
  if (!profile.readiness || profile.readiness.enabled !== true) {
    return { verified: false, lastError: "unverified: readiness is not enabled for this profile" };
  }
  const failure = readStartupReadinessFailure(runDir, agentId);
  if (failure && failure.status !== "ready") {
    return { verified: false, lastError: `unverified: ${failure.reason}` };
  }
  const summaryStatus = readAgentSummaryStatus(runDir, agentId);
  if (summaryStatus && summaryStatus !== "complete") {
    return { verified: false, lastError: `unverified: summary reports ${summaryStatus}` };
  }
  return { verified: true, lastError: "" };
}

function deriveMilestone(
  namespaceId: string,
  orgId: string,
  milestone: OnboardingRunMilestone,
  operations: Record<string, OnboardingOperation>,
  options: MilestoneDeriveOptions,
): OnboardingRunMilestone {
  if (!milestone.runId) return milestone; // never started: the record's own status stands

  const operation = milestone.operationId ? operations[milestone.operationId] : undefined;
  const deadlineAt = operation?.deadlineAt ?? milestone.deadlineAt ?? null;
  const evidence = loadRunEvidence(namespaceId, orgId, milestone.runId);

  if (!evidence) {
    return { ...milestone, status: "needs_attention", runStatus: "missing", deadlineAt, lastError: "Run record not found" };
  }
  const { run, runDir, agents } = evidence;

  if (
    options.expectedProfileId
    && typeof run.agentProfileId === "string"
    && run.agentProfileId !== options.expectedProfileId
  ) {
    return { ...milestone, status: "needs_attention", runStatus: run.status, deadlineAt, lastError: "profile_changed" };
  }

  if (run.status === "pending" || run.status === "running") {
    const deadlinePassed = deadlineAt !== null && Number.isFinite(Date.parse(deadlineAt)) && Date.parse(deadlineAt) <= Date.now();
    if (deadlinePassed) {
      return { ...milestone, status: "needs_attention", runStatus: "timed_out", deadlineAt, lastError: "Operation deadline exceeded" };
    }
    return { ...milestone, status: "in_progress", runStatus: run.status === "pending" ? "queued" : "running", deadlineAt };
  }

  if (run.status === "completed") {
    const allComplete = agents.length > 0 && agents.every((agent) => agent.status === "complete");
    if (!allComplete) {
      return {
        ...milestone, status: "needs_attention", runStatus: "completed", deadlineAt,
        lastError: "unverified: run completed without a matching agent completion",
      };
    }
    if (options.requireReadinessProof) {
      const primaryAgentId = agents[0]?.id;
      const proof = primaryAgentId
        ? evaluateReadinessProof(namespaceId, orgId, run, primaryAgentId, runDir)
        : { verified: false, lastError: "unverified: no agent recorded on the run" };
      if (!proof.verified) {
        return { ...milestone, status: "needs_attention", runStatus: "completed", deadlineAt, lastError: proof.lastError };
      }
    }
    return { ...milestone, status: options.successStatus, runStatus: "completed", deadlineAt, lastError: "" };
  }

  const detail = NEEDS_ATTENTION_RUN_DETAIL[run.status] ?? run.status;
  // "blocked" runs carry their real reason on run.blockedReason (and mirrored
  // onto the stuck agent's lastMessage / statusReason) — e.g. a genuine CLI
  // startup-readiness timeout, not the generic "run blocked". Surface the
  // most specific evidence available instead of a placeholder.
  const blockedReason = typeof run.blockedReason === "string" ? run.blockedReason : undefined;
  const agentReason = agents.map((agent) => agent.lastMessage || agent.statusReason?.reason).find(Boolean);
  return {
    ...milestone, status: "needs_attention", runStatus: detail, deadlineAt,
    lastError: blockedReason || run.statusReason?.reason || agentReason || run.status_message || `run ${detail}`,
  };
}

/**
 * G4 / The invariant: activation (bundle sync + isDefault flip) is not proof.
 * provider/complete/route.ts writes "in_progress" the moment it activates a
 * profile — this promotes it to "ready" only once the SAME profile is still
 * the persisted default AND the readiness milestone (derived above, in this
 * same pass) has actually passed. If the default was since reassigned out
 * from under it, that is needs_attention/"default_not_persisted", never a
 * stale green claim.
 */
function deriveProvider(
  namespaceId: string,
  orgId: string,
  provider: OnboardingRecord["provider"],
  defaultIntent: OnboardingRecord["defaultIntent"],
  readinessStatus: OnboardingStatus,
): OnboardingRecord["provider"] {
  if (!provider.selectedProfileId || !provider.defaultVerified) return provider; // never activated: record stands
  const profile = getProfile(namespaceId, orgId, provider.selectedProfileId);
  if (!profile) {
    return { ...provider, status: "needs_attention", lastError: "default_not_persisted" };
  }
  // "Keep current default" (spec "Default activation contract"): the profile
  // was never meant to become the global isDefault — onboarding runs bind it
  // explicitly instead (fact 4's OR clause). Only the use_selected intent
  // requires the global default to still hold.
  if (defaultIntent !== "keep_current" && !profile.isDefault) {
    return { ...provider, status: "needs_attention", lastError: "default_not_persisted" };
  }
  return readinessStatus === "ready"
    ? { ...provider, status: "ready", lastError: null }
    : { ...provider, status: "in_progress", lastError: null };
}

/** Mark the backing operation terminal once its milestone resolves — closes the ledger instead of leaving it dangling in_progress. Never throws: a stale/missing operation is left alone. */
function closeOperation(state: OnboardingRecord, milestone: OnboardingRunMilestone): void {
  if (!milestone.operationId) return;
  const op = state.operations[milestone.operationId];
  if (!op) return;
  if (op.status === "completed" || op.status === "failed" || op.status === "timed_out" || op.status === "cancelled") return;
  const now = new Date().toISOString();
  if (milestone.status === "ready" || milestone.status === "completed") {
    state.operations[milestone.operationId] = {
      ...op, status: "completed", terminalAt: now, updatedAt: now,
      result: { ...(op.result && typeof op.result === "object" ? op.result : {}), status: milestone.status, runStatus: milestone.runStatus },
    };
  } else if (milestone.status === "needs_attention") {
    const timedOut = milestone.runStatus === "timed_out";
    state.operations[milestone.operationId] = {
      ...op, status: timedOut ? "timed_out" : "failed", terminalAt: now, updatedAt: now,
      errorCode: timedOut ? "DEADLINE_EXCEEDED" : `RUN_${(milestone.runStatus || "FAILED").toUpperCase()}`,
      errorMessage: milestone.lastError || "Operation did not complete successfully",
    };
  }
}

/**
 * Read onboarding state with readiness/sampleRun re-derived from the live run
 * record. Persists a genuine terminal transition (CAS against the revision
 * this read observed); on STATE_CONFLICT (another writer raced us) the
 * derived view is still returned — the next read closes the ledger.
 */
export function deriveOnboardingState(namespaceId: string, orgId: string): OnboardingRecord {
  const state = readOnboardingState(namespaceId, orgId);
  const derivedReadiness = deriveMilestone(namespaceId, orgId, state.readiness, state.operations, {
    successStatus: "ready", requireReadinessProof: true, expectedProfileId: state.provider.selectedProfileId,
  });
  const derivedSampleRun = deriveMilestone(namespaceId, orgId, state.sampleRun, state.operations, {
    successStatus: "completed", requireReadinessProof: false,
  });
  const derivedProvider = deriveProvider(namespaceId, orgId, state.provider, state.defaultIntent, derivedReadiness.status);

  const changed = derivedReadiness.status !== state.readiness.status
    || derivedSampleRun.status !== state.sampleRun.status
    || derivedProvider.status !== state.provider.status
    || derivedProvider.lastError !== state.provider.lastError;
  if (!changed) return { ...state, provider: derivedProvider, readiness: derivedReadiness, sampleRun: derivedSampleRun };

  const next: OnboardingRecord = { ...state, provider: derivedProvider, readiness: derivedReadiness, sampleRun: derivedSampleRun };
  closeOperation(next, derivedReadiness);
  closeOperation(next, derivedSampleRun);

  try {
    return writeOnboardingState(namespaceId, orgId, next, state.revision);
  } catch (error) {
    if (error instanceof Error && error.message === "STATE_CONFLICT") return next;
    throw error;
  }
}
