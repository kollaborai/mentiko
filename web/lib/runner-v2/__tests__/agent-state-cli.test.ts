import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRunnerAgentStateCli } from "../agent-state-cli";

describe("runner agent state CLI", () => {
  it("exposes only named typed operations", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-agent-state-cli-"));
    const output: string[] = [];
    const write = (line: string) => output.push(line);
    const base = ["--state-dir", root, "--session-prefix", "writer", "--run-id", "run-1"];

    runRunnerAgentStateCli(["start", ...base, "--session", "writer-run-1", "--agent-id", "writer"], write);
    runRunnerAgentStateCli(["increment-retry", ...base], write);
    runRunnerAgentStateCli(["fail", ...base, "--reason", "cli exited"], write);
    runRunnerAgentStateCli(["status", ...base], write);

    expect(output.at(-1)).toBe("failed");
    expect(() => runRunnerAgentStateCli(["patch", ...base], write)).toThrow("usage:");
  });
});
