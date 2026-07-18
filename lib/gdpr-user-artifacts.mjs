// Typed owner of GDPR per-user artifact ownership detection.
//
// lib/gdpr-sweep.sh previously decided ownership by grepping raw JSON for
// `"created_by":"<id>"` (chains), `"user_id":"<id>"` (conversations), and
// `"userId":"<id>"` (decisions). That substring match is whitespace-sensitive
// and can false-positive on nested fields. This module parses each artifact and
// compares the canonical ownership field, then removes the owned file/dir. The
// shell boundary forwards the namespace root and user id and parses no JSON.
// Runs remain owned by the typed Run Record CLI (delete-user-runs).

import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Chain dir is owned when its chain.json created_by equals the user id. */
export function chainOwnedByUser(chainFile, userId) {
  if (!existsSync(chainFile)) return false;
  const record = safeParse(readFileSync(chainFile, "utf8"));
  return Boolean(record) && record.created_by === userId;
}

/**
 * A JSONL conversation is owned when ANY record line carries the user id, so a
 * single owned turn retires the file — matching the shell's whole-file grep but
 * without cross-field substring collisions.
 */
export function conversationOwnedByUser(convFile, userId) {
  if (!existsSync(convFile)) return false;
  for (const line of readFileSync(convFile, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const record = safeParse(line);
    if (record && record.user_id === userId) return true;
  }
  return false;
}

/** Decision JSON is owned when its top-level userId equals the user id. */
export function decisionOwnedByUser(decFile, userId) {
  if (!existsSync(decFile)) return false;
  const record = safeParse(readFileSync(decFile, "utf8"));
  return Boolean(record) && record.userId === userId;
}

function listEntries(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir);
}

/**
 * Detect and remove chains, conversations, and decisions owned by the user under
 * a namespace root. Returns removal log lines (also printed by the CLI) so the
 * caller can surface them without re-deriving ownership.
 */
export function sweepUserArtifacts(nsRoot, userId, { dryRun = false } = {}) {
  const removed = [];

  const chainsDir = join(nsRoot, "chains");
  for (const name of listEntries(chainsDir)) {
    const chainDir = join(chainsDir, name);
    if (!statSync(chainDir).isDirectory()) continue;
    if (chainOwnedByUser(join(chainDir, "chain.json"), userId)) {
      if (!dryRun) rmSync(chainDir, { recursive: true, force: true });
      removed.push(`[gdpr-sweep] removing chain: ${chainDir}`);
    }
  }

  const convDir = join(nsRoot, "conversations");
  for (const name of listEntries(convDir)) {
    if (!name.endsWith(".jsonl")) continue;
    const convFile = join(convDir, name);
    if (conversationOwnedByUser(convFile, userId)) {
      if (!dryRun) rmSync(convFile, { force: true });
      removed.push(`[gdpr-sweep] removing conversation: ${convFile}`);
    }
  }

  const decisionsDir = join(nsRoot, "decisions");
  for (const name of listEntries(decisionsDir)) {
    if (!name.endsWith(".json")) continue;
    const decFile = join(decisionsDir, name);
    if (decisionOwnedByUser(decFile, userId)) {
      if (!dryRun) rmSync(decFile, { force: true });
      removed.push(`[gdpr-sweep] removing decision: ${decFile}`);
    }
  }

  return removed;
}

function parseCliArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith("--")) {
      values[token.slice(2)] = argv[index + 1] ?? "";
      index += 1;
    }
  }
  return values;
}

export function runGdprUserArtifactsCli(argv) {
  const [command, ...rest] = argv;
  const args = parseCliArgs(rest);
  if (command !== "sweep") {
    return { code: 2, stdout: "", stderr: `unknown command: ${command ?? ""}` };
  }
  if (!args["ns-root"] || !args["user-id"]) {
    return { code: 2, stdout: "", stderr: "usage: sweep --ns-root <path> --user-id <id>" };
  }
  const removed = sweepUserArtifacts(args["ns-root"], args["user-id"], { dryRun: args["dry-run"] === "true" });
  return { code: 0, stdout: removed.length ? `${removed.join("\n")}\n` : "" };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = runGdprUserArtifactsCli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(`${result.stderr}\n`);
  process.exit(result.code);
}
