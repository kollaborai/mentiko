// Server-side decision auto-advance.
//
// Decisions must progress through their generation pipeline without a live browser tab.
// This driver handles only headless generation; humans choose the option and approve
// the resulting plan before tasks are created:
//
//   research done (briefed) -> auto-generate the deck (round-1 questions)  [headless]
//   deck ready              -> auto-generate the options                   [headless]
//   options ready (round 2) -> stop: the human selects an option
//   plan ready (round 3)    -> stop: the human approves task creation
//
// Browser effects can race these server nudges. Phase starts therefore share a
// single-flight ledger and retain a launched run when persisting its decision pointer
// fails, so the next request repairs the pointer instead of launching a duplicate run.

import type { Decision } from "@/lib/decisions/decision-types";
import { listWorkspaces, resolveDecisionAutoApprove } from "@/lib/workspaces/workspace-storage";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveLinkRunsDir } from "@/lib/links/link-run-runtime";
import { getJob } from "@/lib/runs/job-store";
import { resolveInternalAuthSecret } from "@/lib/auth/internal-api-auth";

type DecisionPhaseStart<T, R> = {
  started: T;
  persisted: R;
  recovered: boolean;
};

const inFlightDecisionPhases = new Map<string, Promise<DecisionPhaseStart<unknown, unknown>>>();
const recoverableDecisionPhases = new Map<string, unknown>();
const inFlightDecisionNudges = new Map<string, Promise<void>>();
const DECISION_PHASE_CLAIMS_DIR = ".decision-phase-claims";
const DECISION_PHASE_CLAIM_STALE_MS = 90_000;

export interface DurableDecisionPhaseRun {
  runId: string;
}

interface DurableDecisionPhaseClaim extends DurableDecisionPhaseRun {
  namespaceId: string;
  orgId: string;
  decisionId: string;
  phase: string;
  selectedOptionId?: string;
  claimedAt: string;
}

export interface DecisionPhaseIdentity {
  namespaceId: string;
  orgId: string;
  decisionId: string;
  phase: string;
  selectedOptionId?: string;
}

export function decisionPhaseKey(
  namespaceId: string,
  orgId: string,
  decisionId: string,
  phase: string,
  selectedOptionId?: string,
): string {
  return `${namespaceId}:${orgId}:${decisionId}:${phase}:${selectedOptionId ?? ""}`;
}

function decisionPhaseClaimPath(input: DecisionPhaseIdentity): string {
  const fingerprint = createHash("sha256")
    .update(decisionPhaseKey(
      input.namespaceId,
      input.orgId,
      input.decisionId,
      input.phase,
      input.selectedOptionId,
    ))
    .digest("hex");
  return join(
    resolveLinkRunsDir(input.namespaceId, input.orgId),
    DECISION_PHASE_CLAIMS_DIR,
    `${fingerprint}.json`,
  );
}

function readDecisionPhaseClaim(path: string): DurableDecisionPhaseClaim | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<DurableDecisionPhaseClaim>;
    return typeof value.runId === "string" && value.runId.length > 0 &&
      typeof value.decisionId === "string" &&
      typeof value.phase === "string"
      ? value as DurableDecisionPhaseClaim
      : null;
  } catch {
    return null;
  }
}

/**
 * Find the exact persisted run for a decision phase. This is the restart-safe recovery
 * path for the crash window after startChainRun writes run.json but before the decision
 * can store generationRunId.
 */
