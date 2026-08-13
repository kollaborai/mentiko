#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, parse as parsePath, resolve, sep } from "node:path";
import {
  buildAgentProfileCommand,
  loadAgentProfile,
  resolveDefaultProfile,
} from "@/lib/runner-v2/agent-profile";
import { classifyCliReadiness, type CliReadinessResult } from "@/lib/runner-v2/readiness-policy";

type Command = "classify" | "wait" | "result" | "result-field";
type ProcessResult = { status: number | null; stdout: string };

export interface StartupRecoveryDecision extends Record<string, unknown> {
  action: "send_keys" | "retry_launch";
  confidence: number;
  risk: "low";
  reason: string;
  keys?: string[];
}

export interface StartupRecoveryInput {
  enabled: boolean;
  maxAttempts: number;
  runId?: string;
  profilesDir?: string;
  namespaceId?: string;
  orgId?: string;
  agentId?: string;
  profileId?: string;
  cli?: string;
  cwd?: string;
  command?: string;
  stateFile?: string;
  artifactDir?: string;
}

export interface ReadinessWaitInput {
  profilePath: string;
  ptyCommand: string;
  session: string;
  maxWaitSecs: number;
  pollSecs: number;
  failClosed: boolean;
  capturePath?: string;
  recovery?: StartupRecoveryInput;
  now?: () => number;
  sleep?: (milliseconds: number) => void;
  run?: (command: string, args: string[]) => ProcessResult;
  advisorRun?: (command: string, input: string) => ProcessResult;
}

export function runReadinessCli(argv: string[], write: (line: string) => void = (line) => console.log(line)): void {
  const [command, ...rest] = argv;
  if (!isCommand(command)) throw new Error(usage());
  const values = parse(rest);

  if (command === "classify") {
    reject(values, ["--profile-path", "--capture-path", "--fail-closed"]);
    const profilePath = required(values, "--profile-path");
    const capturePath = required(values, "--capture-path");
    if (!existsSync(profilePath)) { write(JSON.stringify({ status: "unknown", reason: "profile file missing" })); return; }
    if (!existsSync(capturePath)) { write(JSON.stringify({ status: "unknown", reason: "capture file missing" })); return; }
    assertRegularInput(profilePath, "profile");
    assertRegularInput(capturePath, "capture");
    let result: CliReadinessResult;
    try {
      result = classifyCliReadiness({
        readiness: loadAgentProfile(profilePath).profile.readiness,
        output: readFileSync(capturePath, "utf8"),
        failClosed: optional(values, "--fail-closed") === "true",
      });
    } catch {
      result = { status: "unknown", reason: "readiness profile unreadable" };
    }
    write(JSON.stringify(result));
    return;
  }

  if (command === "wait") {
    reject(values, [
      "--profile-path", "--pty-cmd", "--session", "--max-wait-secs", "--poll-secs", "--fail-closed", "--capture-path",
      "--recovery-enabled", "--recovery-max", "--profiles-dir", "--namespace-id", "--org-id", "--agent-id", "--profile-id",
      "--run-id", "--cli", "--cwd", "--command", "--state-file", "--artifact-dir",
    ]);
    const waited = waitForReadiness({
      profilePath: required(values, "--profile-path"),
      ptyCommand: required(values, "--pty-cmd"),
      session: required(values, "--session"),
      maxWaitSecs: nonNegativeInteger(required(values, "--max-wait-secs"), "--max-wait-secs"),
      pollSecs: positiveInteger(required(values, "--poll-secs"), "--poll-secs"),
      failClosed: optional(values, "--fail-closed") === "true",
      capturePath: optional(values, "--capture-path"),
      recovery: buildRecovery(values),
    });
    write(JSON.stringify(waited.result));
    if (waited.exitCode !== 0) process.exitCode = waited.exitCode;
    return;
  }

  if (command === "result") {
    reject(values, ["--status", "--reason"]);
    write(JSON.stringify({ status: required(values, "--status"), reason: required(values, "--reason") }));
    return;
  }

  reject(values, ["--result-json", "--field"]);
  const parsed = JSON.parse(required(values, "--result-json")) as Record<string, unknown>;
  const field = required(values, "--field");
  if (field !== "status" && field !== "reason") throw new Error("--field must be status or reason");
  write(typeof parsed[field] === "string" ? parsed[field] : "");
}

