export interface ChainLikeWithMetadata {
  metadata?: unknown;
}

export interface RunLikeWithChain {
  chain?: string;
  chainId?: string;
  metadata?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isSystemChainMetadata(metadata: unknown): boolean {
  if (!isRecord(metadata)) return false;
  return metadata.systemChain === true ||
    metadata.system === true ||
    metadata.coreDecisionChain === true ||
    metadata.coreGenerationChain === true;
}

export function isSystemRunMetadata(metadata: unknown): boolean {
  if (!isRecord(metadata)) return false;
  return metadata.generationKind !== undefined ||
    metadata.generationJobId !== undefined ||
    metadata.decisionPhase !== undefined;
}

export function isSystemChainRecord(chain: ChainLikeWithMetadata): boolean {
  return isSystemChainMetadata(chain.metadata);
}

export function getRunChainId(run: RunLikeWithChain): string {
  if (run.chainId) return run.chainId;
  return (run.chain || "").toLowerCase().replace(/\s+/g, "-");
}

export function isSystemChainRun(run: RunLikeWithChain, systemChainIds: Set<string>): boolean {
  const chainId = getRunChainId(run);
  return (chainId.length > 0 && systemChainIds.has(chainId)) || isSystemRunMetadata(run.metadata);
}
