export interface ChainProfileReference {
  id: string;
}

export function getMissingAgentProfileId(
  profileIdValue: unknown,
  profiles: ChainProfileReference[],
): string | undefined {
  const profileId = typeof profileIdValue === "string" ? profileIdValue.trim() : "";
  if (!profileId) return undefined;
  return profiles.some((profile) => profile.id === profileId) ? undefined : profileId;
}

export function getMissingChainDefaultProfileId(
  defaultProfileId: unknown,
  profiles: ChainProfileReference[],
): string | undefined {
  return getMissingAgentProfileId(defaultProfileId, profiles);
}

export function withChainDefaultAgentProfile<T extends object>(
  chain: T,
  profileId: string | null | undefined,
): T & { default_agent_profile?: string } {
  const next = { ...chain } as T & { default_agent_profile?: string };
  const cleanProfileId = typeof profileId === "string" ? profileId.trim() : "";
  if (cleanProfileId) {
    next.default_agent_profile = cleanProfileId;
  } else {
    delete next.default_agent_profile;
  }
  return next;
}
