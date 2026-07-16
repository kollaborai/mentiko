import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface ManualMonitorInput {
  sessionName: string;
  endState: string;
  profileName: string;
  profileContent: string;
  intervalSeconds: number;
  maxStaleCount: number;
  stateDir?: string;
}

export interface ManualMonitorPaths {
  state: string;
  stale: string;
  log: string;
}

export interface ManualMonitorDependencies {
  hasSession(sessionName: string): Promise<boolean>;
  capture(sessionName: string, lines?: number): Promise<string>;
  kill(sessionName: string): Promise<void>;
  sendRaw(sessionName: string, text: string): Promise<void>;
  advise(prompt: string): Promise<string>;
  sleep(seconds: number): Promise<void>;
  now?(): Date;
  log?(line: string): void;
}

export interface ManualMonitorResult {
  reason: "complete" | "session-gone";
  staleCount: number;
  paths: ManualMonitorPaths;
}

const MAX_SESSION_NAME_LENGTH = 240;
const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * This is intentionally separate from the run-scoped chain monitor. `mentiko
 * monitor` attaches to an already-running user session and has no agent spec
 * or run identity to invent. Its historical bookkeeping remains global, but
 * TypeScript owns parsing, validation, state writes, advisor input, and PTY
 * interactions.
 */
export async function runManualMonitor(
  input: ManualMonitorInput,
  dependencies: ManualMonitorDependencies,
): Promise<ManualMonitorResult> {
  validateManualMonitorInput(input);
  const paths = manualMonitorPaths(input.sessionName, input.stateDir);
  const now = dependencies.now ?? (() => new Date());
  const log = (message: string) => {
    appendLog(paths.log, `${now().toISOString()} ${message}`);
    dependencies.log?.(message);
  };

  initializeMonitorFiles(paths, input, now());

  for (let retries = 1; !(await dependencies.hasSession(input.sessionName)); retries += 1) {
    if (retries >= 10) {
      log(`session '${input.sessionName}' not found after 30s`);
      throw new Error(`manual monitor session '${input.sessionName}' not found after 30s`);
    }
    dependencies.log?.(`waiting for session '${input.sessionName}'... (${retries}/10)`);
    await dependencies.sleep(3);
  }

  writeFileSync(paths.state, captureHash(await dependencies.capture(input.sessionName, 20)), { mode: 0o600 });
  let staleCount = 0;

  while (true) {
    await dependencies.sleep(input.intervalSeconds);
    if (!(await dependencies.hasSession(input.sessionName))) {
      log("session terminated");
      clearManualMonitorState(paths);
      return { reason: "session-gone", staleCount, paths };
    }

    const capture = await dependencies.capture(input.sessionName, 500);
    const last50 = tailLines(capture, 50);
    const newHash = captureHash(firstLines(tailLines(capture, 40), 20));
    const oldHash = readOptional(paths.state);

    if (newHash !== oldHash) {
      staleCount = 0;
      writeFileSync(paths.state, newHash, { mode: 0o600 });
      writeFileSync(paths.stale, "0\n", { mode: 0o600 });
      log("active");
      continue;
    }

    if (last50.includes("AGENT_COMPLETE")) {
      log("AGENT_COMPLETE");
      await dependencies.sleep(2);
      if (await dependencies.hasSession(input.sessionName)) {
        await dependencies.kill(input.sessionName);
        log("killed session");
      }
      clearManualMonitorState(paths);
      return { reason: "complete", staleCount, paths };
    }

    staleCount = readNonNegativeInt(paths.stale) + 1;
    writeFileSync(paths.stale, `${staleCount}\n`, { mode: 0o600 });
    if (input.maxStaleCount > 0 && staleCount >= input.maxStaleCount) {
      if (staleCount === input.maxStaleCount) log(`nudge budget exhausted at x${staleCount}`);
      continue;
    }

    log(`stale x${staleCount}`);
    const prompt = buildManualAdvisorPrompt({
      sessionName: input.sessionName,
      endState: input.endState,
      profileContent: input.profileContent,
      staleCount,
      intervalSeconds: input.intervalSeconds,
      capture,
    });
    let nudge = sanitizeNudge(await dependencies.advise(prompt));
    if (!nudge) nudge = fallbackNudge(staleCount);
    log(`nudge: ${nudge}`);
    await dependencies.sendRaw(input.sessionName, nudge);
    await dependencies.sleep(1);
    await dependencies.sendRaw(input.sessionName, "\r");
    await dependencies.sleep(0.5);
    writeFileSync(paths.state, newHash, { mode: 0o600 });
  }
}

export function manualMonitorPaths(sessionName: string, stateDir = join(homedir(), ".mentiko_monitor")): ManualMonitorPaths {
  if (!isSafeSessionName(sessionName)) throw new Error("manual monitor requires a safe session name");
  return {
    state: join(stateDir, `${sessionName}_state`),
    stale: join(stateDir, `${sessionName}_stale`),
    log: join(stateDir, `${sessionName}_log`),
  };
}

