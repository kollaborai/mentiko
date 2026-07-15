/**
 * Match a persisted event identity to one agent without raw substring rules.
 * Exact agent/session identity always wins. Delimiter-token matching is allowed
 * only with the full agent-id set so a real sibling identity can veto it.
 */
export function runnerEventIdentityMatches(
  candidateValue: string,
  ownerValue: string,
  sessionName?: string,
  allAgentIds?: string[],
): boolean {
  const candidate = normalizeIdentity(candidateValue);
  const owner = normalizeIdentity(ownerValue);
  const session = normalizeIdentity(sessionName);
  if (!candidate || !owner) return false;
  if (candidate === owner || (session && candidate === session)) return true;

  const identities = Array.from(new Set(
    (allAgentIds || []).map(normalizeIdentity).filter(Boolean),
  ));
  if (identities.length === 0) return false;
  const namesAnotherAgent = identities.some((agentId) => (
    agentId !== owner && identityAppearsAsToken(candidate, agentId)
  ));
  if (namesAnotherAgent) return false;
  return identityAppearsAsToken(candidate, owner)
    || identityAppearsAsToken(owner, candidate);
}

function identityAppearsAsToken(candidate: string, identity: string): boolean {
  return candidate === identity
    || candidate.startsWith(`${identity}-`)
    || candidate.endsWith(`-${identity}`)
    || candidate.includes(`-${identity}-`);
}

function normalizeIdentity(value: string | undefined): string {
  return value?.trim().toLowerCase() || "";
}
