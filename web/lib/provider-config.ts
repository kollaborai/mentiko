import {
  CpuFilled as Cpu,
  MagicStarFilled as Sparkles,
  LinkFilled as GitBranch,
  UserFilled as Users,
  MagicStarFilled as Wand2,
} from "@aliimam/icons";

// ── CLI tools for agent profile wizard ─────────────────────────────────────────

export const CLI_TOOLS = [
  {
    id: "claude",
    name: "Claude Code",
    cli: "claude",
    description: "Anthropic Claude CLI - most capable",
    icon: Cpu,
    color: "text-amber-400",
    models: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
    defaultModel: "claude-opus-4-6",
  },
  {
    id: "codex",
    name: "Codex",
    cli: "codex",
    description: "OpenAI Codex - code generation",
    icon: Sparkles,
    color: "text-emerald-400",
    models: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
    defaultModel: "gpt-4o",
  },
  {
    id: "aider",
    name: "Aider",
    cli: "aider",
    description: "Aider - AI pair programming",
    icon: GitBranch,
    color: "text-indigo-400",
    models: ["claude-sonnet-4-6", "claude-opus-4-6", "gpt-4o"],
    defaultModel: "claude-sonnet-4-6",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    cli: "gemini",
    description: "Google Gemini CLI - multimodal reasoning",
    icon: Wand2,
    color: "text-blue-400",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-3.1-pro-preview"],
    defaultModel: "gemini-2.5-flash",
  },
  {
    id: "kollabor",
    name: "Kollab",
    cli: "kollab",
    description: "Kollab - collaborative AI",
    icon: Users,
    color: "text-purple-400",
    models: ["claude-opus-4-6", "claude-sonnet-4-6", "gpt-4o"],
    defaultModel: "claude-opus-4-6",
  },
];

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
  kollabor: {
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
    case "kollabor": return { color: "text-purple-300",  bg: "bg-purple-500/20" };
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