export function waitForReadiness(input: ReadinessWaitInput): { result: CliReadinessResult; exitCode: number } {
  if (!existsSync(input.profilePath)) return { result: { status: "unknown", reason: "profile file missing" }, exitCode: 4 };
  assertRegularInput(input.profilePath, "profile");
  const now = input.now || (() => Date.now());
  const sleep = input.sleep || ((milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds));
  const run = input.run || ((command, args) => spawnSync(command, args, { encoding: "utf8" }));
  const started = now();
  let recoveryAttempts = 0;

  for (;;) {
    const alive = run(input.ptyCommand, ["alive", input.session]);
    const pid = run(input.ptyCommand, ["pid", input.session]);
    if (alive.status !== 0 || alive.stdout.trim() !== "alive" || pid.status !== 0 || !/^\d+$/.test(pid.stdout.trim())) {
      return { result: { status: "unknown", reason: "PTY session died during startup" }, exitCode: 1 };
    }

    const capture = run(input.ptyCommand, ["capture", input.session, "120"]);
    const output = capture.status === 0 ? capture.stdout : "";
    if (input.capturePath) writeCaptureAtomically(input.capturePath, output);
    const result = classifyCliReadiness({
      readiness: loadAgentProfile(input.profilePath).profile.readiness,
      output,
      failClosed: input.failClosed,
    });

    if (result.status === "ready") return { result, exitCode: 0 };
    if (isRecoverable(result.status) && canAttemptRecovery(input.recovery, recoveryAttempts)) {
      recoveryAttempts += 1;
      if (attemptStartupRecovery(input, result, output, run)) continue;
    }
    if (isTerminal(result.status)) {
      writeStartupRecoveryArtifacts(input.recovery, result, output);
      return { result, exitCode: 2 };
    }
    if (!input.failClosed) return { result: { status: "ready", reason: "legacy readiness policy permits unresolved startup" }, exitCode: 0 };
    if (now() - started >= input.maxWaitSecs * 1_000) {
      const timeout: CliReadinessResult = { status: "unknown", reason: `CLI readiness timeout after ${input.maxWaitSecs}s` };
      writeStartupRecoveryArtifacts(input.recovery, timeout, output);
      return { result: timeout, exitCode: 4 };
    }
    sleep(input.pollSecs * 1_000);
  }
}

function isRecoverable(status: CliReadinessResult["status"]): boolean {
  return status === "blocked" || status === "recover" || status === "retry";
}

function isTerminal(status: CliReadinessResult["status"]): boolean {
  return status === "blocked" || status === "recover" || status === "retry" || status === "no_ready_signal";
}

function canAttemptRecovery(recovery: StartupRecoveryInput | undefined, attempts: number): boolean {
  return Boolean(recovery?.enabled && recovery.profilesDir && attempts < recovery.maxAttempts);
}

function attemptStartupRecovery(
  input: ReadinessWaitInput,
  readiness: CliReadinessResult,
  output: string,
  run: (command: string, args: string[]) => ProcessResult,
): boolean {
  const recovery = input.recovery;
  if (!recovery) return false;
  const payload = decideStartupRecovery({
    recovery,
    readiness,
    output,
    advisorRun: input.advisorRun,
  });
  if (!payload) return false;

  if (payload.action === "send_keys") {
    if (!payload.keys?.length) return false;
    let applied = false;
    for (const key of payload.keys) {
      const sent = run(input.ptyCommand, ["send", input.session, "--raw", recoveryKeyBytes(key)]);
      if (sent.status !== 0) return false;
      applied = true;
    }
    return applied;
  }
  if (!recovery.command) return false;
  return run(input.ptyCommand, ["send", input.session, recovery.command]).status === 0;
}

export function decideStartupRecovery(input: {
  recovery: StartupRecoveryInput;
  readiness: CliReadinessResult;
  output: string;
  advisorRun?: (command: string, input: string) => ProcessResult;
}): StartupRecoveryDecision | undefined {
  const { recovery } = input;
  if (!recovery.profilesDir) return undefined;
  let advisor;
  try { advisor = resolveDefaultProfile(recovery.profilesDir, "advisor"); } catch { return undefined; }
  if (!advisor) return undefined;

  let advisorCommand: string;
  try {
    advisorCommand = buildAgentProfileCommand({
      profilePath: advisor.path,
      interactive: false,
      namespaceId: recovery.namespaceId || "default",
      orgId: recovery.orgId || "default",
      purpose: "agent",
    });
  } catch { return undefined; }

  const prompt = startupRecoveryPrompt(recovery, input.readiness, input.output);
  const advisorRun = input.advisorRun || ((command, advisorInput) => spawnSync("/bin/bash", ["-lc", command], {
    input: advisorInput,
    encoding: "utf8",
    timeout: 120_000,
  }));
  const response = advisorRun(advisorCommand, prompt);
  if (response.status !== 0) return undefined;
  const payload = parseAdvisorPayload(typeof response.stdout === "string" ? response.stdout : "");
  if (!payload || !isSafeRecoveryDecision(payload)) return undefined;
  appendRecoveryDecision(recovery, payload);
  return payload;
}

