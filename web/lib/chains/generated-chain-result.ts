type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObject(text: string): JsonRecord | null {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    return isJsonRecord(parsed) ? parsed : null;
  } catch {
    // Preserve the existing model-output tolerance for a short prose wrapper,
    // while still requiring the extracted body itself to be strict JSON.
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return isJsonRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

/**
 * Resolve the canonical generated chain from every supported job-result shape.
 * A completion payload is only usable when it contains a named chain and an
 * agents array. Missing or malformed output returns null and must fail closed.
 */
export function extractGeneratedChainResult(result: unknown): JsonRecord | null {
  if (!isJsonRecord(result)) return null;

  const nestedChain = isJsonRecord(result.chain) ? result.chain : undefined;
  const direct = nestedChain ?? result;
  if (typeof direct.name === "string" && direct.name.trim() && Array.isArray(direct.agents)) {
    return direct;
  }

  const output = result.output;
  const parsed = typeof output === "string"
    ? parseJsonObject(output)
    : isJsonRecord(output)
      ? output
      : null;
  if (parsed && typeof parsed.name === "string" && parsed.name.trim() && Array.isArray(parsed.agents)) {
    return parsed;
  }

  return null;
}

export const INVALID_GENERATED_CHAIN_RESULT_ERROR =
  "Chain generation completed without a valid JSON chain payload. The result was missing, malformed, or did not include name and agents.";
