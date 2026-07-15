#!/usr/bin/env node
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// lib/runner-v2/git-integration-cli.ts
var git_integration_cli_exports = {};
__export(git_integration_cli_exports, {
  runRunnerGitIntegrationCli: () => runRunnerGitIntegrationCli
});
module.exports = __toCommonJS(git_integration_cli_exports);

// lib/runner-v2/git-integration.ts
var import_node_child_process = require("node:child_process");
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var GitRepositoryError = class extends Error {
  constructor(chainDir) {
    super(`not a git repo: ${chainDir}`);
    this.chainDir = chainDir;
    this.name = "GitRepositoryError";
  }
};
function isGitRepository(chainDir) {
  try {
    return (0, import_node_fs.lstatSync)((0, import_node_path.join)(chainDir, ".git")).isDirectory();
  } catch {
    return false;
  }
}
function requireGitRepository(chainDir) {
  if (!isGitRepository(chainDir)) throw new GitRepositoryError(chainDir);
}
function runGit(cwd, args) {
  const output = (0, import_node_child_process.execFileSync)("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024
  });
  return output;
}
function runGitBytes(cwd, args) {
  const output = (0, import_node_child_process.execFileSync)("git", args, {
    cwd,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024
  });
  return Buffer.isBuffer(output) ? output : Buffer.from(output);
}
function currentBranch(chainDir, runner = runGit) {
  const branch = runner(chainDir, ["branch", "--show-current"]).trim();
  return branch || "HEAD";
}
function readGitStatus(chainDir, runner = runGit) {
  requireGitRepository(chainDir);
  const branch = currentBranch(chainDir, runner);
  const output = runner(chainDir, ["status", "--porcelain=v1"]);
  const staged = [];
  const modified = [];
  const untracked = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line) continue;
    const status = line.slice(0, 2);
    const file = line.slice(3);
    if (!file) continue;
    if (status === "??") {
      untracked.push(file);
      continue;
    }
    if (status[0] && status[0] !== " ") staged.push(file);
    if (status[1] && status[1] !== " ") modified.push(file);
  }
  return {
    branch,
    staged,
    modified,
    untracked,
    has_changes: staged.length > 0 || modified.length > 0 || untracked.length > 0
  };
}
function normalizeMaxCount(value) {
  if (!Number.isInteger(value) || value < 0) throw new Error("max_count must be a non-negative integer");
  return value;
}
function parseRecordFields(record, count, label) {
  const fields = record.split("");
  if (fields.length < count || fields.slice(0, count).some((field) => field.length === 0)) {
    throw new Error(`invalid ${label} record`);
  }
  return fields;
}
function requireRevision(value, label) {
  if (!value || value.startsWith("-") || value.includes("\0") || /[\r\n]/.test(value)) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}
