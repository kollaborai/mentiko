import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";

/**
 * Typed owner for the agent transcript / provenance JSON contract.
 *
 * The shell predecessor in lib/agent-functions.sh resolved the durable
 * AGENT_COMPLETE completion marker by piping the session transcript JSONL
 * through jq and grepping for a standalone marker line. This module owns that
 * same contract in TypeScript: reading the agent-profile transcript root,
 * parsing each JSONL record into assistant-authored text segments, scoring a
 * candidate transcript against the CURRENT run's identity, and deciding whether
 * a standalone AGENT_COMPLETE line is durably present in the agent's OWN output.
 *
 * Everything here is pure or fs-only -- no pty, no config -- so the compiled CLI
 * bundle and the focused unit tests can use these helpers without pulling in the
 * live monitor module. web/lib/runner-v2/monitor-live-io.ts is the live caller:
 * it supplies the pty capture and the run context, imports these helpers, and
 * re-exports `selectTranscriptFromCapture` / `transcriptRootFromProfile` so its
 * own public surface is unchanged.
 *
 * Every entry point fails closed -- "" / null / false / empty -- whenever the
 * transcript is missing, unparseable, identity-less, or ambiguous, so completion
 * falls back to the declared event file rather than trusting the re-wrappable
 * rendered screen.
 */

const TRANSCRIPT_UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const TRANSCRIPT_ATTEMPT_CLOCK_SKEW_MS = 5_000;
const TRANSCRIPT_FUTURE_TIMESTAMP_TOLERANCE_MS = 60_000;

/**
 * Extract every assistant-authored text segment from one JSONL transcript
 * record. Mirrors the jq query used by the legacy shell durable-marker check:
 *
 *   ( select(.type=="assistant") | .message.content[]? | select(.type=="text") | .text ),
 *   ( select((.type=="message" or .type=="response_item") and .role=="assistant")
 *     | ((.content // .payload.content // [])[]? | (.text // empty)) )
 *
 * Two transcript shapes are supported: the claude-code shape
 * ({type:"assistant", message:{content:[{type:"text", text}]}}) and the generic
 * role-tagged message shape ({type:"message"|"response_item", role:"assistant",
 * content|payload.content:[{text}]}). User-role records and non-text content
 * blocks are ignored, so the pasted instruction (a user message whose text keeps
 * AGENT_COMPLETE mid-sentence with a trailing period) can never satisfy the
 * standalone-line marker predicate regardless of role.
 */
export function assistantTexts(record: unknown): string[] {
  if (!record || typeof record !== "object") return [];
  const r = record as Record<string, unknown>;
  const out: string[] = [];
  if (r.type === "assistant" && r.message && typeof r.message === "object") {
    const content = (r.message as { content?: unknown }).content;
    if (Array.isArray(content)) {
      for (const item of content) {
        if (item && typeof item === "object" && (item as Record<string, unknown>).type === "text") {
          const text = (item as Record<string, unknown>).text;
          if (typeof text === "string") out.push(text);
        }
      }
    }
  }
  if ((r.type === "message" || r.type === "response_item") && r.role === "assistant") {
    // Match the legacy jq `.content // .payload.content // []` semantics:
    // fallback to payload only when content is absent/null. A malformed but
    // present content value must not be bypassed into a false completion latch.
    let content: unknown[] = [];
    if (Array.isArray(r.content)) {
      content = r.content;
    } else if ((r.content === undefined || r.content === null)
      && r.payload && typeof r.payload === "object"
      && Array.isArray((r.payload as { content?: unknown }).content)) {
      content = (r.payload as { content: unknown[] }).content;
    }
    for (const item of content) {
      if (item && typeof item === "object") {
        const text = (item as Record<string, unknown>).text;
        if (typeof text === "string") out.push(text);
      }
    }
  }
  return out;
}

/**
 * Resolve the transcript root directory from an agent-profile JSON file's
 * `log_path` field, expanding a leading ~ to the home directory and trimming a
 * trailing slash. Returns an empty string (degraded, not an error) when the
 * profile is absent, unreadable, or has no usable log_path, so callers fail
 * closed to the declared event file. Mirrors `jq -r '.log_path // empty'` plus
 * the shell tilde/trailing-slash normalization.
 */
