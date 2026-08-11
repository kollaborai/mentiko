/**
 * Repair-before-reject at the acceptance boundary (stall-killer spec v2, C1).
 *
 * The bar is the TASK-007 evidence itself: the two exact generation artifacts
 * that parked the task ~24h must be ACCEPTED, and the repair must be recorded
 * (authored hash, effective hash, repair list) rather than applied silently.
 *
 * The end-to-end door test (/api/jobs/[id]/complete -> auto-run -> save) lives
 * in app/api/jobs/[id]/complete/route.task-007.test.ts — the spec is explicit
 * that helper-level tests alone are insufficient.
 *
 * @jest-environment node
 */
import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { join } from "path";
import { tmpdir } from "os";
import { mkdirSync, mkdtempSync, rmSync, existsSync, writeFileSync } from "fs";
import {
  TASK_007_DANGLING_BRANCH_ARTIFACT,
  TASK_007_SEMVER_ARTIFACT,
} from "./__fixtures__/task-007-generation-artifacts";
import { sanitizeGeneratedChain } from "./generated-chain-sanitizer";

type AcceptanceModule = typeof import("./generated-chain-acceptance");
type RejectionsModule = typeof import("./generated-chain-rejections");

let acceptance: AcceptanceModule;
let rejections: RejectionsModule;
let tempRoot = "";

/**
 * The dangling-branch artifact carries `$ref: "pattern-analyzer"`, which
 * resolves from the registry in the live namespace. Seed the equivalent record
 * so the fixture is exercised as its own door saw it.
 */
function seedRegistryAgent(id: string): void {
  const dir = join(tempRoot, "namespaces", "ns", "orgs", "org", "agents", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "agent.json"), JSON.stringify({
    id,
    name: "Pattern Analyzer",
    version: "1.0.0",
    role: "Analyzes usage patterns",
    prompt: "Analyze the discovered hook consumers for usage patterns. {TASK}",
    triggers: ["hook-consumers-found"],
    emits: "patterns-analyzed",
    deliverable: "a pattern analysis",
    verification: "re-read the analysis",
  }, null, 2));
}

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "generated-chain-repair-"));
  process.env.MENTIKO_GLOBAL_ROOT = tempRoot;
  seedRegistryAgent("pattern-analyzer");
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    acceptance = require("./generated-chain-acceptance");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    rejections = require("./generated-chain-rejections");
  });
});

afterEach(() => {
  delete process.env.MENTIKO_GLOBAL_ROOT;
  if (tempRoot && existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
});

const accept = (chain: Record<string, unknown>) =>
  acceptance.acceptGeneratedChain({ chain, namespaceId: "ns", orgId: "org", phase: "import" });

describe("C1 — the TASK-007 artifacts import clean", () => {
  test("two-part version is padded, not rejected", () => {
    const accepted = accept(TASK_007_SEMVER_ARTIFACT);

    expect(accepted.manifestChain.version).toBe("1.0.0");
    expect(accepted.repairs).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "version_normalized", path: "version" })]),
    );
    // The authored bytes are preserved untouched next to what was validated.
    expect(TASK_007_SEMVER_ARTIFACT.version).toBe("1.0");
    expect(accepted.authoredHash).not.toBe(accepted.effectiveHash);
  });

  test("dangling branch is pruned, not rejected, and the rest of the topology survives", () => {
    const authoredBranches = Object.keys(
      TASK_007_DANGLING_BRANCH_ARTIFACT.branches as Record<string, unknown>,
    );
    const accepted = accept(TASK_007_DANGLING_BRANCH_ARTIFACT);

    const branches = (accepted.manifestChain.branches ?? {}) as Record<string, unknown>;
    expect(Object.keys(branches)).not.toContain("context-validation-failed");
    expect(accepted.repairs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "branch_pruned", path: "branches.context-validation-failed" }),
      ]),
    );
    // Prune-only: every other authored branch is still there, unaltered.
    for (const key of authoredBranches) {
      if (key === "context-validation-failed") continue;
      expect(branches[key]).toEqual((TASK_007_DANGLING_BRANCH_ARTIFACT.branches as Record<string, unknown>)[key]);
    }
  });

  test("a stale pre-repair ledger entry cannot re-reject a repairable artifact", () => {
    // What actually happened: the raw payload was hashed and recorded before
    // any repair, so every later door agreed with that verdict forever.
    rejections.recordGeneratedChainRejection("ns", "org", {
      phase: "import",
      code: "generated_chain_contract_violation",
      deterministic: true,
      artifact_hash: rejections.canonicalGeneratedChainHash(TASK_007_SEMVER_ARTIFACT),
      validator_revision: "2026-07-31.v0349",
      contract_version: 1,
      paths: [],
      message: "version: must be in semver format (e.g., 1.0.0)",
      at: new Date().toISOString(),
    });

    expect(() => accept(TASK_007_SEMVER_ARTIFACT)).not.toThrow();
  });
});

describe("C1 — repair stays deterministic and non-semantic", () => {
  test("a genuinely invalid chain still rejects after repair, with the evidence attached", () => {
    // No agents at all: nothing the repair pass can invent.
    const broken = { ...TASK_007_SEMVER_ARTIFACT, agents: [] };

    let thrown: unknown;
    try {
      accept(broken);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(acceptance.GeneratedChainRejectedError);
    const envelope = (thrown as InstanceType<AcceptanceModule["GeneratedChainRejectedError"]>).envelope;
    expect(envelope.authored_hash).toBe(rejections.canonicalGeneratedChainHash(broken));
    expect(envelope.artifact_hash).not.toBe(envelope.authored_hash); // version was repaired
    expect(envelope.repairs).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "version_normalized" })]),
    );
  });

  test("branch repair never re-points a dangling branch at a nearest event", () => {
    const { chain, repairs } = sanitizeGeneratedChain({
      name: "c",
      version: "1.0.0",
      description: "d",
      config: {},
      agents: [{ id: "a", triggers: ["chain_start"], emits: "a_done" }],
      branches: { nowhere: "a", a_done: "a" },
    });

    expect(chain.branches).toEqual({ a_done: "a" });
    expect(repairs.map((r) => r.action)).toEqual(["branch_pruned"]);
  });

  test("a $ref agent never gets synthesized triggers/emits", () => {
    // triggers/emits on a $ref entry are OVERRIDES of the registry record.
    // Synthesizing one would silently replace the agent's real wiring.
    const { chain, repairs } = sanitizeGeneratedChain({
      name: "c",
      version: "1.0.0",
      description: "d",
      config: {},
      agents: [{ $ref: "some-registered-agent-v5" }],
    });

    expect(chain.agents).toEqual([{ $ref: "some-registered-agent-v5" }]);
    expect(repairs).toEqual([]);
  });

  test("repair is idempotent — accepting a repaired chain changes nothing", () => {
    const once = sanitizeGeneratedChain(TASK_007_DANGLING_BRANCH_ARTIFACT);
    const twice = sanitizeGeneratedChain(once.chain);

    expect(twice.repairs).toEqual([]);
    expect(twice.chain).toEqual(once.chain);
  });
});