function startupRecoveryPrompt(recovery: StartupRecoveryInput, readiness: CliReadinessResult, output: string): string {
  const state = recovery.stateFile ? safeRead(recovery.stateFile) : "";
  return [
    "Mentiko startup recovery request. No agent task has been delivered yet unless the capture proves otherwise.",
    `run_id: ${recovery.runId || process.env.MENTIKO_RUN_ID || "none"}`,
    `agent_id: ${recovery.agentId || "unknown"}`,
    `profile_id: ${recovery.profileId || "unknown"}`,
    `cli: ${recovery.cli || "unknown"}`,
    `cwd: ${recovery.cwd || "unknown"}`,
    `attempted_command: ${recovery.command || ""}`,
    `readiness: ${JSON.stringify(readiness)}`,
    `state_file:\n${state}`,
    `terminal_capture:\n${output}`,
    "Return strict JSON only using action send_keys | retry_launch | suggest_profile_fix | ask_human | no_action, confidence, risk, reason, and optional keys.",
  ].join("\n\n");
}

function parseAdvisorPayload(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

function isSafeRecoveryDecision(value: Record<string, unknown>): value is StartupRecoveryDecision {
  return typeof value.action === "string"
    && ["send_keys", "retry_launch", "suggest_profile_fix", "ask_human", "no_action"].includes(value.action)
    && typeof value.confidence === "number"
    && ["low", "medium", "high"].includes(String(value.risk))
    && typeof value.reason === "string"
    && value.confidence >= 0.85
    && value.risk === "low"
    && (value.action === "send_keys" || value.action === "retry_launch")
    && (
      value.action !== "send_keys"
      || (
        Array.isArray(value.keys)
        && value.keys.length > 0
        && value.keys.every((key) => typeof key === "string")
      )
    );
}

export function recoveryKeyBytes(key: string): string {
  switch (key) {
    case "ENTER": case "RETURN": case "CR": case "\\r": case "\\n": return "\r";
    case "ESC": case "ESCAPE": return "\x1b";
    case "CTRL_C": case "^C": return "\x03";
    case "TAB": return "\t";
    case "SPACE": return " ";
    default: return key;
  }
}

function writeStartupRecoveryArtifacts(recovery: StartupRecoveryInput | undefined, readiness: CliReadinessResult, output: string): void {
  if (!recovery?.artifactDir || !recovery.agentId) return;
  const directory = recovery.artifactDir;
  if (!directory.startsWith("/")) throw new Error("startup recovery artifact directory must be absolute");
  ensureDirectory(directory, "startup recovery artifact directory");
  writeAtomic(join(directory, `${recovery.agentId}-startup-capture.txt`), output);
  writeAtomic(join(directory, `${recovery.agentId}-startup-readiness.json`), `${JSON.stringify(readiness, null, 2)}\n`);
}

function appendRecoveryDecision(recovery: StartupRecoveryInput, decision: Record<string, unknown>): void {
  if (!recovery.artifactDir || !recovery.agentId) return;
  const directory = ensureDirectory(recovery.artifactDir, "startup recovery artifact directory");
  const path = join(directory, `${recovery.agentId}-startup-recovery-decisions.jsonl`);
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error("startup recovery decision log must not be a symlink");
  appendFileSync(path, `${JSON.stringify(decision)}\n`, { mode: 0o600 });
}

function safeRead(path: string): string {
  try { return readFileSync(path, "utf8"); } catch { return ""; }
}

function writeCaptureAtomically(path: string, content: string): void {
  if (existsSync(path)) assertRegularInput(path, "capture");
  writeAtomic(path, content);
}

function writeAtomic(path: string, content: string): void {
  // macOS exposes /tmp as a symlink to /private/tmp. Canonicalize the parent
  // before validating and publishing so a normal mktemp capture is accepted
  // without weakening the non-symlink directory invariant.
  const directory = ensureDirectory(dirname(path), "capture directory");
  const target = join(directory, basename(path));
  if (existsSync(target)) assertRegularInput(target, "capture");
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, content, { mode: 0o600 });
  renameSync(temporary, target);
}

