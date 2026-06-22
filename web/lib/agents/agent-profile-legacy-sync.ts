import type { AgentProfile } from "./agent-profile-storage";
import {
  LEGACY_PROFILE_REPLACEMENTS,
  bundleProfileToAgentProfile,
  getCatalogBundleByProvider,
} from "./agent-provider-catalog";

type SyncUpdate = Partial<Omit<AgentProfile, "id" | "createdAt">>;
type SyncCandidate = ReturnType<typeof bundleProfileToAgentProfile>;

const LEGACY_READ_SYNC_FIELDS = [
  "name",
  "description",
  "cli",
  "model",
  "relay_model",
  "pipe_flag",
  "permission_flag",
  "extra_args",
  "disallowed_tools",
  "pre_exec",
  "readiness",
  "log_path",
  "log_format",
] as const satisfies readonly (keyof SyncCandidate)[];

function normalizeCandidate(profile: SyncCandidate): SyncCandidate {
  return {
    ...profile,
    description: profile.description ?? "",
    model: profile.model ?? "",
    relay_model: profile.relay_model ?? "",
    pipe_flag: profile.pipe_flag ?? "",
    permission_flag: profile.permission_flag ?? "",
    disallowed_tools: profile.disallowed_tools ?? "",
    pre_exec: profile.pre_exec ?? "",
    log_path: profile.log_path ?? "",
    log_format: profile.log_format ?? "",
  };
}

function hasChanged(current: unknown, next: unknown): boolean {
  return JSON.stringify(current ?? "") !== JSON.stringify(next ?? "");
}

export function getLegacyProfileSyncUpdates(profile: AgentProfile): SyncUpdate | null {
  const replacement = LEGACY_PROFILE_REPLACEMENTS.find((item) => item.profile.id === profile.id);
  if (!replacement) return null;

  const bundle = getCatalogBundleByProvider(replacement.provider);
  if (!bundle) return null;

  const nextProfile = normalizeCandidate(bundleProfileToAgentProfile(replacement.profile, bundle));
  const updates: SyncUpdate = {};

  for (const field of LEGACY_READ_SYNC_FIELDS) {
    if (hasChanged(profile[field], nextProfile[field])) {
      updates[field] = nextProfile[field] as never;
    }
  }

  return Object.keys(updates).length > 0 ? updates : null;
}
