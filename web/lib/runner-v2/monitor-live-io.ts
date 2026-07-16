import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pty } from "@/lib/pty/pty-client";
import config from "@/lib/config";
import {
  agentCompleteMarkerDurable,
  findTranscriptJsonl,
  hasTranscriptIdentityBoundary,
  scoreTranscriptIdentity,
  selectTranscriptFromCapture,
  transcriptRootFromProfile,
  type TranscriptIdentityOptions,
} from "@/lib/runner-v2/agent-transcript";
import {
  classifyContextExhaustion,
  classifyDeath,
  classifyStall,
  detectContextExhaustion,
  type MonitorDiagnosticEvent,
} from "@/lib/runner-v2/monitor-diagnostics";
import {
  captureAssertsAgentComplete,
  captureHash,
  clearMonitorState,
  computeLatch,
  crossRunAdoptionAllowed,
  findAgentCompletionEventAnyRun,
  findCompletionEventFile,
  latchExists,
  loadMonitorState,
  monitorStatePaths,
  readDeclaredAgentIds,
  readDeclaredEmits,
  readEventRunAndTimestamp,
  saveMonitorState,
  writeLatch,
} from "@/lib/runner-v2/monitor-io";
import type { MonitorDriverIO } from "@/lib/runner-v2/monitor";
import { readRunJson, updateRunAgent, updateRunStatus, type RunRecord } from "@/lib/runner-v2/run-state";
import { readRunnerV2AttemptState } from "@/lib/runner-v2/agent-attempt";
import { launchRunnerV2CompletionPty } from "@/lib/runner-v2/completion-launch";
import { serializeRunnerEvent } from "@/lib/runner-v2/events";
import { isPayloadCompatibleWithKind } from "@/lib/generation/payload-contract";
import type { CompletionRecoveryEvidence } from "@/lib/runner-v2/completion-runner";

// The transcript/provenance contract is owned by @/lib/runner-v2/agent-transcript
// (pure + fs-only, so it stays usable from the compiled CLI bundle and from unit
// tests without the pty). Re-exported here so this module's public surface --
// and every existing importer of it -- is unchanged by that move.
export { selectTranscriptFromCapture, transcriptRootFromProfile };
export type { TranscriptIdentityOptions };