export function findDurableDecisionPhaseRun(input: DecisionPhaseIdentity): DurableDecisionPhaseRun | null {
  const claimPath = decisionPhaseClaimPath(input);
  const claimed = readDecisionPhaseClaim(claimPath);
  if (claimed) return { runId: claimed.runId };

  const runsDir = resolveLinkRunsDir(input.namespaceId, input.orgId);
  if (!existsSync(runsDir)) return null;
  const candidates: Array<{ runId: string; started: number }> = [];
  for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === DECISION_PHASE_CLAIMS_DIR) continue;
    try {
      const run = JSON.parse(readFileSync(join(runsDir, entry.name, "run.json"), "utf8")) as {
        id?: unknown;
        status?: unknown;
        started?: unknown;
        metadata?: unknown;
      };
      const metadata = run.metadata && typeof run.metadata === "object" && !Array.isArray(run.metadata)
        ? run.metadata as Record<string, unknown>
        : {};
      if (metadata.decisionId !== input.decisionId || metadata.decisionPhase !== input.phase) continue;
      if (input.selectedOptionId && metadata.selectedOptionId !== input.selectedOptionId) continue;
      if (run.status !== "pending" && run.status !== "running") continue;
      const runId = typeof run.id === "string" ? run.id : entry.name;
      candidates.push({
        runId,
        started: typeof run.started === "string" ? Date.parse(run.started) || 0 : 0,
      });
    } catch {
      // A partially-written or unrelated run must not block a decision phase.
    }
  }
  candidates.sort((a, b) => b.started - a.started || b.runId.localeCompare(a.runId));
  return candidates[0] ? { runId: candidates[0].runId } : null;
}

export interface DecisionGenerationPointer {
  runId?: string;
  jobId?: string;
}

export type DecisionGenerationPhase = "questions" | "options" | "plan";

export interface ActiveDecisionGenerationPhase {
  phase: DecisionGenerationPhase;
  pointer: DecisionGenerationPointer;
  selectedOptionId?: string;
}

export interface DecisionGenerationRecovery extends ActiveDecisionGenerationPhase {
  kind: "dead" | "awaiting_import";
}

/** Run statuses that mean "this launch will never produce a result" -- excludes
 * completed/complete (success) and running/pending (still live). */
const DEAD_DECISION_GENERATION_RUN_STATUSES = new Set([
  "failed", "blocked", "stopped", "cancelled", "deleted", "unknown",
]);

/**
 * A round's generationRunId/generationJobId guards every relaunch attempt
 * (the routes early-return "already_generating" whenever it's set) but nothing
 * ever cleared it when the underlying run died mid-flight -- a crashed,
 * concurrency-blocked, or cap-timed-out run wedges the round forever. This is
 * the ONE place that decides "dead", shared by the three guided routes and
 * the auto-advance healer below, so relaunch eligibility can't drift between
 * them. A pointer is dead when every component it has (run and/or job) is
 * terminal-and-not-completed, or missing entirely (the launch never landed
 * durably). A genuinely live run/job, or one that completed and is only
 * awaiting import, is NOT dead -- callers must keep treating it as in flight.
 */
export function isDecisionGenerationPointerDead(
  namespaceId: string,
  orgId: string,
  pointer: DecisionGenerationPointer,
): boolean {
  if (!pointer.runId && !pointer.jobId) return false;

  if (pointer.runId) {
    const runJsonPath = join(resolveLinkRunsDir(namespaceId, orgId), pointer.runId, "run.json");
    try {
      const run = JSON.parse(readFileSync(runJsonPath, "utf8")) as { status?: unknown };
      const status = typeof run.status === "string" ? run.status : "";
      if (!DEAD_DECISION_GENERATION_RUN_STATUSES.has(status)) return false;
    } catch {
      // Missing or unreadable run.json: the launch never landed durably, or
      // was pruned. Either way there is nothing left to wait on.
    }
  }

  if (pointer.jobId) {
    const job = getJob(pointer.jobId, namespaceId);
    if (job && job.status !== "failed") return false;
  }

  return true;
}

/**
 * Return the one generation phase currently capable of being reconciled.
 * Keeping this state-shape check shared prevents the background reconciler and
 * completion-driven auto-advance path from disagreeing about which round owns
 * a pointer.
 */
