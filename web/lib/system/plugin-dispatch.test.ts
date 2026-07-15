import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { dispatchPlugins } from "@/lib/system/plugin-dispatch";
import { getPlugins } from "@/lib/system/plugin-registry";

jest.mock("node:child_process", () => ({ spawn: jest.fn() }));
jest.mock("@/lib/system/plugin-registry", () => ({ getPlugins: jest.fn() }));

describe("typed plugin dispatch", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mentiko-plugin-dispatch-"));
    jest.clearAllMocks();
    (spawn as jest.Mock).mockReturnValue({ unref: jest.fn() });
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reads enabled registrations through the typed owner and launches only declared hook scripts", () => {
    const script = join(dir, "on-event.sh");
    writeFileSync(script, "#!/usr/bin/env bash\nexit 0\n", { mode: 0o700 });
    (getPlugins as jest.Mock).mockReturnValue([{
      id: "plugin-a",
      enabled: true,
      pluginDir: dir,
      manifest: { id: "plugin-a", name: "Plugin A", description: "test", version: "1", category: "custom", events: ["chain.completed"], onEventScript: "on-event.sh", configSchema: [] },
      config: { enabled_flag: true },
    }]);

    const result = dispatchPlugins({ namespaceId: "ns", orgId: "org", event: "chain.completed", chainId: "chain", runId: "run-1", agentId: "writer", data: { value: 1 } });

    expect(result).toEqual({ launched: ["plugin-a"], skipped: [] });
    expect(spawn).toHaveBeenCalledWith("bash", [script], expect.objectContaining({
      detached: true,
      stdio: "ignore",
      env: expect.objectContaining({ PLUGIN_EVENT_TYPE: "chain.completed", PLUGIN_DATA_JSON: "{\"value\":1}", PLUGIN_ENABLED_FLAG: "true", NAMESPACE_ID: "ns", ORG_ID: "org" }),
    }));
  });

  it("rejects a declared hook outside the plugin directory", () => {
    (getPlugins as jest.Mock).mockReturnValue([{
      id: "plugin-a",
      enabled: true,
      pluginDir: dir,
      manifest: { id: "plugin-a", name: "Plugin A", description: "test", version: "1", category: "custom", events: ["*"], onEventScript: "../outside.sh", configSchema: [] },
      config: {},
    }]);

    expect(() => dispatchPlugins({ namespaceId: "ns", orgId: "org", event: "chain.completed" })).toThrow(/escapes its plugin directory/);
    expect(spawn).not.toHaveBeenCalled();
  });
});
