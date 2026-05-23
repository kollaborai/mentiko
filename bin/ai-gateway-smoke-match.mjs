const LEADING_QUOTE_OR_SPACE = /^["'`\s]+/;

export function isExpectedSmokeContent(content, expected) {
  if (typeof content !== "string" || typeof expected !== "string") return false;
  if (!expected) return false;
  const normalized = content.toLowerCase().trim().replace(LEADING_QUOTE_OR_SPACE, "");
  return normalized.startsWith(expected.toLowerCase());
}