export function getActiveDecisionGenerationPhase(
  decision: Decision,
): ActiveDecisionGenerationPhase | null {
  const guidedFlow = decision.guidedFlow;
  if (
    guidedFlow?.round1.status === "in_progress"
    && guidedFlow.round1.questions.length === 0
    && (guidedFlow.round1.generationRunId || guidedFlow.round1.generationJobId)
  ) {
    return {
      phase: "questions",
      pointer: {
        runId: guidedFlow.round1.generationRunId,
        jobId: guidedFlow.round1.generationJobId,
      },
    };
  }
  if (
    guidedFlow?.round2.status === "generating"
    && (guidedFlow.round2.generationRunId || guidedFlow.round2.generationJobId)
  ) {
    return {
      phase: "options",
      pointer: {
        runId: guidedFlow.round2.generationRunId,
        jobId: guidedFlow.round2.generationJobId,
      },
    };
  }
  if (
    guidedFlow?.round3.status === "generating"
    && guidedFlow.round2.selectedOptionId
    && (guidedFlow.round3.generationRunId || guidedFlow.round3.generationJobId)
  ) {
    return {
      phase: "plan",
      pointer: {
        runId: guidedFlow.round3.generationRunId,
        jobId: guidedFlow.round3.generationJobId,
      },
      selectedOptionId: guidedFlow.round2.selectedOptionId,
    };
  }
  return null;
}

export function inspectDecisionGenerationRecovery(input: {
  namespaceId: string;
  orgId: string;
  decision: Decision;
}): DecisionGenerationRecovery | null {
  const active = getActiveDecisionGenerationPhase(input.decision);
  if (!active) return null;
  if (isDecisionGenerationPointerDead(input.namespaceId, input.orgId, active.pointer)) {
    return { ...active, kind: "dead" };
  }
  if (isCompletedRunAwaitingDecisionImport(input.namespaceId, input.orgId, active.pointer.runId)) {
    return { ...active, kind: "awaiting_import" };
  }
  return null;
}

/**
 * Acquire the durable launch lease. Only its holder may create a new chain run; callers
 * that observe an existing lease must adopt its run or return without a duplicate launch.
 */
export function acquireDurableDecisionPhaseClaim(
  input: DecisionPhaseIdentity,
): { acquired: boolean; run?: DurableDecisionPhaseRun } {
  const path = decisionPhaseClaimPath(input);
  mkdirSync(join(resolveLinkRunsDir(input.namespaceId, input.orgId), DECISION_PHASE_CLAIMS_DIR), {
    recursive: true,
    mode: 0o700,
  });
  try {
    // wx is an atomic cross-process claim; a second Next worker cannot launch the same phase.
    writeFileSync(path, JSON.stringify({ ...input, runId: "", claimedAt: new Date().toISOString() }), {
      flag: "wx",
      mode: 0o600,
    });
    return { acquired: true };
  } catch {
    const claim = readDecisionPhaseClaim(path);
    if (claim) return { acquired: false, run: { runId: claim.runId } };
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as { claimedAt?: unknown };
      const claimedAt = typeof raw.claimedAt === "string" ? Date.parse(raw.claimedAt) : 0;
      if (claimedAt > 0 && Date.now() - claimedAt > DECISION_PHASE_CLAIM_STALE_MS) {
        unlinkSync(path);
        return acquireDurableDecisionPhaseClaim(input);
      }
    } catch {
      // An active writer can briefly make the claim unreadable; do not steal it.
    }
    return { acquired: false };
  }
}

export function recordDurableDecisionPhaseRun(input: DecisionPhaseIdentity & { runId: string }): void {
  const path = decisionPhaseClaimPath(input);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...input, claimedAt: new Date().toISOString() }), { mode: 0o600 });
  renameSync(tmp, path);
}

export function releaseDurableDecisionPhaseClaim(input: DecisionPhaseIdentity & { runId: string }): void {
  const path = decisionPhaseClaimPath(input);
  if (!input.runId) {
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as { runId?: unknown };
      if (raw.runId === "") unlinkSync(path);
    } catch { /* another process owns or removed the claim */ }
    return;
  }
  const claim = readDecisionPhaseClaim(path);
  if (claim?.runId !== input.runId) return;
  try { unlinkSync(path); } catch { /* already recovered or removed */ }
}

/** Test hook: simulate a fresh Next worker without touching durable phase state. */
export function resetDecisionPhaseMemoryForTests(): void {
  inFlightDecisionPhases.clear();
  recoverableDecisionPhases.clear();
  inFlightDecisionNudges.clear();
}

/**
 * Launch a phase once. A successful launch is a durable side effect even if the later
 * decision write fails, so retain it for a retry to adopt rather than relaunch.
 */