export function parseManualMonitorArgs(argv: string[]): { sessionName: string; endState: string; profileName: string; intervalSeconds: number } {
  if (argv.length < 2 || argv.length > 4) {
    throw new Error('usage: mentiko monitor <session-name> "end state" [profile] [interval]');
  }
  const [sessionName, endState, profileName = "mentiko", interval = "60"] = argv;
  if (!endState?.trim()) throw new Error("manual monitor requires an end state");
  if (!PROFILE_NAME.test(profileName)) throw new Error("manual monitor requires a safe profile name");
  const intervalSeconds = Number.parseInt(interval, 10);
  if (!Number.isInteger(intervalSeconds) || intervalSeconds <= 0) {
    throw new Error("manual monitor interval must be a positive integer");
  }
  return { sessionName, endState, profileName, intervalSeconds };
}

export function buildManualAdvisorPrompt(input: {
  sessionName: string;
  endState: string;
  profileContent: string;
  staleCount: number;
  intervalSeconds: number;
  capture: string;
}): string {
  return [
    `AGENT SESSION CAPTURE (${lineCount(input.capture)} total lines)`,
    "",
    "== TOP OF SESSION (task assignment, first 150 lines) ==",
    firstLines(input.capture, 150),
    "",
    "== BOTTOM OF SESSION (current state, last 400 lines) ==",
    tailLines(input.capture, 400),
    "",
    "== END OF CAPTURE ==",
    "",
    "---",
    "",
    "MONITORING CONTEXT:",
    `- Session: ${input.sessionName}`,
    `- Stale count: ${input.staleCount} (no output change in ${input.staleCount * input.intervalSeconds}+ seconds)`,
    `- Expected end state: ${input.endState}`,
    "",
    "---",
    "",
    input.profileContent,
    "",
    "---",
    "",
    "Now output exactly ONE message as Mentiko would send it. Nothing else.",
  ].join("\n");
}

export function sanitizeNudge(value: string): string {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
  const normalized = trimmed.toLowerCase().replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized || /^(proceed|continue|go|k|ok|yes|y)(\s+(proceed|continue|go|k|ok|yes|y))*[.!]*$/.test(normalized)) return "";
  return trimmed;
}

export function fallbackNudge(staleCount: number): string {
  if (staleCount <= 2) {
    return "Resume only the current assigned task. If it is complete, write any required artifacts, run your completion command (mentiko emit), and make the final non-empty line exactly AGENT_COMPLETE.";
  }
  if (staleCount <= 4) {
    return "You look stalled. State the blocker in one sentence, then continue the assigned task or, if done, write your required artifacts, run your completion command (mentiko emit), and finish with AGENT_COMPLETE.";
  }
  return "Stop waiting. Finish only the assigned task: write required artifacts, run your completion command (mentiko emit), and make the final non-empty line exactly AGENT_COMPLETE. Do not hand-write event files.";
}

function validateManualMonitorInput(input: ManualMonitorInput): void {
  manualMonitorPaths(input.sessionName, input.stateDir);
  if (!input.endState.trim()) throw new Error("manual monitor requires an end state");
  if (!PROFILE_NAME.test(input.profileName)) throw new Error("manual monitor requires a safe profile name");
  if (!Number.isInteger(input.intervalSeconds) || input.intervalSeconds <= 0) throw new Error("manual monitor interval must be a positive integer");
  if (!Number.isInteger(input.maxStaleCount) || input.maxStaleCount < 0) throw new Error("manual monitor max stale count must be zero or a positive integer");
}

function initializeMonitorFiles(paths: ManualMonitorPaths, input: ManualMonitorInput, now: Date): void {
  mkdirSync(dirname(paths.state), { recursive: true, mode: 0o700 });
  writeFileSync(paths.stale, "0\n", { mode: 0o600 });
  writeFileSync(paths.log, [
    `${now.toISOString()} monitor started for ${input.sessionName}`,
    `  end state: ${input.endState}`,
    `  profile: ${input.profileName}`,
    "---",
    "",
  ].join("\n"), { mode: 0o600 });
}

function clearManualMonitorState(paths: ManualMonitorPaths): void {
  rmSync(paths.state, { force: true });
  rmSync(paths.stale, { force: true });
}

function appendLog(path: string, line: string): void {
  writeFileSync(path, `${readOptional(path)}${line}\n`, { mode: 0o600 });
}

function readOptional(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function readNonNegativeInt(path: string): number {
  const value = Number.parseInt(readOptional(path).trim(), 10);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function isSafeSessionName(sessionName: string): boolean {
  return sessionName.length > 0
    && sessionName.length <= MAX_SESSION_NAME_LENGTH
    && !sessionName.includes("/")
    && !sessionName.includes("\\")
    && !sessionName.includes("\0")
    && sessionName !== "."
    && sessionName !== "..";
}

function captureHash(value: string): string {
  return createHash("md5").update(value).digest("hex");
}

function firstLines(value: string, count: number): string {
  return value.split(/\r?\n/).slice(0, count).join("\n");
}

function tailLines(value: string, count: number): string {
  return value.split(/\r?\n/).slice(-count).join("\n");
}

function lineCount(value: string): number {
  return value ? value.split(/\r?\n/).length : 0;
}
