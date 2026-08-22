#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// lib/system/system-log-cli.ts
var system_log_cli_exports = {};
__export(system_log_cli_exports, {
  resolveSystemLogEndpoint: () => resolveSystemLogEndpoint
});
module.exports = __toCommonJS(system_log_cli_exports);

// lib/config.ts
var import_path = __toESM(require("path"));
var import_os = require("os");

// config/agent-provider-catalog.json
var agent_provider_catalog_default = {
  cliTools: [
    {
      id: "claude",
      name: "Claude Code",
      cli: "claude",
      description: "Anthropic Claude CLI - most capable",
      iconKey: "claude",
      color: "text-amber-400",
      badgeColor: "text-amber-300",
      badgeBg: "bg-amber-500/20",
      credentialKey: "claude",
      bundleProvider: "claude-code",
      terminalAuthCommand: "claude auth login",
      interactiveAuthCommand: "claude auth login",
      detectable: true
    },
    {
      id: "codex",
      name: "Codex",
      cli: "codex",
      description: "OpenAI Codex - code generation",
      iconKey: "openai",
      color: "text-emerald-400",
      badgeColor: "text-emerald-300",
      badgeBg: "bg-emerald-500/20",
      credentialKey: "codex",
      bundleProvider: "codex",
      terminalAuthCommand: "codex login --device-auth",
      interactiveAuthCommand: "codex login --device-auth",
      detectable: true
    },
    {
      id: "aider",
      name: "Aider",
      cli: "aider",
      description: "Aider - AI pair programming",
      iconKey: "aider",
      color: "text-indigo-400",
      badgeColor: "text-indigo-300",
      badgeBg: "bg-indigo-500/20",
      terminalAuthCommand: "aider --help",
      detectable: true
    },
    {
      id: "antigravity",
      name: "Antigravity CLI",
      cli: "agy",
      description: "Google Antigravity CLI - terminal agent harness",
      iconKey: "antigravity",
      color: "text-blue-400",
      badgeColor: "text-blue-300",
      badgeBg: "bg-blue-500/20",
      credentialKey: "gemini",
      bundleProvider: "antigravity",
      terminalAuthCommand: "agy",
      interactiveAuthCommand: "agy",
      detectable: true
    },
    {
      id: "kollab",
      name: "Kollab",
      cli: "kollab",
      description: "Kollab - collaborative AI",
      iconKey: "kollab",
      color: "text-purple-400",
      badgeColor: "text-purple-300",
      badgeBg: "bg-purple-500/20",
      credentialKey: "kollab",
      bundleProvider: "kollab",
      terminalAuthCommand: "kollab --login openai",
      detectable: true
    },
    {
      id: "opencode",
      name: "OpenCode",
      cli: "opencode",
      description: "OpenCode - multi-provider coding runner",
      iconKey: "openai",
      color: "text-indigo-400",
      badgeColor: "text-indigo-300",
      badgeBg: "bg-indigo-500/20",
      credentialKey: "opencode",
      bundleProvider: "opencode",
      terminalAuthCommand: "opencode auth login",
      detectable: false
    }
  ],
  providerCredentials: {
    claude: {
      envKey: "ANTHROPIC_AUTH_TOKEN",
      label: "Anthropic API Key",
      placeholder: "sk-ant-...",
      docsUrl: "https://console.anthropic.com/settings/keys",
      docsLabel: "Get API key"
    },
    gemini: {
      envKey: "GEMINI_API_KEY",
      label: "Google Gemini API Key",
      placeholder: "AIza...",
      docsUrl: "https://aistudio.google.com/app/apikey",
      docsLabel: "Get API key"
    },
    codex: {
      envKey: "OPENAI_API_KEY",
      label: "OpenAI API Key",
      placeholder: "sk-...",
      docsUrl: "https://platform.openai.com/api-keys",
      docsLabel: "Get API key"
    },
    opencode: {
      envKey: "OPENAI_API_KEY",
      label: "OpenAI API Key",
      placeholder: "sk-...",
      docsUrl: "https://platform.openai.com/api-keys",
      docsLabel: "Get API key"
    },
    kollab: {
      envKey: "KOLLAB_API_KEY",
      label: "Kollab API Key",
      placeholder: "sk-...",
      docsUrl: "https://github.com/kollaborai/kollab#readme",
      docsLabel: "Kollab auth docs"
    }
  },
  secretPresets: [
    { label: "Anthropic API Key", envVar: "ANTHROPIC_AUTH_TOKEN" },
    { label: "OpenAI API Key", envVar: "OPENAI_API_KEY" },
    { label: "Google Gemini API Key", envVar: "GEMINI_API_KEY" },
    { label: "Kollab API Key", envVar: "KOLLAB_API_KEY" },
    { label: "GitHub Token", envVar: "GITHUB_TOKEN" },
    { label: "Custom", envVar: "" }
  ],
  profileBundles: [
    {
      provider: "claude-code",
      name: "Claude Code",
      logoKey: "claude-code",
      log_path: "~/.claude/projects/",
      log_format: "jsonl",
      profiles: [
        {
          id: "claude-sonnet",
          name: "Claude / Sonnet",
          cli: "claude",
          model: "sonnet",
          pipe_flag: "-p",
          permission_flag: "--dangerously-skip-permissions",
          pre_exec: "unset CLAUDECODE",
          readiness: { enabled: true, ready_patterns: [{ name: "claude input-ready hint", type: "text", value: "for agents", action: "ready", risk: "low", enabled: true }] },
          description: "Balanced performance - always latest Sonnet"
        },
        {
          id: "claude-opus",
          name: "Claude / Opus",
          cli: "claude",
          model: "opus",
          pipe_flag: "-p",
          permission_flag: "--dangerously-skip-permissions",
          pre_exec: "unset CLAUDECODE",
          readiness: { enabled: true, ready_patterns: [{ name: "claude input-ready hint", type: "text", value: "for agents", action: "ready", risk: "low", enabled: true }] },
          description: "Highest capability - always latest Opus"
        },
        {
          id: "claude-haiku",
          name: "Claude / Haiku",
          cli: "claude",
          model: "haiku",
          pipe_flag: "-p",
          permission_flag: "--dangerously-skip-permissions",
          pre_exec: "unset CLAUDECODE",
          readiness: { enabled: true, ready_patterns: [{ name: "claude input-ready hint", type: "text", value: "for agents", action: "ready", risk: "low", enabled: true }] },
          description: "Fastest for simple tasks - always latest Haiku"
        }
      ]
    },
    {
      provider: "codex",
      name: "Codex",
      logoKey: "codex",
      log_path: "~/.codex/sessions/",
      log_format: "jsonl",
      profiles: [
        {
          id: "codex-default",
          name: "Codex / GPT-5.6 Sol",
          cli: "codex",
          model: "gpt-5.6-sol",
          pipe_flag: "exec",
          permission_flag: "--dangerously-bypass-approvals-and-sandbox",
          readiness: { enabled: false, ready_patterns: [] },
          description: "Flagship model for complex coding and agentic work"
        },
        {
          id: "codex-terra",
          name: "Codex / GPT-5.6 Terra",
          cli: "codex",
          model: "gpt-5.6-terra",
          pipe_flag: "exec",
          permission_flag: "--dangerously-bypass-approvals-and-sandbox",
          readiness: {
            enabled: true,
            ready_patterns: [{ name: "codex tui banner", type: "text", value: "OpenAI Codex (v", action: "ready", risk: "low", enabled: true }, { name: "codex input placeholder", type: "text", value: "Find and fix a bug", action: "ready", risk: "low", enabled: true }],
            blocked_patterns: [
              {
                name: "unsupported skip git repo check arg",
                type: "text",
                value: "unexpected argument '--skip-git-repo-check'",
                action: "block",
                risk: "low",
                enabled: true
              }
            ],
            retry_patterns: [
              {
                name: "cli install or update in progress",
                type: "regex",
                value: "(installing|updating|downloading)",
                action: "retry",
                risk: "medium",
                enabled: true
              }
            ],
            recoverable_patterns: [
              {
                name: "press enter to continue",
                type: "regex",
                value: "Press Enter to continue",
                action: "recover",
                risk: "low",
                enabled: true
              }
            ]
          },
          description: "Balanced Codex profile for everyday coding and agentic work"
        },
        {
          id: "codex-fast",
          name: "Codex / GPT-5.6 Luna",
          cli: "codex",
          model: "gpt-5.6-luna",
          pipe_flag: "exec",
          permission_flag: "--dangerously-bypass-approvals-and-sandbox",
          readiness: {
            enabled: true,
            ready_patterns: [{ name: "codex tui banner", type: "text", value: "OpenAI Codex (v", action: "ready", risk: "low", enabled: true }, { name: "codex input placeholder", type: "text", value: "Find and fix a bug", action: "ready", risk: "low", enabled: true }],
            blocked_patterns: [
              {
                name: "unsupported skip git repo check arg",
                type: "text",
                value: "unexpected argument '--skip-git-repo-check'",
                action: "block",
                risk: "low",
                enabled: true
              }
            ],
            retry_patterns: [
              {
                name: "cli install or update in progress",
                type: "regex",
                value: "(installing|updating|downloading)",
                action: "retry",
                risk: "medium",
                enabled: true
              }
            ],
            recoverable_patterns: [
              {
                name: "press enter to continue",
                type: "regex",
                value: "Press Enter to continue",
                action: "recover",
                risk: "low",
                enabled: true
              }
            ]
          },
          description: "Fastest, lowest-cost Codex profile for focused tasks"
        }
      ]
    },
    {
      provider: "opencode",
      name: "OpenCode",
      logoKey: "opencode",
      log_path: "~/.config/opencode/",
      log_format: "sqlite",
      profiles: [
        {
          id: "opencode-sonnet",
          name: "OpenCode / Sonnet 4.6",
          cli: "opencode",
          model: "anthropic/claude-sonnet-4-6",
          pipe_flag: "-p",
          readiness: { enabled: true, ready_patterns: [{ name: "opencode input ready", type: "text", value: "Ask anything", action: "ready", risk: "low", enabled: true }, { name: "opencode command hint", type: "text", value: "ctrl+p commands", action: "ready", risk: "low", enabled: true }] },
          description: "Claude Sonnet 4.6 via OpenCode runner"
        },
        {
          id: "opencode-gpt",
          name: "OpenCode / GPT-5.6 Sol",
          cli: "opencode",
          model: "openai/gpt-5.6-sol",
          pipe_flag: "-p",
          readiness: { enabled: true, ready_patterns: [{ name: "opencode input ready", type: "text", value: "Ask anything", action: "ready", risk: "low", enabled: true }, { name: "opencode command hint", type: "text", value: "ctrl+p commands", action: "ready", risk: "low", enabled: true }] },
          description: "OpenAI GPT-5.6 Luna via OpenCode runner"
        },
        {
          id: "opencode-gpt-terra",
          name: "OpenCode / GPT-5.6 Terra",
          cli: "opencode",
          model: "openai/gpt-5.6-terra",
          pipe_flag: "-p",
          readiness: { enabled: true, ready_patterns: [{ name: "opencode input ready", type: "text", value: "Ask anything", action: "ready", risk: "low", enabled: true }, { name: "opencode command hint", type: "text", value: "ctrl+p commands", action: "ready", risk: "low", enabled: true }] },
          description: "OpenAI GPT-5.6 Terra via OpenCode runner"
        },
        {
          id: "opencode-gpt-luna",
          name: "OpenCode / GPT-5.6 Luna",
          cli: "opencode",
          model: "openai/gpt-5.6-luna",
          pipe_flag: "-p",
          readiness: { enabled: true, ready_patterns: [{ name: "opencode input ready", type: "text", value: "Ask anything", action: "ready", risk: "low", enabled: true }, { name: "opencode command hint", type: "text", value: "ctrl+p commands", action: "ready", risk: "low", enabled: true }] },
          description: "OpenAI GPT-5.6 Luna via OpenCode runner"
        }
      ]
    },
    {
      provider: "kollab",
      name: "Kollab",
      logoKey: "kollab",
      log_path: "~/.kollab/projects/",
      log_format: "jsonl",
      profiles: [
        {
          id: "kollab",
          name: "Kollab / Mentiko",
          cli: "kollab",
          pipe_flag: "-p",
          permission_flag: "--permissions trust",
          preferredAdvisorDefault: true,
          readiness: { enabled: true, ready_patterns: [{ name: "kollab ready line", type: "text", value: "ready \xB7", action: "ready", risk: "low", enabled: true }, { name: "kollab hooks active", type: "text", value: "hooks active", action: "ready", risk: "low", enabled: true }] },
          description: "Kollab / Mentiko"
        }
      ]
    },
    {
      provider: "antigravity",
      name: "Antigravity CLI",
      logoKey: "antigravity",
      log_path: "~/.gemini/antigravity-cli/",
      log_format: "json",
      profiles: [
        {
          id: "antigravity-default",
          name: "Antigravity / CLI Default",
          cli: "agy",
          permission_flag: "--dangerously-skip-permissions",
          description: "Uses the Antigravity CLI default model and settings"
        }
      ]
    },
    {
      provider: "custom",
      name: "Custom",
      logoKey: "custom",
      profiles: []
    }
  ],
  legacyProfileReplacements: [
    {
      provider: "codex",
      profile: {
        id: "codex-spark",
        name: "Codex / Spark",
        cli: "codex",
        model: "gpt-5.6-luna",
        pipe_flag: "exec",
        permission_flag: "--dangerously-bypass-approvals-and-sandbox",
        readiness: { enabled: false, ready_patterns: [] },
        description: "Legacy Spark profile id synced to the current fast Codex model"
      }
    },
    {
      provider: "antigravity",
      profile: {
        id: "gemini-flash",
        name: "Antigravity / Gemini Flash Legacy",
        cli: "agy",
        permission_flag: "--dangerously-skip-permissions",
        description: "Legacy Gemini Flash profile id synced to Antigravity CLI defaults"
      }
    },
    {
      provider: "antigravity",
      profile: {
        id: "gemini-pro-preview",
        name: "Antigravity / Gemini Pro Preview Legacy",
        cli: "agy",
        permission_flag: "--dangerously-skip-permissions",
        description: "Legacy Gemini Pro preview profile id synced to Antigravity CLI defaults"
      }
    },
    {
      provider: "antigravity",
      profile: {
        id: "gemini-flash-lite",
        name: "Antigravity / Gemini Flash-Lite Legacy",
        cli: "agy",
        permission_flag: "--dangerously-skip-permissions",
        description: "Legacy Gemini Flash-Lite profile id synced to Antigravity CLI defaults"
      }
    },
    {
      provider: "antigravity",
      profile: {
        id: "gemini-pro",
        name: "Antigravity / Gemini Pro Legacy",
        cli: "agy",
        permission_flag: "--dangerously-skip-permissions",
        description: "Legacy Gemini Pro profile id synced to Antigravity CLI defaults"
      }
    }
  ],
  engineProviders: [
    {
      value: "anthropic",
      label: "Anthropic",
      model: "claude-sonnet-4-6",
      baseUrl: "",
      iconKey: "claude"
    },
    {
      value: "openai",
      label: "OpenAI",
      model: "gpt-5.6-sol",
      baseUrl: "",
      iconKey: "openai"
    },
    {
      value: "openrouter",
      label: "OpenRouter",
      model: "deepseek/deepseek-v4-flash",
      baseUrl: "https://openrouter.ai/api/v1",
      iconKey: "openrouter"
    },
    {
      value: "gemini",
      label: "Google Gemini",
      model: "gemini-3.5-flash",
      baseUrl: "",
      iconKey: "gemini"
    },
    {
      value: "custom",
      label: "Custom / Local",
      model: "",
      baseUrl: "",
      iconKey: "custom"
    },
    {
      value: "auto",
      label: "Auto (env vars)",
      model: "",
      baseUrl: "",
      iconKey: "custom"
    }
  ],
  mentikoGatewayProfile: {
    name: "mentiko",
    provider: "openai",
    model: "glm-5.1",
    description: "Mentiko AI gateway (included AI)"
  },
  runtimeDefaults: {
    marketplaceAgentModel: "claude-sonnet-4-6",
    costModel: "claude-sonnet-4-6",
    linkEscalationModel: "haiku",
    codexInlineAuthModel: "gpt-5.6-terra"
  }
};