export function transcriptRootFromProfile(profilePath: string | undefined): string {
  if (!profilePath || !existsSync(profilePath)) return "";
  try {
    const profile = JSON.parse(readFileSync(profilePath, "utf8")) as { log_path?: unknown };
    if (typeof profile.log_path !== "string" || !profile.log_path.trim()) return "";
    return profile.log_path.trim().replace(/^~(?=\/|$)/, homedir()).replace(/\/$/, "");
  } catch {
    return "";
  }
}

/**
 * True if a standalone AGENT_COMPLETE line is present in a text segment. A pty
 * UI attach can re-wrap the instruction echo so the token lands alone on the
 * rendered screen while the agent is still working (BUG-022); the durable
 * transcript cannot be re-wrapped, so this anchor on the agent's OWN output is
 * what the latch trusts. Equivalent to the shell
 * `grep -Eq '^[[:space:]]*AGENT_COMPLETE[[:space:]]*$'` over the assistant text.
 */
export function hasStandaloneAgentComplete(text: string): boolean {
  return text.split(/\r?\n/).some((line) => line.trim() === "AGENT_COMPLETE");
}

/**
 * Read every assistant-authored text segment from a transcript JSONL file.
 * Unreadable or syntactically invalid lines are skipped; a missing/unreadable
 * file yields an empty array (fail closed). The returned segments preserve
 * embedded newlines, so a marker on its own line within a multi-line assistant
 * message is detectable by hasStandaloneAgentComplete.
 */
export function readAssistantTextsFromTranscript(jsonlPath: string): string[] {
  let body: string;
  try {
    body = readFileSync(jsonlPath, "utf8");
  } catch {
    return [];
  }
  const texts: string[] = [];
  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    texts.push(...assistantTexts(record));
  }
  return texts;
}

/**
 * Authoritative durable AGENT_COMPLETE check: the marker on its own line in the
 * agent's recorded transcript output. Returns true iff durably present; fails
 * closed (false) when the transcript is missing or unparseable, so completion
 * falls back to the declared event file rather than trusting the rendered
 * screen. This is the typed twin of the shell agent-complete-marker-durable.
 */
export function agentCompleteMarkerDurable(jsonlPath: string): boolean {
  return readAssistantTextsFromTranscript(jsonlPath).some((text) => hasStandaloneAgentComplete(text));
}

/**
 * Identity boundary a candidate transcript must satisfy to be accepted as the
 * CURRENT run attempt's own transcript. Every field is optional because the live
 * caller derives them from run.json and the attempt ledger, both of which can be
 * partial; `hasTranscriptIdentityBoundary` is what refuses to guess when they
 * are all absent.
 */
export interface TranscriptIdentityOptions {
  workspacePath?: string;
  attemptStartedAt?: string;
  runId?: string;
  instructionPath?: string;
  now?: Date;
}

/** True when a cwd resolves to the workspace itself or a path contained by it. */
function isWithinWorkspace(workspace: string, cwd: string): boolean {
  const rel = relative(workspace, resolve(cwd));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.startsWith(sep));
}

/**
 * Score one candidate transcript against the current run attempt's identity, or
 * return null to REJECT it outright. Rejection (null) is not a low score: a
 * candidate whose recorded cwd sits outside the current workspace, or whose
 * newest timestamp predates the current attempt (beyond clock skew) or sits
 * implausibly in the future, is a different agent's transcript and must never be
 * adopted no matter how it ranks against the alternatives.
 *
 * A transcript that declares session ids at all must declare THIS uuid, so a
 * decoy file that happens to carry a real JSONL body cannot answer for the uuid
 * it was resolved from. Weights order the survivors -- workspace containment is
 * the strongest signal, then attempt freshness, then instruction and run id --
 * and the caller treats a tie as ambiguous rather than picking one.
 */
