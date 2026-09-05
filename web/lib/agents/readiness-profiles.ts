import { getBundleProviderForTool, getCatalogBundleByProvider } from "./agent-provider-catalog";

/**
 * Shared by the onboarding provider step and the cli-auth/* adapters: which
 * profile IDs (from a tool's catalog bundle) have a usable readiness signal.
 * Array order in the catalog is not a safe onboarding decision (e.g. Codex's
 * first bundle profile ships with readiness disabled) — this is the single
 * source of truth both the profile dropdowns and resolveReadinessSafeProfileId
 * (provider-step.tsx) key off of.
 */
export function getReadinessEnabledProfileIds(toolId: string): Set<string> {
  const bundleProvider = getBundleProviderForTool(toolId);
  const bundle = bundleProvider ? getCatalogBundleByProvider(bundleProvider) : undefined;
  return new Set((bundle?.profiles ?? []).filter((p) => p.readiness?.enabled).map((p) => p.id));
}

/** The catalog's own readiness-capable profile ID for a tool, if it has one. */
export function getPreferredReadinessProfileId(toolId: string): string | undefined {
  const bundleProvider = getBundleProviderForTool(toolId);
  const bundle = bundleProvider ? getCatalogBundleByProvider(bundleProvider) : undefined;
  return bundle?.profiles.find((p) => p.readiness?.enabled)?.id;
}
