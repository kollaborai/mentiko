#!/usr/bin/env node
import "@/lib/runner-v2/entry-code-root-anchor";
import { accessSync, constants, lstatSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { pty } from "@/lib/pty/pty-client";
import config from "@/lib/config";
import { parseManualMonitorArgs, runManualMonitor } from "@/lib/runner-v2/manual-monitor";

export async function runManualMonitorCli(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const args = parseManualMonitorArgs(argv);
  const profilePath = join(config.codeRoot, "lib", "monitor-profiles", `${args.profileName}.md`);
  const profileContent = readProfile(profilePath, args.profileName);
  const executable = resolveExecutable(env.MENTIKO_CLI || "claude", env.PATH || "");
  await runManualMonitor({
    ...args,
    profileContent,
    maxStaleCount: nonNegativeInt(env.MENTIKO_MONITOR_MAX_STALE, 10),
  }, {
    hasSession: (session) => pty.alive(session),
    capture: (session, lines) => pty.capture(session, lines),
    kill: (session) => pty.kill(session),
    sendRaw: (session, text) => pty.sendRaw(session, text),
    sleep: (seconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, seconds * 1000)),
    advise: async (prompt) => runAdvisor(executable, prompt),
    log: (line) => console.log(`manual-monitor: ${line}`),
  });
}

export function readProfile(profilePath: string, profileName: string): string {
  try {
    const stat = lstatSync(profilePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("not a regular file");
    return readFileSync(profilePath, "utf8");
  } catch {
    throw new Error(`manual monitor profile '${profileName}' not found or unsafe`);
  }
}

export function resolveExecutable(command: string, pathValue: string): string {
  if (!command) throw new Error("manual monitor requires MENTIKO_CLI");
  const candidates = command.includes("/")
    ? [resolve(command)]
    : pathValue.split(":").filter(Boolean).map((part) => join(part, command));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue until a PATH candidate is executable.
    }
  }
  throw new Error(`manual monitor advisor CLI not found: ${command}`);
}

function runAdvisor(executable: string, prompt: string): Promise<string> {
  return new Promise((resolveAdvisor) => {
    const child = spawn(executable, ["-p", prompt], { stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.on("error", () => resolveAdvisor(""));
    child.on("close", () => resolveAdvisor(output.split(/\r?\n/).slice(0, 10).join("\n")));
  });
}

function nonNegativeInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

if (require.main === module) {
  runManualMonitorCli(process.argv.slice(2)).catch((error) => {
    console.error(`manual monitor failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
