import { lstatSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupClaudeMentikoMcpConfig, createClaudeMentikoMcpConfig, withClaudeMentikoMcpCleanup } from "@/lib/runner-v2/claude-mentiko-mcp-config";

describe("Claude run-scoped Mentiko MCP config", () => {
  const serverPath = join(process.cwd(), "..", "lib", "mentiko-mcp", "dist", "server.js");

  it("writes the current run capability into a private Claude-only config", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "runner-v2-claude-mcp-test-"));
    const receipt = createClaudeMentikoMcpConfig({
      MENTIKO_WEB_URL: "http://127.0.0.1:3200",
      MENTIKO_SESSION_ID: "chain-run-123",
      MENTIKO_SESSION_TOKEN: "session-token",
      MENTIKO_CODE_ROOT: join(process.cwd(), ".."),
      MENTIKO_INBOX_KEY: "interactive-app-key",
      MENTIKO_MCP_TOOL_SCOPE: "bar",
    }, { serverPath, tempRoot });

    try {
      expect(receipt).toBeDefined();
      expect(lstatSync(receipt!.dir).mode & 0o777).toBe(0o700);
      expect(lstatSync(receipt!.path).mode & 0o777).toBe(0o600);
      expect(JSON.parse(readFileSync(receipt!.path, "utf8"))).toEqual({
        mcpServers: {
          mentiko: {
            command: "node",
            args: [serverPath],
            env: {
              MENTIKO_WEB_URL: "http://127.0.0.1:3200",
              MENTIKO_SESSION_ID: "chain-run-123",
              MENTIKO_SESSION_TOKEN: "session-token",
              MENTIKO_INBOX_KEY: "",
              MENTIKO_MCP_TOOL_SCOPE: "runner",
            },
          },
        },
      });
    } finally {
      cleanupClaudeMentikoMcpConfig(receipt);
    }
  });

  it("does not materialize a config for a Claude session without run capability", () => {
    expect(() => createClaudeMentikoMcpConfig({}, { serverPath })).toThrow("Claude Mentiko MCP context requires MENTIKO_WEB_URL, MENTIKO_SESSION_ID, and MENTIKO_SESSION_TOKEN but all were absent/empty");
  });

  it("fails closed for partial run context instead of using a global MCP credential", () => {
    expect(() => createClaudeMentikoMcpConfig({
      MENTIKO_WEB_URL: "http://127.0.0.1:3200",
      MENTIKO_SESSION_ID: "chain-run-123",
      MENTIKO_CODE_ROOT: join(process.cwd(), ".."),
    }, { serverPath })).toThrow("requires MENTIKO_WEB_URL, MENTIKO_SESSION_ID, and MENTIKO_SESSION_TOKEN");
  });

  it("fails closed when MENTIKO_CODE_ROOT is missing", () => {
    expect(() => createClaudeMentikoMcpConfig({
      MENTIKO_WEB_URL: "http://127.0.0.1:3200",
      MENTIKO_SESSION_ID: "chain-run-123",
      MENTIKO_SESSION_TOKEN: "session-token",
    }, {})).toThrow("Claude Mentiko MCP context requires MENTIKO_CODE_ROOT");
  });

  it("cleans the private config only after Claude exits and preserves Claude's status", () => {
    const command = withClaudeMentikoMcpCleanup("claude --mcp-config '/tmp/config' --strict-mcp-config", {
      path: "/tmp/config",
      dir: "/tmp/dir",
    });
    expect(command).toContain("claude --mcp-config '/tmp/config' --strict-mcp-config");
    expect(command).toContain("rm -f '/tmp/config'");
    expect(command).toContain("rmdir '/tmp/dir'");
    expect(command).toContain("(exit $mentiko_mcp_status)");
  });
});
