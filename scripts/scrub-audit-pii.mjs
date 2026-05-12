#!/usr/bin/env node
// scrub-audit-pii.mjs — one-shot migration to remove PII from audit logs
//
// parses JSONL audit.log files, replaces email/name metadata values
// with user_id lookups (via auth.db), rewrites atomically.
//
// usage:
//   node scripts/scrub-audit-pii.mjs             # live run
//   node scripts/scrub-audit-pii.mjs --dry-run   # report only

import { readFileSync, writeFileSync, renameSync, existsSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
let Database;
try {
  Database = require("better-sqlite3");
} catch {
  // when run outside web/, try the web/ node_modules
  try {
    Database = require(join(process.cwd(), "web", "node_modules", "better-sqlite3"));
  } catch {
    Database = null;
    console.warn("[scrub] better-sqlite3 not found — email-to-userid mapping disabled");
  }
}

const PII_KEYS = new Set(["email", "name", "user_email", "user_name", "username"]);
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;

const DRY_RUN = process.argv.includes("--dry-run");

function resolveMentikoRoot() {
  return process.env.MENTIKO_GLOBAL_ROOT || join(homedir(), ".mentiko");
}

function findAuditLogs(root) {
  const logs = [];
  // default namespace
  const defaultLog = join(root, "namespaces", "default", "audit", "audit.log");
  if (existsSync(defaultLog)) logs.push(defaultLog);
  // scan for other namespaces (future-proofing)
  // TODO: enumerate namespace dirs when multi-tenant lands
  return logs;
}

function loadEmailToUserIdMap(db) {
  const map = new Map();
  if (!db) return map;
  try {
    const rows = db.prepare('SELECT id, email FROM "user" WHERE email IS NOT NULL').all();
    for (const row of rows) {
      map.set(row.email.toLowerCase(), row.id);
    }
  } catch (err) {
    console.error("[scrub] could not load user map from auth.db:", err.message);
  }
  return map;
}

function openAuthDb(root) {
  if (!Database) {
    console.warn("[scrub] skipping auth.db lookup (better-sqlite3 unavailable)");
    return null;
  }
  const dbPath = join(root, "data", "auth.db");
  if (!existsSync(dbPath)) {
    console.error("[scrub] auth.db not found at", dbPath);
    return null;
  }
  try {
    const db = new Database(dbPath, { readonly: true });
    return db;
  } catch (err) {
    console.error("[scrub] could not open auth.db:", err.message);
    return null;
  }
}

function scrubLine(line, emailMap) {
  if (!line.trim()) return { line, changed: false };

  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return { line, changed: false };
  }

  let changed = false;

  // scrub metadata
  if (entry.metadata && typeof entry.metadata === "object") {
    const meta = entry.metadata;
    const keysToRemove = [];

    for (const [key, value] of Object.entries(meta)) {
      if (PII_KEYS.has(key)) {
        keysToRemove.push(key);
        changed = true;
      } else if (typeof value === "string" && EMAIL_RE.test(value)) {
        // value contains an email — replace with user_id if possible
        const match = value.match(EMAIL_RE);
        if (match) {
          const userId = emailMap.get(match[0].toLowerCase());
          if (userId && !meta.user_id) {
            meta.user_id = userId;
          }
        }
        keysToRemove.push(key);
        changed = true;
      }
    }

    for (const key of keysToRemove) {
      delete meta[key];
    }
  }

  // scrub description field if it contains email
  if (typeof entry.description === "string" && EMAIL_RE.test(entry.description)) {
    // redact emails in description
    entry.description = entry.description.replace(
      /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
      "[REDACTED]"
    );
    changed = true;
  }

  // scrub user field if it contains email
  if (typeof entry.user === "string" && EMAIL_RE.test(entry.user)) {
    const userId = emailMap.get(entry.user.toLowerCase());
    entry.user = userId || "[REDACTED]";
    changed = true;
  }

  if (!changed) return { line, changed: false };
  return { line: JSON.stringify(entry), changed: true };
}

function scrubFile(filePath, emailMap) {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  let scrubbed = 0;
  let total = 0;
  const output = [];

  for (const rawLine of lines) {
    if (!rawLine.trim()) {
      output.push("");
      continue;
    }
    total++;
    const { line, changed } = scrubLine(rawLine, emailMap);
    if (changed) scrubbed++;
    output.push(line);
  }

  console.log(`[scrub] ${filePath}: ${scrubbed}/${total} entries ${DRY_RUN ? "would be " : ""}scrubbed`);

  if (!DRY_RUN && scrubbed > 0) {
    const tmpPath = filePath + ".scrubbing";
    writeFileSync(tmpPath, output.join("\n"), "utf-8");
    renameSync(tmpPath, filePath);
    console.log(`[scrub] ${filePath}: rewritten atomically`);
  }

  return { total, scrubbed };
}

function main() {
  const root = resolveMentikoRoot();
  console.log(`[scrub] mentiko root: ${root}`);
  console.log(`[scrub] mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);

  const logs = findAuditLogs(root);
  if (logs.length === 0) {
    console.log("[scrub] no audit logs found");
    process.exit(0);
  }

  const db = openAuthDb(root);
  const emailMap = loadEmailToUserIdMap(db);

  let totalScrubbed = 0;
  let totalEntries = 0;

  for (const logPath of logs) {
    const { total, scrubbed } = scrubFile(logPath, emailMap);
    totalEntries += total;
    totalScrubbed += scrubbed;
  }

  db?.close();

  console.log(`[scrub] done: ${totalScrubbed}/${totalEntries} total entries ${DRY_RUN ? "would be " : ""}scrubbed`);
  process.exit(0);
}

main();
