import {
  CpuFilled as Cpu,
  MagicStarFilled as Sparkles,
  LinkFilled as GitBranch,
  UserFilled as Users,
  MagicStarFilled as Wand2,
} from "@aliimam/icons";
import { getBundleByProvider } from "./provider-bundles";
import type { AgentProfileProvider } from "./types";

// ── CLI tools for agent profile wizard ─────────────────────────────────────────

export const CLI_TOOLS = [
  {
    id: "claude",
    name: "Claude Code",
    cli: "claude",
    description: "Anthropic Claude CLI - most capable",
    icon: Cpu,
    color: "text-amber-400",
    models: [],
    defaultModel: "",
  },
  {
    id: "codex",
    name: "Codex",
    cli: "codex",
    description: "OpenAI Codex - code generation",
    icon: Sparkles,
    color: "text-emerald-400",
    models: [],
    defaultModel: "",
  },
  {
    id: "aider",
    name: "Aider",
    cli: "aider",
    description: "Aider - AI pair programming",
    icon: GitBranch,
    color: "text-indigo-400",
    models: [],
    defaultModel: "",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    cli: "gemini",
    description: "Google Gemini CLI - multimodal reasoning",
    icon: Wand2,
    color: "text-blue-400",
    models: [],
    defaultModel: "",
  },
  {
    id: "kollab",
    name: "Kollab",
    cli: "kollab",
    description: "Kollab - collaborative AI",
    icon: Users,
    color: "text-purple-400",
    models: [],
    defaultModel: "",
  },
];

export interface AgentConfigOption {
  id: string;
  name: string;
}

const TOOL_TO_BUNDLE_PROVIDER: Record<string, AgentProfileProvider> = {
  claude: "claude-code",
  codex: "codex",
  gemini: "gemini",
  kollab: "kollab",
};

export function getAgentConfigOptionsForTool(toolId: string): AgentConfigOption[] {
  const bundleProvider = TOOL_TO_BUNDLE_PROVIDER[toolId];
  const bundle = bundleProvider ? getBundleByProvider(bundleProvider) : undefined;
  if (bundle && bundle.profiles.length > 0) {
    return bundle.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
    }));
  }

  const tool = CLI_TOOLS.find((candidate) => candidate.id === toolId);
  return (tool?.models ?? []).map((model) => ({ id: model, name: model }));
}

export function getDefaultAgentConfigIdForTool(toolId: string): string {
  return getAgentConfigOptionsForTool(toolId)[0]?.id ?? "";
}

// ── per-provider credential metadata ───────────────────────────────────────────

export const PROVIDER_CREDENTIALS: Record<string, {
  envKey: string;
  label: string;
  placeholder: string;
  docsUrl: string;
  docsLabel: string;
}> = {
  claude: {
    envKey: "ANTHROPIC_AUTH_TOKEN",
    label: "Anthropic API Key",
    placeholder: "sk-ant-...",
    docsUrl: "https://console.anthropic.com/settings/keys",
    docsLabel: "Get API key",
  },
  gemini: {
    envKey: "GEMINI_API_KEY",
    label: "Google Gemini API Key",
    placeholder: "AIza...",
    docsUrl: "https://aistudio.google.com/app/apikey",
    docsLabel: "Get API key",
  },
  codex: {
    envKey: "OPENAI_API_KEY",
    label: "OpenAI API Key",
    placeholder: "sk-...",
    docsUrl: "https://platform.openai.com/api-keys",
    docsLabel: "Get API key",
  },
  opencode: {
    envKey: "OPENAI_API_KEY",
    label: "OpenAI API Key",
    placeholder: "sk-...",
    docsUrl: "https://platform.openai.com/api-keys",
    docsLabel: "Get API key",
  },
  kollab: {
    envKey: "KOLLAB_API_KEY",
    label: "Kollab API Key",
    placeholder: "sk-...",
    docsUrl: "https://github.com/kollaborai/kollab#readme",
    docsLabel: "Kollab auth docs",
  },
};

// ── provider brand colors ──────────────────────────────────────────────────────

export function getProviderColors(cli: string): { color: string; bg: string } {
  switch (cli.toLowerCase()) {
    case "claude":   return { color: "text-amber-300",   bg: "bg-amber-500/20" };
    case "gemini":   return { color: "text-blue-300",    bg: "bg-blue-500/20" };
    case "codex":    return { color: "text-emerald-300", bg: "bg-emerald-500/20" };
    case "opencode": return { color: "text-indigo-300",  bg: "bg-indigo-500/20" };
    case "kollab":   return { color: "text-purple-300",  bg: "bg-purple-500/20" };
    default:         return { color: "text-foreground/60", bg: "bg-muted" };
  }
}

// ── common secret presets ──────────────────────────────────────────────────────

export const COMMON_PRESETS = [
  { label: "Anthropic API Key", envVar: "ANTHROPIC_AUTH_TOKEN" },
  { label: "OpenAI API Key", envVar: "OPENAI_API_KEY" },
  { label: "Google Gemini API Key", envVar: "GEMINI_API_KEY" },
  { label: "GitHub Token", envVar: "GITHUB_TOKEN" },
  { label: "Custom", envVar: "" },
];
