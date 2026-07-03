import { BadRequest } from "@/lib/api-errors";

/**
 * Validate a chain ID taken from a URL param. Strips to [A-Za-z0-9_-] and
 * rejects empty / overlong values so it can never escape the chain directory
 * when joined into orgPath(..., "chains", chainId) — i.e. no `../` traversal
 * into another chain's (or another org's) git repo.
 *
 * Chain IDs are URL-safe identifiers (kebab-case), so this allowlist matches
 * every legitimate ID and rejects everything that could be a path segment.
 */
export function validateChainId(id: string): string {
  const sanitized = String(id).replace(/[^a-zA-Z0-9\-_]/g, "");
  if (sanitized.length === 0 || sanitized.length > 100) {
    throw new BadRequest("Invalid chain ID");
  }
  return sanitized;
}
