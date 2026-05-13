const RECOVERABLE_SESSION_ERROR_PATTERNS = [
  "session not found",
  "invalid session",
  "session expired",
  "expired session",
  "session has expired",
  "invalid or expired session token",
  "session token expired",
  "expired session token",
  "session invalid",
  "token expired",
];

export function isRecoverableKollaborSessionError(message: unknown): boolean {
  const normalized = String(message ?? "").toLowerCase();
  if (!normalized.trim()) return false;

  return (
    RECOVERABLE_SESSION_ERROR_PATTERNS.some((pattern) =>
      normalized.includes(pattern),
    ) || normalized.includes("404")
  );
}