export async function startDecisionPhaseOnce<T, R>(input: {
  key: string;
  start: () => Promise<T>;
  persist: (started: T) => Promise<R>;
}): Promise<DecisionPhaseStart<T, R> & { joined: boolean }> {
  const active = inFlightDecisionPhases.get(input.key) as Promise<DecisionPhaseStart<T, R>> | undefined;
  if (active) {
    return { ...(await active), joined: true };
  }

  const recovered = recoverableDecisionPhases.get(input.key) as T | undefined;
  const phase = Promise.resolve().then(async () => {
    const started = recovered ?? await input.start();
    try {
      const persisted = await input.persist(started);
      recoverableDecisionPhases.delete(input.key);
      return { started, persisted, recovered: recovered !== undefined };
    } catch (error) {
      recoverableDecisionPhases.set(input.key, started);
      throw error;
    }
  });

  inFlightDecisionPhases.set(input.key, phase as Promise<DecisionPhaseStart<unknown, unknown>>);
  try {
    return { ...(await phase), joined: false };
  } finally {
    if (inFlightDecisionPhases.get(input.key) === phase) {
      inFlightDecisionPhases.delete(input.key);
    }
  }
}

/**
 * Shared durable phase runner used by every decision-generation route. The phase identity
 * may include selectedOptionId, which prevents a plan run for one option from satisfying
 * a later request for another option.
 */
export async function startDurableDecisionPhaseOnce<T extends DurableDecisionPhaseRun, R>(input: {
  identity: DecisionPhaseIdentity;
  start: () => Promise<T>;
  persist: (started: T) => Promise<R>;
}): Promise<DecisionPhaseStart<T, R> & { joined: boolean; durableRecovered: boolean }> {
  const phase = await startDecisionPhaseOnce({
    key: decisionPhaseKey(
      input.identity.namespaceId,
      input.identity.orgId,
      input.identity.decisionId,
      input.identity.phase,
      input.identity.selectedOptionId,
    ),
    start: async () => {
      const existing = findDurableDecisionPhaseRun(input.identity);
      if (existing) return { run: existing as T, durableRecovered: true };

      const claim = acquireDurableDecisionPhaseClaim(input.identity);
      if (!claim.acquired) {
        const claimedRun = claim.run ?? findDurableDecisionPhaseRun(input.identity);
        if (claimedRun) return { run: claimedRun as T, durableRecovered: true };
        throw new Error(
          `Decision ${input.identity.decisionId} ${input.identity.phase} generation is already starting`,
        );
      }

      try {
        const run = await input.start();
        recordDurableDecisionPhaseRun({ ...input.identity, runId: run.runId });
        return { run, durableRecovered: false };
      } catch (error) {
        releaseDurableDecisionPhaseClaim({ ...input.identity, runId: "" });
        throw error;
      }
    },
    persist: async ({ run }) => {
      const persisted = await input.persist(run);
      releaseDurableDecisionPhaseClaim({ ...input.identity, runId: run.runId });
      return persisted;
    },
  });

  return {
    started: phase.started.run,
    persisted: phase.persisted,
    recovered: phase.recovered,
    joined: phase.joined,
    durableRecovered: phase.started.durableRecovered,
  };
}

