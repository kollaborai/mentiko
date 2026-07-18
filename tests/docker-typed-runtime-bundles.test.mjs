import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");

const requiredBundles = [
  ["web/lib/runner-v2/kollabor-mcp-settings-cli.ts", "runner-kollabor-mcp-settings.js"],
  ["web/lib/runner-v2/agent-transcript-cli.ts", "runner-agent-transcript.js"],
  ["web/lib/runner-v2/standalone-monitor-cli.ts", "runner-v2-standalone-monitor.js"],
  ["web/lib/runner-v2/standalone-agent-launch-cli.ts", "runner-v2-standalone-agent-launch.js"],
  ["web/lib/pty/pty-transport-cli.ts", "runner-pty-transport.js"],
];

for (const [source, bundle] of requiredBundles) {
  assert.match(dockerfile, new RegExp(`/build/${source.replace(/[.]/g, "\\.")}`));
  assert.match(dockerfile, new RegExp(`/context/lib/${bundle.replace(/[.]/g, "\\.")}`));
}

assert.match(dockerfile, /lib\/kollabor-mcp-settings\.ts/);
assert.match(dockerfile, /\/context\/lib\/kollabor-mcp-settings\.js/);
console.log(`docker typed runtime bundles: ${requiredBundles.length}/${requiredBundles.length}`);
