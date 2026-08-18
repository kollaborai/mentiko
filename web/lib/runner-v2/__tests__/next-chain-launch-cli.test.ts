import { parseNextChainLaunchArgs } from "@/lib/runner-v2/next-chain-launch";

describe("typed next-chain launch arguments", () => {
  it("requires explicit child provenance and runtime root", () => {
    expect(parseNextChainLaunchArgs([
      "chain.json", "--parent-run-id", "run-parent", "--runs-dir", "/tmp/runs",
    ])).toMatchObject({
      chainPath: expect.stringMatching(/chain\.json$/),
      parentRunId: "run-parent",
      runsDir: "/tmp/runs",
    });
  });

  it("rejects inherited or incomplete shell-style launch input", () => {
    expect(() => parseNextChainLaunchArgs(["chain.json", "--runs-dir", "/tmp/runs"])).toThrow("usage: runner-v2-next-chain");
    expect(() => parseNextChainLaunchArgs(["chain.json", "--parent-run-id", "run-parent", "--runs-dir", "/tmp/runs", "--workspace", "/tmp/work"])).toThrow("unsupported typed next-chain option");
  });
});
