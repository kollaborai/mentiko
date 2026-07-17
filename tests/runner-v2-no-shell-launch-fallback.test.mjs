#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const launchPlan = readFileSync(join(root, "web/lib/runner-v2/launch-plan.ts"), "utf8");
const controller = readFileSync(join(root, "web/lib/runner-v2/controller.ts"), "utf8");
const bootstrapPlan = readFileSync(join(root, "web/lib/runner-v2/agent-bootstrap-plan.ts"), "utf8");
const runService = readFileSync(join(root, "web/lib/runs/chain-run-service.ts"), "utf8");
const shellRunner = readFileSync(join(root, "lib/chain-runner.sh"), "utf8");

for (const [name, source, forbidden] of [
  ["launch-plan", launchPlan, /chain-runner\.sh|shell-compat|\/bin\/zsh|\|\|/],
  ["controller", controller, /buildRunnerV2LaunchPlan|\/bin\/zsh|shell fallback/],
  ["agent-bootstrap-plan", bootstrapPlan, /monitor-chain-agent|MENTIKO_MONITOR_V2|npx tsx|_monitor_v2_status/],
  ["runner-v2 chain service", runService, /runnerV2Launch\.fallbackAllowed/],
  ["chain-runner compatibility boundary", shellRunner, /source |function |\bjq\b|--parallel|monitor-chain-agent|npx tsx/],
]) {
  if (forbidden.test(source)) throw new Error(`${name} retains a shell compatibility launch fallback`);
}
if (!launchPlan.includes('mode: "external-cli"')) throw new Error("external workspace dispatch must be explicit");
if (!controller.includes("isExternalWorkspace(context)")) throw new Error("controller must contain the explicit non-local boundary");
if (!bootstrapPlan.includes("exec node")) throw new Error("typed bootstrap monitor must execute the compiled typed command");
if (!shellRunner.includes('exec node "$SCRIPT_DIR/runner-v2-direct-run.js" "$@"')) throw new Error("compatibility filename must immediately enter the compiled typed direct runner");
console.log("PASS: runner-v2 local launch has no shell fallback");