// lib/agents/agent-provider-catalog.ts
var catalog = agent_provider_catalog_default;
var CLI_TOOLS = catalog.cliTools;
var PROVIDER_CREDENTIALS = catalog.providerCredentials;
var COMMON_PRESETS = catalog.secretPresets;
var PROFILE_BUNDLES = catalog.profileBundles;
var LEGACY_PROFILE_REPLACEMENTS = catalog.legacyProfileReplacements;
var ENGINE_PROVIDER_DEFAULTS = catalog.engineProviders;
var MENTIKO_GATEWAY_PROFILE = catalog.mentikoGatewayProfile;
var DEFAULT_MARKETPLACE_AGENT_MODEL = catalog.runtimeDefaults.marketplaceAgentModel;
var DEFAULT_COST_MODEL = catalog.runtimeDefaults.costModel;
var LINK_ESCALATION_FALLBACK_MODEL = catalog.runtimeDefaults.linkEscalationModel;
var CODEX_INLINE_AUTH_MODEL = catalog.runtimeDefaults.codexInlineAuthModel;

// lib/agents/provider-bundles.ts
var CLAUDE_CODE_LOGO = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="cc-grad" x1="0" y1="0" x2="32" y2="32">
      <stop offset="0%" stop-color="#f59e0b" />
      <stop offset="100%" stop-color="#dc2626" />
    </linearGradient>
  </defs>
  <path d="M16 2L28 9v14l-12 7-12-7V9z" fill="url(#cc-grad)" />
  <text x="16" y="21" font-family="monospace" font-size="12" font-weight="bold" fill="white" text-anchor="middle">CC</text>
