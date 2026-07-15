import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { branchParseLine, errorHandlerFor, timeoutConfigFor } from "@/lib/runner-v2/routing-contract";
import { runRoutingContractCli } from "@/lib/runner-v2/routing-contract-cli";

function fixtureChain() {
  const root = mkdtempSync(join(tmpdir(), "mentiko-routing-contract-"));
  const chainDir = join(root, "chains");
  const chainPath = join(chainDir, "review", "chain.json");
  mkdirSync(join(chainDir, "review"), { recursive: true });
  writeFileSync(chainPath, JSON.stringify({
    name: "Review", config: { session_prefix: "review" }, routing: { default_timeout: 90, error_handler: "recover", timeout_handler: "timeout-recover" },
    agents: [{ id: "writer", timeout: -1 }, { id: "recover" }, { id: "timeout-recover" }],
  }));
  return { chainDir, chainPath };
}

describe("typed routing contract", () => {
  it("normalizes simple, parallel, fan-out, and conditional branches without shell jq", () => {
    expect(branchParseLine('"writer"')).toBe("simple:writer");
    expect(branchParseLine('["writer","reviewer"]')).toBe("parallel:writer reviewer");
    expect(branchParseLine('{"fan_out":["writer","reviewer"],"fan_in":"merge","wait_for":"quorum","quorum":1,"on_error":"recover"}'))
      .toBe("fanout:writer reviewer|merge|quorum|1|recover");
    expect(branchParseLine('{"conditions":[{"if":"approved","then":"ship"}],"default":"recover"}')).toBe("conditional:recover");
    expect(branchParseLine("{}")).toBe("unknown:");
    expect(() => branchParseLine('{"fan_out":[1]}')).toThrow("fan_out must be an array");
  });

  it("owns error and timeout definition reads behind path-safe primitives", () => {
    const { chainDir, chainPath } = fixtureChain();
    expect(errorHandlerFor(chainPath, chainDir, "writer", "error")).toBe("recover");
    expect(errorHandlerFor(chainPath, chainDir, "writer", "timeout")).toBe("timeout-recover");
    expect(timeoutConfigFor(chainPath, chainDir, "writer")).toEqual({ timeout: 90, sessionPrefix: "review-writer" });
    expect(() => errorHandlerFor(join(chainDir, "..", "outside.json"), chainDir, "writer")).toThrow("escapes configured chains directory");
    const outside = join(chainDir, "..", "outside.json");
    writeFileSync(outside, "{}");
    const linked = join(chainDir, "linked.json");
    symlinkSync(outside, linked);
    expect(() => errorHandlerFor(linked, chainDir, "writer")).toThrow("must not be a symbolic link");
  });

  it("keeps CLI branch output identical to the typed parser", () => {
    const output: string[] = [];
    runRoutingContractCli(["branch-parse", "--branch-json", '["writer","reviewer"]'], (line) => output.push(line));
    expect(output).toEqual(["parallel:writer reviewer"]);
  });
});
