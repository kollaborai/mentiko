import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
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
 * CURRENT run attempt's own transcript. The live caller derives these values
 * from run.json and the attempt ledger, which can be partial; only a trusted
 * session id, attempt clock, or instruction path is strong enough to bind a
 * transcript. Workspace and run id are contextual scoring signals, never a
 * standalone acceptance boundary.
 */
export interface TranscriptIdentityOptions {
  /** Optional transcript/session UUID supplied by a trusted caller. */
  sessionId?: string;
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
function containsIdentityToken(body: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}(?=$|[^A-Za-z0-9_-])`).test(body);
}

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
  const runIds = new Set<string>();
  const timestamps: number[] = [];
  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      if (typeof record.cwd === "string") cwds.add(record.cwd);
      for (const key of ["sessionId", "session_id"] as const) {
        if (typeof record[key] === "string") sessionIds.add(record[key].toLowerCase());
      }
      for (const key of ["runId", "run_id"] as const) {
        if (typeof record[key] === "string") runIds.add(record[key]);
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
  const requestedSessionId = identity.sessionId?.toLowerCase();
  if (requestedSessionId && (sessionIds.size === 0 || !sessionIds.has(requestedSessionId))) return null;
  if (identity.runId && runIds.size > 0 && !runIds.has(identity.runId)) return null;

  let score = uuid && sessionIds.has(uuid) ? 40 : 0;
  if (requestedSessionId && sessionIds.has(requestedSessionId)) score += 60;
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

  const runMatch = Boolean(identity.runId && containsIdentityToken(body, identity.runId));
  const instructionMatch = Boolean(identity.instructionPath && body.includes(identity.instructionPath));
  if (runMatch) score += 20;
  if (instructionMatch) score += 30;
  // A run id or workspace is contextual metadata, not a sufficient provenance
  // anchor: either the attempt clock, instruction path, or trusted session id
  // must bind this transcript to the current attempt. This prevents a decoy
  // containing only a copied run id from latching completion.
  if (!identity.attemptStartedAt && !identity.instructionPath && !requestedSessionId) return null;
  return score;
}

/**
 * True when the caller supplied a strong identity anchor. Workspace and run id
 * alone are intentionally excluded: copied metadata can appear in another
 * run's transcript, so selection fails closed until the attempt clock,
 * instruction path, or trusted session id is also present.
 */
export function hasTranscriptIdentityBoundary(identity: TranscriptIdentityOptions): boolean {
  return Boolean(identity.sessionId || identity.attemptStartedAt || identity.instructionPath);
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
  findByInstructionPath?: () => string[],
): string {
  const uuids = [...new Set((capture.match(TRANSCRIPT_UUID_RE) ?? []).map((u) => u.toLowerCase()))];
  if (!hasTranscriptIdentityBoundary(identity)) return "";

  const candidates = uuids.flatMap((uuid) => {
    const path = resolve(uuid);
    if (!path) return [];
    const score = scoreTranscriptIdentity(path, uuid, identity);
    return score === null ? [] : [{ path, score }];
  });

  // The screen UUID is one finder; the instruction pointer is another. Neither
  // gates the other -- a CLI that never prints a session UUID (codex, aider,
  // kollab, an unconfigured claude) still resolves via findByInstructionPath
  // (findTranscriptJsonlByInstructionPath), scored through the SAME
  // scoreTranscriptIdentity funnel a uuid-found candidate goes through (uuid
  // omitted, so no uuid-match bonus -- absence never disqualifies, presence
  // only ever raises a competing candidate's score). A path the uuid pass
  // already scored is skipped so the same transcript can't tie against itself.
  if (identity.instructionPath && findByInstructionPath) {
    const alreadyScored = new Set(candidates.map((candidate) => candidate.path));
    for (const path of findByInstructionPath()) {
      if (alreadyScored.has(path)) continue;
      alreadyScored.add(path);
      const score = scoreTranscriptIdentity(path, undefined, identity);
      if (score !== null) candidates.push({ path, score });
    }
  }

  if (!candidates.length) return "";
  candidates.sort((a, b) => b.score - a.score);
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

/**
 * Depth-bounded enumeration of every *.jsonl file under a transcript root.
 * Same traversal boundary as findTranscriptJsonl (a directory or symlink
 * masquerading as a transcript is stepped over, never guessed at) but
 * collects every match instead of stopping at the first uuid hit, because the
 * instruction-path finder below has no uuid to search for.
 */
function collectJsonlFiles(root: string, depth: number): string[] {
  if (depth < 0 || !existsSync(root)) return [];
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry);
    try {
      const entryStat = lstatSync(path);
      if (entry.endsWith(".jsonl") && entryStat.isFile()) {
        out.push(path);
      } else if (entryStat.isDirectory()) {
        out.push(...collectJsonlFiles(path, depth - 1));
      }
    } catch {
      continue;
    }
  }
  return out;
}

// Hard ceiling on how many time-window survivors get their content read on a
// single call. A monitor tick must stay cheap even when a transcript root
// has accumulated many old session logs.
const TRANSCRIPT_INSTRUCTION_PATH_SCAN_LIMIT = 20;

/**
 * Find candidate transcripts by CONTENT instead of a screen-scraped session
 * UUID: buildInstructionPointer (agent-bootstrap-plan.ts) pastes the current
 * run's per-agent instruction file path into the agent's chat composer at
 * bootstrap, so it lands verbatim in the transcript JSONL regardless of which
 * CLI is running -- unlike a session UUID, nothing has to print it to the
 * screen. This is what makes durable AGENT_COMPLETE detection (route B)
 * CLI-agnostic instead of depending on a configured Claude status line.
 *
 * Cheap by construction: every *.jsonl under root is stat'd (not read) and
 * narrowed to the current attempt's time window FIRST, using the same
 * clock-skew/future-tolerance constants scoreTranscriptIdentity applies to
 * in-content timestamps -- just against mtime, so the filter costs a stat, not
 * a read. Only the newest TRANSCRIPT_INSTRUCTION_PATH_SCAN_LIMIT survivors are
 * actually opened to check for the instruction-path substring. With no attempt
 * clock (instructionPath supplied without an attempt row) the window check is
 * skipped and the same recency cap is the only bound.
 *
 * Returns every surviving path unranked -- the caller (selectTranscript-
 * FromCapture) scores and ambiguity-checks them with scoreTranscriptIdentity,
 * the SAME funnel a uuid-found candidate goes through, so a screen UUID stays
 * an optional tiebreaker rather than the gate. Fails closed to [] when there
 * is no instructionPath to anchor on, no root, or no textual match -- never a
 * guess.
 */
export function findTranscriptJsonlByInstructionPath(
  root: string,
  identity: TranscriptIdentityOptions,
  depth: number,
): string[] {
  if (!identity.instructionPath) return [];
  const files = collectJsonlFiles(root, depth);
  if (!files.length) return [];

  const started = identity.attemptStartedAt ? Date.parse(identity.attemptStartedAt) : Number.NaN;
  const now = (identity.now ?? new Date()).getTime();
  const withinWindow = (mtimeMs: number): boolean => !Number.isFinite(started) || (
    mtimeMs >= started - TRANSCRIPT_ATTEMPT_CLOCK_SKEW_MS
    && mtimeMs <= now + TRANSCRIPT_FUTURE_TIMESTAMP_TOLERANCE_MS
  );

  const narrowed = files
    .map((path) => {
      try {
        return { path, mtimeMs: statSync(path).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { path: string; mtimeMs: number } => entry !== null && withinWindow(entry.mtimeMs))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, TRANSCRIPT_INSTRUCTION_PATH_SCAN_LIMIT);

  const matches: string[] = [];
  for (const { path } of narrowed) {
    let body: string;
    try {
      body = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    if (body.includes(identity.instructionPath)) matches.push(path);
  }
  return matches;
}
