/**
 * Acceptance-service tests (plan-of-record B3/B4/B5/B8) against a REAL
 * throwaway filesystem root: registry commits happen only after validation,
 * rejections leave the registry untouched, the ledger answers duplicates,
 * the semantic circuit breaker demotes typed lifecycle rules to warnings,
 * and the accepted manifest binds run start to the accepted bytes.
 *
 * @jest-environment node
 */
import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from "fs";

type AcceptanceModule = typeof import("./generated-chain-acceptance");
type SettingsModule = typeof import("../system/system-settings");

let acceptance: AcceptanceModule;
let settings: SettingsModule;
let tempRoot = "";

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "generated-chain-acceptance-"));
  process.env.MENTIKO_GLOBAL_ROOT = tempRoot;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    acceptance = require("./generated-chain-acceptance");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    settings = require("../system/system-settings");
  });
});

afterEach(() => {
  delete process.env.MENTIKO_GLOBAL_ROOT;
  if (tempRoot && existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
});

const agentsDir = () => join(tempRoot, "namespaces", "ns", "orgs", "org", "agents");

const inlineAgent = (extra: Record<string, unknown> = {}) => ({
  id: "runtime-verifier",
  name: "Runtime Verifier",
  prompt: "Verify the runtime evidence.",
  triggers: ["manual-start"],
  emits: "runtime-verified",
  deliverable: "an evidence-backed verdict",
  verification: "re-read the evidence",
  final_verifier: true,
  verifies_acceptance_criteria: true,
  success_assertion: "evidence recorded",
  ...extra,
});

const generatedChain = (overrides: Record<string, unknown> = {}) => ({
  name: "acceptance-example",
  version: "1.0.0",
  description: "example",
  config: {},
  metadata: {
    generated_chain_contract: {
      version: 1,
      mode: "research",
      acceptance_criteria: "runtime evidence exists",
    },
  },
  agents: [inlineAgent()],
  ...overrides,
});

describe("acceptGeneratedChain", () => {
  test("accepts a valid chain, commits registry writes, and returns a digest", () => {
    const accepted = acceptance.acceptGeneratedChain({
      chain: generatedChain(),
      namespaceId: "ns",
      orgId: "org",
      phase: "import",
    });

    expect(accepted.digest).toMatch(/^sha256:/);
    expect(accepted.contractVersion).toBe(1);
    expect(accepted.createdAgents).toEqual([{ id: "runtime-verifier", name: "Runtime Verifier" }]);
    expect(accepted.warnings).toEqual([]);
    // materialized chain is $ref-rewritten and the registry write landed
    expect((accepted.manifestChain.agents as Array<Record<string, unknown>>)[0].$ref).toBe("runtime-verifier");
    expect(existsSync(join(agentsDir(), "runtime-verifier", "agent.json"))).toBe(true);
  });

  test("a rejected chain leaves the registry untouched (pure materialization)", () => {
    const invalid = generatedChain({
      agents: [inlineAgent({ final_verifier: undefined })],
    });
    expect(() => acceptance.acceptGeneratedChain({
      chain: invalid,
      namespaceId: "ns",
      orgId: "org",
      phase: "import",
    })).toThrow(acceptance.GeneratedChainRejectedError);

    expect(existsSync(agentsDir()) ? readdirSync(agentsDir()) : []).toEqual([]);
  });

  test("an identical rejected candidate is answered from the ledger as a duplicate", () => {
    const invalid = generatedChain({ agents: [inlineAgent({ final_verifier: undefined })] });
    const first = (() => {
      try {
        acceptance.acceptGeneratedChain({ chain: invalid, namespaceId: "ns", orgId: "org", phase: "import" });
        throw new Error("expected rejection");
      } catch (error) {
        return error as InstanceType<AcceptanceModule["GeneratedChainRejectedError"]>;
      }
    })();
    expect(first.duplicate).toBe(false);

    try {
      acceptance.acceptGeneratedChain({ chain: invalid, namespaceId: "ns", orgId: "org", phase: "save" });
      throw new Error("expected duplicate rejection");
    } catch (error) {
      const second = error as InstanceType<AcceptanceModule["GeneratedChainRejectedError"]>;
      expect(second.duplicate).toBe(true);
      expect(second.envelope.phase).toBe("save");
      expect(second.envelope.artifact_hash).toBe(first.envelope.artifact_hash);
    }
  });

  test("typed lifecycle violations block in enforce mode and demote to warnings under the override", () => {
    const v2Chain = generatedChain({
      metadata: {
        generated_chain_contract: {
          version: 2,
          mode: "research",
          acceptance_criteria: "runtime evidence exists",
          lifecycle_checks: [{
            subject: "current_run",
            phase: "in_run",
            owner: "agent",
            assert: { status: "completed" },
          }],
        },
      },
    });

    expect(() => acceptance.acceptGeneratedChain({
      chain: v2Chain,
      namespaceId: "ns",
      orgId: "org",
      phase: "import",
    })).toThrow(/must not assert terminal status/);

    // admin circuit breaker: rule-scoped warn mode
    settings.writeSystemSettings({
      ...settings.readSystemSettings("ns"),
      semantic_policy: { mode: "warn", rule_ids: ["lifecycle-self-terminal"], reason: "incident drill" },
    }, "ns");

    // the previous rejection is in the ledger — a demotion is a NEW policy
    // decision, so vary the candidate to avoid the duplicate answer
    const varied = { ...v2Chain, description: "post-override attempt" };
    const accepted = acceptance.acceptGeneratedChain({
      chain: varied,
      namespaceId: "ns",
      orgId: "org",
      phase: "import",
    });
    expect(accepted.warnings).toEqual([
      expect.objectContaining({ rule: "lifecycle-self-terminal", demoted_by_policy: true }),
    ]);
  });

  test("structural failures never demote: warn mode cannot bypass a missing verifier", () => {
    settings.writeSystemSettings({
      ...settings.readSystemSettings("ns"),
      semantic_policy: { mode: "warn", reason: "drill" },
    }, "ns");
    expect(() => acceptance.acceptGeneratedChain({
      chain: generatedChain({ agents: [inlineAgent({ final_verifier: undefined })] }),
      namespaceId: "ns",
      orgId: "org",
      phase: "save",
    })).toThrow(/final_verifier/);
  });
});

describe("accepted manifest (B5)", () => {
  test("persists on save and verifies accepted vs drifted vs none", () => {
    const accepted = acceptance.acceptGeneratedChain({
      chain: generatedChain(),
      namespaceId: "ns",
      orgId: "org",
      phase: "save",
      persistManifestForChainId: "acceptance-example",
    });

    const verification = acceptance.verifyAcceptedManifest(
      "ns",
      "org",
      "acceptance-example",
      accepted.manifestChain,
    );
    expect(verification.state).toBe("accepted");

    const resolvedAgent = JSON.parse(
      readFileSync(join(agentsDir(), "runtime-verifier", "agent.json"), "utf8"),
    );
    const resolvedReadModel = {
      ...accepted.manifestChain,
      id: "acceptance-example",
      agents: [resolvedAgent],
    };
    expect(acceptance.verifyAcceptedManifest(
      "ns",
      "org",
      "acceptance-example",
      resolvedReadModel,
    ).state).toBe("accepted");

    const drifted = acceptance.verifyAcceptedManifest(
      "ns",
      "org",
      "acceptance-example",
      { ...accepted.manifestChain, description: "edited after acceptance" },
    );
    expect(drifted.state).toBe("drifted");

    const editedResolvedReadModel = {
      ...resolvedReadModel,
      agents: [{ ...resolvedAgent, prompt: "edited after acceptance" }],
    };
    expect(acceptance.verifyAcceptedManifest(
      "ns",
      "org",
      "acceptance-example",
      editedResolvedReadModel,
    ).state).toBe("drifted");

    expect(acceptance.verifyAcceptedManifest("ns", "org", "never-accepted", accepted.manifestChain).state)
      .toBe("none");
    // manual chains (no generated contract) never consult the manifest
    expect(acceptance.verifyAcceptedManifest("ns", "org", "acceptance-example", { name: "manual" }).state)
      .toBe("none");
  });
});
