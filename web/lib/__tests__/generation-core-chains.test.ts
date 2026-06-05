import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = join(tmpdir(), `mentiko-core-generation-chains-${process.pid}`);

function resetRoot() {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
}

describe("generation core chains", () => {
  beforeEach(() => {
    jest.resetModules();
    resetRoot();
    jest.doMock("@/lib/config", () => ({
      orgPath: (namespaceId: string, orgId: string, ...segments: string[]) => (
        orgId === "default"
          ? join(root, "namespaces", namespaceId, ...segments)
          : join(root, "namespaces", namespaceId, "orgs", orgId, ...segments)
      ),
    }));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("installs visible generation core chains idempotently", async () => {
    const { ensureGenerationCoreChains, GENERATION_CORE_CHAIN_IDS } = await import("../generation/generation-core-chains");

    const first = ensureGenerationCoreChains("default", "default");
    const second = ensureGenerationCoreChains("default", "default");

    expect(first.map((chain) => chain.id)).toEqual(GENERATION_CORE_CHAIN_IDS);
    expect(second.map((chain) => chain.id)).toEqual(GENERATION_CORE_CHAIN_IDS);
    expect(first.every((chain) => chain.created)).toBe(true);
    expect(second.every((chain) => chain.created)).toBe(false);

    const chainsDir = join(root, "namespaces", "default", "chains");
    expect(readdirSync(chainsDir).sort()).toEqual([...GENERATION_CORE_CHAIN_IDS].sort());

    for (const id of GENERATION_CORE_CHAIN_IDS) {
      const chainPath = join(chainsDir, id, "chain.json");
      expect(existsSync(chainPath)).toBe(true);
      const chain = JSON.parse(readFileSync(chainPath, "utf8"));
      expect(chain.id).toBe(id);
      expect(chain.default_agent_profile).toBeUndefined();
      expect(chain.metadata?.coreGenerationChain).toBe(true);
      expect(chain.agents).toHaveLength(1);
      expect(chain.agents[0].prompt).toContain("mentiko generation import");
      expect(chain.agents[0].prompt).toContain("$ARTIFACTS_DIR/generation-result.json");
      expect(chain.agents[0].prompt).toContain("Inspect relevant repository files");
      expect(chain.agents[0].prompt).not.toContain("Do not inspect repository files");
    }
  });

  test("preserves explicit profile overrides when upgrading generation core chains", async () => {
    const { ensureGenerationCoreChains } = await import("../generation/generation-core-chains");
    const chainDir = join(root, "namespaces", "default", "chains", "task-generation");
    mkdirSync(chainDir, { recursive: true });
    const chainPath = join(chainDir, "chain.json");
    const customizedChain = {
      id: "task-generation",
      name: "Task Generation",
      version: "0.0.1",
      default_agent_profile: "kollab",
      metadata: {
        coreGenerationChain: true,
        generationKind: "task",
      },
      agents: [],
    };
    writeFileSync(chainPath, `${JSON.stringify(customizedChain, null, 2)}\n`, "utf8");

    const result = ensureGenerationCoreChains("default", "default");
    const upgraded = JSON.parse(readFileSync(chainPath, "utf8"));

    expect(result.find((chain) => chain.id === "task-generation")?.created).toBe(true);
    expect(upgraded.version).not.toBe("0.0.1");
    expect(upgraded.default_agent_profile).toBe("kollab");
  });
});
