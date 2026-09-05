/**
 * Spec "Recommended profile selection": the provider catalog must declare
 * onboarding metadata instead of relying on array order. Codex specifically:
 * codex-default (bundle.profiles[0]) has readiness disabled while
 * codex-terra/codex-fast have it enabled with a real ready_pattern — picking
 * profiles[0] as the silent default means the onboarding card can NEVER
 * reach Ready under the fail-closed policy.
 *
 * When the client sends no explicit profileId, prefer the first profile in
 * the bundle that can actually prove readiness (enabled + at least one
 * ready_pattern); fall back to the bundle's first profile only when nothing
 * in it can ever pass — the caller should then report readinessAvailable:
 * false rather than implying the fallback can turn green.
 */
export interface OnboardingProfileCandidate {
  id: string;
  readiness?: { enabled?: boolean; ready_patterns?: unknown[] } | null;
}

export function selectOnboardingProfileId(
  profiles: OnboardingProfileCandidate[],
  requestedProfileId?: string,
): string {
  if (requestedProfileId) return requestedProfileId;
  const readinessCapable = profiles.find(
    (profile) => profile.readiness?.enabled === true && (profile.readiness.ready_patterns?.length ?? 0) > 0,
  );
  return readinessCapable?.id ?? profiles[0]?.id ?? "";
}
