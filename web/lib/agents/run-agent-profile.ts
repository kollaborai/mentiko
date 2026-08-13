export interface RunAgentProfileCandidate {
  id: string;
  isDefault?: boolean | null;
}

export type RunAgentProfileSource = "runtime" | "chain" | "workspace" | "namespace";

export interface RunAgentProfileResolution {
  id: string;
  source: RunAgentProfileSource;
}

export function resolveRunAgentProfile({
  requestedProfileId,
  chainDefaultProfileId,
  workspaceDefaultProfileId,
  profiles,
}: {
  requestedProfileId?: string | null;
  chainDefaultProfileId?: string | null;
  workspaceDefaultProfileId?: string | null;
  profiles: RunAgentProfileCandidate[];
}): RunAgentProfileResolution | undefined {
  const ids = new Set(profiles.map((profile) => profile.id));
  const explicit: Array<[string | null | undefined, RunAgentProfileSource]> = [
    [requestedProfileId, "runtime"],
    [chainDefaultProfileId, "chain"],
    [workspaceDefaultProfileId, "workspace"],
  ];
  for (const [candidate, source] of explicit) {
    if (candidate && ids.has(candidate)) return { id: candidate, source };
  }
  const namespaceDefault = profiles.find((profile) => profile.isDefault) ?? profiles[0];
  return namespaceDefault ? { id: namespaceDefault.id, source: "namespace" } : undefined;
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
  return resolveRunAgentProfile({
    requestedProfileId,
    chainDefaultProfileId,
    workspaceDefaultProfileId,
    profiles,
  })?.id;
}
