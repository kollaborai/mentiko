import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { apiSuccess, withErrorHandling } from "@/lib/api-response";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
import {
  readOnboardingState,
  writeOnboardingState,
  nextOperation,
  CURRENT_SETUP_VERSION,
  type OnboardingStatus,
} from "@/lib/onboarding/onboarding-state";

// The input bar's own backend (kollabor-engine) — same source of truth as
// app/api/kollabor/engine/[...path]/route.ts, which the browser bar is
// proxied through. GET /health is unauthenticated there and sends no
// message, so it doubles as the "one bounded, harmless connection check"
// the spec requires — the same signal floating-kollabor-bar.tsx's own
// enginePing() uses to decide its "connected" vs "engine offline" state.
const ENGINE_BASE_URL = process.env.KOLLABOR_ENGINE_URL || "http://127.0.0.1:7433";
const PROBE_TIMEOUT_MS = 5_000;

async function probeInputBarBackend(): Promise<{ reachable: boolean; reason: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${ENGINE_BASE_URL}/health`, { method: "GET", signal: controller.signal });
    return res.ok
      ? { reachable: true, reason: "kollabor-engine is reachable" }
      : { reachable: false, reason: `kollabor-engine returned ${res.status}` };
  } catch (error) {
    return { reachable: false, reason: error instanceof Error ? error.message : "kollabor-engine is unreachable" };
  } finally {
    clearTimeout(timeout);
  }
}

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) throw new Unauthorized();
  const body = await request.json();
  const key = String(body.idempotencyKey || "");
  const setupVersion = Number(body.setupVersion);
  if (!key) throw new BadRequest("idempotencyKey is required");
  if (setupVersion !== CURRENT_SETUP_VERSION) throw new BadRequest("Unsupported setupVersion", { setupVersion, current: CURRENT_SETUP_VERSION });
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { state, op, reused } = nextOperation(namespaceId, orgId, "input_bar_check", key, "input-bar");

  // Flag off: the install does not expose the bar at all — Not available,
  // never a failure (spec "Unavailable path"). Flag on: run the real probe;
  // never claim "ready" from the env var alone.
  const flagEnabled = process.env.MENTIKO_INPUT_BAR_ENABLED !== "0";
  let status: OnboardingStatus;
  let available: boolean;
  let reason: string;
  if (!flagEnabled) {
    status = "not_available";
    available = false;
    reason = "The floating input bar is not enabled on this install.";
  } else {
    const probe = await probeInputBarBackend();
    available = true;
    status = probe.reachable ? "ready" : "needs_attention";
    reason = probe.reason;
  }

  if (!reused) {
    const s = readOnboardingState(namespaceId, orgId);
    s.setupVersion = setupVersion;
    s.inputBar = { status, available };
    writeOnboardingState(namespaceId, orgId, s, state.revision);
  }
  return apiSuccess({ operationId: op.operationId, status, available, reason });
});