</svg>`;
var CODEX_LOGO = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="4" y="4" width="24" height="24" rx="4" fill="#10b981" />
  <text x="16" y="22" font-family="monospace" font-size="14" font-weight="bold" fill="white" text-anchor="middle">C</text>
</svg>`;
var OPENCODE_LOGO = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="16" cy="16" r="12" fill="#3b82f6" />
  <text x="16" y="21" font-family="monospace" font-size="12" font-weight="bold" fill="white" text-anchor="middle">O</text>
</svg>`;
var KOLLAB_LOGO = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M16 2L28 9v14l-12 7-12-7V9z" fill="#8b5cf6" />
  <text x="16" y="21" font-family="monospace" font-size="12" font-weight="bold" fill="white" text-anchor="middle">K</text>
</svg>`;
var ANTIGRAVITY_LOGO = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="antigravity-grad" x1="0" y1="0" x2="32" y2="32">
      <stop offset="0%" stop-color="#4285f4" />
      <stop offset="100%" stop-color="#9c5cf6" />
    </linearGradient>
  </defs>
  <path d="M16 2 C17 10 22 11 30 16 C22 21 17 22 16 30 C15 22 10 21 2 16 C10 11 15 10 16 2 Z" fill="url(#antigravity-grad)"/>
  <text x="16" y="20" font-family="monospace" font-size="7" font-weight="bold" fill="white" text-anchor="middle">AG</text>
