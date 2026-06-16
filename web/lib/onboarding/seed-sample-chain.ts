"use client";

/**
 * Client helper to seed a starter sample chain into the user's workspace and
 * navigate them to a place where they can actually run it.
 *
 * Backed by POST /api/chains/seed-sample (session-authenticated, no body):
 *   200 -> { success: true, chainId: string, alreadyExisted: boolean }
 *   err -> { success: false, error: string } (or non-200)
 *
 * The endpoint is idempotent: calling it repeatedly returns the same sample
 * chain id, so it's safe to use from every "run a sample chain" entry point.
 *
 * Reused by:
 *   - components/dashboard/getting-started.tsx  (the "run a chain" step)
 *   - components/onboarding/steps/done-step.tsx (the "run a sample chain" card)
 *   - app/runs/page.tsx                         (empty-state launchpad)
 *   - app/(workflows)/chains/page.tsx           (empty-state launchpad)
 */

export interface SeedSampleChainResult {
  chainId: string;
  alreadyExisted: boolean;
}

/**
 * The route a freshly-seeded sample chain should open to.
 *
 * /chains/{id}/run is the dedicated single-chain run page: it loads the chain,
 * pre-fills its default goal, and shows a prominent "start chain" button — so a
 * brand-new user lands somewhere they can immediately execute, not on an empty
 * list. We centralize it here so every caller navigates consistently.
 */
export function sampleChainRunRoute(chainId: string): string {
  return `/chains/${encodeURIComponent(chainId)}/run`;
}

/**
 * POST to the seed endpoint and return the sample chain id (+ whether it was
 * already present). Throws on any failure so callers can fall back gracefully.
 *
 * Per the endpoint contract this is session-authenticated with no body, so we
 * use a plain `fetch` rather than the namespace-aware `fetchWithNamespace` hook
 * (this helper is a plain module, not a React hook). New users — the target of
 * every entry point here — operate in their default namespace, which the
 * endpoint resolves server-side from the session.
 */
export async function seedSampleChain(): Promise<SeedSampleChainResult> {
  const res = await fetch("/api/chains/seed-sample", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // non-JSON / empty body — handled by the !res.ok / shape checks below
  }

  const data =
    payload && typeof payload === "object"
      ? (payload as { success?: boolean; chainId?: string; alreadyExisted?: boolean; error?: string })
      : {};

  if (!res.ok || data.success === false || !data.chainId) {
    const message =
      typeof data.error === "string" && data.error
        ? data.error
        : `failed to create sample chain (${res.status})`;
    throw new Error(message);
  }

  return {
    chainId: data.chainId,
    alreadyExisted: data.alreadyExisted === true,
  };
}

export interface SeedAndOpenOptions {
  /** Navigation primitive — pass router.push or any (route) => void. */
  navigate: (route: string) => void;
  /** Optional surface for a non-fatal failure message (defaults to console.error). */
  onError?: (message: string) => void;
}

/**
 * One-call convenience for entry points: seed the sample chain, then navigate
 * to its run page. On any failure it surfaces a non-fatal message and falls
 * back to /chains so the user is never left on a dead end.
 *
 * Returns true if the seed succeeded (caller may e.g. keep a spinner up until
 * navigation), false if it fell back.
 */
export async function seedAndOpenSampleChain({
  navigate,
  onError,
}: SeedAndOpenOptions): Promise<boolean> {
  try {
    const { chainId } = await seedSampleChain();
    navigate(sampleChainRunRoute(chainId));
    return true;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "could not create a sample chain";
    if (onError) onError(message);
    else console.error("[seed-sample-chain]", message);
    // graceful fallback: still get the user to chains rather than a dead end
    navigate("/chains");
    return false;
  }
}
