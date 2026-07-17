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
  ["kollabor-mcp-settings-cli", "runner-kollabor-mcp-settings"],
  ["agent-transcript-cli", "runner-agent-transcript"],
  ["agent-profile-cli", "runner-agent-profile"],
  ["launch-agent-cli", "runner-v2-launch-agent"],
  ["monitor-cli", "monitor-v2"],
  ["manual-monitor-cli", "runner-manual-monitor"],
  ["standalone-monitor-cli", "runner-v2-standalone-monitor"],
  ["lib/system/audit-cli.ts", "runner-audit"],
  ["lib/system/native-plugin-handler-cli.ts", "runner-native-plugin"],
];
const standaloneBundles = [
  ["lib/runner-v2/job-worker.ts", "runner-job-worker"],
  ["lib/pty/pty-transport-cli.ts", "runner-pty-transport"],
];
const temp = mkdtempSync(join(tmpdir(), "mentiko-bundle-parity-"));
try {
  for (const [source, bundle] of pairs) {
    const output = join(temp, `${bundle}.js`);
    const sourcePath = source.endsWith(".ts") ? source : `lib/runner-v2/${source}.ts`;
    execFileSync("npx", ["esbuild", sourcePath, "--bundle", "--platform=node", "--target=node20", `--outfile=${output}`], { cwd: web, stdio: "pipe" });
    assert.equal(readFileSync(output, "utf8"), readFileSync(join(root, "lib", `${bundle}.js`), "utf8"), `${bundle} is stale`);
  }
  for (const [source, bundle] of standaloneBundles) {
    const output = join(temp, `${bundle}.js`);
    execFileSync("npx", ["esbuild", source, "--bundle", "--platform=node", "--target=node20", `--outfile=${output}`], { cwd: web, stdio: "pipe" });
    assert.equal(readFileSync(output, "utf8"), readFileSync(join(root, "lib", `${bundle}.js`), "utf8"), `${bundle} is stale`);
  }
  const bundleCount = pairs.length + standaloneBundles.length;
  console.log(`bundle parity: ${bundleCount}/${bundleCount}`);
} finally { rmSync(temp, { recursive: true, force: true }); }
