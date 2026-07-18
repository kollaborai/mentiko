import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerKollabMentikoMcpServer } from "@/lib/kollabor-mcp-settings";

describe("registerKollabMentikoMcpServer", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, MENTIKO_INBOX_KEY: "test-key", NAMESPACE_ID: "tenant", ORG_ID: "org" };
  });

  afterEach(() => { process.env = { ...originalEnv }; });

  it("normalizes legacy servers and atomically registers the typed MCP server", () => {
    const home = mkdtempSync(join(tmpdir(), "mentiko-kollab-settings-"));
    const settingsPath = join(home, ".kollab", "mcp", "mcp_settings.json");
    mkdirSync(join(home, ".kollab", "mcp"), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ mcpServers: { legacy: { command: "old" } }, servers: { current: { command: "new" } } }), "utf8");

    const result = registerKollabMentikoMcpServer({ homeDir: home, command: "/app/bin/mentiko-mcp" });
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));

    expect(result).toMatchObject({ created: false, updated: true, preservedServerCount: 2 });
    expect(settings.mcpServers).toBeUndefined();
    expect(settings.servers).toMatchObject({
      legacy: { command: "old" },
      current: { command: "new" },
      mentiko: { command: "/app/bin/mentiko-mcp", env: expect.objectContaining({ MENTIKO_INBOX_KEY: "test-key", MENTIKO_NAMESPACE_ID: "tenant", MENTIKO_ORG_ID: "org" }) },
    });
  });

  it("fails closed on malformed persisted settings", () => {
    const home = mkdtempSync(join(tmpdir(), "mentiko-kollab-settings-"));
    const settingsDir = join(home, ".kollab", "mcp");
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(join(settingsDir, "mcp_settings.json"), "not-json", "utf8");
    expect(() => registerKollabMentikoMcpServer({ homeDir: home, command: "/app/bin/mentiko-mcp" })).toThrow("invalid MCP settings JSON");
  });
});
