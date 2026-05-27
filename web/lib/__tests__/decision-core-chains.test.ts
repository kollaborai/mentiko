import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = join(tmpdir(), `mentiko-core-decision-chains-${process.pid}`);

function resetRoot() {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
}

describe("decision core chains", () => {
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

  test("installs the decision core chains idempotently", async () => {
    const { ensureDecisionCoreChains, DECISION_CORE_CHAIN_IDS } = await import("../decision-core-chains");

    const first = ensureDecisionCoreChains("default", "default");
    const second = ensureDecisionCoreChains("default", "default");

    expect(first.map((chain) => chain.id)).toEqual(DECISION_CORE_CHAIN_IDS);
    expect(second.map((chain) => chain.id)).toEqual(DECISION_CORE_CHAIN_IDS);
    expect(first.every((chain) => chain.created)).toBe(true);
    expect(second.every((chain) => chain.created)).toBe(false);

    const chainsDir = join(root, "namespaces", "default", "chains");
    expect(readdirSync(chainsDir).sort()).toEqual([...DECISION_CORE_CHAIN_IDS].sort());

    for (const id of DECISION_CORE_CHAIN_IDS) {
      const chainPath = join(chainsDir, id, "chain.json");
      expect(existsSync(chainPath)).toBe(true);
      const chain = JSON.parse(readFileSync(chainPath, "utf8"));
      expect(chain.id).toBe(id);
      expect(chain.default_agent_profile).toBeUndefined();
      expect(chain.metadata?.coreDecisionChain).toBe(true);
      expect(chain.agents).toHaveLength(1);
      expect(chain.agents[0].prompt).toContain("mentiko decision import");
      expect(chain.agents[0].prompt).toContain("$ARTIFACTS_DIR/decision-result.json");
    }
  });

  test("preserves any existing profile override when upgrading old core chains", async () => {
    const { ensureDecisionCoreChains } = await import("../decision-core-chains");
    const chainDir = join(root, "namespaces", "default", "chains", "decision-research");
    mkdirSync(chainDir, { recursive: true });
    const chainPath = join(chainDir, "chain.json");
    const oldChain = {
      id: "decision-research",
      name: "Decision Research",
      version: "1.0.1",
      default_agent_profile: "user-selected-profile",
      metadata: {
        coreDecisionChain: true,
        decisionPhase: "research",
      },
      agents: [],
    };
    writeFileSync(chainPath, `${JSON.stringify(oldChain, null, 2)}\n`, "utf8");

    const result = ensureDecisionCoreChains("default", "default");
    const upgraded = JSON.parse(readFileSync(chainPath, "utf8"));

    expect(result.find((chain) => chain.id === "decision-research")?.created).toBe(true);
    expect(upgraded.version).not.toBe("1.0.1");
    expect(upgraded.default_agent_profile).toBe("user-selected-profile");
  });

  test("preserves explicit profile overrides when upgrading core chains", async () => {
    const { ensureDecisionCoreChains } = await import("../decision-core-chains");
    const chainDir = join(root, "namespaces", "default", "chains", "decision-research");
    mkdirSync(chainDir, { recursive: true });
    const chainPath = join(chainDir, "chain.json");
    const customizedChain = {
      id: "decision-research",
      name: "Decision Research",
      version: "1.0.1",
      default_agent_profile: "codex-default",
      metadata: {
        coreDecisionChain: true,
        decisionPhase: "research",
      },
      agents: [],
    };
    writeFileSync(chainPath, `${JSON.stringify(customizedChain, null, 2)}\n`, "utf8");

    const result = ensureDecisionCoreChains("default", "default");
    const upgraded = JSON.parse(readFileSync(chainPath, "utf8"));

    expect(result.find((chain) => chain.id === "decision-research")?.created).toBe(true);
    expect(upgraded.version).not.toBe("1.0.1");
    expect(upgraded.default_agent_profile).toBe("codex-default");
  });

  test("does not rewrite current core chains just because a user changed the profile", async () => {
    const { ensureDecisionCoreChains } = await import("../decision-core-chains");
    ensureDecisionCoreChains("default", "default");
    const chainPath = join(root, "namespaces", "default", "chains", "decision-research", "chain.json");
    const customizedChain = JSON.parse(readFileSync(chainPath, "utf8"));
    customizedChain.default_agent_profile = "codex-default";
    writeFileSync(chainPath, `${JSON.stringify(customizedChain, null, 2)}\n`, "utf8");

    const result = ensureDecisionCoreChains("default", "default");
    const reloaded = JSON.parse(readFileSync(chainPath, "utf8"));

    expect(result.find((chain) => chain.id === "decision-research")?.created).toBe(false);
    expect(reloaded.default_agent_profile).toBe("codex-default");
  });

  test("updates a core chain profile without replacing user edits", async () => {
    const { ensureDecisionCoreChains, updateDecisionCoreChainProfile } = await import("../decision-core-chains");
    ensureDecisionCoreChains("default", "default");
    const chainPath = join(root, "namespaces", "default", "chains", "decision-research", "chain.json");
    const customizedChain = JSON.parse(readFileSync(chainPath, "utf8"));
    customizedChain.agents[0].prompt = "custom prompt";
    writeFileSync(chainPath, `${JSON.stringify(customizedChain, null, 2)}\n`, "utf8");

    updateDecisionCoreChainProfile("default", "default", "decision-research", "codex-default");
    const reloaded = JSON.parse(readFileSync(chainPath, "utf8"));

    expect(reloaded.default_agent_profile).toBe("codex-default");
    expect(reloaded.agents[0].prompt).toBe("custom prompt");
  });

  test("restores a core chain back to factory defaults", async () => {
    const { ensureDecisionCoreChains, restoreDecisionCoreChain } = await import("../decision-core-chains");
    ensureDecisionCoreChains("default", "default");
    const chainPath = join(root, "namespaces", "default", "chains", "decision-research", "chain.json");
    const customizedChain = JSON.parse(readFileSync(chainPath, "utf8"));
    customizedChain.default_agent_profile = "codex-default";
    customizedChain.agents[0].prompt = "custom prompt";
    writeFileSync(chainPath, `${JSON.stringify(customizedChain, null, 2)}\n`, "utf8");

    restoreDecisionCoreChain("default", "default", "decision-research");
    const restored = JSON.parse(readFileSync(chainPath, "utf8"));

    expect(restored.default_agent_profile).toBeUndefined();
    expect(restored.agents[0].prompt).toContain("You are the Mentiko core decision research agent.");
    expect(restored.agents[0].prompt).toContain("mentiko decision import");
  });
});
