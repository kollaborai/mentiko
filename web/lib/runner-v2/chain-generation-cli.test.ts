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
  agents: [
    {
      id: "writer",
      name: "Writer",
      triggers: ["manual-start"],
      emits: "draft-ready",
      prompt: "Write a draft",
    },
    {
      id: "reviewer",
      name: "Reviewer",
      triggers: ["draft-ready"],
      emits: "approved",
      spec: "specs/reviewer.md",
      role: "Review the draft",
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

  it("fails closed when no configured external CLI exists", () => {
    expect(() => generateChain(
      { prompt: "test", outputDir: tempRoot(), jsonOutput: false, rawOutput: false },
      { runExternalCli: () => JSON.stringify(validChain) },
      { ...process.env, DEFAULT_CLI: undefined },
    )).toThrow("DEFAULT_CLI is required");
  });
});
