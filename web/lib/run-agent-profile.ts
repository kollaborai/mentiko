export interface RunAgentProfileCandidate {
  id: string;
  isDefault?: boolean | null;
}

export function resolveRunAgentProfileId({
  requestedProfileId,
  chainDefaultProfileId,
  workspaceDefaultProfileId,
  profiles,
}: {
  requestedProfileId?: string | null;
  chainDefaultProfileId?: string | null;
  workspaceDefaultProfileId?: string | null;
  profiles: RunAgentProfileCandidate[];
}): string | undefined {
  const ids = new Set(profiles.map((profile) => profile.id));
  for (const candidate of [requestedProfileId, chainDefaultProfileId, workspaceDefaultProfileId]) {
    if (candidate && ids.has(candidate)) return candidate;
  }
  return profiles.find((profile) => profile.isDefault)?.id ?? profiles[0]?.id;
}
