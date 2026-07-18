#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const shell = readFileSync(join(root, "bin", "docker-entrypoint.sh"), "utf8");
const source = join(root, "web", "lib", "runner-v2", "kollabor-mcp-settings-cli.ts");
const bundle = join(root, "lib", "runner-kollabor-mcp-settings.js");

assert.match(shell, /node \/app\/lib\/runner-kollabor-mcp-settings\.js register --command \/app\/bin\/mentiko-mcp/);
assert.doesNotMatch(shell, /node <<|JSON\.parse|JSON\.stringify|mcpServers/);

const temp = mkdtempSync(join(tmpdir(), "mentiko-kollab-mcp-boundary-"));
try {
  const compiled = join(temp, "runner-kollabor-mcp-settings.js");
  execFileSync("npx", ["esbuild", "lib/runner-v2/kollabor-mcp-settings-cli.ts", "--bundle", "--platform=node", "--target=node20", `--outfile=${compiled}`], {
    cwd: join(root, "web"), stdio: "pipe",
  });
  assert.equal(readFileSync(compiled, "utf8"), readFileSync(bundle, "utf8"), "typed MCP settings bundle is stale");
  const output = execFileSync("node", [bundle, "register", "--command", "/app/bin/mentiko-mcp", "--home", temp], {
    encoding: "utf8",
    env: { ...process.env, MENTIKO_INBOX_KEY: "test", NAMESPACE_ID: "tenant", ORG_ID: "org" },
  });
  assert.match(output, /"updated":true/);
  const settings = JSON.parse(readFileSync(join(temp, ".kollab", "mcp", "mcp_settings.json"), "utf8"));
  assert.equal(settings.servers.mentiko.command, "/app/bin/mentiko-mcp");
  assert.equal(settings.servers.mentiko.env.MENTIKO_NAMESPACE_ID, "tenant");
  console.log("PASS: typed kollab MCP settings boundary");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
