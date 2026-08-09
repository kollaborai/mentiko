#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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

// lib/runner-v2/entry-code-root.ts
var import_fs = require("fs");
var import_path = require("path");
function findCodeRootFrom(startDir, maxHops = 8) {
  let dir = (0, import_path.resolve)(startDir);
  for (let hop = 0; hop <= maxHops; hop++) {
    if ((0, import_fs.existsSync)((0, import_path.join)(dir, "lib", "chain-runner.sh"))) return dir;
    const parent = (0, import_path.dirname)(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}
function anchorCodeRootEnv(startDir) {
  const existing = process.env.MENTIKO_CODE_ROOT?.trim();
  if (existing) return existing;
  const found = findCodeRootFrom(startDir);
  if (found) process.env.MENTIKO_CODE_ROOT = found;
  return found;
}

// lib/runner-v2/entry-code-root-anchor.ts
anchorCodeRootEnv(__dirname);

// lib/runner-v2/completion-launch.ts
var import_fs4 = require("fs");
var import_path5 = require("path");

// lib/config.ts
var import_path2 = __toESM(require("path"));
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
          name: "Codex / GPT-5.5",
          cli: "codex",
          model: "gpt-5.5",
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
          description: "Flagship model for complex coding and agentic work"
        },
        {
          id: "codex-fast",
          name: "Codex / GPT-5.4 mini",
          cli: "codex",
          model: "gpt-5.4-mini",
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
          description: "Faster, lower-cost Codex profile for focused tasks"
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
          name: "OpenCode / GPT-5.5",
          cli: "opencode",
          model: "openai/gpt-5.5",
          pipe_flag: "-p",
          readiness: { enabled: true, ready_patterns: [{ name: "opencode input ready", type: "text", value: "Ask anything", action: "ready", risk: "low", enabled: true }, { name: "opencode command hint", type: "text", value: "ctrl+p commands", action: "ready", risk: "low", enabled: true }] },
          description: "OpenAI GPT-5.5 via OpenCode runner"
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
        model: "gpt-5.4-mini",
        pipe_flag: "exec",
        permission_flag: "--dangerously-bypass-approvals-and-sandbox",
        readiness: {
          enabled: true,
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
      model: "gpt-5.5",
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
    codexInlineAuthModel: "gpt-5.5"
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
    return import_path2.default.join((0, import_os.homedir)(), p.slice(2));
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
  process.env.MENTIKO_GLOBAL_ROOT || process.env.MENTIKO_ROOT || import_path2.default.join((0, import_os.homedir)(), ".mentiko")
);
var codeRoot = process.env.MENTIKO_CODE_ROOT || import_path2.default.resolve(process.cwd(), "..");
var namespaceId = process.env.NAMESPACE_ID || "default";
var orgId = process.env.ORG_ID || "default";
var ptyDaemonName = process.env.PTY_DAEMON || derivePtyDaemonName(globalRoot, namespaceId, orgId);
process.env.PTY_DAEMON = ptyDaemonName;
var projectDir = process.env.MENTIKO_PROJECT_DIR || codeRoot;
var projectId = encodeProjectPath(projectDir);
var namespaceRoot = process.env.MENTIKO_NAMESPACE_ROOT || import_path2.default.join(globalRoot, "namespaces", namespaceId);
var orgRoot = process.env.MENTIKO_ORG_ROOT || (orgId === "default" ? namespaceRoot : import_path2.default.join(namespaceRoot, "orgs", orgId));
var projectRoot = process.env.MENTIKO_PROJECT_ROOT || (projectDir === codeRoot ? orgRoot : import_path2.default.join(orgRoot, "projects", projectId));
var claudeProjectsBase = process.env.CLAUDE_PROJECTS_DIR || import_path2.default.join((0, import_os.homedir)(), ".claude", "projects");
var ptyManagerDir = process.env.PTY_MANAGER_DIR || import_path2.default.join((0, import_os.homedir)(), ".pty-manager");
var demoWorkspaceDir = process.env.DEMO_WORKSPACE_DIR || import_path2.default.join(globalRoot, "demo-workspace");
function ptyDaemonEnv() {
  const env = {
    PTY_DAEMON: ptyDaemonName,
    PTY_MANAGER_DIR: ptyManagerDir
  };
  if (process.env.PTY_SOCKET_PATH) env.PTY_SOCKET_PATH = process.env.PTY_SOCKET_PATH;
  return env;
}
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
  namespacesBase: import_path2.default.join(globalRoot, "namespaces"),
  // --- tier 1: global ---
  authDbPath: import_path2.default.join(globalRoot, "data", "auth.db"),
  // --- tier 2: namespace ---
  billingDir: import_path2.default.join(namespaceRoot, "billing"),
  namespaceSettingsDir: import_path2.default.join(namespaceRoot, "settings"),
  marketplaceDir: import_path2.default.join(namespaceRoot, "marketplace"),
  // --- tier 3: org ---
  chainsDir: process.env.CHAIN_DIR || import_path2.default.join(orgRoot, "chains"),
  linksDir: process.env.LINKS_DIR || import_path2.default.join(orgRoot, "links"),
  agentsDir: process.env.AGENTS_DIR || import_path2.default.join(orgRoot, "agents"),
  agentProfilesDir: process.env.AGENT_PROFILES_DIR || import_path2.default.join(orgRoot, "agent-profiles"),
  configProfilesDir: process.env.CONFIG_PROFILES_DIR || import_path2.default.join(orgRoot, "config-profiles"),
  templatesDir: process.env.TEMPLATES_DIR || import_path2.default.join(orgRoot, "templates"),
  webhooksDir: process.env.WEBHOOKS_DIR || import_path2.default.join(orgRoot, "webhooks"),
  emailsDir: process.env.EMAILS_DIR || import_path2.default.join(orgRoot, "emails"),
  // --- tier 4: project ---
  runsDir: process.env.RUNS_DIR || import_path2.default.join(projectRoot, "runs"),
  jobsDir: process.env.JOBS_DIR || import_path2.default.join(projectRoot, "jobs"),
  eventsDir: process.env.EVENTS_DIR || import_path2.default.join(projectRoot, "events"),
  stateDir: process.env.STATE_DIR || import_path2.default.join(projectRoot, "state"),
  decisionsDir: process.env.DECISIONS_DIR || import_path2.default.join(projectRoot, "decisions"),
  schedulesDir: process.env.SCHEDULES_DIR || import_path2.default.join(projectRoot, "schedules"),
  metricsDir: process.env.METRICS_DIR || import_path2.default.join(projectRoot, "metrics"),
  notificationsDir: process.env.NOTIFICATIONS_DIR || import_path2.default.join(projectRoot, "notifications"),
  reportsDir: process.env.REPORTS_DIR || import_path2.default.join(projectRoot, "reports"),
  debugDir: process.env.DEBUG_DIR || import_path2.default.join(projectRoot, "debug"),
  workspaceDir: process.env.WORKSPACE_DIR || import_path2.default.join(projectRoot, "workspace"),
  profilesDir: process.env.PROFILES_DIR || import_path2.default.join(projectRoot, "profiles"),
  watchdogHooksDir: process.env.WATCHDOG_HOOKS_DIR || import_path2.default.join(projectRoot, "watchdog-hooks"),
  // --- code root (not data, these are executables/scripts) ---
  binDir: process.env.BIN_DIR || import_path2.default.join(codeRoot, "bin"),
  libDir: process.env.LIB_DIR || import_path2.default.join(codeRoot, "lib"),
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
var config_default = config;

// lib/pty/pty-client.ts
var import_net = require("net");
var import_path3 = require("path");
var import_fs2 = require("fs");
var import_child_process = require("child_process");
var DAEMON_NAME = config.ptyDaemonName;
var getSocketPath = () => {
  if (config.ptySocketPath) return config.ptySocketPath;
  return (0, import_path3.join)(config.ptyManagerDir, `${DAEMON_NAME}.sock`);
};
var SOCKET_PATH = getSocketPath();
function resolvePtyMgrPath({
  codeRoot: codeRoot2,
  cwd = process.cwd(),
  env = process.env,
  exists = import_fs2.existsSync
}) {
  const libPath = (0, import_path3.join)(codeRoot2, "lib", "pty-manager.mjs");
  const candidates = [
    env.PTY_MGR_BIN,
    env.MENTIKO_PTY_MGR_BIN,
    (0, import_path3.join)(codeRoot2, "node_modules", ".bin", "pty-mgr"),
    (0, import_path3.join)(codeRoot2, "web", "node_modules", ".bin", "pty-mgr"),
    "/usr/local/bin/pty-mgr",
    (0, import_path3.join)(codeRoot2, "bin", "pty-mgr"),
    libPath
  ].filter((path2) => Boolean(path2));
  const seen = /* @__PURE__ */ new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (exists(candidate)) return candidate;
  }
  let dir = cwd;
  for (let i = 0; i < 5; i++) {
    const binCandidate = (0, import_path3.join)(dir, "bin", "pty-mgr");
    const libCandidate = (0, import_path3.join)(dir, "lib", "pty-manager.mjs");
    if (!seen.has(binCandidate) && exists(binCandidate)) return binCandidate;
    if (!seen.has(libCandidate) && exists(libCandidate)) return libCandidate;
    const parent = (0, import_path3.dirname)(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return libPath;
}
function findPtyMgr() {
  return resolvePtyMgrPath({ codeRoot: config.codeRoot });
}
var PTY_MGR_PATH = findPtyMgr();
function sendCommand(req) {
  return new Promise((resolve3, reject) => {
    const conn = (0, import_net.createConnection)(SOCKET_PATH);
    let buf = "";
    conn.on("error", (err) => {
      if (err.code === "ENOENT" || err.code === "ECONNREFUSED") {
        reject(new Error("daemon not running"));
      } else {
        reject(err);
      }
    });
    conn.on("connect", () => {
      conn.write(JSON.stringify(req) + "\n");
    });
    conn.on("data", (data) => {
      buf += data.toString();
      const nl = buf.indexOf("\n");
      if (nl !== -1) {
        const res = JSON.parse(buf.slice(0, nl));
        conn.end();
        resolve3(res);
      }
    });
    const timeout = setTimeout(() => {
      conn.destroy();
      reject(new Error("daemon command timed out"));
    }, 1e4);
    conn.on("close", () => clearTimeout(timeout));
  });
}
async function ensurePtyDaemon() {
  try {
    await sendCommand({ cmd: "status" });
    return;
  } catch {
  }
  return new Promise((resolve3, reject) => {
    let child;
    try {
      const isMjs = PTY_MGR_PATH.endsWith(".mjs");
      const cmd = isMjs ? "node" : PTY_MGR_PATH;
      const args = isMjs ? [PTY_MGR_PATH, "daemon"] : ["daemon"];
      child = (0, import_child_process.spawn)(cmd, args, {
        detached: true,
        stdio: ["ignore", "ignore", "ignore"],
        env: {
          ...process.env,
          MENTIKO_GLOBAL_ROOT: config.globalRoot,
          MENTIKO_CODE_ROOT: config.codeRoot,
          MENTIKO_PROJECT_ROOT: config.projectRoot,
          MENTIKO_ORG_ROOT: config.orgRoot,
          MENTIKO_NAMESPACE_ROOT: config.namespaceRoot,
          NAMESPACE_ID: config.namespaceId,
          ORG_ID: config.orgId,
          ...ptyDaemonEnv()
        }
      });
    } catch {
      return reject(new Error(`pty-manager binary not found at ${PTY_MGR_PATH}`));
    }
    child.on("error", () => {
    });
    child.unref();
    let retries = 0;
    const check = setInterval(async () => {
      retries++;
      try {
        await sendCommand({ cmd: "status" });
        clearInterval(check);
        resolve3();
      } catch {
        if (retries >= 20) {
          clearInterval(check);
          reject(new Error("failed to start pty-manager daemon"));
        }
      }
    }, 250);
  });
}
var PtyClient = class {
  // spawn a new session
  async spawn(name, cmd, args, opts) {
    await ensurePtyDaemon();
    const res = await sendCommand({
      cmd: "spawn",
      name,
      args: { cmd: cmd || "zsh", args: args || [], ...opts }
    });
    if (!res.ok) throw new Error(res.error || "spawn failed");
    return { name: res.name, pid: res.pid };
  }
  // send text + enter to a session
  // `enter: true` is REQUIRED for the daemon to submit. Its send handler is
  // `if (enter && !raw) { sleep(config.sendDelay); sendKeys("\r") }` — with
  // `enter` absent it defaults to false and the daemon delivers the text and
  // stops, making this identical to sendRaw. We omitted the flag, so every
  // sendKeys caller here has been typing into the composer without ever
  // pressing return: agent instructions, steer messages, terminal commands,
  // peer-link prompts, monitor nudges. The pty-mgr CLI always sent
  // `enter: !raw`; only this client didn't. The daemon owns the settle delay
  // (config.sendDelay, default 1000ms) — never hand-roll it caller-side.
  async sendKeys(name, text) {
    const res = await sendCommand({
      cmd: "send",
      name,
      args: { text, enter: true }
    });
    if (!res.ok) throw new Error(res.error || "send failed");
  }
  // send raw text (no enter)
  async sendRaw(name, text) {
    const res = await sendCommand({
      cmd: "send",
      name,
      args: { text, raw: true }
    });
    if (!res.ok) throw new Error(res.error || "send failed");
  }
  // capture session output
  async capture(name, lines) {
    const res = await sendCommand({
      cmd: "capture",
      name,
      args: lines ? { lines } : void 0
    });
    if (!res.ok) throw new Error(res.error || "capture failed");
    return res.output || "";
  }
  // check if session exists and is alive
  async alive(name) {
    try {
      const res = await sendCommand({ cmd: "alive", name });
      return res.ok && res.alive === true;
    } catch {
      return false;
    }
  }
  // check if session exists (alive or dead)
  async has(name) {
    try {
      const res = await sendCommand({ cmd: "has", name });
      return res.ok && res.exists === true;
    } catch {
      return false;
    }
  }
  // kill a session (keeps it in manager as "dead")
  async kill(name) {
    try {
      await sendCommand({ cmd: "kill", name });
    } catch {
    }
  }
  // remove a session (kill + delete from manager)
  async remove(name) {
    try {
      await sendCommand({ cmd: "remove", name });
    } catch {
    }
  }
  // list all sessions
  async list() {
    await ensurePtyDaemon();
    const res = await sendCommand({ cmd: "list" });
    if (!res.ok) return [];
    return res.sessions || [];
  }
  // get session info
  async info(name) {
    try {
      const res = await sendCommand({ cmd: "info", name });
      if (!res.ok) return null;
      return res.info;
    } catch {
      return null;
    }
  }
  // get child process pid
  async pid(name) {
    try {
      const res = await sendCommand({ cmd: "pid", name });
      if (!res.ok) return null;
      return res.pid;
    } catch {
      return null;
    }
  }
  // get daemon status
  async status() {
    try {
      const res = await sendCommand({ cmd: "status" });
      if (!res.ok) return null;
      return res.status;
    } catch {
      return null;
    }
  }
};
var pty = new PtyClient();

// lib/runner-v2/completion-launch-context.ts
var import_fs3 = require("fs");
var import_path4 = require("path");
var import_os2 = require("os");
var CONTEXT_DIR_PREFIX = "mentiko-completion-context-";
var CONTEXT_FILE_NAME = "context.json";
var REAL_TMP_DIR = (0, import_fs3.realpathSync)((0, import_os2.tmpdir)());
var COMPLETION_CONTEXT_ENV_KEYS = [
  "DEBUG",
  "MENTIKO_DEBUG",
  "NODE_ENV",
  "MENTIKO_RUN_ID",
  "RUN_ID",
  "NAMESPACE_ID",
  "ORG_ID",
  "WORKSPACE_TYPE",
  "MENTIKO_RUN_DIR",
  "RUN_DIR",
  "RUNS_DIR",
  "MENTIKO_GLOBAL_ROOT",
  "MENTIKO_CODE_ROOT",
  "MENTIKO_PROJECT_ROOT",
  "MENTIKO_ORG_ROOT",
  "MENTIKO_NAMESPACE_ROOT",
  "EVENTS_DIR",
  "STATE_DIR",
  "SCHEDULES_DIR",
  "AGENT_PROFILES_DIR",
  "MENTIKO_WEB_URL",
  // Routed agents can require authenticated Mentiko MCP operations. Keep this
  // run-scoped capability in the private one-shot context, never in argv or
  // durable run state.
  "MENTIKO_SESSION_ID",
  "MENTIKO_SESSION_TOKEN",
  "KOLLABOR_ENGINE_URL",
  "MENTIKO_RUNNER_V2",
  "MENTIKO_RUNNER_V2_COMPLETION",
  "MENTIKO_RUNNER_V2_COMPLETION_DRY_RUN",
  "MENTIKO_RUNNER_V2_COMPLETION_MAX_EXTENSIONS",
  "MENTIKO_RUNNER_V2_PTY_PROBE_TIMEOUT_MS",
  "MENTIKO_LAUNCH_ACCEPT_TIMEOUT_MS",
  "MENTIKO_NEXT_CHAIN_ACCEPT_TIMEOUT_MS",
  "MENTIKO_COMPLETION_OCCURRENCE_ID",
  "MENTIKO_MONITOR_COMPLETION_LATCH",
  "MENTIKO_AI_GATEWAY_LOCAL_PROXY_ENABLED",
  "MENTIKO_AI_GATEWAY_LOCAL_BASE_URL",
  "MENTIKO_AI_GATEWAY_LOCAL_TOKEN",
  "MENTIKO_GENERATION_JOB_ID",
  "MENTIKO_GENERATION_KIND",
  "MENTIKO_JOB_IMPORT_TOKEN",
  "MENTIKO_TASK_ID",
  "MENTIKO_PARENT_RUN_ID",
  "MENTIKO_MONITOR_STATE_DIR",
  "MENTIKO_AGENT_PROFILE_PATH",
  "MENTIKO_WORKSPACE_PATH",
  "MENTIKO_PTY_MGR_BIN",
  "PTY_MGR_BIN",
  "MENTIKO_RETRY_ATTEMPT",
  "RETRY_ATTEMPT",
  "PTY_DAEMON"
];
var ALLOWED_KEYS = new Set(COMPLETION_CONTEXT_ENV_KEYS);
var REQUIRED_KEYS = [
  "MENTIKO_RUN_ID",
  "MENTIKO_RUN_DIR",
  "MENTIKO_CODE_ROOT",
  "EVENTS_DIR",
  "STATE_DIR"
];
function createCompletionLaunchContext(input) {
  const env = {};
  for (const key of COMPLETION_CONTEXT_ENV_KEYS) {
    const value = input[key];
    if (typeof value === "string") env[key] = value;
  }
  validateContextEnv(env);
  const dir = (0, import_fs3.mkdtempSync)((0, import_path4.join)(REAL_TMP_DIR, CONTEXT_DIR_PREFIX));
  (0, import_fs3.chmodSync)(dir, 448);
  const path2 = (0, import_path4.join)(dir, CONTEXT_FILE_NAME);
  (0, import_fs3.writeFileSync)(path2, `${JSON.stringify({ version: 1, env })}
`, {
    encoding: "utf8",
    flag: "wx",
    mode: 384
  });
  (0, import_fs3.chmodSync)(path2, 384);
  return { dir, path: path2 };
}
function cleanupCompletionLaunchContext(path2) {
  if (!isCompletionLaunchContextPath(path2)) return;
  try {
    (0, import_fs3.unlinkSync)(path2);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    (0, import_fs3.rmdirSync)((0, import_path4.dirname)(path2));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
function isCompletionLaunchContextPath(path2) {
  if (!path2 || !(0, import_path4.isAbsolute)(path2) || (0, import_path4.resolve)(path2) !== path2 || (0, import_path4.basename)(path2) !== CONTEXT_FILE_NAME) {
    return false;
  }
  const parent = (0, import_path4.dirname)(path2);
  const dirName = (0, import_path4.basename)(parent);
  return (0, import_path4.dirname)(parent) === REAL_TMP_DIR && /^mentiko-completion-context-[A-Za-z0-9_-]+$/.test(dirName);
}
function validateContextEnv(env) {
  for (const key of REQUIRED_KEYS) {
    if (!env[key]?.trim()) throw new Error(`completion launch context missing required key: ${key}`);
  }
}

// lib/runner-v2/completion-launch.ts
async function launchRunnerV2CompletionPty(input) {
  const env = input.env || process.env;
  const runId = env.MENTIKO_RUN_ID || env.RUN_ID || "";
  const runDir = env.MENTIKO_RUN_DIR || (env.RUNS_DIR && runId ? (0, import_path5.join)(env.RUNS_DIR, runId) : "");
  const completionSession = input.completionSession || `complete-${input.sessionName}-${Math.floor(Date.now() / 1e3)}`;
  const entrypoint = resolveCompletionEntrypoint(config_default.codeRoot);
  const context = createCompletionLaunchContext({
    ...env,
    MENTIKO_RUN_ID: runId,
    RUN_ID: runId,
    MENTIKO_RUN_DIR: runDir,
    MENTIKO_CODE_ROOT: config_default.codeRoot,
    MENTIKO_RUNNER_V2: "1",
    MENTIKO_RUNNER_V2_COMPLETION: "1"
  });
  let launched;
  try {
    launched = await pty.spawn(
      completionSession,
      process.execPath,
      [entrypoint, input.sessionName, input.chainPath, context.path]
    );
  } catch (error) {
    cleanupCompletionLaunchContext(context.path);
    throw error;
  }
  if (!await waitForContextConsumption(context.path, input.contextAckTimeoutMs ?? 5e3)) {
    await pty.remove(completionSession).catch(() => {
    });
    cleanupCompletionLaunchContext(context.path);
    throw new Error("runner-v2 completion failed closed: child did not consume launch context");
  }
  cleanupCompletionLaunchContext(context.path);
  return launched;
}
function resolveCompletionEntrypoint(codeRoot2, fileExists = import_fs4.existsSync) {
  const compiled = (0, import_path5.join)(codeRoot2, "lib", "runner-v2-complete.js");
  if (fileExists(compiled)) return compiled;
  throw new Error("runner-v2 completion failed closed: typed completion entrypoint missing");
}
async function waitForContextConsumption(path2, timeoutMs) {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while ((0, import_fs4.existsSync)(path2)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve3) => setTimeout(resolve3, 25));
  }
  return true;
}

// lib/runner-v2/completion-launch-cli.ts
async function main() {
  const sessionName = process.argv[2];
  const chainPath = process.argv[3];
  if (!sessionName || !chainPath) {
    console.error("usage: runner-v2-completion-launch <session-name> <chain.json>");
    process.exitCode = 64;
    return;
  }
  const launched = await launchRunnerV2CompletionPty({ sessionName, chainPath });
  console.log(JSON.stringify({ status: "started", session: launched.name, pid: launched.pid }));
}
main().catch((error) => {
  console.error(`runner-v2 completion launch failed closed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
