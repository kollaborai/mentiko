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
  ["chain-validation-cli", "runner-chain-validation"], ["parallel-contract-cli", "runner-parallel-contract"],
];
const temp = mkdtempSync(join(tmpdir(), "mentiko-bundle-parity-"));
try {
  for (const [source, bundle] of pairs) {
    const output = join(temp, `${bundle}.js`);
    execFileSync("npx", ["esbuild", `lib/runner-v2/${source}.ts`, "--bundle", "--platform=node", "--target=node20", `--outfile=${output}`], { cwd: web, stdio: "pipe" });
    assert.equal(readFileSync(output, "utf8"), readFileSync(join(root, "lib", `${bundle}.js`), "utf8"), `${bundle} is stale`);
  }
  console.log(`bundle parity: ${pairs.length}/${pairs.length}`);
} finally { rmSync(temp, { recursive: true, force: true }); }
