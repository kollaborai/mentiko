#!/usr/bin/env node
import {
  bumpVersion,
  compareAgents,
  createVersion,
  diffVersions,
  formatVersion,
  getMetadata,
  listVersions,
  nextVersion,
  parseSemver,
  rollback,
  validateVersion,
  versionExists,
  versionPath,
  versionsDirectory,
} from "@/lib/runner-v2/version-control";

export function runVersionControlCli(argv: string[], write: (value: string) => void = (value) => process.stdout.write(value)): void {
  const [command, ...args] = argv;
  switch (command) {
    case "parse-semver": {
      requireArgCount(args, 1, command);
      write(`${parseSemver(args[0]).join(" ")}\n`);
      return;
    }
    case "format-version": {
      requireArgCount(args, 3, command);
      write(`${formatVersion(safeInteger(args[0]), safeInteger(args[1]), safeInteger(args[2]))}\n`);
      return;
    }
    case "bump-version": {
      if (args.length < 1 || args.length > 2) throw usage(command);
      write(`${bumpVersion(args[0], args[1])}\n`);
      return;
    }
    case "next-version": {
      if (args.length < 1 || args.length > 2) throw usage(command);
      write(`${nextVersion(args[0], args[1])}\n`);
      return;
    }
    case "versions-dir": {
      requireArgCount(args, 1, command);
      write(`${versionsDirectory(args[0])}\n`);
      return;
    }
    case "version-path": {
      requireArgCount(args, 2, command);
      write(`${versionPath(args[0], args[1])}\n`);
      return;
    }
    case "version-exists": {
      requireArgCount(args, 2, command);
      if (!versionExists(args[0], args[1])) process.exitCode = 1;
      return;
    }
    case "create-version": {
      if (args.length < 2 || args.length > 3) throw usage(command);
      write(`${createVersion(args[0], args[1], args[2] ?? "")}\n`);
      return;
    }
    case "list-versions": {
      requireArgCount(args, 1, command);
      const lines = listVersions(args[0]).map((entry) => `${entry.version}|${entry.created}|${entry.message}`);
      if (lines.length > 0) write(`${lines.join("\n")}\n`);
      return;
    }
    case "rollback": {
      requireArgCount(args, 2, command);
      const result = rollback(args[0], args[1]);
      write(`backed up current to: ${result.backupFile}\n`);
      write(`rolled back from v${result.currentVersion} to v${result.targetVersion} (saved as v${result.newVersion})\n`);
      write(`backup at: ${result.backupFile}\n`);
      return;
    }
    case "diff": {
      if (args.length < 1 || args.length > 3) throw usage(command);
      write(`${diffVersions(args[0], args[1] ?? "", args[2] ?? "")}\n`);
      return;
    }
    case "compare-agents": {
      if (args.length < 1 || args.length > 3) throw usage(command);
      write(`${compareAgents(args[0], args[1] ?? "", args[2] ?? "")}`);
      return;
    }
    case "validate-version": {
      requireArgCount(args, 1, command);
      if (!validateVersion(args[0])) process.exitCode = 1;
      return;
    }
    case "metadata": {
      requireArgCount(args, 2, command);
      write(`${JSON.stringify(getMetadata(args[0], args[1]))}\n`);
      return;
    }
    default:
      throw usage(command);
  }
}

function requireArgCount(args: string[], count: number, command: string): void {
  if (args.length !== count) throw usage(command);
}

function safeInteger(value: string): number {
  if (!/^[0-9]+$/.test(value)) throw new Error(`invalid integer: ${value}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`integer is out of range: ${value}`);
  return parsed;
}

function usage(command?: string): Error {
  return new Error(`usage: runner-version-control ${command || "<command>"}`);
}

if (require.main === module) {
  try {
    runVersionControlCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
