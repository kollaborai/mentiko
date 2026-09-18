// -------------------------------------------------------------------
// kollabor-session-errors.ts — Recoverable session error detection.
// -------------------------------------------------------------------
// Session lookup failures (404/expired-token) and engine lifecycle races
// (stale daemon / turn already in flight) are recoverable by the caller.
// A recoverable error must not itself delete the persisted session identity:
// callers may cancel/reset the existing session and retry with the same id.

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
  "session daemon is not running",
  "session daemon not running",
  "daemon is not running",
  "daemon not running",
  "turn already in flight",
  "turn already in-flight",
  "turn in flight",
  "turn-in-flight",
  "session daemon is not running",
  "daemon is not running",
  "session is not running",
  "stale session",
];

/**
 * Return true for engine errors that can be repaired without changing the
 * user's stable session identity. HTTP status is accepted separately so a
 * typed client error can retain status/detail while string callers continue
 * to work.
 */
export function isRecoverableKollaborSessionError(
  error: unknown,
  status?: number,
): boolean {
  const normalized = String(
    error instanceof Error ? error.message : error ?? "",
  ).toLowerCase();
  if (!normalized.trim()) return status === 404 || status === 409;

  return (
    status === 404 ||
    status === 409 ||
    RECOVERABLE_SESSION_ERROR_PATTERNS.some((pattern) =>
      normalized.includes(pattern),
    ) ||
    normalized.includes("http 404") ||
    normalized.includes("http 409") ||
    normalized.includes("status 404") ||
    normalized.includes("status 409") ||
    // Preserve the legacy contract: the engine often reports bare status
    // codes (without an "HTTP"/"status" prefix) in proxy error messages.
    normalized.includes("404") ||
    normalized.includes("409")
  );
}

/** Narrow typed shape shared by client recovery callers and tests. */
export interface KollaborHttpError extends Error {
  status: number;
  context?: string;
  detail?: string;
  recoverable?: boolean;
}

export function isKollaborHttpError(error: unknown): error is KollaborHttpError {
  return (
    error instanceof Error &&
    typeof (error as Partial<KollaborHttpError>).status === "number"
  );
}