function internalDecisionPost(
  namespaceId: string,
  orgId: string,
  path: string,
  workspacePath?: string,
  body?: unknown,
  // Route-specific auth override. Most internal nudges hit routes guarded by
  // checkAuth's service-secret bypass (raw BETTER_AUTH_SECRET); the import
  // route guards with requireInternalAuth("decision-import"), which needs the
  // HMAC-derived token instead -- callers targeting it must pass one.
  authToken?: string,
  baseUrl?: string,
): void {
  const port = process.env.WEB_PORT || process.env.PORT || 3000;
  const secret = authToken ?? (process.env.BETTER_AUTH_SECRET || "");
  const origin = baseUrl || `http://localhost:${port}`;
  const qs = workspacePath ? `?workspace=${encodeURIComponent(workspacePath)}` : "";
  const key = `${namespaceId}:${orgId}:${path}:${workspacePath ?? ""}:${JSON.stringify(body ?? {})}`;
  if (inFlightDecisionNudges.has(key)) return;

  // A bounded retry repairs a phase run whose launch succeeded but whose pointer write
  // temporarily failed. This is deliberately not an unbounded retry loop.
  const nudge = (async () => {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(`${origin}${path}${qs}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${secret}`,
            "x-namespace-id": namespaceId,
            "x-org-id": orgId,
          },
          body: JSON.stringify(body ?? {}),
          signal: AbortSignal.timeout(30_000),
        });
        if (response.ok) return;
        lastError = new Error(`HTTP ${response.status}`);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
    throw lastError ?? new Error("Unknown decision advance failure");
  })();

  inFlightDecisionNudges.set(key, nudge);
  void nudge.catch((err) => {
    console.warn(`[decision-advance] internal POST ${path} failed:`, err);
  }).finally(() => {
    if (inFlightDecisionNudges.get(key) === nudge) {
      inFlightDecisionNudges.delete(key);
    }
  });
}

/**
 * A generation pointer that is not dead (isDecisionGenerationPointerDead ==
 * false) can still be permanently stuck: the pointed-at run completed and
 * wrote its artifact, but the import that should have applied it never
 * landed (crash between completion and import, or a caller that typed the
 * wrong decision id). Detect exactly that gap so callers can replay the
 * import instead of reporting "already_generating" forever.
 */
export function isCompletedRunAwaitingDecisionImport(
  namespaceId: string,
  orgId: string,
  runId: string | undefined,
): boolean {
  if (!runId) return false;
  const runDir = join(resolveLinkRunsDir(namespaceId, orgId), runId);
  try {
    const run = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8")) as { status?: unknown };
    if (run.status !== "completed") return false;
  } catch {
    return false;
  }
  return existsSync(join(runDir, "artifacts", "decision-result.json"));
}

function readRunScopedDecisionImportToken(runDir: string): string {
  try {
    return readFileSync(join(runDir, ".internal", "decision-import-token"), "utf8").trim();
  } catch {
    return "";
  }
}

/**
 * Replay the import for a completed-but-unimported decision phase run. Reuses
 * the exact route the CLI's `mentiko decision import` hits and the same
 * requireInternalAuth("decision-import") derived token it authenticates
 * with -- no new auth path. `runDir`, when supplied, lets an out-of-process
 * caller (the typed completion entrypoint, which may not share this
 * process's BETTER_AUTH_SECRET) read the durable per-run token that
 * chain-run-service.ts already writes for the CLI to use, instead of trusting
 * env inheritance.
 */
export function triggerDecisionImportReplay(input: {
  namespaceId: string;
  orgId: string;
  decisionId: string;
  phase: string;
  runId: string;
  workspacePath?: string;
  selectedOptionId?: string;
  runDir?: string;
  webUrl?: string;
}): void {
  const token = (input.runDir && readRunScopedDecisionImportToken(input.runDir))
    || resolveInternalAuthSecret("decision-import");
  internalDecisionPost(
    input.namespaceId,
    input.orgId,
    `/api/decisions/${input.decisionId}/import`,
    input.workspacePath,
    {
      phase: input.phase,
      runId: input.runId,
      ...(input.selectedOptionId ? { selectedOptionId: input.selectedOptionId } : {}),
    },
    token,
    input.webUrl,
  );
}

function decisionAutoApprovalEnabled(namespaceId: string, orgId: string, decision: Decision): boolean {
  if (!decision.workspacePath) return false;
  // Circuit breaker against self-amplification: never auto-approve a decision the
  // completion-audit delivery gate raised. Those mean "a task ran but a human must
  // judge the outcome" — auto-approving them is exactly what let ONE delivery-gate
  // escalation re-seed the queue into hundreds of tasks (the ApothesIQ storm). They
  // wait for a person; every other decision still auto-advances under the policy.
  if (decision.source === "completion-audit") return false;
  const workspace = listWorkspaces(namespaceId, orgId).find(
    (candidate) => candidate.id === decision.workspacePath || candidate.path === decision.workspacePath,
  );
  return resolveDecisionAutoApprove(workspace);
}

