#!/usr/bin/env node
//
// scripts/build-runner-bundles.mjs
//
// The single source of truth for building the committed lib/*.js runner bundles
// from their web/lib/runner-v2/*.ts (and a few lib/**/*.ts) sources. Lifted out
// of tests/runner-typed-bundle-parity.test.mjs, which had been the only place the
// esbuild command was written down — and which nothing in CI ran.
//
// Every bundle carries a GENERATED banner so a hand-edit is obvious. This branch
// exists because five committed bundles were hand-edited with no .ts behind them;
// this script + the parity test (now wired into CI) is the guardrail against that
// recurring.
//
//   node scripts/build-runner-bundles.mjs           # rebuild every bundle into lib/
//   node scripts/build-runner-bundles.mjs --check   # build to a temp dir, exit 1 if any committed bundle differs (CI)
//
// The parity test imports buildBundle() so there is ONE esbuild invocation, not two.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const WEB = join(ROOT, "web");
const LIB = join(ROOT, "lib");

// [sourceStem, bundleName]. sourceStem is relative to web/ unless it ends in .ts
// (then it is web-relative already). Mirrors the parity test exactly.
export const PAIRS = [
  ["integration-contract-cli", "runner-integration-contract"], ["legacy-metrics-cli", "runner-legacy-metrics"],
  ["routing-contract-cli", "runner-routing-contract"], ["schedule-contract-cli", "runner-schedule-contract"],
  ["concurrency-admission-cli", "runner-concurrency-admission"], ["retry-circuit-cli", "runner-retry-circuit"],
  ["monitor-completion-cli", "runner-monitor-completion"], ["readiness-cli", "runner-readiness"],
  ["chain-validation-cli", "runner-chain-validation"], ["chain-generation-cli", "runner-chain-generation"],
  ["chain-graph-cli", "runner-chain-graph"],
  ["activity-capture-cli", "runner-activity-capture"],
  ["approval-gate-cli", "runner-approval-gate"], ["error-handling-cli", "runner-error-handling"],
  ["teammux-bridge-cli", "runner-teammux-bridge"], ["version-control-cli", "runner-version-control"],
  ["task-context-cli", "runner-task-context"],
  ["git-integration-cli", "runner-git-integration"],
  ["audit-ship-cli", "runner-audit-ship"],
  ["notification-dispatcher-cli", "runner-notification-dispatcher"],
  ["complete-cli", "runner-v2-complete"],
  ["run-record-cli", "runner-run-record"],
  ["kollabor-mcp-settings-cli", "runner-kollabor-mcp-settings"],
  ["agent-transcript-cli", "runner-agent-transcript"],
  ["agent-profile-cli", "runner-agent-profile"],
  ["direct-run-cli", "runner-v2-direct-run"],
  ["batch-runner-cli", "runner-batch-runner"],
  ["next-chain-launch-cli", "runner-v2-next-chain"],
  ["existing-run-launch-cli", "runner-v2-existing-run"],
  ["launch-agent-cli", "runner-v2-launch-agent"],
  ["monitor-cli", "monitor-v2"],
  ["manual-monitor-cli", "runner-manual-monitor"],
  ["standalone-monitor-cli", "runner-v2-standalone-monitor"],
  ["standalone-agent-launch-cli", "runner-v2-standalone-agent-launch"],
  ["lib/system/audit-cli.ts", "runner-audit"],
  ["lib/system/native-plugin-handler-cli.ts", "runner-native-plugin"],
  ["lib/links/peer-link-controller-cli.ts", "runner-peer-link-controller"],
];

// Sources that live directly under web/ (not web/lib/runner-v2/).
export const STANDALONE = [
  ["lib/runner-v2/job-worker.ts", "runner-job-worker"],
  ["lib/pty/pty-transport-cli.ts", "runner-pty-transport"],
];

export function sourcePath(stem) {
  return stem.endsWith(".ts") ? stem : `lib/runner-v2/${stem}.ts`;
}

// Build one bundle to outPath. One esbuild invocation for the whole repo — the
// parity test calls this too, so the banner and flags can never drift between them.
export function buildBundle(stem, outPath) {
  const src = sourcePath(stem);
  const banner = `// GENERATED FROM web/${src} - DO NOT EDIT. Rebuild: node scripts/build-runner-bundles.mjs`;
  execFileSync("npx", [
    "esbuild", src,
    "--bundle", "--platform=node", "--target=node20",
    `--banner:js=${banner}`,
    `--outfile=${outPath}`,
  ], { cwd: WEB, stdio: "pipe" });
  return outPath;
}

export function allTargets() {
  return [...PAIRS, ...STANDALONE];
}

// Rebuild every bundle into lib/.
function rebuildAll() {
  for (const [stem, bundle] of allTargets()) {
    buildBundle(stem, join(LIB, `${bundle}.js`));
  }
  console.log(`rebuilt ${allTargets().length} bundles into lib/`);
}

// Build to a temp dir, compare each against the committed lib/*.js, exit 1 on any drift.
function checkParity() {
  const temp = mkdtempSync(join(tmpdir(), "mentiko-bundle-parity-"));
  let stale = 0;
  try {
    for (const [stem, bundle] of allTargets()) {
      const tmpOut = join(temp, `${bundle}.js`);
      buildBundle(stem, tmpOut);
      const committed = join(LIB, `${bundle}.js`);
      if (readFileSync(tmpOut, "utf8") !== readFileSync(committed, "utf8")) {
        console.error(`stale: ${bundle}`);
        stale++;
      }
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  if (stale > 0) { console.error(`${stale} bundle(s) stale — run: node scripts/build-runner-bundles.mjs`); process.exit(1); }
  console.log(`bundle parity: ${allTargets().length}/${allTargets().length}`);
}

// CLI dispatch — only when run directly, not when imported (e.g. by the parity test,
// which imports buildBundle/allTargets to share the one esbuild invocation).
if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const mode = process.argv[2];
  if (mode === "--check") checkParity();
  else rebuildAll();
}
