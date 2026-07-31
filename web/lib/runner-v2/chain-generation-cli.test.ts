import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractGeneratedJson,
  generateChain,
  validateGeneratedChain,
} from "@/lib/runner-v2/chain-generation-cli";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "mentiko-chain-generation-"));
}

const validChain = {
  name: "generated-demo",
  description: "generated chain",
  metadata: {
    generated_chain_contract: {
      version: 1,
      mode: "delivery",
      acceptance_criteria: "Given a draft is requested, when the verifier checks it, then the approved draft exists and meets the brief.",
    },
  },
  agents: [
    {
      id: "writer",
      name: "Writer",
      triggers: ["manual-start"],
      emits: "draft-ready",
      prompt: "Write a draft",
      authorities: { can: ["edit_files"], needs_approval: [] },
      deliverable: "The requested draft in the workspace",
      verification: "Read the saved draft and compare it to the brief.",
    },
    {
      id: "reviewer",
      name: "Reviewer",
      triggers: ["draft-ready"],
      emits: "approved",
      spec: "specs/reviewer.md",
      role: "Review the draft",
      deliverable: "A verdict with evidence against the brief",
      verification: "Inspect the draft and compare every acceptance condition.",
      final_verifier: true,
      verifies_acceptance_criteria: true,
      success_assertion: "The draft exists and satisfies every acceptance condition.",
    },
  ],
  config: { session_prefix: "demo" },
};

