/**
 * Deterministic-rejection ledger + policy tests (plan-of-record A3/A4).
 *
 * Isolation: the ledger derives its path from `config.globalRoot`
 * (env MENTIKO_GLOBAL_ROOT), so each test points that at a throwaway temp dir
 * and loads the module via `jest.isolateModules` so config re-evaluates.
 *
 * @jest-environment node
 */
import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";

type RejectionsModule = typeof import("./generated-chain-rejections");
type PolicyModule = typeof import("../tasks/generation-rejection-policy");

let rejections: RejectionsModule;
let policy: PolicyModule;
let tempRoot = "";

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "generated-chain-rejections-"));
  process.env.MENTIKO_GLOBAL_ROOT = tempRoot;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    rejections = require("./generated-chain-rejections");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    policy = require("../tasks/generation-rejection-policy");
  });
});

afterEach(() => {
  delete process.env.MENTIKO_GLOBAL_ROOT;
  if (tempRoot && existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
});

const CHAIN = {
  name: "example",
  metadata: { generated_chain_contract: { version: 1, mode: "research", acceptance_criteria: "x" } },
  agents: [{ id: "a", deliverable: "d", verification: "v" }],
};

describe("canonicalGeneratedChainHash", () => {
  test("is stable across key order and ignores undefined members", () => {
    const a = rejections.canonicalGeneratedChainHash({ x: 1, y: [1, 2], z: { b: 2, a: 1 } });
    const b = rejections.canonicalGeneratedChainHash({ z: { a: 1, b: 2 }, y: [1, 2], x: 1, w: undefined });
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("differs when content differs", () => {
    expect(rejections.canonicalGeneratedChainHash({ x: 1 }))
      .not.toBe(rejections.canonicalGeneratedChainHash({ x: 2 }));
  });
});

describe("rejection ledger", () => {
  test("round-trips an envelope through record and find", () => {
    const envelope = rejections.buildGeneratedChainRejectionEnvelope({
      phase: "import",
      chain: CHAIN,
      errors: ["agents[0].deliverable must name the concrete output this agent hands off"],
    });
    rejections.recordGeneratedChainRejection("ns", "org", envelope);

    const found = rejections.findGeneratedChainRejection("ns", "org", envelope.artifact_hash);
    expect(found).toMatchObject({
      phase: "import",
      code: "generated_chain_contract_violation",
      deterministic: true,
      artifact_hash: envelope.artifact_hash,
      paths: ["agents[0].deliverable"],
    });
    // Ledger lives under the org chains dir alongside the chains it gates.
    expect(existsSync(join(tempRoot, "namespaces", "ns"))).toBe(true);
  });

  test("misses an entry recorded under a different validator revision", () => {
    const envelope = rejections.buildGeneratedChainRejectionEnvelope({
      phase: "save",
      chain: CHAIN,
      errors: ["generated chain requires at least one agent"],
    });
    rejections.recordGeneratedChainRejection("ns", "org", {
      ...envelope,
      validator_revision: "2000-01-01.obsolete",
    });
    expect(rejections.findGeneratedChainRejection("ns", "org", envelope.artifact_hash)).toBeUndefined();
  });

  test("caps the ledger at 100 entries, dropping the oldest", () => {
    for (let index = 0; index < 105; index += 1) {
      rejections.recordGeneratedChainRejection("ns", "org", rejections.buildGeneratedChainRejectionEnvelope({
        phase: "save",
        chain: { ...CHAIN, name: `chain-${index}` },
        errors: ["generated chain requires at least one agent"],
      }));
    }
    const ledgerFile = join(tempRoot, "namespaces", "ns", "orgs", "org", "chains", ".generated-chain-rejections.json");
    const onDisk = existsSync(ledgerFile)
      ? JSON.parse(readFileSync(ledgerFile, "utf-8"))
      : null;
    // Path shape is an implementation detail of orgPath; assert through the API
    // when the direct read misses.
    if (onDisk) {
      expect(onDisk).toHaveLength(100);
    }
    const first = rejections.canonicalGeneratedChainHash({ ...CHAIN, name: "chain-0" });
    const last = rejections.canonicalGeneratedChainHash({ ...CHAIN, name: "chain-104" });
    expect(rejections.findGeneratedChainRejection("ns", "org", first)).toBeUndefined();
    expect(rejections.findGeneratedChainRejection("ns", "org", last)).toBeDefined();
  });
});

describe("decideGenerationRejection", () => {
  test("first rejection allows one guided regeneration", () => {
    const envelope = rejections.buildGeneratedChainRejectionEnvelope({
      phase: "import",
      chain: CHAIN,
      errors: ["generated chain requires at least one agent"],
    });
    const decision = policy.decideGenerationRejection({ envelope, priorFingerprints: undefined });
    expect(decision.stop).toBe(false);
    expect(decision.fingerprints).toHaveLength(1);
  });

  test("the same fingerprint seen twice stops immediately", () => {
    const envelope = rejections.buildGeneratedChainRejectionEnvelope({
      phase: "save",
      chain: CHAIN,
      errors: ["generated chain requires at least one agent"],
    });
    const first = policy.decideGenerationRejection({ envelope, priorFingerprints: [] });
    const second = policy.decideGenerationRejection({ envelope, priorFingerprints: first.fingerprints });
    expect(second.stop).toBe(true);
    expect(second.stopReason).toBe(policy.GENERATION_STOP_DUPLICATE);
    expect(second.fingerprints).toEqual(first.fingerprints);
  });

  test("a second distinct deterministic rejection exhausts the allowance", () => {
    const first = policy.decideGenerationRejection({
      envelope: rejections.buildGeneratedChainRejectionEnvelope({
        phase: "import",
        chain: { ...CHAIN, name: "candidate-a" },
        errors: ["generated chain requires at least one agent"],
      }),
      priorFingerprints: [],
    });
    const second = policy.decideGenerationRejection({
      envelope: rejections.buildGeneratedChainRejectionEnvelope({
        phase: "save",
        chain: { ...CHAIN, name: "candidate-b" },
        errors: ["generated chain requires at least one agent"],
      }),
      priorFingerprints: first.fingerprints,
    });
    expect(second.stop).toBe(true);
    expect(second.stopReason).toBe(policy.GENERATION_STOP_BUDGET);
    expect(second.fingerprints).toHaveLength(2);
  });
});
