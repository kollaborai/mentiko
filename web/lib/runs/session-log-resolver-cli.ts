#!/usr/bin/env node
import { existsSync, lstatSync } from "node:fs";
import {
  encodeCwdSlug,
  findConversationFiles,
  resolveProfileLogDir,
  resolveSessionLog,
} from "@/lib/runs/session-log-resolver";
import { profileTranscriptConfig } from "@/lib/runner-v2/agent-profile";

const COMMANDS = ["encode-cwd-slug", "log-dir", "session-log", "conversation-files"] as const;
type Command = (typeof COMMANDS)[number];

export function runSessionLogResolverCli(argv: string[], write: (line: string) => void = (line) => console.log(line)): number {
  const { command, values } = parseCli(argv);
  switch (command) {
    case "encode-cwd-slug": {
      const slug = encodeCwdSlug(required(values, "--cli"), required(values, "--cwd"));
      if (slug) write(slug);
      return 0;
    }
    case "log-dir": {
      const profileOrCli = required(values, "--profile-or-cli");
      const cwd = required(values, "--cwd");
      if (!isRegularFile(profileOrCli)) return 0;
      const config = profileTranscriptConfig(profileOrCli);
      const logDir = resolveProfileLogDir({ cli: config.cli, log_path: config.logPath }, cwd);
      if (logDir) write(logDir);
      return 0;
    }
    case "session-log": {
      const result = resolveSessionLog(required(values, "--log-dir"), required(values, "--session"), required(values, "--pty-binary"));
      if (result) write(result);
      return 0;
    }
    case "conversation-files": {
      const startedAt = Number(required(values, "--started-at"));
      for (const result of findConversationFiles(required(values, "--log-dir"), startedAt, values.get("--cli") ?? "claude")) write(result);
      return 0;
    }
  }
}

function parseCli(argv: string[]): { command: Command; values: Map<string, string> } {
  const command = argv[0] as Command | undefined;
  if (!command || !COMMANDS.includes(command)) throw new Error(usage());
  const allowed = allowedFlags(command);
  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || !value || !flag.startsWith("--") || values.has(flag)) throw new Error(usage());
    if (!allowed.has(flag)) throw new Error(`${flag} is not valid for ${command}`);
    values.set(flag, value);
  }
  return { command, values };
}

function allowedFlags(command: Command): Set<string> {
  switch (command) {
    case "encode-cwd-slug": return new Set(["--cli", "--cwd"]);
    case "log-dir": return new Set(["--profile-or-cli", "--cwd"]);
    case "session-log": return new Set(["--log-dir", "--session", "--pty-binary"]);
    case "conversation-files": return new Set(["--log-dir", "--started-at", "--cli"]);
  }
}

function required(values: Map<string, string>, flag: string): string {
  const value = values.get(flag);
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

function usage(): string {
  return "usage: runner-session-log-resolver <encode-cwd-slug|log-dir|session-log|conversation-files> [flags]";
}

function isRegularFile(candidate: string): boolean {
  try {
    return existsSync(candidate) && lstatSync(candidate).isFile();
  } catch {
    return false;
  }
}

if (require.main === module) {
  try {
    process.exitCode = runSessionLogResolverCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