describe("typed chain generation contract", () => {
  it("decodes nested JSON from model prose and preserves the object", () => {
    expect(extractGeneratedJson(`Here is the chain:\n${JSON.stringify(validChain)}\n`)).toEqual(validChain);
  });

  it("validates normalized fields and materializes chain and spec files", () => {
    const root = tempRoot();
    const outputDir = join(root, "output");
    const templatePath = join(root, "template.json");
    writeFileSync(templatePath, "{\"name\":\"template\"}\n");
    let receivedPrompt = "";

    const result = generateChain(
      {
        prompt: "make a review chain",
        outputDir,
        templateFile: templatePath,
        jsonOutput: false,
        rawOutput: false,
      },
      {
        runExternalCli: (_cli, prompt) => {
          receivedPrompt = prompt;
          return JSON.stringify(validChain);
        },
      },
      { ...process.env, DEFAULT_CLI: "test-cli" },
    );

    expect(result.chainPath).toBe(join(outputDir, "chain.json"));
    expect(JSON.parse(readFileSync(result.chainPath, "utf8"))).toEqual(validChain);
    expect(readFileSync(join(outputDir, "specs/reviewer.md"), "utf8")).toContain("# Reviewer");
    expect(receivedPrompt).toContain("make a review chain");
    expect(receivedPrompt).toContain("REFERENCE TEMPLATE");
    expect(receivedPrompt).toContain('"delivery"|"operations"|"research"');
    expect(receivedPrompt).toContain("never persist current task IDs");
    expect(receivedPrompt).toContain("TASK_LINKED_CHAIN_RUNTIME");
    expect(receivedPrompt).toContain("metadata.last_run_id/task_run_scope identify the active run");
  });

  it("accepts an operations-mode chain with run_commands and no fake edit_files step", () => {
    expect(validateGeneratedChain({
      name: "managed-state-operation",
      metadata: {
        generated_chain_contract: {
          version: 1,
          mode: "operations",
          acceptance_criteria: "the requested state postcondition is true",
        },
      },
      agents: [{
        id: "state-mutator",
        name: "State Mutator",
        triggers: ["manual-start"],
        emits: "state-mutated",
        deliverable: "the requested state mutation",
        verification: "read the state back",
        authorities: { can: ["run_commands"] },
        final_verifier: true,
        verifies_acceptance_criteria: true,
        success_assertion: "the read-back proves the requested postcondition",
      }],
    })).toMatchObject({ name: "managed-state-operation" });
  });

  it("rejects missing fields, duplicate ids, and symlinked output", () => {
    expect(() => validateGeneratedChain({ name: "broken", agents: [] })).toThrow("at least 1 agent");
    expect(() => validateGeneratedChain({
      name: "broken",
      agents: [
        { id: "a", name: "A", triggers: [], emits: "done" },
        { id: "a", name: "A2", triggers: [], emits: "done2" },
      ],
    })).toThrow("duplicate agent id");

    const root = tempRoot();
    const realOutput = join(root, "real-output");
    const linkedOutput = join(root, "linked-output");
    mkdirSync(realOutput);
    symlinkSync(realOutput, linkedOutput);
    expect(() => generateChain(
      { prompt: "test", outputDir: linkedOutput, jsonOutput: false, rawOutput: false },
      { runExternalCli: () => JSON.stringify(validChain) },
      { ...process.env, DEFAULT_CLI: "test-cli" },
    )).toThrow("non-symlink directory");
  });

  it("rejects activity-only generated chains without a verifier contract", () => {
    expect(() => validateGeneratedChain({
      name: "activity-only",
      agents: [{ id: "observer", name: "Observer", triggers: ["manual-start"], emits: "observed" }],
    })).toThrow(/generated chain delivery contract invalid/);
  });

  // 2026-07-31 incident (chain-contract-plan-of-record.md A2): prose never
  // blocks. The standalone boundary keeps prompt guidance advisory and rejects
  // only structural invalidity.
  it("accepts lifecycle-flavored prose at the typed standalone generation boundary", () => {
    expect(() => validateGeneratedChain({
      ...validChain,
      agents: validChain.agents.map((agent, index) => index === 0
        ? { ...agent, prompt: "Require the linked task status to equal open before emitting." }
        : agent),
    })).not.toThrow();
  });

  // Regression: TASK-203 follow-up (2026-07-23). This generator is standalone --
  // no namespace, no org, no agent registry (grep: zero agent-loader imports) --
  // and it validates the raw parsed model JSON with no resolution step. The
  // --template flag injects an arbitrary chain.json verbatim as "REFERENCE
  // TEMPLATE", so pointing it at a real platform chain (where $ref is the normal
  // reuse shorthand) would teach the model to emit references this path can
  // never resolve, reproducing the exact false rejection fixed at the web
  // import boundary. The prompt has to rule $ref out here.
  it("tells the model to emit inline agents because this path cannot resolve a $ref", () => {
    let receivedPrompt = "";
    const root = tempRoot();
    const templatePath = join(root, "reference-chain.json");
    // a reference template that itself uses the platform's $ref shorthand
    writeFileSync(templatePath, JSON.stringify({
      name: "existing-chain",
      agents: [{ $ref: "some-registry-agent" }],
    }));

    generateChain(
      { prompt: "make a chain", outputDir: join(root, "out"), templateFile: templatePath, jsonOutput: false, rawOutput: false },
      {
        runExternalCli: (_cli, prompt) => {
          receivedPrompt = prompt;
          return JSON.stringify(validChain);
        },
      },
      { ...process.env, DEFAULT_CLI: "test-cli" },
    );

    expect(receivedPrompt).toContain('Never emit a {"$ref": "agent-id"} catalog reference here');
    expect(receivedPrompt).toContain("no agent registry to resolve a $ref against");
    // The rejection it would otherwise hit is real, and in this path it lands
    // even earlier than the delivery contract: the CLI's own field check fires
    // first, so the model gets "agent unnamed is missing required fields" with
    // no hint that a $ref was the problem. All the more reason the prompt has
    // to rule it out up front.
    expect(() => validateGeneratedChain({
      name: "ref-chain",
      metadata: { generated_chain_contract: { version: 1, mode: "delivery", acceptance_criteria: "x" } },
      agents: [{ $ref: "some-registry-agent" }],
    })).toThrow("agent unnamed is missing required fields (id, name, triggers, emits)");
  });

  it("fails closed when no configured external CLI exists", () => {
    expect(() => generateChain(
      { prompt: "test", outputDir: tempRoot(), jsonOutput: false, rawOutput: false },
      { runExternalCli: () => JSON.stringify(validChain) },
      { ...process.env, DEFAULT_CLI: undefined },
    )).toThrow("DEFAULT_CLI is required");
  });
});
