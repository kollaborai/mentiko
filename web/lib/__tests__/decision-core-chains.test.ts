import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
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

  test("installs the four visible decision core chains idempotently", async () => {
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
      expect(chain.default_agent_profile).toBe("claude-sonnet");
      expect(chain.metadata?.coreDecisionChain).toBe(true);
      expect(chain.agents).toHaveLength(1);
      expect(chain.agents[0].prompt).toContain("mentiko decision import");
      expect(chain.agents[0].prompt).toContain("$ARTIFACTS_DIR/decision-result.json");
    }
  });
});
