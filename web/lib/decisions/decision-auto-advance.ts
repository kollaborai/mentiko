// Server-side decision auto-advance.
//
// Decisions must progress through their GENERATION pipeline without a live browser tab.
// Today rounds only auto-advance via client useEffects (guided-flow-shell), so a
// headlessly-created decision (e.g. a completion-audit decision gate) gets research and
// then stalls at "briefed" forever until a human opens it. This drives the generation
// server-side up to the ONE human gate -- option selection -- then auto-resolves after
// the plan:
//
//   research done (briefed) -> auto-generate the DECK (round-1 questions)   [headless]
//   deck ready               -> STOP: the human answers the tradeoff cards
//   options ready (round 2)  -> STOP: the human selects an option  <-- the only gate
//   plan ready (round 3)     -> auto-resolve into tasks  [drops the redundant Approve click]
//
// Mechanism mirrors triggerAutoRunScan: a fire-and-forget internal POST to the existing
// guided routes, which already own prompt-building + auth. Idempotency: research leaves
// round1 "pending", and the guided/questions route is guarded to skip when a generation
// is already in flight, so a live browser tab + this driver won't double-generate.

import type { Decision } from "@/lib/decisions/decision-types";

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
  // fire-and-forget: a decision phase completing must never fail because the next-step
  // nudge did. The 60s auto-run poller does not cover decisions, so if this is ever
  // dropped the decision waits for a human to open it (the pre-existing behavior).
  fetch(`http://localhost:${port}${path}${qs}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${secret}`,
      "x-namespace-id": namespaceId,
      "x-org-id": orgId,
    },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(30_000),
  }).catch((err) => console.warn(`[decision-advance] internal POST ${path} failed:`, err));
}

/**
 * Advance a decision one generation step after a phase's job completed. Pass the UPDATED
 * decision returned by applyDecisionRunResult so the dispatch keys off its new state.
 */
export function advanceDecisionAfterPhase(input: {
  namespaceId: string;
  orgId: string;
  decision: Decision;
}): void {
  const { namespaceId, orgId, decision } = input;
  const ws = decision.workspacePath;
  const gf = decision.guidedFlow;

  // brief ready -> generate the deck (round-1 questions), headless. Guard on round1
  // still "pending" so we never restart a deck that a browser tab already kicked off.
  if (decision.status === "briefed" && (!gf || !gf.round1 || gf.round1.status === "pending")) {
    internalDecisionPost(namespaceId, orgId, `/api/decisions/${decision.id}/guided/questions`, ws);
    return;
  }

  // plan ready -> auto-resolve into tasks. The selected option was recorded when the
  // human picked it (round2.selectedOptionId); resolve requires it. If it is somehow
  // absent we do NOT resolve -- better to leave the ready plan for a human than to
  // resolve against the wrong option.
  if (gf?.round3?.status === "ready" && gf.round3.plan && gf.round2?.selectedOptionId) {
    internalDecisionPost(namespaceId, orgId, `/api/decisions/${decision.id}/resolve`, ws, {
      selectedOptionId: gf.round2.selectedOptionId,
    });
  }

  // deck ready (round1 in_progress) -> STOP: the human answers.
  // options ready (round2 ready)    -> STOP: the human selects (the one gate).
}
