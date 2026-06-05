import { isRecoverableKollaborSessionError } from "../ai-engine/kollabor-session-errors";

describe("isRecoverableKollaborSessionError", () => {
  it.each([
    "Session not found",
    "404",
    "engine returned 404 for session",
    "Invalid session",
    "Session expired",
    "Invalid or expired session token",
    "session token expired",
    "token expired before refresh",
  ])("treats %s as recoverable", (message) => {
    expect(isRecoverableKollaborSessionError(message)).toBe(true);
  });

  it.each([
    "",
    null,
    undefined,
    "rate limit exceeded",
    "model provider unavailable",
  ])("does not treat %s as recoverable", (message) => {
    expect(isRecoverableKollaborSessionError(message)).toBe(false);
  });
});
