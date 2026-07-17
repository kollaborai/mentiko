import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("monitor prompt storage", () => {
  const originalEnv = process.env;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "mentiko-monitor-prompts-"));
    process.env = { ...originalEnv, MENTIKO_GLOBAL_ROOT: root, NAMESPACE_ID: "prompt-test", ORG_ID: "default" };
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    rmSync(root, { recursive: true, force: true });
  });

  it("returns both defaults when nothing is saved", async () => {
    const { getMonitorPrompts } = await import("@/lib/monitor/monitor-prompt-storage");
    const prompts = getMonitorPrompts("prompt-test", "default");

    expect(prompts.map((p) => p.id)).toEqual(["monitor_persona", "monitor_status_report"]);
    expect(prompts[0].content).toContain("Mentiko Monitor");
    expect(prompts[1].content).toContain("verdict first");
  });

  it("round-trips an override and keeps the untouched default", async () => {
    const { getMonitorPrompts, saveMonitorPrompts, getMonitorPrompt } = await import(
      "@/lib/monitor/monitor-prompt-storage"
    );
    const edited = getMonitorPrompts("prompt-test", "default").map((p) =>
      p.id === "monitor_persona" ? { ...p, content: "You are a pirate. Report in pirate." } : p,
    );
    saveMonitorPrompts("prompt-test", "default", edited);

    const persona = getMonitorPrompt("prompt-test", "default", "monitor_persona");
    const report = getMonitorPrompt("prompt-test", "default", "monitor_status_report");
    expect(persona.content).toBe("You are a pirate. Report in pirate.");
    expect(report.content).toContain("verdict first");
  });

  it("drops unknown saved ids and falls back to defaults on corrupt files", async () => {
    const { getMonitorPrompts, saveMonitorPrompts, getDefaultMonitorPrompts } = await import(
      "@/lib/monitor/monitor-prompt-storage"
    );
    saveMonitorPrompts("prompt-test", "default", [
      ...getDefaultMonitorPrompts(),
      // a prompt id we no longer ship must not resurface on read
      { id: "monitor_retired" as never, label: "Old", content: "stale", updatedAt: "2026-01-01" },
    ]);
    expect(getMonitorPrompts("prompt-test", "default").map((p) => p.id)).toEqual([
      "monitor_persona",
      "monitor_status_report",
    ]);

    const filePath = join(root, "namespaces", "prompt-test", "monitor-prompts.json");
    mkdirSync(join(root, "namespaces", "prompt-test"), { recursive: true });
    writeFileSync(filePath, "not json");
    const prompts = getMonitorPrompts("prompt-test", "default");
    expect(prompts).toHaveLength(2);
    expect(prompts[0].content).toContain("Mentiko Monitor");
  });
});
