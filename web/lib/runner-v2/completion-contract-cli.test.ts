import { runCompletionContractCli } from "@/lib/runner-v2/completion-contract-cli";

describe("completion-contract CLI", () => {
  it("builds the same typed handoff contract for a shell launch", () => {
    const output: string[] = [];
    runCompletionContractCli([
      "build",
      "--agent-id", "writer",
      "--artifacts-dir", "/runs/run-1/artifacts",
      "--events-dir", "/workspace/events",
      "--run-id", "run-1",
      "--emits", "draft-ready",
      "--core-generation-chain", "false",
    ], (line) => output.push(line));

    expect(output).toHaveLength(1);
    expect(output[0]).toContain("Run context: RUN_ID=run-1, MENTIKO_AGENT_ID=writer");
    expect(output[0]).toContain("/runs/run-1/artifacts/writer-summary.json");
    expect(output[0]).toContain("mentiko emit draft-ready");
    expect(output[0]).toContain("Do NOT hand-write any .event file.");
  });

  it("rejects malformed or duplicate primitive arguments", () => {
    expect(() => runCompletionContractCli([
      "build",
      "--agent-id", "writer",
      "--agent-id", "writer-again",
      "--artifacts-dir", "/runs/run-1/artifacts",
      "--events-dir", "/workspace/events",
    ])).toThrow("usage: runner-completion-contract build");
  });
});
