import { AgentProfile, AgentProfileProvider } from "./types";

// ============================================================
// provider logo svgs (as html strings)
// ============================================================

// Claude Code: hexagon shape, amber-to-red gradient (same as app logo but labeled 'CC')
const CLAUDE_CODE_LOGO = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="cc-grad" x1="0" y1="0" x2="32" y2="32">
      <stop offset="0%" stop-color="#f59e0b" />
      <stop offset="100%" stop-color="#dc2626" />
    </linearGradient>
  </defs>
  <path d="M16 2L28 9v14l-12 7-12-7V9z" fill="url(#cc-grad)" />
  <text x="16" y="21" font-family="monospace" font-size="12" font-weight="bold" fill="white" text-anchor="middle">CC</text>
</svg>`;

// Codex: simple geometric SVG (green square with C)
const CODEX_LOGO = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="4" y="4" width="24" height="24" rx="4" fill="#10b981" />
  <text x="16" y="22" font-family="monospace" font-size="14" font-weight="bold" fill="white" text-anchor="middle">C</text>
</svg>`;

// OpenCode: blue circle with O
const OPENCODE_LOGO = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="16" cy="16" r="12" fill="#3b82f6" />
  <text x="16" y="21" font-family="monospace" font-size="12" font-weight="bold" fill="white" text-anchor="middle">O</text>
</svg>`;

// Kollab: purple hexagon with K
const KOLLAB_LOGO = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M16 2L28 9v14l-12 7-12-7V9z" fill="#8b5cf6" />
  <text x="16" y="21" font-family="monospace" font-size="12" font-weight="bold" fill="white" text-anchor="middle">K</text>
</svg>`;

// Gemini: 4-pointed star (blue-to-purple gradient)
const GEMINI_LOGO = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="gemini-grad" x1="0" y1="0" x2="32" y2="32">
      <stop offset="0%" stop-color="#4285f4" />
      <stop offset="100%" stop-color="#9c5cf6" />
    </linearGradient>
  </defs>
  <path d="M16 2 C17 10 22 11 30 16 C22 21 17 22 16 30 C15 22 10 21 2 16 C10 11 15 10 16 2 Z" fill="url(#gemini-grad)"/>
</svg>`;

// Custom: gray gear icon
const CUSTOM_LOGO = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="16" cy="16" r="10" stroke="#6b7280" stroke-width="3" fill="none" />
  <circle cx="16" cy="16" r="4" fill="#6b7280" />
</svg>`;

// ============================================================
// types
// ============================================================

export interface BundleProfile {
  id: string;
  name: string;
  cli: string;
  model?: string;
  pipe_flag?: string;
  permission_flag?: string;
  extra_args?: string[];
  pre_exec?: string;
  description?: string;
}

export interface ProviderBundle {
  provider: AgentProfileProvider;
  name: string;
  logo: string;
  profiles: BundleProfile[];
  /** local path where this CLI stores session logs (~ expanded at runtime) */
  log_path?: string;
  /** storage format: "jsonl" | "sqlite" | "json" */
  log_format?: string;
}

// ============================================================
// bundle profile manifests
// ============================================================