function readGitHistory(chainDir, maxCount = 50, runner = runGit) {
  return readGitHistoryDetailed(chainDir, maxCount, "HEAD", runner).map(({ body: _body, ...record }) => record);
}
function readGitHistoryDetailed(chainDir, maxCount = 50, branch = "HEAD", runner = runGit) {
  requireGitRepository(chainDir);
  const count = normalizeMaxCount(maxCount);
  const revision = requireRevision(branch, "branch");
  const output = runner(chainDir, [
    "log",
    "-n",
    String(count),
    "--pretty=format:%H%x1f%h%x1f%an%x1f%ci%x1f%s%x1f%b%x1e",
    revision
  ]);
  return output.split("").filter((record) => record.length > 0).map((record) => {
    const [hash, short, author, date, message, ...bodyParts] = parseRecordFields(record, 5, "git history");
    return { hash, short, author, date, message, body: bodyParts.join("").trim() };
  });
}
function parseNameStatus(output) {
  return output.split(/\r?\n/).filter((line) => line.length > 0).map((line) => ({ status: line.slice(0, 1), file: line.slice(2) })).filter((entry) => entry.file.length > 0);
}
function readGitDiff(chainDir, fromCommit = "HEAD", toCommit = "HEAD", runner = runGit, bytesRunner = runGitBytes) {
  requireGitRepository(chainDir);
  const from = requireRevision(fromCommit, "from revision");
  const to = requireRevision(toCommit, "to revision");
  const filesChanged = runner(chainDir, ["diff", "--name-status", from, to]);
  const files = parseNameStatus(filesChanged).map(({ status, file }) => ({
    status,
    file,
    diff: bytesRunner(chainDir, ["diff", from, to, "--", file]).toString("base64")
  }));
  return { from, to, files };
}
function renderGitStatusText(record) {
  const lines = [`branch: ${record.branch}`];
  if (record.staged.length > 0) lines.push(`staged: ${record.staged.join(" ")}`);
  if (record.modified.length > 0) lines.push(`modified: ${record.modified.join(" ")}`);
  if (record.untracked.length > 0) lines.push(`untracked: ${record.untracked.join(" ")}`);
  return lines.join("\n");
}
function renderGitHistoryText(records) {
  return records.map((record) => `${record.short}|${record.author}|${record.date}|${record.message}`).join("\n");
}
function renderGitDiffText(chainDir, fromCommit, toCommit, runner = runGit) {
  return runner(chainDir, ["diff", fromCommit, toCommit]);
}
function splitRecords(output) {
  return output.split("").map((record) => record.replace(/^\r?\n/, "").replace(/\r?\n$/, "")).filter((record) => record.length > 0);
}
function readGitBranches(chainDir, runner = runGit) {
  requireGitRepository(chainDir);
  const current = runner(chainDir, ["branch", "--show-current"]).trim();
  const output = runner(chainDir, [
    "for-each-ref",
    `--format=%(refname:short)%(objectname:short)%(authorname)%(committerdate:iso8601)%(contents:subject)`,
    "refs/heads/"
  ]);
  return splitRecords(output).map((record) => {
    const [name, short, author, date, message = ""] = parseRecordFields(record, 4, "git branch");
    return { name, short, author, date, message, current: name === current };
  });
}
function readGitConflicts(chainDir, runner = runGit) {
  requireGitRepository(chainDir);
  const output = runner(chainDir, ["diff", "--name-only", "--diff-filter=U"]);
  const conflicts = output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  return { conflicts };
}
function readGitCommitInfo(chainDir, commit = "HEAD", runner = runGit) {
  requireGitRepository(chainDir);
  const revision = requireRevision(commit, "commit");
  const info = runner(chainDir, [
    "show",
    "-s",
    "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%ci%x1f%s%x1f%b%x1e",
    revision
  ]);
  const record = splitRecords(info)[0];
  if (!record) throw new Error("invalid git commit-info record");
  const [hash, short, author, author_email, date, message = "", ...bodyParts] = parseRecordFields(record, 5, "git commit-info");
  const body = bodyParts.join("");
  const filesOutput = runner(chainDir, ["show", "--name-status", "--format=", revision]);
  const files = parseNameStatus(filesOutput);
  return { hash, short, author, author_email, date, message, body, files };
}
function parseCount(output, label) {
  const value = Number(output.trim());
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`invalid ${label}: ${JSON.stringify(output)}`);
  }
  return value;
}
function readGitBranchComparison(chainDir, branch1 = "HEAD", branch2 = "main", runner = runGit) {
  requireGitRepository(chainDir);
  const left = requireRevision(branch1, "branch1");
  const right = requireRevision(branch2, "branch2");
  const ahead = parseCount(runner(chainDir, ["rev-list", "--count", `${right}..${left}`]), "ahead count");
  const behind = parseCount(runner(chainDir, ["rev-list", "--count", `${left}..${right}`]), "behind count");
  return { branch1: left, branch2: right, ahead, behind };
}
function readGitStashList(chainDir, runner = runGit) {
  requireGitRepository(chainDir);
  const output = runner(chainDir, [
    "stash",
    "list",
    "--format=%H%x1f%B%x1f%s%x1f%ci%x1e"
  ]);
  return splitRecords(output).map((record) => {
    const [stash, branch, message = "", ...dateParts] = parseRecordFields(record, 2, "git stash");
    return { stash, branch: branch.trim(), message, date: dateParts.join("").trim() };
  });
}
function renderGitBranchesText(records) {
  return records.map((record) => {
    const marker = record.current ? "*" : " ";
    return `${marker} ${record.short}|${record.name}|${record.author}|${record.date}|${record.message}`;
  }).join("\n");
}
function renderGitConflictsText(record) {
  return record.conflicts.join("\n");
}
function renderGitCommitInfoText(record) {
  const lines = [
    `commit ${record.hash}`,
    `Author: ${record.author} <${record.author_email}>`,
    `Date:   ${record.date}`,
    "",
    `    ${record.message}`
  ];
  if (record.body) lines.push("", record.body);
  if (record.files.length > 0) {
    lines.push("");
    for (const file of record.files) lines.push(`${file.status}	${file.file}`);
  }
  return lines.join("\n");
}
function renderGitBranchComparisonText(record) {
  return [
    `${record.branch1} is ${record.ahead} commits ahead of ${record.branch2}`,
    `${record.branch1} is ${record.behind} commits behind ${record.branch2}`
  ].join("\n");
}
function renderGitStashText(records) {
  return records.map((record) => `${record.stash}|${record.message}|${record.date}`).join("\n");
}