export function scoreTranscriptIdentity(
  path: string,
  uuid: string | undefined,
  identity: TranscriptIdentityOptions,
): number | null {
  let body = "";
  try {
    body = readFileSync(path, "utf8");
  } catch {
    return null;
  }

  const cwds = new Set<string>();
  const sessionIds = new Set<string>();
  const timestamps: number[] = [];
  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      if (typeof record.cwd === "string") cwds.add(record.cwd);
      for (const key of ["sessionId", "session_id"] as const) {
        if (typeof record[key] === "string") sessionIds.add(record[key].toLowerCase());
      }
      if (typeof record.timestamp === "string") {
        const value = Date.parse(record.timestamp);
        if (Number.isFinite(value)) timestamps.push(value);
      }
    } catch {
      continue;
    }
  }

  if (uuid && sessionIds.size > 0 && !sessionIds.has(uuid)) return null;

  let score = uuid && sessionIds.has(uuid) ? 40 : 0;
  if (identity.workspacePath) {
    const workspace = resolve(identity.workspacePath);
    const workspaceMatch = [...cwds].some((cwd) => isWithinWorkspace(workspace, cwd));
    if (!workspaceMatch) return null;
    score += 100;
  }

  if (identity.attemptStartedAt) {
    const started = Date.parse(identity.attemptStartedAt);
    const latest = timestamps.length ? Math.max(...timestamps) : Number.NaN;
    const now = (identity.now ?? new Date()).getTime();
    if (
      !Number.isFinite(started)
      || !Number.isFinite(latest)
      || latest < started - TRANSCRIPT_ATTEMPT_CLOCK_SKEW_MS
      || latest > now + TRANSCRIPT_FUTURE_TIMESTAMP_TOLERANCE_MS
    ) {
      return null;
    }
    score += 80;
  }

  const runMatch = Boolean(identity.runId && body.includes(identity.runId));
  const instructionMatch = Boolean(identity.instructionPath && body.includes(identity.instructionPath));
  if (runMatch) score += 20;
  if (instructionMatch) score += 30;
  if (!identity.workspacePath && !identity.attemptStartedAt && !runMatch && !instructionMatch) return null;
  return score;
}

/**
 * True when the caller supplied at least one identity anchor. With none of them,
 * every candidate would score on position alone -- which is exactly the decoy
 * failure this module exists to prevent -- so selection fails closed instead.
 */
export function hasTranscriptIdentityBoundary(identity: TranscriptIdentityOptions): boolean {
  return Boolean(identity.workspacePath || identity.attemptStartedAt || identity.runId || identity.instructionPath);
}

/**
 * Pick a session's transcript JSONL from its screen capture. A capture routinely
 * holds MORE than one UUID-shaped string: the CLI status bar carries the real
 * transcript/session UUID, but the agent's goal or prompt commonly echoes OTHER
 * UUIDs -- a decision_id, a task id -- that appear EARLIER in the scrollback.
 * Matching only the first hit resolves to a decoy UUID with no transcript file,
 * so the durable AGENT_COMPLETE marker is never read and the monitor nudges to a
 * false stall until it escalates the run to blocked (the decision-chain hang:
 * decision_id is always a UUID in the prompt, so it wins the first-match every
 * time). Try every distinct UUID in capture order and accept the first that
 * `resolve` maps to a real file -- decoys resolve to "" and are skipped, never
 * guessed. Pure + injected `resolve` so it is unit-tested without the fs/pty.
 */
export function selectTranscriptFromCapture(
  capture: string,
  resolve: (uuid: string) => string,
  identity: TranscriptIdentityOptions = {},
): string {
  const uuids = [...new Set((capture.match(TRANSCRIPT_UUID_RE) ?? []).map((u) => u.toLowerCase()))];
  if (!hasTranscriptIdentityBoundary(identity)) return "";
  const candidates = uuids.flatMap((uuid, position) => {
    const path = resolve(uuid);
    if (!path) return [];
    const score = scoreTranscriptIdentity(path, uuid, identity);
    return score === null ? [] : [{ path, position, score }];
  }).sort((a, b) => b.score - a.score || b.position - a.position);
  if (!candidates.length) return "";
  if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
    return "";
  }
  return candidates[0].path;
}

/**
 * Depth-bounded search for the `<uuid>.jsonl` transcript under an agent-profile
 * transcript root. Returns "" when the root is absent or nothing matches, so an
 * unresolvable (decoy) uuid is skipped by selectTranscriptFromCapture rather
 * than guessed at. Unreadable directories are stepped over, never fatal.
 */
export function findTranscriptJsonl(root: string, uuid: string, depth: number): string {
  if (depth < 0 || !existsSync(root)) return "";
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return "";
  }
  for (const entry of entries) {
    const path = join(root, entry);
    try {
      // Match the legacy `find ... -type f` boundary: a directory named like a
      // transcript, or a symlink to one, is not a durable JSONL source. Fail
      // closed instead of returning it and letting a later read hide the real
      // nested transcript behind the name collision.
      const entryStat = lstatSync(path);
      if (entry.includes(uuid) && entry.endsWith(".jsonl") && entryStat.isFile()) return path;
      if (entryStat.isDirectory()) {
        const nested = findTranscriptJsonl(path, uuid, depth - 1);
        if (nested) return nested;
      }
    } catch {
      continue;
    }
  }
  return "";
}
