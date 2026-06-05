import {
  CLI_TOOLS,
  COMMON_PRESETS,
  DEFAULT_MARKETPLACE_AGENT_MODEL,
  getAgentConfigOptionsForTool,
  getCliBinary,
  getCliTool,
  getDefaultAgentConfigIdForTool,
  getEngineProviderDefault,
  getTerminalAuthCommand,
} from "@/lib/agents/agent-provider-catalog";

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
      { id: "codex-default", name: "Codex / GPT-5.5" },
      { id: "codex-fast", name: "Codex / GPT-5.4 mini" },
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
    expect(getEngineProviderDefault("openai")?.model).toBe("gpt-5.5");
    expect(getEngineProviderDefault("gemini")?.model).toBe("gemini-3.5-flash");
    expect(getEngineProviderDefault("openrouter")?.model).toBe("deepseek/deepseek-v4-flash");
    expect(DEFAULT_MARKETPLACE_AGENT_MODEL).toBe("claude-sonnet-4-6");
  });
});