</svg>`;
var CUSTOM_LOGO = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="16" cy="16" r="10" stroke="#6b7280" stroke-width="3" fill="none" />
  <circle cx="16" cy="16" r="4" fill="#6b7280" />
</svg>`;
var LOGOS = {
  "claude-code": CLAUDE_CODE_LOGO,
  codex: CODEX_LOGO,
  opencode: OPENCODE_LOGO,
  kollab: KOLLAB_LOGO,
  antigravity: ANTIGRAVITY_LOGO,
  custom: CUSTOM_LOGO
};
var PROVIDER_BUNDLES = PROFILE_BUNDLES.map((bundle) => ({
  ...bundle,
  logo: LOGOS[bundle.logoKey] ?? CUSTOM_LOGO
}));

// lib/config.ts
function expandTilde(p) {
  if (p.startsWith("~/") || p === "~") {
    return import_path.default.join((0, import_os.homedir)(), p.slice(2));
  }
  return p;
}
function slugPart(value) {
  const slug = value.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return slug || "root";
}
function derivePtyDaemonName(root, namespace, org) {
  return [
    "mentiko",
    slugPart(root),
    slugPart(namespace || "default"),
    slugPart(org || "default")
  ].join("-");
}
function encodeProjectPath(dir) {
  return dir.replace(/\//g, "-");
}
var globalRoot = expandTilde(
  process.env.MENTIKO_GLOBAL_ROOT || process.env.MENTIKO_ROOT || import_path.default.join((0, import_os.homedir)(), ".mentiko")
);
var codeRoot = process.env.MENTIKO_CODE_ROOT || import_path.default.resolve(process.cwd(), "..");
var namespaceId = process.env.NAMESPACE_ID || "default";
var orgId = process.env.ORG_ID || "default";
var ptyDaemonName = process.env.PTY_DAEMON || derivePtyDaemonName(globalRoot, namespaceId, orgId);
process.env.PTY_DAEMON = ptyDaemonName;
var projectDir = process.env.MENTIKO_PROJECT_DIR || codeRoot;
var projectId = encodeProjectPath(projectDir);
var namespaceRoot = process.env.MENTIKO_NAMESPACE_ROOT || import_path.default.join(globalRoot, "namespaces", namespaceId);
var orgRoot = process.env.MENTIKO_ORG_ROOT || (orgId === "default" ? namespaceRoot : import_path.default.join(namespaceRoot, "orgs", orgId));
var projectRoot = process.env.MENTIKO_PROJECT_ROOT || (projectDir === codeRoot ? orgRoot : import_path.default.join(orgRoot, "projects", projectId));
var claudeProjectsBase = process.env.CLAUDE_PROJECTS_DIR || import_path.default.join((0, import_os.homedir)(), ".claude", "projects");
var ptyManagerDir = process.env.PTY_MANAGER_DIR || import_path.default.join((0, import_os.homedir)(), ".pty-manager");
var demoWorkspaceDir = process.env.DEMO_WORKSPACE_DIR || import_path.default.join(globalRoot, "demo-workspace");
var config = {
  // --- roots ---
  globalRoot,
  codeRoot,
  namespaceRoot,
  orgRoot,
  projectRoot,
  // --- IDs ---
  namespaceId,
  orgId,
  projectId,
  projectDir,
  // backward compat: root was used for code paths (bin, lib, scripts)
  root: codeRoot,
  // backward compat: namespacesBase used by some API routes
  namespacesBase: import_path.default.join(globalRoot, "namespaces"),
  // --- tier 1: global ---
  authDbPath: import_path.default.join(globalRoot, "data", "auth.db"),
  // --- tier 2: namespace ---
  billingDir: import_path.default.join(namespaceRoot, "billing"),
  namespaceSettingsDir: import_path.default.join(namespaceRoot, "settings"),
  marketplaceDir: import_path.default.join(namespaceRoot, "marketplace"),
  // --- tier 3: org ---
  chainsDir: process.env.CHAIN_DIR || import_path.default.join(orgRoot, "chains"),
  linksDir: process.env.LINKS_DIR || import_path.default.join(orgRoot, "links"),
  agentsDir: process.env.AGENTS_DIR || import_path.default.join(orgRoot, "agents"),
  agentProfilesDir: process.env.AGENT_PROFILES_DIR || import_path.default.join(orgRoot, "agent-profiles"),
  configProfilesDir: process.env.CONFIG_PROFILES_DIR || import_path.default.join(orgRoot, "config-profiles"),
  templatesDir: process.env.TEMPLATES_DIR || import_path.default.join(orgRoot, "templates"),
  webhooksDir: process.env.WEBHOOKS_DIR || import_path.default.join(orgRoot, "webhooks"),
  emailsDir: process.env.EMAILS_DIR || import_path.default.join(orgRoot, "emails"),
  // --- tier 4: project ---
  runsDir: process.env.RUNS_DIR || import_path.default.join(projectRoot, "runs"),
  jobsDir: process.env.JOBS_DIR || import_path.default.join(projectRoot, "jobs"),
  eventsDir: process.env.EVENTS_DIR || import_path.default.join(projectRoot, "events"),
  stateDir: process.env.STATE_DIR || import_path.default.join(projectRoot, "state"),
  decisionsDir: process.env.DECISIONS_DIR || import_path.default.join(projectRoot, "decisions"),
  schedulesDir: process.env.SCHEDULES_DIR || import_path.default.join(projectRoot, "schedules"),
  metricsDir: process.env.METRICS_DIR || import_path.default.join(projectRoot, "metrics"),
  notificationsDir: process.env.NOTIFICATIONS_DIR || import_path.default.join(projectRoot, "notifications"),
  reportsDir: process.env.REPORTS_DIR || import_path.default.join(projectRoot, "reports"),
  debugDir: process.env.DEBUG_DIR || import_path.default.join(projectRoot, "debug"),
  workspaceDir: process.env.WORKSPACE_DIR || import_path.default.join(projectRoot, "workspace"),
  profilesDir: process.env.PROFILES_DIR || import_path.default.join(projectRoot, "profiles"),
  watchdogHooksDir: process.env.WATCHDOG_HOOKS_DIR || import_path.default.join(projectRoot, "watchdog-hooks"),
  // --- code root (not data, these are executables/scripts) ---
  binDir: process.env.BIN_DIR || import_path.default.join(codeRoot, "bin"),
  libDir: process.env.LIB_DIR || import_path.default.join(codeRoot, "lib"),
  // --- external tool paths (system-level, not data) ---
  ptyManagerDir,
  ptySocketPath: process.env.PTY_SOCKET_PATH || null,
  ptyTokenPath: process.env.PTY_TOKEN_PATH || null,
  ptyDaemonName,
  demoWorkspaceDir,
  claudeProjectsDir: claudeProjectsBase,
  infraSshPublicKey: process.env.MENTIKO_SSH_PUBLIC_KEY || null,
  infraSshPrivateKey: process.env.MENTIKO_SSH_PRIVATE_KEY || null,
  // --- operational ---
  cliBin: process.env.CLI_BIN || "claude",
  sessionPrefix: process.env.SESSION_PREFIX || "mentiko",
  defaultMaxRounds: parseInt(process.env.DEFAULT_MAX_ROUNDS || "50", 10),
  polling: {
    sessions: parseInt(process.env.POLLING_SESSIONS || "3000", 10),
    output: parseInt(process.env.POLLING_OUTPUT || "2000", 10),
    conversations: parseInt(process.env.POLLING_CONVERSATIONS || "5000", 10),
    messages: parseInt(process.env.POLLING_MESSAGES || "3000", 10)
  }
};

// lib/system/system-logger.ts
var LOG_LEVELS = ["error", "warn", "info"];
function trimmedString(value) {
  if (typeof value !== "string") return void 0;
  const trimmed = value.trim();
  return trimmed ? trimmed : void 0;
}
function normalizeSystemLogSubmission(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, error: "submission must be an object" };
  const candidate = raw;
  const level = trimmedString(candidate.level);
  const source = trimmedString(candidate.source);
  const message = trimmedString(candidate.message);
  const detail = trimmedString(candidate.detail);
  if (!level || !source || !message) return { ok: false, error: "level, source, message required" };
  if (!LOG_LEVELS.includes(level)) {
    return { ok: false, error: `level must be one of ${LOG_LEVELS.join(", ")}` };
  }
  return { ok: true, submission: { level, source, message, ...detail ? { detail } : {} } };
}

