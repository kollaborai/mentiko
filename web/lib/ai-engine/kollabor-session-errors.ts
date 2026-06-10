// -------------------------------------------------------------------
// kollabor-session-errors.ts — Recoverable session error detection.
// -------------------------------------------------------------------
// Kollabor engine sessions can become invalid due to server restart,
// inactivity timeout, or token expiry. These errors are RECOVERABLE
// by creating a fresh session — the client should NOT surface them to
// the user as failures.
//
// The patterns below cover all known session-invalid responses from the
// engine. 404 is included because GET /sessions/:id returns 404 when
// a session has been reaped (engine-side gc).
//
// Usage: wrap any kollabor-engine API call in a try/catch and call this
// function on the error. If true, discard the session id and call
// getOrCreateSession() to obtain a fresh one.
// -------------------------------------------------------------------

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
