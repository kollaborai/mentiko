import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderChainGraph, runChainGraphCli } from "@/lib/runner-v2/chain-graph-cli";

describe("typed chain graph CLI", () => {
  it("renders validated JSON5 chain data without creating a run", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-chain-graph-"));
    const chainPath = join(root, "chain.json");
    writeFileSync(chainPath, `{
      // JSON5 input is part of the existing graph contract
      name: "review-chain",
      agents: [{ id: "writer", name: "Writer", triggers: ["manual-start"], emits: "draft.ready" }],
    }`);

    expect(renderChainGraph(chainPath)).toEqual(expect.arrayContaining([
      "  chain: review-chain",
      "  [writer] Writer",
      "    triggers: manual-start",
      "    emits:    draft.ready",
    ]));
  });

  it("fails closed on flags instead of routing them to shell execution", () => {
    expect(() => runChainGraphCli(["--dry-run"])).toThrow("usage: mentiko graph <chain.json>");
  });
});
