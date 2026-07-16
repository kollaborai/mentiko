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
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveLinkRunsDir } from "@/lib/links/link-run-runtime";

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
): void {
  const port = process.env.WEB_PORT || process.env.PORT || 3000;
  const secret = process.env.BETTER_AUTH_SECRET || "";
  const qs = workspacePath ? `?workspace=${encodeURIComponent(workspacePath)}` : "";
  const key = `${namespaceId}:${orgId}:${path}:${workspacePath ?? ""}:${JSON.stringify(body ?? {})}`;
  if (inFlightDecisionNudges.has(key)) return;

  // A bounded retry repairs a phase run whose launch succeeded but whose pointer write
  // temporarily failed. This is deliberately not an unbounded retry loop.
  const nudge = (async () => {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(`http://localhost:${port}${path}${qs}`, {
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
 * Advance a decision after a phase's job completed. Pass the updated decision returned
 * by applyDecisionRunResult so the dispatch keys off its current state.
 */
export function advanceDecisionAfterPhase(input: {
  namespaceId: string;
  orgId: string;
  decision: Decision;
}): void {
  const { namespaceId, orgId, decision } = input;
  const ws = decision.workspacePath;
  const gf = decision.guidedFlow;

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

  // A generated plan is not authorization to create tasks. The guided-flow UI
  // owns the explicit "Approve and create tasks" action; resolving here races
  // that click and makes a stale browser retry look like a failed run.
}
