#!/usr/bin/env node
import { lstatSync, readFileSync } from "node:fs";
import {
  agentCompleteMarkerDurable,
  findTranscriptJsonl,
  hasTranscriptIdentityBoundary,
  scoreTranscriptIdentity,
  selectTranscriptFromCapture,
  transcriptRootFromProfile,
  type TranscriptIdentityOptions,
} from "@/lib/runner-v2/agent-transcript";

/**
 * Shell-to-TypeScript invocation boundary for the transcript/provenance
 * contract. lib/agent-functions.sh no longer resolves the transcript itself:
 * `_agent_transcript_jsonl` forwards a pty capture plus primitive identity
 * arguments to `resolve`, and `agent-complete-marker-durable` forwards the same
 * arguments to `durable-marker`. Both shell functions keep their signatures and
 * return codes; every decision -- transcript root resolution, identity-bound
 * UUID selection, assistant-marker validation, ambiguity handling -- lives here.
 *
 * The capture arrives on stdin, never as an argument: a 2000-line pty capture
 * routinely exceeds ARG_MAX, and the shell already holds it as a string.
 *
 * Fail-closed is the contract, not an error path. `resolve` prints nothing and
 * `durable-marker` exits 1 whenever the transcript is missing, identity-less,
 * rejected, or ambiguous, so the monitor keeps waiting for the declared event
 * file instead of latching a still-working agent off a re-wrappable screen
 * (BUG-022) or off another run's transcript.
 */

const COMMANDS = ["resolve", "durable-marker"] as const;
type Command = (typeof COMMANDS)[number];

const IDENTITY_FLAGS = new Set([
  "--session-id",
  "--profile-path",
  "--explicit-jsonl",
  "--run-id",
  "--workspace",
  "--attempt-started-at",
  "--instruction-path",
  "--capture-depth",
]);

const DEFAULT_CAPTURE_DEPTH = 4;

export interface RunnerAgentTranscriptCliDeps {
  readCapture: () => string;
  now?: Date;
}

/**
 * Resolve the transcript JSONL for the current run attempt, or "" when it
 * cannot be established. Mirrors monitor-live-io's resolveTranscriptJsonl so the
 * shell boundary and the live typed monitor agree on every accept/reject.
 *
 * An explicit `--explicit-jsonl` with NO identity anchors supplied is the
 * caller/test seam and passes through unscored -- that is the shell's existing
 * MENTIKO_TRANSCRIPT_JSONL behavior. Once ANY identity anchor is supplied the
 * explicit path is scored like any other candidate, so a seam value cannot smuggle
 * another run's transcript past the boundary.
 */
export function resolveTranscriptPath(
  values: Map<string, string>,
  deps: RunnerAgentTranscriptCliDeps,
): string {
  const identity = identityFromValues(values, deps.now);
  const explicit = values.get("--explicit-jsonl");
  if (explicit) {
    // Keep the typed boundary strict: directories, FIFOs, and symlinked paths
    // are never transcript sources, even when a symlink currently targets a
    // regular file. This prevents a mutable external path from becoming
    // completion evidence after selection.
    try {
      if (!lstatSync(explicit).isFile()) return "";
    } catch {
      return "";
    }
    if (!hasTranscriptIdentityBoundary(identity)) {
      const hasWeakIdentity = Boolean(identity.workspacePath || identity.runId);
      return hasWeakIdentity ? "" : explicit;
    }
    return scoreTranscriptIdentity(explicit, undefined, identity) === null ? "" : explicit;
  }

  if (!hasTranscriptIdentityBoundary(identity)) return "";
  const root = transcriptRootFromProfile(values.get("--profile-path"));
  if (!root) return "";
  const depth = captureDepth(values.get("--capture-depth"));
  return selectTranscriptFromCapture(
    deps.readCapture(),
    (uuid) => findTranscriptJsonl(root, uuid, depth),
    identity,
  );
}

export function runRunnerAgentTranscriptCli(
  argv: string[],
  deps: RunnerAgentTranscriptCliDeps,
  write: (line: string) => void = (line) => console.log(line),
): number {
  const parsed = parseCli(argv);
  const path = resolveTranscriptPath(parsed.values, deps);

  if (parsed.command === "resolve") {
    if (path) write(path);
    return 0;
  }

  if (!path) return 1;
  return agentCompleteMarkerDurable(path) ? 0 : 1;
}

interface ParsedCli { command: Command; values: Map<string, string>; }

function parseCli(argv: string[]): ParsedCli {
  const command = argv[0] as Command | undefined;
  if (!command || !COMMANDS.includes(command)) throw new Error(usage());
  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || !value || !flag.startsWith("--") || values.has(flag)) throw new Error(usage());
    if (!IDENTITY_FLAGS.has(flag)) throw new Error(`${flag} is not valid for ${command}`);
    values.set(flag, value);
  }
  return { command, values };
}

function identityFromValues(values: Map<string, string>, now?: Date): TranscriptIdentityOptions {
  return {
    sessionId: values.get("--session-id"),
    workspacePath: values.get("--workspace"),
    attemptStartedAt: values.get("--attempt-started-at"),
    runId: values.get("--run-id"),
    instructionPath: values.get("--instruction-path"),
    now,
  };
}

function captureDepth(raw: string | undefined): number {
  if (!raw) return DEFAULT_CAPTURE_DEPTH;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_CAPTURE_DEPTH;
}

function usage(): string {
  return `usage: runner-agent-transcript <${COMMANDS.join("|")}> [--profile-path <path>] [--explicit-jsonl <path>] [--session-id <uuid>] [--run-id <id>] [--workspace <path>] [--attempt-started-at <iso>] [--instruction-path <path>] [--capture-depth <n>] < capture`;
}

/**
 * The capture is only read when live resolution actually needs it, so a
 * `--explicit-jsonl` call does not block on a stdin that the shell never wrote.
 */
function readStdinCapture(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

if (require.main === module) {
  try {
    process.exitCode = runRunnerAgentTranscriptCli(process.argv.slice(2), { readCapture: readStdinCapture });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
