/**
 * Output sanitization: ANSI stripping + credential redaction.
 * Used by run output API, agent output API, and activity API.
 */

// Handles CSI, OSC, DCS, SOS, PM, APC, and simple escape sequences
// IMPORTANT: Longer patterns must come first to avoid partial matches
const ANSI_RE = /(?:\x1b(?:\[[0-?]*[ -/]*[@-~]|][^\x07]*(?:\x07|\x1b\\)|P[^\x1b]*\x1b\\|X[^\x1b]*\x1b\\|_[^\x1b]*\x1b\\|\^[^\x1b]*\x1b\\|[@-Z\\-_]))/g;

// sensitive env var names
const SENSITIVE_VARS =
  "ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|MENTIKO_AI_GATEWAY_TOKEN|MENTIKO_AI_GATEWAY_LOCAL_TOKEN|JOB_CALLBACK_SECRET|AUTH_TOKEN|API_KEY|SECRET_KEY|ACCESS_TOKEN|BEARER_TOKEN|SESSION_TOKEN|BETTER_AUTH_SECRET";

// credential patterns to redact (applied per-line)
const LINE_PATTERNS: [RegExp, string][] = [
  // export VAR='value' or VAR='value' (quoted)
  [new RegExp(`(${SENSITIVE_VARS})='[^']*'`, "gi"), "$1=[REDACTED]"],
  [new RegExp(`(${SENSITIVE_VARS})="[^"]*"`, "gi"), "$1=[REDACTED]"],
  // VAR=unquoted_value (no quotes)
  [new RegExp(`(${SENSITIVE_VARS})=([^\\s;'"][^\\s;]*)`, "gi"), "$1=[REDACTED]"],
  // Bearer tokens in headers
  [/(Bearer\s+)[A-Za-z0-9._\-]{20,}/gi, "$1[REDACTED]"],
  // tenant AI gateway tokens spend tenant quota and must not appear in logs
  [/\bmtk_ai_[A-Za-z0-9_-]{16,}\b/g, "[REDACTED]"],
  // standalone long hex tokens (32+ hex chars, optionally with dot+base64 suffix)
  // catches token fragments on continuation lines like: 72ebb4f9ca444565d8a.4SCYl3qMgLk6ONDf
  [/\b[A-Fa-f0-9]{32,}(?:\.[A-Za-z0-9+/=_\-]+)?\b/g, "[REDACTED]"],
];

// normalize line endings and strip invisible control characters
export function normalizeOutput(s: string): string {
  return s
    .replace(/\r\n/g, '\n')           // Normalize CRLF to LF
    .replace(/\r/g, '\n')             // Normalize old Mac CR to LF
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // Strip zero-width chars
    .replace(/\t/g, '  ');            // Normalize tabs to spaces
}

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

export function redactCredentials(s: string): string {
  let result = s;
  for (const [pattern, replacement] of LINE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function sanitizeOutput(s: string): string {
  return redactCredentials(normalizeOutput(stripAnsi(s)));
}
