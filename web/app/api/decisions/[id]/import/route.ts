import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getWorkspacePath } from "@/lib/workspaces/workspace-params";
import { BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { requireInternalAuth } from "@/lib/auth/internal-api-auth";
import { applyDecisionRunResult, type DecisionRunPhase } from "@/lib/decisions/decision-run-results";
import { advanceDecisionAfterPhase } from "@/lib/decisions/decision-auto-advance";
import { resolveLinkRunPaths } from "@/lib/links/link-run-runtime";

export const dynamic = "force-dynamic";

const PHASES = new Set<DecisionRunPhase>([
  "research",
  "questions",
  "synthesis",
  "options",
  "plan",
  "retrospective",
]);

function parsePhase(value: unknown): DecisionRunPhase {
  if (typeof value !== "string" || !PHASES.has(value as DecisionRunPhase)) {
    throw new BadRequest("valid decision phase is required");
  }
  return value as DecisionRunPhase;
}

export const POST = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  requireInternalAuth(request, "decision-import");

  const { id } = await context.params;
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const body = await request.json() as {
    phase?: unknown;
    runId?: unknown;
    result?: unknown;
    workspacePath?: unknown;
    selectedOptionId?: unknown;
  };

  const runId = typeof body.runId === "string" && body.runId ? body.runId : undefined;

  // The URL id is caller-supplied text (the CLI composes it, an agent can type it by
  // hand) and has been observed wrong -- a single flipped hex character silently 404s
  // the whole import. When a run id is present, run.json's own metadata.decisionId is
  // this run's durably-recorded identity; trust it over the URL and only log the
  // mismatch. Existing callers that pass a correct URL id (with or without a runId)
  // see no behavior change.
  let decisionId = id;
  let result = body.result;
  if (runId) {
    const { runJsonPath, runDir } = resolveLinkRunPaths(namespaceId, orgId, runId);
    try {
      const run = JSON.parse(readFileSync(runJsonPath, "utf8")) as { metadata?: unknown };
      const metadata = run.metadata && typeof run.metadata === "object" && !Array.isArray(run.metadata)
        ? run.metadata as Record<string, unknown>
        : {};
      const runDecisionId = typeof metadata.decisionId === "string" ? metadata.decisionId : undefined;
      if (runDecisionId && runDecisionId !== id) {
        console.warn(
          `[decision-import] URL decision id "${id}" does not match run ${runId}'s recorded decision id "${runDecisionId}"; applying to the run's decision`,
        );
        decisionId = runDecisionId;
      }
    } catch {
      // run.json missing or unreadable: nothing durable to override the URL id with.
    }

    if (!result) {
      try {
        result = JSON.parse(readFileSync(join(runDir, "artifacts", "decision-result.json"), "utf8"));
      } catch {
        // no artifact on disk either; falls through to the required-result error below.
      }
    }
  }

  if (!result) {
    throw new BadRequest("result is required");
  }

  const decision = await applyDecisionRunResult({
    namespaceId,
    orgId,
    decisionId,
    phase: parsePhase(body.phase),
    runId,
    result,
    workspacePath: typeof body.workspacePath === "string" ? body.workspacePath : getWorkspacePath(request),
    selectedOptionId: typeof body.selectedOptionId === "string" ? body.selectedOptionId : undefined,
  });

  // Decision phases complete via the agent's `mentiko decision import`, not only via
  // jobs/[id]/complete. Drive the next generation step server-side (headless) up to the
  // human selection gate, and auto-resolve the plan into tasks after round 3 — so the
  // selection is the ONLY human gate. Mirrors jobs/[id]/complete. Idempotency is guarded
  // (single-flight nudge ledger + guarded resolve), so a browser tab and this server
  // driver cannot double-resolve. See lib/decisions/decision-auto-advance.
  advanceDecisionAfterPhase({ namespaceId, orgId, decision });

  return apiSuccess({ decision });
});