export const PROVIDER_BUNDLES: ProviderBundle[] = [
  {
    provider: "claude-code",
    name: "Claude Code",
    logo: CLAUDE_CODE_LOGO,
    // logs: ~/.claude/projects/<project-hash>/*.jsonl (one file per session)
    log_path: "~/.claude/projects/",
    log_format: "jsonl",
    profiles: [
      {
        id: "claude-sonnet",
        name: "Claude / Sonnet",
        cli: "claude",
        model: "sonnet",
        pipe_flag: "-p",
        permission_flag: "--allow-dangerously-skip-permissions --permission-mode bypassPermissions",
        pre_exec: "unset CLAUDECODE",
        description: "Balanced performance — always latest Sonnet",
      },
      {
        id: "claude-opus",
        name: "Claude / Opus",
        cli: "claude",
        model: "opus",
        pipe_flag: "-p",
        permission_flag: "--allow-dangerously-skip-permissions --permission-mode bypassPermissions",
        pre_exec: "unset CLAUDECODE",
        description: "Highest capability — always latest Opus",
      },
      {
        id: "claude-haiku",
        name: "Claude / Haiku",
        cli: "claude",
        model: "haiku",
        pipe_flag: "-p",
        permission_flag: "--allow-dangerously-skip-permissions --permission-mode bypassPermissions",
        pre_exec: "unset CLAUDECODE",
        description: "Fastest for simple tasks — always latest Haiku",
      },
    ],
  },
  {
    provider: "codex",
    name: "Codex",
    logo: CODEX_LOGO,
    // logs: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
    log_path: "~/.codex/sessions/",
    log_format: "jsonl",
    profiles: [
      {
        id: "codex-default",
        name: "Codex / Default",
        cli: "codex",
        model: "gpt-5.3-codex",
        pipe_flag: "exec",
        permission_flag: "--dangerously-bypass-approvals-and-sandbox",
        extra_args: ["--skip-git-repo-check"],
        description: "Most capable agentic coding model — GPT-5.3 Codex",
      },
      {
        id: "codex-spark",
        name: "Codex / Spark",
        cli: "codex",
        model: "gpt-5.3-codex-spark",
        pipe_flag: "exec",
        permission_flag: "--dangerously-bypass-approvals-and-sandbox",
        extra_args: ["--skip-git-repo-check"],
        description: "Text-only research preview — fast real-time iteration",
      },
    ],
  },
  {
    provider: "opencode",
    name: "OpenCode",
    logo: OPENCODE_LOGO,
    // logs: ~/.config/opencode/ (SQLite database)
    log_path: "~/.config/opencode/",
    log_format: "sqlite",
    profiles: [
      {
        id: "opencode-sonnet",
        name: "OpenCode / Sonnet",
        cli: "opencode",
        model: "anthropic/claude-sonnet-4-6",
        pipe_flag: "-p",
        description: "Claude Sonnet via OpenCode runner",
      },
      {
        id: "opencode-o3",
        name: "OpenCode / o3",
        cli: "opencode",
        model: "openai/o3",
        pipe_flag: "-p",
        description: "OpenAI o3 via OpenCode runner",
      },
    ],
  },
  {
    provider: "kollab",
    name: "Kollab",
    logo: KOLLAB_LOGO,
    log_path: "~/.kollab/projects/",
    log_format: "jsonl",
    profiles: [
      {
        id: "kollab",
        name: "Kollab / Mentiko",
        cli: "kollab",
        pipe_flag: "-p",
        permission_flag: "--permissions trust",
        description: "Kollab / Mentiko",
      },
    ],
  },
  {
    provider: "gemini",
    name: "Gemini CLI",
    logo: GEMINI_LOGO,
    // logs: ~/.gemini/tmp/<project-hash>/checkpoints (JSON)
    log_path: "~/.gemini/tmp/",
    log_format: "json",
    profiles: [
      {
        id: "gemini-flash",
        name: "Gemini / Flash",
        cli: "gemini",
        model: "gemini-2.5-flash",
        pipe_flag: "-p",
        permission_flag: "-y",
        description: "Fast and cost-efficient — Gemini 2.5 Flash",
      },
      {
        id: "gemini-pro",
        name: "Gemini / Pro",
        cli: "gemini",
        model: "gemini-2.5-pro",
        pipe_flag: "-p",
        permission_flag: "-y",
        description: "Advanced reasoning — Gemini 2.5 Pro",
      },
      {
        id: "gemini-pro-preview",
        name: "Gemini / 3.1 Pro",
        cli: "gemini",
        model: "gemini-3.1-pro-preview",
        pipe_flag: "-p",
        permission_flag: "-y",
        description: "Latest frontier model — Gemini 3.1 Pro Preview",
      },
    ],
  },
  {
    provider: "custom",
    name: "Custom",
    logo: CUSTOM_LOGO,
    profiles: [],
  },
];

// ============================================================
// helper: get bundle by provider
// ============================================================

export function getBundleByProvider(provider: AgentProfileProvider): ProviderBundle | undefined {
  return PROVIDER_BUNDLES.find((b) => b.provider === provider);
}

// ============================================================
// helper: convert bundle profile to AgentProfile
// ============================================================

export function bundleProfileToAgentProfile(
  bundleProfile: BundleProfile,
  bundle?: ProviderBundle
): Omit<AgentProfile, "createdAt" | "updatedAt"> {
  return {
    id: bundleProfile.id,
    name: bundleProfile.name,
    description: bundleProfile.description,
    isDefault: false,
    cli: bundleProfile.cli,
    model: bundleProfile.model,
    pipe_flag: bundleProfile.pipe_flag,
    permission_flag: bundleProfile.permission_flag,
    extra_args: [],
    env: {},
    pre_exec: bundleProfile.pre_exec,
    log_path: bundle?.log_path,
    log_format: bundle?.log_format,
  };
}

// ============================================================
// helper: get all profiles from bundles as AgentProfile[]
// ============================================================

export function getAllBundleProfiles(): Omit<AgentProfile, "createdAt" | "updatedAt">[] {
  const profiles: Omit<AgentProfile, "createdAt" | "updatedAt">[] = [];

  for (const bundle of PROVIDER_BUNDLES) {
    for (const profile of bundle.profiles) {
      profiles.push(bundleProfileToAgentProfile(profile, bundle));
    }
  }

  return profiles;
}

// ============================================================
// helper: get bundle logo svg
// ============================================================

export function getProviderLogo(provider: AgentProfileProvider): string {
  const bundle = getBundleByProvider(provider);
  return bundle?.logo || CUSTOM_LOGO;
}
