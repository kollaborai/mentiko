import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const root = new URL("..", import.meta.url).pathname;
const web = join(root, "web");
const pairs = [
  ["integration-contract-cli", "runner-integration-contract"], ["legacy-metrics-cli", "runner-legacy-metrics"],
  ["routing-contract-cli", "runner-routing-contract"], ["schedule-contract-cli", "runner-schedule-contract"],
  ["concurrency-admission-cli", "runner-concurrency-admission"], ["retry-circuit-cli", "runner-retry-circuit"],
  ["monitor-completion-cli", "runner-monitor-completion"], ["readiness-cli", "runner-readiness"],
  ["chain-validation-cli", "runner-chain-validation"], ["chain-generation-cli", "runner-chain-generation"],
  ["parallel-contract-cli", "runner-parallel-contract"], ["activity-capture-cli", "runner-activity-capture"],
  ["approval-gate-cli", "runner-approval-gate"], ["error-handling-cli", "runner-error-handling"],
  ["teammux-bridge-cli", "runner-teammux-bridge"], ["version-control-cli", "runner-version-control"],
  ["task-context-cli", "runner-task-context"],
  ["git-integration-cli", "runner-git-integration"],
  ["audit-ship-cli", "runner-audit-ship"],
  ["notification-dispatcher-cli", "runner-notification-dispatcher"],
  ["lib/system/audit-cli.ts", "runner-audit"],
];
const temp = mkdtempSync(join(tmpdir(), "mentiko-bundle-parity-"));
try {
  for (const [source, bundle] of pairs) {
    const output = join(temp, `${bundle}.js`);
    const sourcePath = source.endsWith(".ts") ? source : `lib/runner-v2/${source}.ts`;
    execFileSync("npx", ["esbuild", sourcePath, "--bundle", "--platform=node", "--target=node20", `--outfile=${output}`], { cwd: web, stdio: "pipe" });
    assert.equal(readFileSync(output, "utf8"), readFileSync(join(root, "lib", `${bundle}.js`), "utf8"), `${bundle} is stale`);
  }
  console.log(`bundle parity: ${pairs.length}/${pairs.length}`);
} finally { rmSync(temp, { recursive: true, force: true }); }