// lib/runner-v2/git-integration-cli.ts
var COMMANDS = [
  "status",
  "history",
  "diff",
  "branches",
  "conflicts",
  "commit-info",
  "compare",
  "stash-list"
];
function runRunnerGitIntegrationCli(argv, write = (line) => console.log(line)) {
  const parsed = parseCli(argv);
  const chainDir = required(parsed.values, "--chain-dir");
  const format = optional(parsed.values, "--format") || "json";
  if (format !== "json" && format !== "text") throw new Error("--format must be json or text");
  if (parsed.command === "status") {
    rejectUnexpected(parsed, /* @__PURE__ */ new Set(["--chain-dir", "--format"]));
    const record = readGitStatus(chainDir);
    write(format === "json" ? JSON.stringify(record) : renderGitStatusText(record));
    return;
  }
  if (parsed.command === "history") {
    rejectUnexpected(parsed, /* @__PURE__ */ new Set(["--chain-dir", "--max-count", "--format"]));
    const rawCount = optional(parsed.values, "--max-count") || "50";
    const maxCount = Number(rawCount);
    if (!Number.isInteger(maxCount) || maxCount < 0) throw new Error("--max-count must be a non-negative integer");
    const records2 = readGitHistory(chainDir, maxCount);
    write(format === "json" ? JSON.stringify(records2) : renderGitHistoryText(records2));
    return;
  }
  if (parsed.command === "diff") {
    rejectUnexpected(parsed, /* @__PURE__ */ new Set(["--chain-dir", "--from", "--to", "--format"]));
    const from = optional(parsed.values, "--from") || "HEAD";
    const to = optional(parsed.values, "--to") || "HEAD";
    const record = readGitDiff(chainDir, from, to);
    write(format === "json" ? JSON.stringify(record) : renderGitDiffText(chainDir, from, to));
    return;
  }
  if (parsed.command === "branches") {
    rejectUnexpected(parsed, /* @__PURE__ */ new Set(["--chain-dir", "--format"]));
    const records2 = readGitBranches(chainDir);
    write(format === "json" ? JSON.stringify(records2) : renderGitBranchesText(records2));
    return;
  }
  if (parsed.command === "conflicts") {
    rejectUnexpected(parsed, /* @__PURE__ */ new Set(["--chain-dir", "--format"]));
    const record = readGitConflicts(chainDir);
    write(format === "json" ? JSON.stringify(record) : renderGitConflictsText(record));
    return;
  }
  if (parsed.command === "commit-info") {
    rejectUnexpected(parsed, /* @__PURE__ */ new Set(["--chain-dir", "--commit", "--format"]));
    const commit = optional(parsed.values, "--commit") || "HEAD";
    const record = readGitCommitInfo(chainDir, commit);
    write(format === "json" ? JSON.stringify(record) : renderGitCommitInfoText(record));
    return;
  }
  if (parsed.command === "compare") {
    rejectUnexpected(parsed, /* @__PURE__ */ new Set(["--chain-dir", "--branch1", "--branch2", "--format"]));
    const branch1 = optional(parsed.values, "--branch1") || "HEAD";
    const branch2 = optional(parsed.values, "--branch2") || "main";
    const record = readGitBranchComparison(chainDir, branch1, branch2);
    write(format === "json" ? JSON.stringify(record) : renderGitBranchComparisonText(record));
    return;
  }
  rejectUnexpected(parsed, /* @__PURE__ */ new Set(["--chain-dir", "--format"]));
  const records = readGitStashList(chainDir);
  write(format === "json" ? JSON.stringify(records) : renderGitStashText(records));
}
function parseCli(argv) {
  const command = argv[0];
  if (!command || !COMMANDS.includes(command)) throw new Error(usage());
  const values = /* @__PURE__ */ new Map();
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === void 0 || values.has(key)) throw new Error(usage());
    values.set(key, value);
  }
  return { command, values };
}
function rejectUnexpected(parsed, allowed) {
  for (const key of parsed.values.keys()) if (!allowed.has(key)) throw new Error(`${key} is not valid for ${parsed.command}`);
}
function required(values, key) {
  const value = values.get(key);
  if (!value) throw new Error(`${key} is required`);
  return value;
}
function optional(values, key) {
  return values.get(key);
}
function usage() {
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runRunnerGitIntegrationCli
});
