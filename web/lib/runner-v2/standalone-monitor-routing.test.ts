import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "..");

function standaloneMonitorBlock(source: string, start: string): string {
  const offset = source.indexOf(start);
  if (offset < 0) throw new Error(`missing ${start}`);
  return source.slice(offset, source.indexOf("\n}", offset) + 2);
}

describe("standalone monitor shell routing", () => {
  it("keeps every standalone launcher as a typed forwarding boundary", () => {
    const launcher = readFileSync(join(root, "lib", "launch-agent.sh"), "utf8");
    const functions = readFileSync(join(root, "lib", "agent-functions.sh"), "utf8");
    const functionBlock = standaloneMonitorBlock(functions, "new-agent-from-spec() {");

    expect(launcher).toContain("runner-v2-standalone-agent-launch.js");
    expect(launcher).not.toContain("runner-v2-standalone-monitor.js");
    expect(launcher).not.toContain("monitor-with-ai");
    expect(launcher).not.toContain(".mentiko_monitor");
    expect(functionBlock).toContain("runner-v2-standalone-agent-launch.js");
    expect(functionBlock).not.toContain("runner-v2-standalone-monitor.js");
    expect(functionBlock).not.toContain("grep");
    expect(functionBlock).not.toContain("sed");
    expect(functionBlock).not.toContain("xargs");
    expect(functionBlock).not.toContain("date");
    expect(functionBlock).not.toContain("_agent_state_cli");
    expect(functionBlock).not.toContain("new-agent-session");
    expect(functionBlock).not.toContain("monitor-with-ai");
    expect(functionBlock).not.toContain(".mentiko_monitor");
  });
});
