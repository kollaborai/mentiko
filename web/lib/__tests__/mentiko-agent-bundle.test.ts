import { readFileSync } from "node:fs";
import { join } from "node:path";

const bundle = JSON.parse(
  readFileSync(join(__dirname, "../../../kollab/agent-bundles/mentiko/agent.json"), "utf8"),
);

// kollab >= 0.10 hides and denies every MCP tool for a bundle whose `tools`
// allowlist lacks "mcp-tool" -- even for servers listed in `mcp_servers`.
// Without it the floating bar loses navigate/open_*/show_* entirely.
test("mentiko bundle grants its MCP servers' tools", () => {
  expect(bundle.mcp_servers).toContain("mentiko");
  expect(bundle.tools).toContain("mcp-tool");
});

// "hub": false makes the engine spawn a solo daemon. On the mesh, every bar
// session broadcast its user's input to all other sessions and local agents.
test("mentiko bundle stays off the kollab hub mesh", () => {
  expect(bundle.hub).toBe(false);
});
