import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { listProfiles } from "@/lib/agents/agent-profile-storage";
import {
  PROVIDER_BUNDLES,
  type ProviderBundle,
} from "@/lib/agents/provider-bundles";
import type { AgentProfileProvider } from "@/lib/types";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

interface BundleProfileWithStatus {
  id: string;
  name: string;
  installed: boolean;
}

interface BundleWithStatus {
  provider: AgentProfileProvider;
  name: string;
  logo: string;
  profiles: BundleProfileWithStatus[];
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const installedProfiles = listProfiles(namespaceId, orgId);
  const installedIds = new Set(installedProfiles.map((p) => p.id));

  const bundles: BundleWithStatus[] = PROVIDER_BUNDLES.map(
    (bundle: ProviderBundle) => ({
      provider: bundle.provider,
      name: bundle.name,
      logo: bundle.logo,
      profiles: bundle.profiles.map((p) => ({
        id: p.id,
        name: p.name,
        installed: installedIds.has(p.id),
      })),
    })
  );

  return apiSuccess({ bundles });
});
