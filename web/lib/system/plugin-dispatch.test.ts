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

  it("routes a declared builtin native handler to the compiled typed boundary", () => {
    (getPlugins as jest.Mock).mockReturnValue([{
      id: "pagerduty",
      enabled: true,
      pluginDir: dir,
      manifest: { id: "pagerduty", name: "PagerDuty", description: "test", version: "1", category: "notification", events: ["chain-stopped"], builtin: true, nativeHandler: "pagerduty", configSchema: [] },
      config: {},
    }]);

    expect(dispatchPlugins({ namespaceId: "ns", orgId: "org", event: "chain-stopped" })).toEqual({ launched: ["pagerduty"], skipped: [] });
    expect(spawn).toHaveBeenCalledWith(process.execPath, [expect.stringMatching(/lib\/runner-native-plugin\.js$/), "dispatch", "--handler", "pagerduty"], expect.objectContaining({ detached: true, stdio: "ignore" }));
  });

  it("routes custom-webhook through the compiled typed boundary instead of a shell hook", () => {
    (getPlugins as jest.Mock).mockReturnValue([{
      id: "custom-webhook",
      enabled: true,
      pluginDir: dir,
      manifest: { id: "custom-webhook", name: "Outbound Webhook", description: "test", version: "1", category: "outbound-webhook", events: ["chain-stopped"], builtin: true, nativeHandler: "custom-webhook", configSchema: [] },
      config: { url: "https://example.test/hook" },
    }]);

    expect(dispatchPlugins({ namespaceId: "ns", orgId: "org", event: "chain-stopped" })).toEqual({ launched: ["custom-webhook"], skipped: [] });
    expect(spawn).toHaveBeenCalledWith(process.execPath, [expect.stringMatching(/lib\/runner-native-plugin\.js$/), "dispatch", "--handler", "custom-webhook"], expect.objectContaining({
      detached: true,
      stdio: "ignore",
      env: expect.objectContaining({ PLUGIN_URL: "https://example.test/hook" }),
    }));
  });
});
