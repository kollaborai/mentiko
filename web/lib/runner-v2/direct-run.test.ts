import { parseDirectRunArgs } from "@/lib/runner-v2/direct-run";

describe("typed direct run arguments", () => {
  it("accepts only one local initial agent with optional workspace and debug", () => {
    expect(parseDirectRunArgs(["chain.json", "--workspace", "/tmp/work", "--start", "first", "--debug"])).toMatchObject({
      chainPath: expect.stringMatching(/chain\.json$/), workspacePath: "/tmp/work", agentId: "first", debug: true,
    });
  });

  it.each(["--task", "--parallel", "--dry-run"])("rejects legacy shell-only mode %s", (flag) => {
    expect(() => parseDirectRunArgs(["chain.json", flag, "value"])).toThrow("not supported by typed direct run");
  });

  it("rejects missing values, unknown flags, and multiple chain files", () => {
    expect(() => parseDirectRunArgs(["chain.json", "--workspace"])).toThrow("requires a value");
    expect(() => parseDirectRunArgs(["chain.json", "--unknown"])).toThrow("unsupported mentiko run option");
    expect(() => parseDirectRunArgs(["one.json", "two.json"])).toThrow("unexpected positional argument");
  });
});
