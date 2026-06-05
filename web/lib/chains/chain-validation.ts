import { existsSync } from "fs";
import { orgPath } from "../config";

/**
 * Validate that a chain ID exists in the org-scoped chains directory
 */
export function validateChainId(
  chainId: string,
  namespaceId: string,
  orgId: string
): { valid: boolean; chainName?: string; error?: string } {
  if (!chainId || typeof chainId !== "string") {
    return { valid: false, error: "Chain ID is required" };
  }

  const chainPath = orgPath(namespaceId, orgId, "chains", chainId, "chain.json");

  if (!existsSync(chainPath)) {
    return {
      valid: false,
      error: `Chain "${chainId}" does not exist in namespace "${namespaceId}"`,
    };
  }

  // Try to read chain name for metadata
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require("fs");
    const content = readFileSync(chainPath, "utf-8");
    const chain = JSON.parse(content);
    return {
      valid: true,
      chainName: chain.name || chainId,
    };
  } catch {
    // Chain exists but couldn't read name - still valid
    return { valid: true, chainName: chainId };
  }
}

/**
 * Build chain assignment metadata for task storage
 * Returns metadata with chainBinding nested structure
 */
export function buildChainMetadata(
  chainId: string,
  chainName?: string,
  autoRun = true
): Record<string, unknown> {
  return {
    chainBinding: {
      chain_id: chainId,
      chain_name: chainName || chainId,
      auto_run: autoRun,
    },
  };
}
