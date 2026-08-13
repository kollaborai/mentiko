import {
  CLI_TOOLS,
  COMMON_PRESETS,
  DEFAULT_MARKETPLACE_AGENT_MODEL,
  getAgentConfigOptionsForTool,
  getAllBundleProfiles,
  getCliBinary,
  getCliTool,
  getDefaultAgentConfigIdForTool,
  getEngineProviderDefault,
  getTerminalAuthCommand,
} from "@/lib/agents/agent-provider-catalog";
import { getModelPricing } from "@/lib/system/token-store";

describe("agent provider catalog", () => {
  it("keeps cli tools free of raw model ownership", () => {
    for (const tool of CLI_TOOLS) {
      expect(tool).not.toHaveProperty("models");
      expect(tool).not.toHaveProperty("defaultModel");
    }
  });

  it("serves bundled profile options from the catalog instead of stale ui lists", () => {
    expect(getDefaultAgentConfigIdForTool("codex")).toBe("codex-default");
    expect(getAgentConfigOptionsForTool("codex")).toEqual([
      { id: "codex-default", name: "Codex / GPT-5.6 Sol" },
      { id: "codex-terra", name: "Codex / GPT-5.6 Terra" },
      { id: "codex-fast", name: "Codex / GPT-5.6 Luna" },
    ]);
    expect(getAgentConfigOptionsForTool("opencode")).toEqual([
      { id: "opencode-sonnet", name: "OpenCode / Sonnet 4.6" },
      { id: "opencode-gpt", name: "OpenCode / GPT-5.6 Sol" },
      { id: "opencode-gpt-terra", name: "OpenCode / GPT-5.6 Terra" },
      { id: "opencode-gpt-luna", name: "OpenCode / GPT-5.6 Luna" },
    ]);
  });

  it("replaces the removed Gemini CLI surface with Antigravity CLI", () => {
    expect(getCliTool("gemini")).toBeUndefined();
    expect(CLI_TOOLS.some((tool) => tool.id === "gemini" || tool.cli === "gemini")).toBe(false);
    expect(CLI_TOOLS.some((tool) => tool.name === "Gemini CLI")).toBe(false);

    expect(getCliTool("antigravity")).toEqual(
      expect.objectContaining({
        id: "antigravity",
        name: "Antigravity CLI",
        cli: "agy",
        bundleProvider: "antigravity",
      }),
    );
    expect(getCliBinary("antigravity")).toBe("agy");
    expect(getDefaultAgentConfigIdForTool("antigravity")).toBe("antigravity-default");
    expect(getAgentConfigOptionsForTool("antigravity")).toEqual([
      { id: "antigravity-default", name: "Antigravity / CLI Default" },
    ]);
  });

  it("centralizes terminal auth commands", () => {
    expect(getTerminalAuthCommand("codex")).toBe("codex login --device-auth");
    expect(getTerminalAuthCommand("antigravity")).toBe("agy");
    expect(getTerminalAuthCommand("kollab")).toBe("kollab --login openai");
    expect(getTerminalAuthCommand("aider")).toBe("aider --help");
  });

  it("includes every provider credential in quick secret presets", () => {
    const envVars = COMMON_PRESETS.map((preset) => preset.envVar);
    expect(envVars).toContain("ANTHROPIC_AUTH_TOKEN");
    expect(envVars).toContain("OPENAI_API_KEY");
    expect(envVars).toContain("GEMINI_API_KEY");
    expect(envVars).toContain("KOLLAB_API_KEY");
  });

  it("uses current engine defaults and avoids stale OpenAI/Gemini fallbacks", () => {
    expect(getEngineProviderDefault("openai")?.model).toBe("gpt-5.6-sol");
    expect(getEngineProviderDefault("gemini")?.model).toBe("gemini-3.5-flash");
    expect(getEngineProviderDefault("openrouter")?.model).toBe("deepseek/deepseek-v4-flash");
    expect(DEFAULT_MARKETPLACE_AGENT_MODEL).toBe("claude-sonnet-4-6");
  });

  it("prices every GPT-5.6 bundle model at its published rate", () => {
    expect(getModelPricing("gpt-5.6-sol")).toMatchObject({
      inputCentsPerMillion: 500,
      outputCentsPerMillion: 3000,
    });
    expect(getModelPricing("gpt-5.6-terra")).toMatchObject({
      inputCentsPerMillion: 250,
      outputCentsPerMillion: 1500,
    });
    expect(getModelPricing("gpt-5.6-luna")).toMatchObject({
      inputCentsPerMillion: 100,
      outputCentsPerMillion: 600,
    });
  });

  it("keeps Codex profiles automation-safe and free of invented readiness signals", () => {
    const codexProfiles = getAllBundleProfiles().filter((profile) => profile.cli === "codex");

    expect(codexProfiles.length).toBeGreaterThan(0);
    const codexDefault = codexProfiles.find((profile) => profile.id === "codex-default");
    expect(codexDefault?.readiness).toEqual({ enabled: false, ready_patterns: [] });
    expect(codexDefault?.readiness?.ready_patterns).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "OpenAI Codex (v" }),
        expect.objectContaining({ value: "Find and fix a bug" }),
      ]),
    );
    for (const profile of codexProfiles) {
      expect(profile.extra_args || []).not.toContain("--skip-git-repo-check");
    }
  });
});
