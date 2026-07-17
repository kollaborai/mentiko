#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const shell = readFileSync(join(root, "lib", "chain-runner.sh"), "utf8");
const cli = readFileSync(join(root, "bin", "mentiko"), "utf8");
const direct = readFileSync(join(root, "web", "lib", "runner-v2", "direct-run.ts"), "utf8");
const plan = readFileSync(join(root, "web", "lib", "runner-v2", "agent-bootstrap-plan.ts"), "utf8");
const bootstrap = readFileSync(join(root, "web", "lib", "runner-v2", "bootstrap-executor.ts"), "utf8");

execFileSync("bash", ["-n", join(root, "lib", "chain-runner.sh")]);
assert.match(shell, /exec node "\$SCRIPT_DIR\/runner-v2-direct-run\.js" "\$@"/);
assert.doesNotMatch(shell, /source |function |\bjq\b|--parallel|transport_new_session|run\.json/);
assert.match(cli, /graph\)\s+exec node "\$LIB_DIR\/runner-chain-graph\.js"/s);
assert.match(direct, /--task/);
assert.match(direct, /--dry-run/);
assert.match(direct, /--parallel was retired/);
assert.match(direct, /loadTypedTaskContext/);
assert.match(plan, /buildLocalAiGatewayProxyEnv/);
assert.match(plan, /MENTIKO_AI_GATEWAY_LOCAL_TOKEN/);
assert.doesNotMatch(plan, /ANTHROPIC_API_KEY/);
assert.match(bootstrap, /Typed task context:/);
assert.match(bootstrap, /startMonitorSession/);

console.log("chain-runner typed boundary: compatibility shell has no lifecycle ownership");