export interface LiveMonitorContext {
  sessionName: string;
  chainPath: string;
  runId: string;
  runDir: string;
  runJsonPath: string;
  agentId: string;
  workspaceType: string;
  eventsDir: string;
  stateDir: string;
  namespaceId: string;
  orgId: string;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

export type CompletionEvidence =
  | { kind: "declared-event"; path: string }
  | { kind: "durable-marker"; transcriptPath: string }
  | { kind: "core-generation-artifact"; artifactPath: string; jobId: string; generationKind: string };

export function createLiveMonitorIO(context: LiveMonitorContext): MonitorDriverIO {
  let completionEvidence: CompletionEvidence | null = null;
  // A cross-run event is usable only after crossRunAdoptionAllowed accepts its
  // task/predecessor or freshness+chain proof. Preserve that accepted evidence
  // into the typed completion entrypoint; otherwise it re-reads only this run's
  // events and falsely fails the completion it just allowed the monitor to take.
  let acceptedCrossRunCompletionEvent = false;
  const completeFromFreshEvidence = async (session: string): Promise<boolean> => {
    completionEvidence = await probeCompletionEvidence(session, context) || completionEvidence;
    if (!completionEvidence) return false;
    writeLatch(session);
    await launchCompletionSession(session, context, {
      completionRecoveryEvidence: completionEvidence.kind === "durable-marker"
        ? "durable-marker"
        : acceptedCrossRunCompletionEvent ? "accepted-cross-run-event" : undefined,
    });
    return true;
  };
  return {
    hasSession: (session) => pty.alive(session),
    observe: async (session) => {
      const capture = await pty.capture(session, 20).catch(() => "");
      const expectedEvent = readDeclaredEmits(context.chainPath, context.agentId);
      let eventFile = findCompletionEventFile({
        eventsDir: context.eventsDir,
        runId: context.runId,
        agentId: context.agentId,
        expectedEvent,
        sessionName: context.sessionName,
      });

      // Cross-run completion recovery: this run has NO completion event of its own,
      // yet the agent has printed a standalone AGENT_COMPLETE AND its declared emit
      // event already exists under ANOTHER run (a duplicate run of work a prior run
      // finished). Gated on the agent asserting completion, so an actively-working
      // run (which has not printed the marker) is never short-circuited; run-scoped
      // isolation above stays the primary signal.
      //
      // Finding the event is not enough to adopt it: a stale event from an
      // unrelated prior run must not complete this run. crossRunAdoptionAllowed
      // requires either a proven predecessor/task relation, or a tight freshness
      // window plus matching chain identity; otherwise this leaves the event for
      // the reconcile late-event recovery (recoverLateCompletionEvents) instead of
      // latching here.
      if (!eventFile && expectedEvent && captureAssertsAgentComplete(capture)) {
        const allAgentIds = readDeclaredAgentIds(context.chainPath);
        const candidateDir = context.eventsDir;
        const candidate = findAgentCompletionEventAnyRun({
          eventsDir: candidateDir,
          agentId: context.agentId,
          emitsEvent: expectedEvent,
          allAgentIds,
        });
        if (candidate) {
          const { runId: candidateRunId, timestamp: candidateTimestamp } = readEventRunAndTimestamp(candidateDir, candidate);
          const currentRun = safeReadRunJson(context.runJsonPath);
          const candidateRun = candidateRunId
            ? safeReadRunJson(join(dirname(context.runDir), candidateRunId, "run.json"))
            : null;
          const allowed = Boolean(currentRun) && crossRunAdoptionAllowed({
            candidateRunId,
            candidateTimestamp,
            now: new Date(),
            currentRun: currentRun ?? {},
            candidateRun,
          });
          if (allowed) {
            eventFile = candidate;
            acceptedCrossRunCompletionEvent = true;
            console.log(
              `monitor: ${context.agentId} asserted AGENT_COMPLETE and its '${expectedEvent}' completion event ` +
                `exists under another run (${candidate}, run ${candidateRunId}); completing run ${context.runId} cleanly instead of escalating`,
            );
          } else {
            console.log(
              `monitor: ${context.agentId} asserted AGENT_COMPLETE and a '${expectedEvent}' completion event exists ` +
                `under another run (${candidate}, run ${candidateRunId || "unknown"}), but adoption requires a proven ` +
                `predecessor/task relation or fresh+matching-chain evidence; leaving it for reconcile late-event ` +
                `recovery instead of completing run ${context.runId}`,
            );
          }
        }
      }

      completionEvidence = await probeCompletionEvidence(session, context, eventFile || undefined)
        || completionEvidence;
      const latched = computeLatch({
        alreadyLatched: latchExists(session),
        markerDurable: completionEvidence?.kind === "durable-marker",
        completionEventPresent: completionEvidence?.kind === "declared-event"
          || completionEvidence?.kind === "core-generation-artifact",
      });
      if (latched) writeLatch(session);
      return {
        processGone: context.workspaceType === "local"
          ? await monitorAgentProcessGone(session, context.env)
          : false,
        captureHash: captureHash(capture, 20),
        completionEventPresent: Boolean(eventFile),
        latched,
        // Reuse the same 20-line capture: an agent wedged on a context-window-limit
        // error shows it as its stuck tail every tick. Never override a real latch —
        // the reducer checks latched first, so a completed-then-errored agent still
        // completes.
        contextExhausted: !latched && detectContextExhaustion(capture),
      };
    },
    sendNudge: async (session, message) => {
      await pty.sendRaw(session, message);
      await sleepMs(1000);
      await pty.sendRaw(session, "\r");
      await sleepMs(500);
    },
    onComplete: async (session) => {
      completionEvidence = completionEvidence || await probeCompletionEvidence(session, context);
      await launchCompletionSession(session, context, {
        completionRecoveryEvidence: completionEvidence?.kind === "durable-marker"
          ? "durable-marker"
          : acceptedCrossRunCompletionEvent ? "accepted-cross-run-event" : undefined,
      });
    },
    recheckCompletion: async (session) => {
      completionEvidence = await probeCompletionEvidence(session, context) || completionEvidence;
      if (completionEvidence) writeLatch(session);
      return Boolean(completionEvidence);
    },
    onDied: async (session) => {
      if (await completeFromFreshEvidence(session)) return "complete";
      const hasCompletionEvent = Boolean(currentCompletionEventPath(context));
      const verdict = classifyDeath({
        hasCompletionEvent,
        runId: context.runId,
        agentId: context.agentId,
        reason: "monitor: agent CLI process exited before producing its completion event",
        timestamp: timestamp(),
      });
      if (verdict.outcome === "complete-normally") {
        await launchCompletionSession(session, context);
        return "complete";
      }
      updateRunAgent(context.runJsonPath, context.agentId, verdict.agentStatus);
      updateRunStatus(context.runJsonPath, verdict.runStatus, verdict.diagnostic.reason);
      writeDiagnosticEvent(context.eventsDir, verdict.diagnostic);
      return "terminal";
    },
    onStalled: async (session, kind, count) => {
      if (await completeFromFreshEvidence(session)) return "complete";
      const reason = kind === "escalate"
        ? `monitor: no real progress after ${count} nudges; escalating instead of nudging an unresponsive session indefinitely`
        : `monitor: agent output quiescent for ${count} stale cycles; no AGENT_COMPLETE and no completion event`;
      const verdict = classifyStall({
        runId: context.runId,
        agentId: context.agentId,
        reason,
        staleCount: count,
        timestamp: timestamp(),
      });
      updateRunAgent(context.runJsonPath, context.agentId, verdict.agentStatus);
      updateRunStatus(context.runJsonPath, verdict.runStatus, verdict.diagnostic.reason);
      writeDiagnosticEvent(context.eventsDir, verdict.diagnostic);
      return "terminal";
    },
    onContextExhausted: async (session) => {
      if (await completeFromFreshEvidence(session)) return "complete";
      const verdict = classifyContextExhaustion({
        runId: context.runId,
        agentId: context.agentId,
        reason:
          "monitor: agent CLI exhausted its model context window (repeated context-limit error); " +
          "the run cannot generate output to complete and its wedged session was torn down",
        timestamp: timestamp(),
      });
      // FAILED (not blocked): a context-full agent is unresumable, so surface it in
      // Runs/Activity as failed with a clear reason, not a resumable stall.
      updateRunAgent(context.runJsonPath, context.agentId, verdict.agentStatus);
      updateRunStatus(context.runJsonPath, verdict.runStatus, verdict.diagnostic.reason);
      writeDiagnosticEvent(context.eventsDir, verdict.diagnostic);
      // Tear the session down: a stall leaves the pty for a human to inspect, but a
      // context-exhausted session can never make progress and only holds dead weight.
      await pty.remove(session).catch(() => {});
      console.log(`monitor: torn down context-exhausted session ${session} (run ${context.runId} failed)`);
      return "terminal";
    },
    sleep: (seconds) => sleepMs(seconds * 1000),
    loadState: loadMonitorState,
    saveState: saveMonitorState,
    clearState: clearMonitorState,
    log: (message) => console.log(message),
  };
}

/** Best-effort run.json read for the cross-run adoption guard -- never throws. */
function safeReadRunJson(path: string): RunRecord | null {
  try {
    return existsSync(path) ? readRunJson(path) : null;
  } catch {
    return null;
  }
}

/**
 * Core generation has a durable, run-scoped handoff artifact. It is completion
 * evidence only when every identity boundary agrees: core chain metadata,
 * current job/kind metadata, post-attempt mtime, valid JSON, and the existing
 * generation payload contract. A filename alone is never authoritative.
 */
export function hasAuthoritativeGenerationArtifact(context: LiveMonitorContext): boolean {
  return Boolean(authoritativeGenerationArtifact(context));
}

function authoritativeGenerationArtifact(
  context: LiveMonitorContext,
): Extract<CompletionEvidence, { kind: "core-generation-artifact" }> | null {
  const run = safeReadRunJson(context.runJsonPath);
  if (!run) return null;
  let chain: Record<string, unknown>;
  try {
    chain = JSON.parse(readFileSync(context.chainPath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  const chainMetadata = chain.metadata && typeof chain.metadata === "object" && !Array.isArray(chain.metadata)
    ? chain.metadata as Record<string, unknown>
    : null;
  if (chainMetadata?.coreGenerationChain !== true) return null;

  const metadata = run.metadata && typeof run.metadata === "object" && !Array.isArray(run.metadata)
    ? run.metadata as Record<string, unknown>
    : null;
  const jobId = typeof metadata?.generationJobId === "string"
    ? metadata.generationJobId
    : typeof metadata?.jobId === "string" ? metadata.jobId : "";
  const kind = typeof metadata?.generationKind === "string" ? metadata.generationKind : "";
  if (!jobId || !kind) return null;
  if (!existsSync(join(context.runDir, ".internal", "generation-import-token"))) return null;

  const artifactPath = join(context.runDir, "artifacts", "generation-result.json");
  if (!existsSync(artifactPath)) return null;
  const attempts = readRunnerV2AttemptState(context.runJsonPath).attempts;
  const attempt = [...attempts].reverse().find((candidate) => candidate.agentId === context.agentId);
  if (!attempt) return null;
  const started = Date.parse(attempt.createdAt);
  try {
    if (!Number.isFinite(started) || statSync(artifactPath).mtimeMs < started) return null;
    const payload = JSON.parse(readFileSync(artifactPath, "utf8"));
    return isPayloadCompatibleWithKind(payload, kind)
      ? { kind: "core-generation-artifact", artifactPath, jobId, generationKind: kind }
      : null;
  } catch {
    return null;
  }
}

async function probeCompletionEvidence(
  sessionName: string,
  context: LiveMonitorContext,
  knownEventPath?: string,
): Promise<CompletionEvidence | null> {
  const eventPath = knownEventPath || currentCompletionEventPath(context);
  if (eventPath) return { kind: "declared-event", path: eventPath };

  const transcriptPath = await durableMarkerTranscript(sessionName, context.env, context);
  if (transcriptPath) return { kind: "durable-marker", transcriptPath };

  return authoritativeGenerationArtifact(context);
}

function currentCompletionEventPath(context: LiveMonitorContext): string {
  const expectedEvent = readDeclaredEmits(context.chainPath, context.agentId);
  return findCompletionEventFile({
    eventsDir: context.eventsDir,
    runId: context.runId,
    agentId: context.agentId,
    expectedEvent,
    sessionName: context.sessionName,
  });
}

async function monitorAgentProcessGone(
  sessionName: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Promise<boolean> {
  const panePid = await pty.pid(sessionName);
  if (!panePid) return false;
  const paths = monitorStatePaths(sessionName);
  const graceMax = positiveInt(env.MENTIKO_MONITOR_NEVER_ARMED_GRACE, 5);

  if (hasPgrep()) {
    if (hasChildProcess(panePid)) {
      mkdirSync(dirname(paths.armed), { recursive: true });
      writeFileSync(paths.armed, "");
      rmSync(paths.armedGrace, { force: true });
      return false;
    }

    if (!existsSync(paths.armed)) {
      const grace = readPositiveIntFile(paths.armedGrace) + 1;
      mkdirSync(dirname(paths.armedGrace), { recursive: true });
      writeFileSync(paths.armedGrace, String(grace));
      if (grace < graceMax) return false;
    }

    await sleepMs(1000);
    if (hasChildProcess(panePid)) {
      writeFileSync(paths.armed, "");
      rmSync(paths.armedGrace, { force: true });
      return false;
    }
    return true;
  }

  return spawnSync("ps", ["-p", String(panePid)], { stdio: "ignore" }).status !== 0;
}

async function durableMarkerTranscript(
  sessionName: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  context?: LiveMonitorContext,
): Promise<string> {
  const transcript = await resolveTranscriptJsonl(sessionName, env, context);
  if (!transcript) return "";
  return agentCompleteMarkerDurable(transcript) ? transcript : "";
}

async function resolveTranscriptJsonl(
  sessionName: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  context?: LiveMonitorContext,
): Promise<string> {
  const explicit = env.MENTIKO_TRANSCRIPT_JSONL;
  const identity = transcriptIdentityFromContext(context);
  if (explicit) {
    try {
      // A symlink or directory is not durable transcript provenance. Match the
      // typed CLI boundary: only a regular file selected by the caller may be
      // scored or used as completion evidence.
      if (!lstatSync(explicit).isFile()) return "";
    } catch {
      return "";
    }
    if (!context) return explicit;
    return scoreTranscriptIdentity(explicit, undefined, identity) === null ? "" : explicit;
  }

  if (!hasTranscriptIdentityBoundary(identity)) return "";
  const capture = await pty.capture(sessionName, positiveInt(env.MENTIKO_TRANSCRIPT_CAPTURE_LINES, 2000)).catch(() => "");
  const root = transcriptRootFromProfile(env.MENTIKO_AGENT_PROFILE_PATH);
  if (!root) return "";
  return selectTranscriptFromCapture(capture, (uuid) => {
    return findTranscriptJsonl(root, uuid, 4);
  }, identity);
}

function transcriptIdentityFromContext(context?: LiveMonitorContext): TranscriptIdentityOptions {
  if (!context) return {};
 const run = safeReadRunJson(context.runJsonPath);
 const attempts = readRunnerV2AttemptState(context.runJsonPath).attempts;
 const attempt = [...attempts].reverse().find((candidate) => candidate.agentId === context.agentId && candidate.runId === context.runId);
  const envAttemptStartedAt = typeof context.env.MENTIKO_TRANSCRIPT_ATTEMPT_STARTED_AT === "string"
    ? context.env.MENTIKO_TRANSCRIPT_ATTEMPT_STARTED_AT
    : undefined;
  const envInstructionPath = typeof context.env.MENTIKO_TRANSCRIPT_INSTRUCTION_PATH === "string"
    ? context.env.MENTIKO_TRANSCRIPT_INSTRUCTION_PATH
    : undefined;
 return {
   workspacePath: typeof run?.workspacePath === "string" ? run.workspacePath : undefined,
    attemptStartedAt: attempt?.createdAt || envAttemptStartedAt,
   runId: context.runId,
    instructionPath: attempt?.instructionLedger.at(-1)?.instructionPath || envInstructionPath,
 };
}

interface CompletionLaunchOptions {
  completionRecoveryEvidence?: CompletionRecoveryEvidence;
}

async function launchCompletionSession(
  sessionName: string,
  context: LiveMonitorContext,
  options: CompletionLaunchOptions = {},
): Promise<void> {
  const completionSession = `complete-${sessionName}-${Math.floor(Date.now() / 1000)}`;
  await launchRunnerV2CompletionPty({
    completionSession,
    sessionName,
    chainPath: context.chainPath,
    env: {
      ...context.env,
      MENTIKO_RUN_ID: context.runId,
      RUN_ID: context.runId,
      NAMESPACE_ID: context.namespaceId,
      ORG_ID: context.orgId,
      WORKSPACE_TYPE: context.workspaceType,
      MENTIKO_RUN_DIR: context.runDir,
      MENTIKO_CODE_ROOT: config.codeRoot,
      EVENTS_DIR: context.eventsDir,
      STATE_DIR: context.stateDir,
      MENTIKO_RUNNER_V2: "1",
      MENTIKO_RUNNER_V2_COMPLETION: "1",
      MENTIKO_MONITOR_COMPLETION_LATCH: options.completionRecoveryEvidence || "",
    },
  });
}

function writeDiagnosticEvent(eventsDir: string, event: MonitorDiagnosticEvent): void {
  mkdirSync(eventsDir, { recursive: true });
  const extensionFields = [
    `agent: ${event.agent}`,
    `reason: ${event.reason}`,
    ...(typeof event.staleCount === "number" ? [`stale_count: ${event.staleCount}`] : []),
  ].join("\n");
  const content = serializeRunnerEvent({
    event: event.event,
    source: event.source,
    runId: event.runId,
    timestamp: new Date().toISOString(),
    data: JSON.stringify({ agent: event.agent, reason: event.reason, staleCount: event.staleCount }),
  });
  writeFileSync(join(eventsDir, event.filename), `${content}${extensionFields}\n`);
}

function hasPgrep(): boolean {
  // Single shell-string form (no args array) so this does not trip Node's DEP0190
  // "args + shell:true" deprecation. `command -v` is a shell builtin, so shell:true
  // is required; there are no args to escape here.
  return spawnSync("command -v pgrep", { shell: true, stdio: "ignore" }).status === 0;
}

function hasChildProcess(pid: number): boolean {
  return spawnSync("pgrep", ["-P", String(pid)], { stdio: "ignore" }).status === 0;
}

function readPositiveIntFile(path: string): number {
  try {
    return positiveInt(readFileSync(path, "utf8").trim(), 0);
  } catch {
    return 0;
  }
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
}
