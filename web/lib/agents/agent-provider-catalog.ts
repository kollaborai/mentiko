import catalogJson from "@/config/agent-provider-catalog.json";
import type { AgentProfile, AgentProfileProvider } from "../types";

export interface CatalogCliTool {
  id: string;
  name: string;
  cli: string;
  description: string;
  iconKey: string;
  color: string;
  badgeColor: string;
  badgeBg: string;
  credentialKey?: string;
  bundleProvider?: AgentProfileProvider;
  terminalAuthCommand?: string;
  interactiveAuthCommand?: string;
  detectable?: boolean;
}

export interface ProviderCredential {
  envKey: string;
  label: string;
  placeholder: string;
  docsUrl: string;
  docsLabel: string;
}

export interface SecretPreset {
  label: string;
  envVar: string;
}

export interface BundleProfile {
  id: string;
  name: string;
  cli: string;
  model?: string;
  pipe_flag?: string;
  permission_flag?: string;
  extra_args?: string[];
  pre_exec?: string;
  description?: string;
  preferredAdvisorDefault?: boolean;
}

export interface CatalogProviderBundle {
  provider: AgentProfileProvider;
  name: string;
  logoKey: string;
  profiles: BundleProfile[];
  log_path?: string;
  log_format?: string;
}

export interface LegacyProfileReplacement {
  provider: AgentProfileProvider;
  profile: BundleProfile;
}

export interface EngineProviderDefault {
  value: string;
  label: string;
  model: string;
  baseUrl: string;
  iconKey: string;
}

interface AgentProviderCatalog {
  cliTools: CatalogCliTool[];
  providerCredentials: Record<string, ProviderCredential>;
  secretPresets: SecretPreset[];
  profileBundles: CatalogProviderBundle[];
  legacyProfileReplacements: LegacyProfileReplacement[];
  engineProviders: EngineProviderDefault[];
  mentikoGatewayProfile: {
    name: string;
    provider: string;
    model: string;
    description: string;
  };
  runtimeDefaults: {
    marketplaceAgentModel: string;
    costModel: string;
    linkEscalationModel: string;
    codexInlineAuthModel: string;
  };
}

const catalog = catalogJson as AgentProviderCatalog;

export const CLI_TOOLS = catalog.cliTools;
export const PROVIDER_CREDENTIALS = catalog.providerCredentials;
export const COMMON_PRESETS = catalog.secretPresets;
export const PROFILE_BUNDLES = catalog.profileBundles;
export const LEGACY_PROFILE_REPLACEMENTS = catalog.legacyProfileReplacements;
export const ENGINE_PROVIDER_DEFAULTS = catalog.engineProviders;
export const MENTIKO_GATEWAY_PROFILE = catalog.mentikoGatewayProfile;
export const DEFAULT_MARKETPLACE_AGENT_MODEL = catalog.runtimeDefaults.marketplaceAgentModel;
export const DEFAULT_COST_MODEL = catalog.runtimeDefaults.costModel;
export const LINK_ESCALATION_FALLBACK_MODEL = catalog.runtimeDefaults.linkEscalationModel;
export const CODEX_INLINE_AUTH_MODEL = catalog.runtimeDefaults.codexInlineAuthModel;

export interface AgentConfigOption {
  id: string;
  name: string;
}

export function getCliTool(toolId: string): CatalogCliTool | undefined {
  const key = toolId.toLowerCase();
  return CLI_TOOLS.find((tool) =>
    tool.id === key ||
    tool.cli === key ||
    tool.bundleProvider === key
  );
}

export function getDetectableCliTools(): CatalogCliTool[] {
  return CLI_TOOLS.filter((tool) => tool.detectable !== false);
}

export function getInteractiveAuthTools(): CatalogCliTool[] {
  return CLI_TOOLS.filter((tool) => Boolean(tool.interactiveAuthCommand));
}

export function getCliBinary(toolId: string): string {
  return getCliTool(toolId)?.cli ?? toolId;
}

export function getBundleProviderForTool(toolId: string): AgentProfileProvider | undefined {
  return getCliTool(toolId)?.bundleProvider;
}

export function getTerminalAuthCommand(toolId: string): string {
  return getCliTool(toolId)?.terminalAuthCommand ?? `${toolId} auth login`;
}

export function getInteractiveAuthCommand(toolId: string): string | undefined {
  return getCliTool(toolId)?.interactiveAuthCommand;
}

export function getProviderDisplayName(providerOrCli: string): string {
  const tool = getCliTool(providerOrCli);
  if (tool) return tool.name;
  const bundle = getCatalogBundleByProvider(providerOrCli as AgentProfileProvider);
  if (bundle) return bundle.name;
  return providerOrCli.charAt(0).toUpperCase() + providerOrCli.slice(1);
}

export function getProviderColors(providerOrCli: string): { color: string; bg: string } {
  const tool = getCliTool(providerOrCli);
  if (tool) return { color: tool.badgeColor, bg: tool.badgeBg };
  return { color: "text-foreground/60", bg: "bg-muted" };
}

export function getCatalogBundleByProvider(provider: AgentProfileProvider): CatalogProviderBundle | undefined {
  return PROFILE_BUNDLES.find((bundle) => bundle.provider === provider);
}

export function getLegacyProfileReplacementsByProvider(provider: AgentProfileProvider): BundleProfile[] {
  return LEGACY_PROFILE_REPLACEMENTS
    .filter((replacement) => replacement.provider === provider)
    .map((replacement) => replacement.profile);
}

export function getAgentConfigOptionsForTool(toolId: string): AgentConfigOption[] {
  const bundleProvider = getBundleProviderForTool(toolId);
  const bundle = bundleProvider ? getCatalogBundleByProvider(bundleProvider) : undefined;
  return (bundle?.profiles ?? []).map((profile) => ({
    id: profile.id,
    name: profile.name,
  }));
}

export function getDefaultAgentConfigIdForTool(toolId: string): string {
  return getAgentConfigOptionsForTool(toolId)[0]?.id ?? "";
}

export function bundleProfileToAgentProfile(
  bundleProfile: BundleProfile,
  bundle?: CatalogProviderBundle
): Omit<AgentProfile, "createdAt" | "updatedAt"> {
  return {
    id: bundleProfile.id,
    name: bundleProfile.name,
    description: bundleProfile.description,
    isDefault: false,
    isAdvisorDefault: false,
    cli: bundleProfile.cli,
    model: bundleProfile.model,
    pipe_flag: bundleProfile.pipe_flag,
    permission_flag: bundleProfile.permission_flag,
    extra_args: bundleProfile.extra_args ?? [],
    env: {},
    pre_exec: bundleProfile.pre_exec,
    log_path: bundle?.log_path,
    log_format: bundle?.log_format,
  };
}

export function getAllBundleProfiles(): Omit<AgentProfile, "createdAt" | "updatedAt">[] {
  return PROFILE_BUNDLES.flatMap((bundle) =>
    bundle.profiles.map((profile) => bundleProfileToAgentProfile(profile, bundle))
  );
}

export function getEngineProviderDefault(provider: string): EngineProviderDefault | undefined {
  return ENGINE_PROVIDER_DEFAULTS.find((candidate) => candidate.value === provider);
}

export function getProviderCredentialKeys(): string[] {
  return Array.from(new Set(Object.values(PROVIDER_CREDENTIALS).map((credential) => credential.envKey)));
}
