import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const source = readFileSync(join(root, "lib", "chain-runner.sh"), "utf8");

// The chain runner may still use curl for the heartbeat transport, but it must
// not construct audit or notification JSON in shell.
assert.doesNotMatch(source, /\bjq\b/, "chain-runner must not own JSON construction");
assert.doesNotMatch(source, /--metadata-json/, "chain-runner audit calls must use typed metadata primitives");
assert.match(source, /--meta agent_id=/);
assert.match(source, /--meta chain_name=/);
assert.match(source, /--meta agent_count=/);
assert.match(source, /runner-notification-dispatcher\.js" dispatch/);
assert.match(source, /--event chain-started/);
assert.match(source, /--endpoint "\$\{BASE_URL\}\/api\/notifications\/dispatch"/);
assert.match(source, /BASE_URL="\$\{BETTER_AUTH_URL:-/);
execFileSync("bash", ["-n", join(root, "lib", "chain-runner.sh")]);

console.log("chain-runner event payload boundary: typed audit and notification callers");
