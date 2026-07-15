#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { loadAgentProfile } from "@/lib/runner-v2/agent-profile";
import { classifyCliReadiness, type CliReadinessResult } from "@/lib/runner-v2/readiness-policy";

type Command = "classify" | "wait" | "result" | "result-field";

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
    try { result = classifyCliReadiness({ readiness: loadAgentProfile(profilePath).profile.readiness, output: readFileSync(capturePath, "utf8"), failClosed: optional(values, "--fail-closed") === "true" }); }
    catch { result = { status: "unknown", reason: "readiness profile unreadable" }; }
    write(JSON.stringify(result)); return;
  }
  if (command === "wait") {
    reject(values, ["--profile-path", "--pty-cmd", "--session", "--max-wait-secs", "--poll-secs", "--fail-closed"]);
    const waited = waitForReadiness({ profilePath: required(values, "--profile-path"), ptyCommand: required(values, "--pty-cmd"), session: required(values, "--session"), maxWaitSecs: nonNegativeInteger(required(values, "--max-wait-secs"), "--max-wait-secs"), pollSecs: positiveInteger(required(values, "--poll-secs"), "--poll-secs"), failClosed: optional(values, "--fail-closed") === "true" });
    write(JSON.stringify(waited.result));
    if (waited.exitCode !== 0) process.exitCode = waited.exitCode;
    return;
  }
  if (command === "result") {
    reject(values, ["--status", "--reason"]);
    write(JSON.stringify({ status: required(values, "--status"), reason: required(values, "--reason") })); return;
  }
  reject(values, ["--result-json", "--field"]);
  const parsed = JSON.parse(required(values, "--result-json")) as Record<string, unknown>;
  const field = required(values, "--field");
  if (field !== "status" && field !== "reason") throw new Error("--field must be status or reason");
  write(typeof parsed[field] === "string" ? parsed[field] : "");
}

export function waitForReadiness(input: { profilePath: string; ptyCommand: string; session: string; maxWaitSecs: number; pollSecs: number; failClosed: boolean; now?: () => number; sleep?: (milliseconds: number) => void; run?: (command: string, args: string[]) => { status: number | null; stdout: string } }): { result: CliReadinessResult; exitCode: number } {
  if (!existsSync(input.profilePath)) return { result: { status: "unknown", reason: "profile file missing" }, exitCode: 4 };
  assertRegularInput(input.profilePath, "profile");
  const now = input.now || (() => Date.now()); const sleep = input.sleep || ((milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)); const run = input.run || ((command, args) => spawnSync(command, args, { encoding: "utf8" })); const started = now();
  for (;;) {
    const alive = run(input.ptyCommand, ["alive", input.session]);
    const pid = run(input.ptyCommand, ["pid", input.session]);
    if (alive.status !== 0 || alive.stdout.trim() !== "alive" || pid.status !== 0 || !/^\d+$/.test(pid.stdout.trim())) return { result: { status: "unknown", reason: "PTY session died during startup" }, exitCode: 1 };
    const capture = run(input.ptyCommand, ["capture", input.session, "100"]);
    const result = classifyCliReadiness({ readiness: loadAgentProfile(input.profilePath).profile.readiness, output: capture.status === 0 ? capture.stdout : "", failClosed: input.failClosed });
    if (result.status === "ready") return { result, exitCode: 0 };
    if (result.status === "blocked") return { result, exitCode: 2 };
    if (now() - started >= input.maxWaitSecs * 1_000) return { result: { status: "unknown", reason: `CLI readiness timeout after ${input.maxWaitSecs}s` }, exitCode: 4 };
    sleep(input.pollSecs * 1_000);
  }
}
function nonNegativeInteger(value: string, label: string): number { if (!/^\d+$/.test(value)) throw new Error(`${label} must be a non-negative integer`); return Number(value); }
function positiveInteger(value: string, label: string): number { const result = nonNegativeInteger(value, label); if (!result) throw new Error(`${label} must be positive`); return result; }
function assertRegularInput(path: string, label: string): void {
  const entry = lstatSync(path);
  if (entry.isSymbolicLink() || !entry.isFile()) throw new Error(`${label} input must be a non-symlink regular file: ${path}`);
}
function parse(argv: string[]): Map<string, string> { const values = new Map<string, string>(); for (let i = 0; i < argv.length; i += 2) { const key = argv[i], value = argv[i + 1]; if (!key?.startsWith("--") || value === undefined || values.has(key)) throw new Error(usage()); values.set(key, value); } return values; }
function required(values: Map<string, string>, key: string): string { const value = values.get(key); if (!value) throw new Error(`${key} is required`); return value; }
function optional(values: Map<string, string>, key: string): string | undefined { return values.get(key); }
function reject(values: Map<string, string>, allowed: string[]): void { for (const key of values.keys()) if (!allowed.includes(key)) throw new Error(`${key} is not valid for runner-readiness`); }
function isCommand(value: string | undefined): value is Command { return value === "classify" || value === "wait" || value === "result" || value === "result-field"; }
function usage(): string { return "usage: runner-readiness <classify|wait|result|result-field> [options]"; }
if (require.main === module) { try { runReadinessCli(process.argv.slice(2)); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; } }