/**
 * Advance a decision after a phase's job completed. Pass the updated decision returned
 * by applyDecisionRunResult so the dispatch keys off its current state.
 */
export function advanceDecisionAfterPhase(input: {
  namespaceId: string;
  orgId: string;
  decision: Decision;
}): void {
  const { namespaceId, orgId, decision } = input;
  if (
    decision.resolution
    || decision.status === "approved"
    || decision.status === "in_progress"
    || decision.status === "done"
    || decision.status === "skipped"
    || decision.status === "superseded"
  ) {
    return;
  }
  const ws = decision.workspacePath;
  const gf = decision.guidedFlow;

  // Self-heal a round wedged on a dead generation pointer before evaluating the
  // normal phase transitions below. Nothing else re-triggers this decision once
  // its run stops emitting completion events, so a crashed/blocked/cap-timed-out
  // run would otherwise freeze the round forever. Re-post to the SAME phase
  // route rather than relaunching here -- the durable lease, staleness check,
  // and relaunch all stay in the one place the routes already own.
  //
  // A pointer that is NOT dead can still be stuck a different way: the run
  // completed and wrote its artifact, but nothing ever imported it (the agent
  // crashed after writing decision-result.json, mistyped the decision id, or
  // the completion-driven import failed). Replay the import for that case
  // instead of no-opping forever.
  const recovery = inspectDecisionGenerationRecovery({ namespaceId, orgId, decision });
  if (recovery?.kind === "dead") {
    const body = recovery.phase === "plan"
      ? { selectedOptionId: recovery.selectedOptionId }
      : undefined;
    internalDecisionPost(
      namespaceId,
      orgId,
      `/api/decisions/${decision.id}/guided/${recovery.phase}`,
      ws,
      body,
    );
    return;
  }
  if (recovery?.kind === "awaiting_import" && recovery.pointer.runId) {
    triggerDecisionImportReplay({
      namespaceId,
      orgId,
      decisionId: decision.id,
      phase: recovery.phase,
      runId: recovery.pointer.runId,
      workspacePath: ws,
      selectedOptionId: recovery.selectedOptionId,
    });
    return;
  }

  if (decision.status === "briefed" && (!gf || !gf.round1 || gf.round1.status === "pending")) {
    internalDecisionPost(namespaceId, orgId, `/api/decisions/${decision.id}/guided/questions`, ws);
    return;
  }

  // Questions are generated context, not a human gate. The options route accepts an
  // empty preference profile, which is the correct headless default until a human chooses.
  if (
    gf?.round1.status === "in_progress" &&
    gf.round1.questions.length > 0 &&
    gf.round2.status === "pending"
  ) {
    internalDecisionPost(namespaceId, orgId, `/api/decisions/${decision.id}/guided/options`, ws);
    return;
  }

  // Preserve the human gate unless this workspace explicitly opts in. The
  // recommendation must name a real option; no inferred first-option fallback.
  const recommendedOptionId = decision.recommendation?.choiceId;
  const recommendationIsValid = Boolean(
    recommendedOptionId && decision.options.some((option) => option.id === recommendedOptionId),
  );
  if (!decisionAutoApprovalEnabled(namespaceId, orgId, decision) || !recommendationIsValid || !recommendedOptionId) {
    return;
  }

  if (gf?.round2.status === "ready" && !gf.round2.selectedOptionId) {
    internalDecisionPost(
      namespaceId,
      orgId,
      `/api/decisions/${decision.id}/guided/plan`,
      ws,
      { selectedOptionId: recommendedOptionId },
    );
    return;
  }

  if (
    gf?.round3.status === "ready" &&
    gf.round2.selectedOptionId === recommendedOptionId &&
    gf.round3.plan
  ) {
    internalDecisionPost(
      namespaceId,
      orgId,
      `/api/decisions/${decision.id}/resolve`,
      ws,
      {
        selectedOptionId: recommendedOptionId,
        notes: "Automatically approved by this workspace's decision policy.",
        autoApprovedByWorkspacePolicy: true,
      },
    );
  }
}
