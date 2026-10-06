import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { readOnboardingState } from "@/lib/onboarding/onboarding-state";
import { getSecretValue } from "@/lib/secrets/secrets-store";
import type { NextRequest } from "next/server";

/**
 * Resolves the GitHub token stored by the onboarding connect flow (OAuth or gh CLI)
 * for the requesting namespace/org. Returns null when not connected or the secret
 * is gone.
 */
export async function getOnboardingGithubToken(request: NextRequest): Promise<string | null> {
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const state = readOnboardingState(namespaceId, orgId);
  const tokenSecretId = (state.github.account as { tokenSecretId?: string } | null)?.tokenSecretId;
  if (state.github.status !== "connected" || !tokenSecretId) return null;
  return getSecretValue(namespaceId, orgId, tokenSecretId);
}

export const GITHUB_API_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
} as const;
