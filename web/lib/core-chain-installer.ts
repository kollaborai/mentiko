import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { orgPath } from "@/lib/config";

export type CoreChainRecord = Record<string, unknown>;

export interface CoreChainInstallResult<TId extends string> {
  id: TId;
  path: string;
  created: boolean;
}

export function getCoreChainPath(namespaceId: string, orgId: string, id: string): string {
  return join(orgPath(namespaceId, orgId, "chains", id), "chain.json");
}

export function readExistingCoreChain(path: string): CoreChainRecord | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as CoreChainRecord
      : null;
  } catch {
    return null;
  }
}

export function writeCoreChain(path: string, chain: CoreChainRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(chain, null, 2)}\n`, "utf8");
}

export function hasStringDefaultAgentProfile(chain: CoreChainRecord | null): chain is CoreChainRecord & { default_agent_profile: string } {
  return typeof chain?.default_agent_profile === "string" && chain.default_agent_profile.trim().length > 0;
}

export function mergeDefaultAgentProfile<TChain extends CoreChainRecord>(
  existing: CoreChainRecord | null,
  desired: TChain,
  { dropExistingProfile = false }: { dropExistingProfile?: boolean } = {}
): TChain {
  if (dropExistingProfile || !hasStringDefaultAgentProfile(existing)) {
    return desired;
  }
  return {
    ...desired,
    default_agent_profile: existing.default_agent_profile,
  };
}

export function updateCoreChainProfile<TId extends string>({
  namespaceId,
  orgId,
  id,
  profileId,
  isManagedChain,
}: {
  namespaceId: string;
  orgId: string;
  id: TId;
  profileId?: string | null;
  isManagedChain: (chain: CoreChainRecord | null) => boolean;
}) {
  const chainPath = getCoreChainPath(namespaceId, orgId, id);
  const existing = readExistingCoreChain(chainPath);
  if (!isManagedChain(existing)) {
    throw new Error(`Core chain not found: ${id}`);
  }

  const next = { ...existing };
  if (profileId) {
    next.default_agent_profile = profileId;
  } else {
    delete next.default_agent_profile;
  }
  writeCoreChain(chainPath, next);
  return { id, path: chainPath, chain: next };
}

export function restoreCoreChain<TId extends string, TChain extends CoreChainRecord>({
  namespaceId,
  orgId,
  id,
  buildChain,
}: {
  namespaceId: string;
  orgId: string;
  id: TId;
  buildChain: (id: TId) => TChain;
}) {
  const chainPath = getCoreChainPath(namespaceId, orgId, id);
  const chain = buildChain(id);
  writeCoreChain(chainPath, chain);
  return { id, path: chainPath, chain };
}

export function ensureCoreChains<TId extends string, TChain extends CoreChainRecord>({
  namespaceId,
  orgId,
  ids,
  buildChain,
  shouldWriteChain,
  mergeExistingChain,
}: {
  namespaceId: string;
  orgId: string;
  ids: readonly TId[];
  buildChain: (id: TId) => TChain;
  shouldWriteChain: (existing: CoreChainRecord | null, desired: TChain) => boolean;
  mergeExistingChain?: (existing: CoreChainRecord | null, desired: TChain) => TChain;
}): CoreChainInstallResult<TId>[] {
  return ids.map((id) => {
    const chainPath = getCoreChainPath(namespaceId, orgId, id);
    const chain = buildChain(id);
    const existing = readExistingCoreChain(chainPath);
    const shouldWrite = shouldWriteChain(existing, chain);
    if (shouldWrite) {
      writeCoreChain(chainPath, mergeExistingChain ? mergeExistingChain(existing, chain) : chain);
    }
    return {
      id,
      path: chainPath,
      created: shouldWrite,
    };
  });
}
