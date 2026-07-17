import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "..");

function standaloneMonitorBlock(source: string, start: string): string {
  const offset = source.indexOf(start);
  if (offset < 0) throw new Error(`missing ${start}`);
  return source.slice(offset, source.indexOf("\n}", offset) + 2);
}

describe("standalone monitor shell routing", () => {
  it("routes both standalone spec entrypoints directly into the typed monitor runtime", () => {
    const launcher = readFileSync(join(root, "lib", "launch-agent.sh"), "utf8");
    const functions = readFileSync(join(root, "lib", "agent-functions.sh"), "utf8");
    const launchBlock = launcher.slice(launcher.indexOf("# start monitor if requested"));
    const functionBlock = standaloneMonitorBlock(functions, "new-agent-from-spec() {");

    for (const block of [launchBlock, functionBlock]) {
      expect(block).toContain("runner-v2-standalone-monitor.js");
      expect(block).toContain("--session");
      expect(block).toContain("--spec");
      expect(block).not.toContain("monitor-with-ai");
      expect(block).not.toContain(".mentiko_monitor");
    }
  });
});
