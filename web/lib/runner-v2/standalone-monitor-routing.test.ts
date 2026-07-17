import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "..");

function standaloneMonitorBlock(source: string, start: string): string {
  const offset = source.indexOf(start);
  if (offset < 0) throw new Error(`missing ${start}`);
  return source.slice(offset, source.indexOf("\n}", offset) + 2);
}

describe("standalone monitor shell routing", () => {
  it("keeps the old standalone launcher as a typed forwarding boundary and the remaining shell helper on the typed monitor", () => {
    const launcher = readFileSync(join(root, "lib", "launch-agent.sh"), "utf8");
    const functions = readFileSync(join(root, "lib", "agent-functions.sh"), "utf8");
    const functionBlock = standaloneMonitorBlock(functions, "new-agent-from-spec() {");

    expect(launcher).toContain("runner-v2-standalone-agent-launch.js");
    expect(launcher).not.toContain("runner-v2-standalone-monitor.js");
    expect(launcher).not.toContain("monitor-with-ai");
    expect(launcher).not.toContain(".mentiko_monitor");
    expect(functionBlock).toContain("runner-v2-standalone-monitor.js");
    expect(functionBlock).toContain("--session");
    expect(functionBlock).toContain("--spec");
    expect(functionBlock).not.toContain("monitor-with-ai");
    expect(functionBlock).not.toContain(".mentiko_monitor");
  });
});