// lib/system/system-log-cli.ts
function parseArguments(argv) {
  const parsed = { level: "", source: "", message: "", detail: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1] ?? "";
    switch (argv[index]) {
      case "--level":
        parsed.level = value;
        index += 1;
        break;
      case "--source":
        parsed.source = value;
        index += 1;
        break;
      case "--message":
        parsed.message = value;
        index += 1;
        break;
      case "--detail":
        parsed.detail = value;
        index += 1;
        break;
      default:
        break;
    }
  }
  return parsed;
}
function resolveSystemLogEndpoint(env = process.env) {
  const port = env.WEB_PORT || env.PORT || "3000";
  return `${env.MENTIKO_WEB_URL || `http://localhost:${port}`}/api/system/logs`;
}
async function main() {
  const args = parseArguments(process.argv.slice(2));
  const normalized = normalizeSystemLogSubmission(args);
  if (!normalized.ok) {
    process.stderr.write(`system-log: ${normalized.error}
`);
    return;
  }
  try {
    await fetch(resolveSystemLogEndpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.BETTER_AUTH_SECRET || ""}`,
        "x-namespace-id": process.env.NAMESPACE_ID || "default",
        "x-org-id": process.env.ORG_ID || "default"
      },
      body: JSON.stringify(normalized.submission)
    });
  } catch {
  }
}
if (require.main === module) {
  void main();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  resolveSystemLogEndpoint
});
