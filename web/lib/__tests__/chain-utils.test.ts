import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildChainSummary, loadChain } from "../chains/chain-utils";

const root = join(tmpdir(), `mentiko-chain-utils-${process.pid}`);

jest.mock("../agents/agent-loader", () => ({
  resolveChainAgents: (agents: unknown[]) => agents,
}));

describe("chain utils", () => {
  beforeEach(() => {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("preserves the chain default agent profile for list/detail parity", () => {
    const chainPath = join(root, "chain.json");
    writeFileSync(chainPath, JSON.stringify({
      id: "profiled-chain",
      name: "Profiled Chain",
      description: "has a chain override",
      version: "1.0.0",
      default_agent_profile: "profile-a",
      agents: [],
    }, null, 2));

    const chain = loadChain(chainPath, "profiled-chain", "mentiko");

    expect(chain?.default_agent_profile).toBe("profile-a");
  });

  it("preserves chain metadata for catalog filtering", () => {
    const chainPath = join(root, "chain.json");
    writeFileSync(chainPath, JSON.stringify({
      id: "system-chain",
      name: "System Chain",
      description: "managed by the app",
      version: "1.0.0",
      metadata: {
        coreGenerationChain: true,
        generationKind: "task",
      },
      agents: [],
    }, null, 2));

    const chain = loadChain(chainPath, "system-chain", "mentiko");

    expect(chain?.metadata).toEqual({
      coreGenerationChain: true,
      generationKind: "task",
    });
  });

  it("omits agent prompt hints from chain summaries", () => {
    const summary = buildChainSummary([
      {
        id: "smoke-chain",
        name: "Smoke Chain",
        description: "Creates artifacts",
        version: "1.0.0",
        agentCount: 1,
        cli: "mentiko",
        monitor: true,
        agents: [
          {
            id: "artifact-writer",
            name: "Artifact Writer",
            role: "writer",
            triggers: ["chain_start"],
            emits: "artifact-written",
            prompt: "Create cli-agnostic-pointer-proof.json and verify the exact artifact name.",
            artifacts: {
              produces: [
                {
                  id: "cli-agnostic-pointer-proof.json",
                  type: "json",
                  description: "Exact smoke proof artifact",
                },
              ],
            },
          },
        ],
      },
    ]);

    expect(summary).toContain("triggers: chain_start");
    expect(summary).toContain("emits: artifact-written");
    expect(summary).toContain("artifacts:");
    expect(summary).not.toContain("prompt_hint:");
    expect(summary).not.toContain("Create cli-agnostic-pointer-proof.json");
    expect(summary).toContain("cli-agnostic-pointer-proof.json");
  });
});
