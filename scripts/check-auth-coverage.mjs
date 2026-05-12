#!/usr/bin/env node
/*
 * check-auth-coverage.mjs
 *
 * CI gate for docs/AUTH_COVERAGE.md — prevents silent auth regressions.
 *
 * Enumerates web/app/api/**\/route.ts files, compares against the routes
 * listed under any category section in docs/AUTH_COVERAGE.md, and fails
 * if a route exists on disk without an entry in the doc.
 *
 * Categories scanned: "authenticated", "public-by-design", "unclear",
 * "resolved in RBAC-5b", "likely bug". Anything under "## notes" is ignored.
 *
 * Exit codes:
 *   0  — every route on disk is in the doc
 *   1  — one or more routes missing from the doc
 *   2  — internal error (missing doc, bad repo state)
 *
 * Usage:
 *   node scripts/check-auth-coverage.mjs             # fail on drift (CI mode)
 *   node scripts/check-auth-coverage.mjs --report    # print drift, exit 0
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(import.meta.url), "..", "..");
const apiDir = join(repoRoot, "web", "app", "api");
const docPath = join(repoRoot, "docs", "AUTH_COVERAGE.md");

const CATEGORY_HEADING_RE = /^## (authenticated|public-by-design|unclear|resolved in RBAC-\S+|likely bug)/i;
const NOTES_HEADING_RE = /^## notes/i;
const BULLET_RE = /^- (\S[^\s—]*)/;

async function walk(dir, acc = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, acc);
    } else if (entry.isFile() && entry.name === "route.ts") {
      acc.push(full);
    }
  }
  return acc;
}

async function enumerateRoutes() {
  try {
    await stat(apiDir);
  } catch {
    console.error(`error: api directory not found: ${apiDir}`);
    process.exit(2);
  }
  const files = await walk(apiDir);
  return files.map((f) => relative(apiDir, f)).sort();
}

async function parseDocumentedRoutes() {
  let text;
  try {
    text = await readFile(docPath, "utf8");
  } catch {
    console.error(`error: auth coverage doc not found: ${docPath}`);
    process.exit(2);
  }

  const documented = new Set();
  let inCategory = false;

  for (const line of text.split("\n")) {
    if (NOTES_HEADING_RE.test(line)) {
      inCategory = false;
      continue;
    }
    if (line.startsWith("## ")) {
      inCategory = CATEGORY_HEADING_RE.test(line);
      continue;
    }
    if (!inCategory) continue;
    const m = line.match(BULLET_RE);
    if (!m) continue;
    const route = m[1].trim();
    if (route && route !== "(none" && !route.startsWith("(")) {
      documented.add(route);
    }
  }

  return documented;
}

async function main() {
  const reportOnly = process.argv.includes("--report");
  const [actual, documented] = await Promise.all([
    enumerateRoutes(),
    parseDocumentedRoutes(),
  ]);

  const missing = actual.filter((r) => !documented.has(r));
  const stale = [...documented].filter((r) => !actual.includes(r)).sort();

  console.log(`auth coverage check`);
  console.log(`  routes on disk:     ${actual.length}`);
  console.log(`  documented routes:  ${documented.size}`);
  console.log(`  missing from doc:   ${missing.length}`);
  console.log(`  stale in doc:       ${stale.length}`);

  if (missing.length > 0) {
    console.log("");
    console.log("routes on disk NOT listed in docs/AUTH_COVERAGE.md:");
    for (const r of missing) console.log(`  - ${r}`);
    console.log("");
    console.log("fix: add each route under the correct category in docs/AUTH_COVERAGE.md");
    console.log("     (authenticated / public-by-design / unclear / likely bug)");
  }

  if (stale.length > 0) {
    console.log("");
    console.log("routes listed in docs/AUTH_COVERAGE.md but NOT on disk (possibly renamed or deleted):");
    for (const r of stale) console.log(`  - ${r}`);
  }

  if (reportOnly) {
    process.exit(0);
  }
  if (missing.length > 0) {
    console.log("");
    console.log("CI FAIL: new or undocumented routes must be categorized in docs/AUTH_COVERAGE.md");
    process.exit(1);
  }
  if (stale.length > 0) {
    console.log("");
    console.log("warn: stale entries found. not blocking CI, but run `--report` locally and clean up.");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("internal error:", err);
  process.exit(2);
});
