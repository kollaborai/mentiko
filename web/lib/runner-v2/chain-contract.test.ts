import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadNormalizedChainDefinition,
  resolveChainRuntimeConfig,
} from "@/lib/runner-v2/chain-contract";

function fixture(): { root: string; chainPath: string; agentsDir: string; profilesDir: string } {
  const root = mkdtempSync(join(tmpdir(), "mentiko-chain-contract-"));
  const agentsDir = join(root, "agents");
  const profilesDir = join(root, "config-profiles");
  mkdirSync(join(agentsDir, "writer"), { recursive: true });
  mkdirSync(join(profilesDir, "execution"), { recursive: true });
  writeFileSync(join(agentsDir, "writer", "agent.json"), JSON.stringify({ id: "writer", name: "Writer", prompt: "write", triggers: ["manual-start"], emits: "written" }));
  writeFileSync(join(profilesDir, "execution", "fast.json"), JSON.stringify({ data: { executor: "codex", monitor: false, max_rounds: 4 } }));
  const chainPath = join(root, "chain.json");
  return { root, chainPath, agentsDir, profilesDir };
}

describe("runner chain contract", () => {
  it("normalizes catalog refs and applies typed config profiles", () => {
    const { chainPath, agentsDir, profilesDir } = fixture();
    writeFileSync(chainPath, JSON.stringify({ name: "test", config: { monitor: true }, profiles: { execution: "fast" }, agents: [{ $ref: "writer" }] }));
    const chain = loadNormalizedChainDefinition(chainPath, agentsDir);
    expect(chain.agents[0]).toEqual(expect.objectContaining({ id: "writer", name: "Writer" }));
    expect(resolveChainRuntimeConfig(chain, profilesDir)).toEqual(expect.objectContaining({ cli: "codex", monitor: "false", max_rounds: "4" }));
  });

  it("rejects a self-referential fan-in before a shell runner can launch it", () => {
    const { chainPath, agentsDir } = fixture();
    writeFileSync(chainPath, JSON.stringify({
      name: "invalid", agents: [{ $ref: "writer" }],
      branches: { written: { fan_out: ["writer"], fan_in: "writer", wait_for: "all" } },
    }));
    expect(() => loadNormalizedChainDefinition(chainPath, agentsDir)).toThrow("branches.written: fan_in must not also appear in fan_out");
  });
});