function ensureDirectory(path: string, label: string): string {
  // macOS exposes trusted root aliases such as /tmp and /var beneath /private.
  // Canonicalize only those OS-owned aliases; never realpath caller input.
  const candidate = canonicalizeTrustedSystemAlias(path);
  assertExistingDirectoryComponents(candidate, label, path);
  if (!existsSync(candidate)) mkdirSync(candidate, { recursive: true, mode: 0o700 });
  assertExistingDirectoryComponents(candidate, label, path);
  return candidate;
}

function canonicalizeTrustedSystemAlias(path: string): string {
  // These are macOS-owned root aliases. Only normalize this fixed allow-list;
  // a configured artifact/capture directory may not use a caller-owned link.
  const normalized = resolve(path);
  for (const alias of ["/tmp", "/var", "/etc"]) {
    if (normalized !== alias && !normalized.startsWith(`${alias}/`)) continue;
    const canonical = realpathSync(alias);
    return normalized === alias ? canonical : join(canonical, normalized.slice(alias.length + 1));
  }
  return normalized;
}

/** Reject a symlink at every existing component, before mkdir can follow it. */
function assertExistingDirectoryComponents(path: string, label: string, originalPath: string): void {
  const absolute = resolve(path);
  const root = parsePath(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    if (!existsSync(current)) return;
    const entry = lstatSync(current);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error(`${label} must be a non-symlink directory: ${originalPath}`);
    }
  }
}

function buildRecovery(values: Map<string, string>): StartupRecoveryInput | undefined {
  const enabled = optional(values, "--recovery-enabled") === "true";
  const profilesDir = optional(values, "--profiles-dir");
  if (!enabled && !profilesDir) return undefined;
  return {
    enabled,
    maxAttempts: nonNegativeInteger(optional(values, "--recovery-max") || "0", "--recovery-max"),
    profilesDir,
    runId: optional(values, "--run-id"), namespaceId: optional(values, "--namespace-id"), orgId: optional(values, "--org-id"),
    agentId: optional(values, "--agent-id"), profileId: optional(values, "--profile-id"),
    cli: optional(values, "--cli"), cwd: optional(values, "--cwd"), command: optional(values, "--command"),
    stateFile: optional(values, "--state-file"), artifactDir: optional(values, "--artifact-dir"),
  };
}

function assertRegularInput(path: string, label: string): void {
  const entry = lstatSync(path);
  if (entry.isSymbolicLink() || !entry.isFile()) throw new Error(`${label} input must be a non-symlink regular file: ${path}`);
}
function nonNegativeInteger(value: string, label: string): number { if (!/^\d+$/.test(value)) throw new Error(`${label} must be a non-negative integer`); return Number(value); }
function positiveInteger(value: string, label: string): number { const result = nonNegativeInteger(value, label); if (!result) throw new Error(`${label} must be positive`); return result; }
function parse(argv: string[]): Map<string, string> { const values = new Map<string, string>(); for (let i = 0; i < argv.length; i += 2) { const key = argv[i], value = argv[i + 1]; if (!key?.startsWith("--") || value === undefined || values.has(key)) throw new Error(usage()); values.set(key, value); } return values; }
function required(values: Map<string, string>, key: string): string { const value = values.get(key); if (!value) throw new Error(`${key} is required`); return value; }
function optional(values: Map<string, string>, key: string): string | undefined { return values.get(key); }
function reject(values: Map<string, string>, allowed: string[]): void { for (const key of values.keys()) if (!allowed.includes(key)) throw new Error(`${key} is not valid for runner-readiness`); }
function isCommand(value: string | undefined): value is Command { return value === "classify" || value === "wait" || value === "result" || value === "result-field"; }
function usage(): string { return "usage: runner-readiness <classify|wait|result|result-field> [options]"; }

// This module is bundled into several runner entrypoints. A plain
// `require.main === module` guard also fires for those bundles, causing the
// embedded CLI to parse the runner's arguments and set exitCode=1. Only run
// the CLI when the readiness entrypoint itself is the process entrypoint.
function isStandaloneReadinessCli(): boolean {
  const entrypoint = process.argv[1] || "";
  return /(?:^|[\\/])(?:runner-readiness|readiness-cli)(?:\.(?:c|m)?[jt]s)?$/.test(entrypoint);
}

if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module && isStandaloneReadinessCli()) {
  try { runReadinessCli(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
