#!/usr/bin/env node
import {
  readGitBranchComparison,
  readGitBranches,
  readGitCommitInfo,
  readGitConflicts,
  readGitDiff,
  readGitHistory,
  readGitStatus,
  readGitStashList,
  renderGitBranchComparisonText,
  renderGitBranchesText,
  renderGitCommitInfoText,
  renderGitConflictsText,
  renderGitDiffText,
  renderGitHistoryText,
  renderGitStatusText,
  renderGitStashText,
} from "@/lib/runner-v2/git-integration";

const COMMANDS = [
  "status",
  "history",
  "diff",
  "branches",
  "conflicts",
  "commit-info",
  "compare",
  "stash-list",
] as const;
type Command = (typeof COMMANDS)[number];

export function runRunnerGitIntegrationCli(
  argv: string[],
  write: (line: string) => void = (line) => console.log(line),
): void {
  const parsed = parseCli(argv);
  const chainDir = required(parsed.values, "--chain-dir");
  const format = optional(parsed.values, "--format") || "json";
  if (format !== "json" && format !== "text") throw new Error("--format must be json or text");

  if (parsed.command === "status") {
      rejectUnexpected(parsed, new Set(["--chain-dir", "--format"]));
      const record = readGitStatus(chainDir);
      write(format === "json" ? JSON.stringify(record) : renderGitStatusText(record));
      return;
  }

  if (parsed.command === "history") {
      rejectUnexpected(parsed, new Set(["--chain-dir", "--max-count", "--format"]));
      const rawCount = optional(parsed.values, "--max-count") || "50";
      const maxCount = Number(rawCount);
      if (!Number.isInteger(maxCount) || maxCount < 0) throw new Error("--max-count must be a non-negative integer");
      const records = readGitHistory(chainDir, maxCount);
      write(format === "json" ? JSON.stringify(records) : renderGitHistoryText(records));
      return;
  }

  if (parsed.command === "diff") {
      rejectUnexpected(parsed, new Set(["--chain-dir", "--from", "--to", "--format"]));
      const from = optional(parsed.values, "--from") || "HEAD";
      const to = optional(parsed.values, "--to") || "HEAD";
      const record = readGitDiff(chainDir, from, to);
      write(format === "json" ? JSON.stringify(record) : renderGitDiffText(chainDir, from, to));
      return;
  }

  if (parsed.command === "branches") {
      rejectUnexpected(parsed, new Set(["--chain-dir", "--format"]));
      const records = readGitBranches(chainDir);
      write(format === "json" ? JSON.stringify(records) : renderGitBranchesText(records));
      return;
  }

  if (parsed.command === "conflicts") {
      rejectUnexpected(parsed, new Set(["--chain-dir", "--format"]));
      const record = readGitConflicts(chainDir);
      write(format === "json" ? JSON.stringify(record) : renderGitConflictsText(record));
      return;
  }

  if (parsed.command === "commit-info") {
      rejectUnexpected(parsed, new Set(["--chain-dir", "--commit", "--format"]));
      const commit = optional(parsed.values, "--commit") || "HEAD";
      const record = readGitCommitInfo(chainDir, commit);
      write(format === "json" ? JSON.stringify(record) : renderGitCommitInfoText(record));
      return;
  }

  if (parsed.command === "compare") {
      rejectUnexpected(parsed, new Set(["--chain-dir", "--branch1", "--branch2", "--format"]));
      const branch1 = optional(parsed.values, "--branch1") || "HEAD";
      const branch2 = optional(parsed.values, "--branch2") || "main";
      const record = readGitBranchComparison(chainDir, branch1, branch2);
      write(format === "json" ? JSON.stringify(record) : renderGitBranchComparisonText(record));
      return;
  }

  // stash-list
  rejectUnexpected(parsed, new Set(["--chain-dir", "--format"]));
  const records = readGitStashList(chainDir);
  write(format === "json" ? JSON.stringify(records) : renderGitStashText(records));
}

interface ParsedCli {
  command: Command;
  values: Map<string, string>;
}

function parseCli(argv: string[]): ParsedCli {
  const command = argv[0] as Command | undefined;
  if (!command || !COMMANDS.includes(command)) throw new Error(usage());
  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || values.has(key)) throw new Error(usage());
    values.set(key, value);
  }
  return { command, values };
}

function rejectUnexpected(parsed: ParsedCli, allowed: Set<string>): void {
  for (const key of parsed.values.keys()) if (!allowed.has(key)) throw new Error(`${key} is not valid for ${parsed.command}`);
}

function required(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function optional(values: Map<string, string>, key: string): string | undefined {
  return values.get(key);
}

function usage(): string {
  return `usage: runner-git-integration <status|history|diff|branches|conflicts|commit-info|compare|stash-list> --chain-dir <dir> [--format json|text] [--max-count N] [--from REV --to REV] [--commit REV] [--branch1 REV --branch2 REV]`;
}

if (require.main === module) {
  try {
    runRunnerGitIntegrationCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
