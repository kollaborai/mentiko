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

// lib/runner-v2/readiness-cli.ts
var readiness_cli_exports = {};
__export(readiness_cli_exports, {
  runReadinessCli: () => runReadinessCli,
  waitForReadiness: () => waitForReadiness
});
module.exports = __toCommonJS(readiness_cli_exports);
var import_node_child_process = require("node:child_process");
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");

// lib/runner-v2/agent-profile.ts
var import_node_fs = require("node:fs");
var import_node_os = require("node:os");
var import_node_path = require("node:path");

// lib/secrets/secrets-store.ts
var import_crypto2 = require("crypto");
var import_fs2 = require("fs");
var import_path3 = require("path");

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
          permission_flag: "--allow-dangerously-skip-permissions --permission-mode bypassPermissions",
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
          permission_flag: "--allow-dangerously-skip-permissions --permission-mode bypassPermissions",
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
          permission_flag: "--allow-dangerously-skip-permissions --permission-mode bypassPermissions",
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
function orgPath(nsId, oId, ...segments) {
  if (oId === "default") {
    return import_path.default.join(globalRoot, "namespaces", nsId, ...segments);
  }
  return import_path.default.join(globalRoot, "namespaces", nsId, "orgs", oId, ...segments);
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

// lib/secrets/dev-secret.ts
var import_crypto = require("crypto");
var import_fs = require("fs");
var import_os2 = require("os");
var import_path2 = require("path");
var _devSecretWarned = false;
var _devSecret = null;
var HKDF_LABELS = {
  session: "mentiko-session-signing-v1",
  vault: "mentiko-vault-encryption-v1",
  "user-crypto": "mentiko-user-crypto-v1"
};
function hkdfSha256(ikm, info, length = 32) {
  const prk = (0, import_crypto.createHmac)("sha256", "\0".repeat(32)).update(ikm).digest();
  const okm = (0, import_crypto.createHmac)("sha256", prk).update(info + "").digest();
  return okm.slice(0, length).toString("hex");
}
function getLocalDevSecret() {
  if (_devSecret) return _devSecret;
  const configured = process.env.MENTIKO_DEV_SECRET;
  if (configured) {
    _devSecret = configured;
    return _devSecret;
  }
  const root = process.env.MENTIKO_GLOBAL_ROOT || process.env.MENTIKO_ROOT || (0, import_path2.join)((0, import_os2.homedir)(), ".mentiko");
  const dir = (0, import_path2.join)(root, "data");
  const file = (0, import_path2.join)(dir, "dev-secret");
  try {
    if ((0, import_fs.existsSync)(file)) {
      const existing = (0, import_fs.readFileSync)(file, "utf8").trim();
      if (existing) {
        _devSecret = existing;
        return _devSecret;
      }
    }
    (0, import_fs.mkdirSync)(dir, { recursive: true });
    _devSecret = `dev-${(0, import_crypto.randomBytes)(32).toString("hex")}`;
    (0, import_fs.writeFileSync)(file, `${_devSecret}
`, { mode: 384 });
    try {
      (0, import_fs.chmodSync)(file, 384);
    } catch {
    }
    return _devSecret;
  } catch {
    _devSecret = `ephemeral-dev-${(0, import_crypto.randomBytes)(32).toString("hex")}`;
    return _devSecret;
  }
}
function getRootSecret(context) {
  const value = process.env.BETTER_AUTH_SECRET || process.env.SECRET_KEY;
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `BETTER_AUTH_SECRET is required in production (${context})`
    );
  }
  if (!_devSecretWarned) {
    _devSecretWarned = true;
    console.warn(
      "[security] BETTER_AUTH_SECRET not set - using local development secret. Set BETTER_AUTH_SECRET in web/.env.local before sharing data."
    );
  }
  return getLocalDevSecret();
}
function resolveAppSecret(purposeOrContext, slot = "current") {
  if (purposeOrContext !== "session" && purposeOrContext !== "vault" && purposeOrContext !== "user-crypto") {
    return getRootSecret(purposeOrContext);
  }
  const purpose = purposeOrContext;
  const isPrevious = slot === "previous";
  const envMap = {
    session: {
      current: "SESSION_SIGNING_KEY",
      previous: "SESSION_SIGNING_KEY_OLD"
    },
    vault: {
      current: "VAULT_ENCRYPTION_KEY",
      previous: "VAULT_ENCRYPTION_KEY_OLD"
    },
    "user-crypto": {
      current: "USER_CRYPTO_KEY",
      previous: "USER_CRYPTO_KEY_OLD"
    }
  };
  const envVar = envMap[purpose][isPrevious ? "previous" : "current"];
  const directValue = process.env[envVar];
  if (directValue) return directValue;
  const root = getRootSecret(`${purpose}-${slot}`);
  return hkdfSha256(root, HKDF_LABELS[purpose]);
}

// lib/secrets/secrets-store.ts
var KEY_DERIVATION_SALT = "mentiko-vault-crypto-v1";
var KEY_DERIVATION_ITERATIONS = 1e5;
var KEY_LENGTH_BYTES = 32;
var KEY_DERIVATION_LABEL = "mentiko-vault-encryption-v1";
function deriveVaultAppSecret(rootSecret) {
  const prk = (0, import_crypto2.createHmac)("sha256", "\0".repeat(32)).update(rootSecret).digest();
  return (0, import_crypto2.createHmac)("sha256", prk).update(`${KEY_DERIVATION_LABEL}`).digest("hex");
}
function resolveVaultSecret(secret) {
  if (secret !== void 0) {
    return deriveVaultAppSecret(secret);
  }
  return resolveAppSecret("vault", "current");
}
function resolveLegacyVaultSecret(secret) {
  if (secret !== void 0) {
    return secret;
  }
  return resolveAppSecret("vault-secret");
}
function getDerivedKey(secret) {
  const appSecret = deriveVaultAppSecret(resolveVaultSecret(secret));
  return (0, import_crypto2.pbkdf2Sync)(
    appSecret,
    KEY_DERIVATION_SALT,
    KEY_DERIVATION_ITERATIONS,
    KEY_LENGTH_BYTES,
    "sha256"
  );
}
function getLegacyDerivedKey(secret) {
  const rawSecret = resolveLegacyVaultSecret(secret);
  return (0, import_crypto2.pbkdf2Sync)(
    rawSecret,
    KEY_DERIVATION_SALT,
    KEY_DERIVATION_ITERATIONS,
    KEY_LENGTH_BYTES,
    "sha256"
  );
}
function getKeyId(key) {
  const derivedKey = key ?? getDerivedKey();
  return (0, import_crypto2.createHash)("sha256").update(derivedKey).digest("hex").slice(0, 16);
}
function decrypt(ciphertext, keyOverride) {
  try {
    if (ciphertext.startsWith("v1:")) {
      const parts = ciphertext.split(":", 5);
      if (parts.length !== 5) throw new Error("invalid v1 ciphertext format");
      const [, keyIdStored, ivHex, tagHex, encHex] = parts;
      const key = keyOverride ? getDerivedKey(keyOverride) : getDerivedKey();
      const keyId = getKeyId(key);
      if (keyIdStored !== keyId) {
        return null;
      }
      const decipher = (0, import_crypto2.createDecipheriv)("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
      decipher.setAuthTag(Buffer.from(tagHex, "hex"));
      return Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]).toString("utf8");
    } else {
      const parts = ciphertext.split(":");
      if (parts.length !== 3) throw new Error("invalid v0 ciphertext format");
      const [ivHex, tagHex, encHex] = parts;
      const primaryKey = keyOverride ? getDerivedKey(keyOverride) : getDerivedKey();
      const fallbackKey = getLegacyDerivedKey(keyOverride);
      const keyCandidates = [primaryKey, ...!primaryKey.equals(fallbackKey) ? [fallbackKey] : []];
      for (const candidate of keyCandidates) {
        try {
          const decipher = (0, import_crypto2.createDecipheriv)("aes-256-gcm", candidate, Buffer.from(ivHex, "hex"));
          decipher.setAuthTag(Buffer.from(tagHex, "hex"));
          return Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]).toString("utf8");
        } catch {
        }
      }
      return null;
    }
  } catch {
    return null;
  }
}
function secretsDir(namespaceId2, orgId2) {
  return orgPath(namespaceId2, orgId2, "secrets");
}
function getSecretByName(namespaceId2, orgId2, name) {
  const dir = secretsDir(namespaceId2, orgId2);
  if (!(0, import_fs2.existsSync)(dir)) return null;
  for (const f of (0, import_fs2.readdirSync)(dir).filter((x) => x.endsWith(".json"))) {
    try {
      const rec = JSON.parse((0, import_fs2.readFileSync)((0, import_path3.join)(dir, f), "utf-8"));
      if (rec.name === name && rec.encryptedValue) {
        const val = decrypt(rec.encryptedValue);
        if (!val) {
          console.warn(`[secrets] decryption failed: ${rec.id} \u2014 key mismatch or corrupt`);
        }
        return val;
      }
    } catch (err) {
      console.warn(`[secrets] error reading secret: ${f} \u2014 ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return null;
}

// lib/runner-v2/agent-profile.ts
var PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var ENV_KEY = /^[A-Z_][A-Z0-9_]*$/;
var SECRET_REFERENCE = /^\{secret:([^}]+)\}$/;
function resolveDefaultProfile(profilesDir, source = "namespace") {
  const candidates = listProfileFiles(profilesDir).map((path2) => loadAgentProfile(path2));
  const matches = candidates.filter((candidate) => source === "advisor" ? candidate.profile.isAdvisorDefault === true : candidate.profile.isDefault === true);
  if (matches.length > 1) throw new Error(`Multiple ${source} default agent profiles exist in ${profilesDir}`);
  const selected = matches[0];
  return selected ? { ...selected, source } : void 0;
}
function loadAgentProfile(profilePath) {
  if (!(0, import_node_path.isAbsolute)(profilePath)) throw new Error(`Agent profile path must be absolute: ${profilePath}`);
  const raw = readJson(profilePath, "agent profile");
  const profile = validateAgentProfile(raw, profilePath);
  const expectedId = (0, import_node_path.basename)(profilePath, ".json");
  if (expectedId !== profile.id) throw new Error(`Agent profile id '${profile.id}' does not match file name '${expectedId}'`);
  return { id: profile.id, name: profile.name, path: profilePath, profile };
}
function buildAgentProfileCommand(input) {
  const { profile } = loadAgentProfile(input.profilePath);
  const envFile = writeProfileEnvFile(profile, input.namespaceId, input.orgId);
  const permissionFlag = normalizePermissionFlag(profile.cli, profile.permission_flag);
  const model = input.modelOverride ?? (input.purpose === "relay" ? profile.relay_model ?? profile.model : profile.model);
  const args = [
    profile.cli,
    ...input.interactive || !profile.pipe_flag ? [] : [profile.pipe_flag],
    ...permissionFlag ? splitProfileArgumentString(permissionFlag, "permission_flag") : [],
    ...model ? ["--model", model] : [],
    ...profile.extra_args ?? []
  ];
  const command = args.map(shellQuote).join(" ");
  const setup = [
    envFile ? `source ${shellQuote(envFile)}; rm -f ${shellQuote(envFile)}; rmdir ${shellQuote((0, import_node_path.dirname)(envFile))} 2>/dev/null || true` : "",
    envFile && !Object.hasOwn(profile.env ?? {}, "ANTHROPIC_API_KEY") ? "unset ANTHROPIC_API_KEY" : "",
    profile.pre_exec ?? "",
    command
  ].filter(Boolean);
  return setup.join("; ");
}
function validateAgentProfile(value, path2) {
  if (!isRecord(value)) throw new Error(`Invalid agent profile JSON at ${path2}`);
  const id = requiredString(value.id, "id", path2);
  assertProfileId(id, "profile id");
  const name = requiredString(value.name, "name", path2);
  const cli = requiredString(value.cli, "cli", path2);
  const profile = {
    id,
    name,
    cli,
    isDefault: value.isDefault === true,
    ...value.isAdvisorDefault === true ? { isAdvisorDefault: true } : {},
    ...optionalString(value.description, "description", path2) ? { description: optionalString(value.description, "description", path2) } : {},
    ...optionalString(value.model, "model", path2) ? { model: optionalString(value.model, "model", path2) } : {},
    ...optionalString(value.relay_model, "relay_model", path2) ? { relay_model: optionalString(value.relay_model, "relay_model", path2) } : {},
    ...optionalString(value.pipe_flag, "pipe_flag", path2) ? { pipe_flag: optionalString(value.pipe_flag, "pipe_flag", path2) } : {},
    ...optionalString(value.permission_flag, "permission_flag", path2) ? { permission_flag: optionalString(value.permission_flag, "permission_flag", path2) } : {},
    ...optionalString(value.disallowed_tools, "disallowed_tools", path2) ? { disallowed_tools: optionalString(value.disallowed_tools, "disallowed_tools", path2) } : {},
    ...optionalString(value.pre_exec, "pre_exec", path2) ? { pre_exec: optionalString(value.pre_exec, "pre_exec", path2) } : {},
    ...optionalString(value.log_path, "log_path", path2) ? { log_path: optionalString(value.log_path, "log_path", path2) } : {},
    ...optionalString(value.log_format, "log_format", path2) ? { log_format: optionalString(value.log_format, "log_format", path2) } : {},
    ...value.extra_args === void 0 ? {} : { extra_args: stringArray(value.extra_args, "extra_args", path2) },
    ...value.env === void 0 ? {} : { env: profileEnv(value.env, path2) },
    ...value.readiness === void 0 ? {} : { readiness: readiness(value.readiness, path2) },
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : ""
  };
  return profile;
}
function listProfileFiles(profilesDir) {
  if (!(0, import_node_path.isAbsolute)(profilesDir)) throw new Error(`Agent profiles directory must be absolute: ${profilesDir}`);
  if (!(0, import_node_fs.existsSync)(profilesDir)) return [];
  return (0, import_node_fs.readdirSync)(profilesDir).filter((name) => name.endsWith(".json")).sort().map((name) => (0, import_node_path.join)(profilesDir, name));
}
function writeProfileEnvFile(profile, namespaceId2, orgId2) {
  const values = Object.entries(profile.env ?? {}).flatMap(([key, value]) => {
    const secret = value.match(SECRET_REFERENCE);
    if (!secret) return [[key, value]];
    const resolved = getSecretByName(namespaceId2, orgId2, secret[1]);
    return resolved === null ? [] : [[key, resolved]];
  });
  if (values.length === 0) return void 0;
  const dir = (0, import_node_fs.mkdtempSync)((0, import_node_path.join)((0, import_node_os.tmpdir)(), "mentiko-agent-profile-"));
  (0, import_node_fs.chmodSync)(dir, 448);
  const envPath = (0, import_node_path.join)(dir, "env.sh");
  (0, import_node_fs.writeFileSync)(envPath, `${values.map(([key, value]) => `export ${key}=${shellQuote(value)}`).join("\n")}
`, { mode: 384 });
  return envPath;
}
function normalizePermissionFlag(cli, permissionFlag) {
  if (cli === "claude" && permissionFlag === "--dangerously-skip-permissions") {
    return "--allow-dangerously-skip-permissions --permission-mode bypassPermissions";
  }
  return permissionFlag;
}
function splitProfileArgumentString(value, field) {
  const tokens = [];
  let token = "";
  let quote;
  let escaped = false;
  let started = false;
  for (const character of value) {
    if (escaped) {
      token += character;
      escaped = false;
      started = true;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      started = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = void 0;
      else token += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (started) {
        tokens.push(token);
        token = "";
        started = false;
      }
      continue;
    }
    token += character;
    started = true;
  }
  if (escaped || quote) throw new Error(`Invalid ${field}: unterminated escape or quote`);
  if (started) tokens.push(token);
  return tokens;
}
function readiness(value, path2) {
  if (!isRecord(value) || typeof value.enabled !== "boolean") throw new Error(`Invalid readiness configuration at ${path2}`);
  return value;
}
function profileEnv(value, path2) {
  if (!isRecord(value)) throw new Error(`Profile env must be an object at ${path2}`);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    if (!ENV_KEY.test(key) || typeof entry !== "string") throw new Error(`Invalid profile env entry '${key}' at ${path2}`);
    return [key, entry];
  }));
}
function stringArray(value, field, path2) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) throw new Error(`Profile ${field} must be a string array at ${path2}`);
  return value;
}
function assertProfileId(value, label) {
  if (!PROFILE_ID.test(value)) throw new Error(`Invalid ${label}: ${value}`);
}
function requiredString(value, field, path2) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Profile ${field} is required at ${path2}`);
  return value;
}
function optionalString(value, field, path2) {
  if (value === void 0) return void 0;
  if (typeof value !== "string") throw new Error(`Profile ${field} must be a string at ${path2}`);
  return value || void 0;
}
function readJson(path2, label) {
  try {
    return JSON.parse((0, import_node_fs.readFileSync)(path2, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${label} at ${path2}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function shellQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

// lib/runner-v2/readiness-policy.ts
var PATTERN_GROUPS = [
  { group: "blocked_patterns", status: "blocked" },
  { group: "recoverable_patterns", status: "recover" },
  { group: "retry_patterns", status: "retry" },
  { group: "ready_patterns", status: "ready" }
];
function isReadinessFailClosed(env = process.env) {
  return env.MENTIKO_READINESS_FAIL_CLOSED === "1";
}
function matchesPattern(output, pattern) {
  if (!pattern.value) return false;
  if (pattern.type === "regex") {
    try {
      return new RegExp(pattern.value, "i").test(output);
    } catch {
      return false;
    }
  }
  return output.includes(pattern.value);
}
function classifyCliReadiness(input) {
  if (input.profileMissing) {
    return { status: "unknown", reason: "profile file missing" };
  }
  const failClosed = input.failClosed ?? isReadinessFailClosed();
  const readiness2 = input.readiness;
  if (!readiness2 || readiness2.enabled !== true) {
    if (failClosed) {
      return { status: "no_ready_signal", reason: "readiness not enabled (fail-closed)" };
    }
    return { status: "ready", reason: "readiness disabled" };
  }
  for (const { group, status } of PATTERN_GROUPS) {
    for (const pattern of readiness2[group] ?? []) {
      if (pattern.enabled === false) continue;
      if (matchesPattern(input.output, pattern)) {
        const name = pattern.name || "unnamed pattern";
        return {
          status,
          reason: `matched ${name}`,
          pattern: name,
          ...pattern.action ? { action: pattern.action } : {},
          ...pattern.risk ? { risk: pattern.risk } : {}
        };
      }
    }
  }
  if ((readiness2.ready_patterns ?? []).length === 0) {
    if (failClosed) {
      return {
        status: "no_ready_signal",
        reason: "readiness enabled but no ready_patterns configured (fail-closed)"
      };
    }
    return { status: "ready", reason: "no ready patterns configured" };
  }
  return { status: "unknown", reason: "no readiness pattern matched" };
}

// lib/runner-v2/readiness-cli.ts
function runReadinessCli(argv, write = (line) => console.log(line)) {
  const [command, ...rest] = argv;
  if (!isCommand(command)) throw new Error(usage());
  const values = parse(rest);
  if (command === "classify") {
    reject(values, ["--profile-path", "--capture-path", "--fail-closed"]);
    const profilePath = required(values, "--profile-path");
    const capturePath = required(values, "--capture-path");
    if (!(0, import_node_fs2.existsSync)(profilePath)) {
      write(JSON.stringify({ status: "unknown", reason: "profile file missing" }));
      return;
    }
    if (!(0, import_node_fs2.existsSync)(capturePath)) {
      write(JSON.stringify({ status: "unknown", reason: "capture file missing" }));
      return;
    }
    assertRegularInput(profilePath, "profile");
    assertRegularInput(capturePath, "capture");
    let result;
    try {
      result = classifyCliReadiness({
        readiness: loadAgentProfile(profilePath).profile.readiness,
        output: (0, import_node_fs2.readFileSync)(capturePath, "utf8"),
        failClosed: optional(values, "--fail-closed") === "true"
      });
    } catch {
      result = { status: "unknown", reason: "readiness profile unreadable" };
    }
    write(JSON.stringify(result));
    return;
  }
  if (command === "wait") {
    reject(values, [
      "--profile-path",
      "--pty-cmd",
      "--session",
      "--max-wait-secs",
      "--poll-secs",
      "--fail-closed",
      "--capture-path",
      "--recovery-enabled",
      "--recovery-max",
      "--profiles-dir",
      "--namespace-id",
      "--org-id",
      "--agent-id",
      "--profile-id",
      "--run-id",
      "--cli",
      "--cwd",
      "--command",
      "--state-file",
      "--artifact-dir"
    ]);
    const waited = waitForReadiness({
      profilePath: required(values, "--profile-path"),
      ptyCommand: required(values, "--pty-cmd"),
      session: required(values, "--session"),
      maxWaitSecs: nonNegativeInteger(required(values, "--max-wait-secs"), "--max-wait-secs"),
      pollSecs: positiveInteger(required(values, "--poll-secs"), "--poll-secs"),
      failClosed: optional(values, "--fail-closed") === "true",
      capturePath: optional(values, "--capture-path"),
      recovery: buildRecovery(values)
    });
    write(JSON.stringify(waited.result));
    if (waited.exitCode !== 0) process.exitCode = waited.exitCode;
    return;
  }
  if (command === "result") {
    reject(values, ["--status", "--reason"]);
    write(JSON.stringify({ status: required(values, "--status"), reason: required(values, "--reason") }));
    return;
  }
  reject(values, ["--result-json", "--field"]);
  const parsed = JSON.parse(required(values, "--result-json"));
  const field = required(values, "--field");
  if (field !== "status" && field !== "reason") throw new Error("--field must be status or reason");
  write(typeof parsed[field] === "string" ? parsed[field] : "");
}
function waitForReadiness(input) {
  if (!(0, import_node_fs2.existsSync)(input.profilePath)) return { result: { status: "unknown", reason: "profile file missing" }, exitCode: 4 };
  assertRegularInput(input.profilePath, "profile");
  const now = input.now || (() => Date.now());
  const sleep = input.sleep || ((milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds));
  const run = input.run || ((command, args) => (0, import_node_child_process.spawnSync)(command, args, { encoding: "utf8" }));
  const started = now();
  let recoveryAttempts = 0;
  for (; ; ) {
    const alive = run(input.ptyCommand, ["alive", input.session]);
    const pid = run(input.ptyCommand, ["pid", input.session]);
    if (alive.status !== 0 || alive.stdout.trim() !== "alive" || pid.status !== 0 || !/^\d+$/.test(pid.stdout.trim())) {
      return { result: { status: "unknown", reason: "PTY session died during startup" }, exitCode: 1 };
    }
    const capture = run(input.ptyCommand, ["capture", input.session, "120"]);
    const output = capture.status === 0 ? capture.stdout : "";
    if (input.capturePath) writeCaptureAtomically(input.capturePath, output);
    const result = classifyCliReadiness({
      readiness: loadAgentProfile(input.profilePath).profile.readiness,
      output,
      failClosed: input.failClosed
    });
    if (result.status === "ready") return { result, exitCode: 0 };
    if (isRecoverable(result.status) && canAttemptRecovery(input.recovery, recoveryAttempts)) {
      recoveryAttempts += 1;
      if (attemptStartupRecovery(input, result, output, run)) continue;
    }
    if (isTerminal(result.status)) {
      writeStartupRecoveryArtifacts(input.recovery, result, output);
      return { result, exitCode: 2 };
    }
    if (!input.failClosed) return { result: { status: "ready", reason: "legacy readiness policy permits unresolved startup" }, exitCode: 0 };
    if (now() - started >= input.maxWaitSecs * 1e3) {
      const timeout = { status: "unknown", reason: `CLI readiness timeout after ${input.maxWaitSecs}s` };
      writeStartupRecoveryArtifacts(input.recovery, timeout, output);
      return { result: timeout, exitCode: 4 };
    }
    sleep(input.pollSecs * 1e3);
  }
}
function isRecoverable(status) {
  return status === "blocked" || status === "recover" || status === "retry";
}
function isTerminal(status) {
  return status === "blocked" || status === "recover" || status === "retry" || status === "no_ready_signal";
}
function canAttemptRecovery(recovery, attempts) {
  return Boolean(recovery?.enabled && recovery.profilesDir && attempts < recovery.maxAttempts);
}
function attemptStartupRecovery(input, readiness2, output, run) {
  const recovery = input.recovery;
  if (!recovery?.profilesDir) return false;
  let advisor;
  try {
    advisor = resolveDefaultProfile(recovery.profilesDir, "advisor");
  } catch {
    return false;
  }
  if (!advisor) return false;
  let advisorCommand;
  try {
    advisorCommand = buildAgentProfileCommand({
      profilePath: advisor.path,
      interactive: false,
      namespaceId: recovery.namespaceId || "default",
      orgId: recovery.orgId || "default",
      purpose: "agent"
    });
  } catch {
    return false;
  }
  const prompt = startupRecoveryPrompt(recovery, readiness2, output);
  const advisorRun = input.advisorRun || ((command, advisorInput) => (0, import_node_child_process.spawnSync)("/bin/bash", ["-lc", command], {
    input: advisorInput,
    encoding: "utf8",
    timeout: 12e4
  }));
  const response = advisorRun(advisorCommand, prompt);
  if (response.status !== 0) return false;
  const payload = parseAdvisorPayload(typeof response.stdout === "string" ? response.stdout : "");
  if (!payload || !isSafeRecoveryDecision(payload)) return false;
  appendRecoveryDecision(recovery, payload);
  if (payload.action === "send_keys") {
    if (!Array.isArray(payload.keys) || payload.keys.length === 0) return false;
    let applied = false;
    for (const key of payload.keys) {
      if (typeof key !== "string") return false;
      const sent = run(input.ptyCommand, ["send", input.session, "--raw", recoveryKeyBytes(key)]);
      if (sent.status !== 0) return false;
      applied = true;
    }
    return applied;
  }
  if (payload.action === "retry_launch") {
    if (!recovery.command) return false;
    return run(input.ptyCommand, ["send", input.session, recovery.command]).status === 0;
  }
  return false;
}
function startupRecoveryPrompt(recovery, readiness2, output) {
  const state = recovery.stateFile ? safeRead(recovery.stateFile) : "";
  return [
    "Mentiko startup recovery request. No agent task has been delivered yet unless the capture proves otherwise.",
    `run_id: ${recovery.runId || process.env.MENTIKO_RUN_ID || "none"}`,
    `agent_id: ${recovery.agentId || "unknown"}`,
    `profile_id: ${recovery.profileId || "unknown"}`,
    `cli: ${recovery.cli || "unknown"}`,
    `cwd: ${recovery.cwd || "unknown"}`,
    `attempted_command: ${recovery.command || ""}`,
    `readiness: ${JSON.stringify(readiness2)}`,
    `state_file:
${state}`,
    `terminal_capture:
${output}`,
    "Return strict JSON only using action send_keys | retry_launch | suggest_profile_fix | ask_human | no_action, confidence, risk, reason, and optional keys."
  ].join("\n\n");
}
function parseAdvisorPayload(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return void 0;
  try {
    const value = JSON.parse(text.slice(start, end + 1));
    return value && typeof value === "object" && !Array.isArray(value) ? value : void 0;
  } catch {
    return void 0;
  }
}
function isSafeRecoveryDecision(value) {
  return typeof value.action === "string" && ["send_keys", "retry_launch", "suggest_profile_fix", "ask_human", "no_action"].includes(value.action) && typeof value.confidence === "number" && ["low", "medium", "high"].includes(String(value.risk)) && typeof value.reason === "string" && value.confidence >= 0.85 && value.risk === "low" && (value.action === "send_keys" || value.action === "retry_launch");
}
function recoveryKeyBytes(key) {
  switch (key) {
    case "ENTER":
    case "RETURN":
    case "CR":
    case "\\r":
    case "\\n":
      return "\r";
    case "ESC":
    case "ESCAPE":
      return "\x1B";
    case "CTRL_C":
    case "^C":
      return "";
    case "TAB":
      return "	";
    case "SPACE":
      return " ";
    default:
      return key;
  }
}
function writeStartupRecoveryArtifacts(recovery, readiness2, output) {
  if (!recovery?.artifactDir || !recovery.agentId) return;
  const directory = recovery.artifactDir;
  if (!directory.startsWith("/")) throw new Error("startup recovery artifact directory must be absolute");
  ensureDirectory(directory, "startup recovery artifact directory");
  writeAtomic((0, import_node_path2.join)(directory, `${recovery.agentId}-startup-capture.txt`), output);
  writeAtomic((0, import_node_path2.join)(directory, `${recovery.agentId}-startup-readiness.json`), `${JSON.stringify(readiness2, null, 2)}
`);
}
function appendRecoveryDecision(recovery, decision) {
  if (!recovery.artifactDir || !recovery.agentId) return;
  const directory = ensureDirectory(recovery.artifactDir, "startup recovery artifact directory");
  const path2 = (0, import_node_path2.join)(directory, `${recovery.agentId}-startup-recovery-decisions.jsonl`);
  if ((0, import_node_fs2.existsSync)(path2) && (0, import_node_fs2.lstatSync)(path2).isSymbolicLink()) throw new Error("startup recovery decision log must not be a symlink");
  (0, import_node_fs2.appendFileSync)(path2, `${JSON.stringify(decision)}
`, { mode: 384 });
}
function safeRead(path2) {
  try {
    return (0, import_node_fs2.readFileSync)(path2, "utf8");
  } catch {
    return "";
  }
}
function writeCaptureAtomically(path2, content) {
  if ((0, import_node_fs2.existsSync)(path2)) assertRegularInput(path2, "capture");
  writeAtomic(path2, content);
}
function writeAtomic(path2, content) {
  const directory = ensureDirectory((0, import_node_path2.dirname)(path2), "capture directory");
  const target = (0, import_node_path2.join)(directory, (0, import_node_path2.basename)(path2));
  if ((0, import_node_fs2.existsSync)(target)) assertRegularInput(target, "capture");
  const temporary = `${target}.${process.pid}.tmp`;
  (0, import_node_fs2.writeFileSync)(temporary, content, { mode: 384 });
  (0, import_node_fs2.renameSync)(temporary, target);
}
function ensureDirectory(path2, label) {
  const candidate = canonicalizeTrustedSystemAlias(path2);
  assertExistingDirectoryComponents(candidate, label, path2);
  if (!(0, import_node_fs2.existsSync)(candidate)) (0, import_node_fs2.mkdirSync)(candidate, { recursive: true, mode: 448 });
  assertExistingDirectoryComponents(candidate, label, path2);
  return candidate;
}
function canonicalizeTrustedSystemAlias(path2) {
  const normalized = (0, import_node_path2.resolve)(path2);
  for (const alias of ["/tmp", "/var", "/etc"]) {
    if (normalized !== alias && !normalized.startsWith(`${alias}/`)) continue;
    const canonical = (0, import_node_fs2.realpathSync)(alias);
    return normalized === alias ? canonical : (0, import_node_path2.join)(canonical, normalized.slice(alias.length + 1));
  }
  return normalized;
}
function assertExistingDirectoryComponents(path2, label, originalPath) {
  const absolute = (0, import_node_path2.resolve)(path2);
  const root = (0, import_node_path2.parse)(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(import_node_path2.sep).filter(Boolean)) {
    current = (0, import_node_path2.join)(current, part);
    if (!(0, import_node_fs2.existsSync)(current)) return;
    const entry = (0, import_node_fs2.lstatSync)(current);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error(`${label} must be a non-symlink directory: ${originalPath}`);
    }
  }
}
function buildRecovery(values) {
  const enabled = optional(values, "--recovery-enabled") === "true";
  const profilesDir = optional(values, "--profiles-dir");
  if (!enabled && !profilesDir) return void 0;
  return {
    enabled,
    maxAttempts: nonNegativeInteger(optional(values, "--recovery-max") || "0", "--recovery-max"),
    profilesDir,
    runId: optional(values, "--run-id"),
    namespaceId: optional(values, "--namespace-id"),
    orgId: optional(values, "--org-id"),
    agentId: optional(values, "--agent-id"),
    profileId: optional(values, "--profile-id"),
    cli: optional(values, "--cli"),
    cwd: optional(values, "--cwd"),
    command: optional(values, "--command"),
    stateFile: optional(values, "--state-file"),
    artifactDir: optional(values, "--artifact-dir")
  };
}
function assertRegularInput(path2, label) {
  const entry = (0, import_node_fs2.lstatSync)(path2);
  if (entry.isSymbolicLink() || !entry.isFile()) throw new Error(`${label} input must be a non-symlink regular file: ${path2}`);
}
function nonNegativeInteger(value, label) {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a non-negative integer`);
  return Number(value);
}
function positiveInteger(value, label) {
  const result = nonNegativeInteger(value, label);
  if (!result) throw new Error(`${label} must be positive`);
  return result;
}
function parse(argv) {
  const values = /* @__PURE__ */ new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!key?.startsWith("--") || value === void 0 || values.has(key)) throw new Error(usage());
    values.set(key, value);
  }
  return values;
}
function required(values, key) {
  const value = values.get(key);
  if (!value) throw new Error(`${key} is required`);
  return value;
}
function optional(values, key) {
  return values.get(key);
}
function reject(values, allowed) {
  for (const key of values.keys()) if (!allowed.includes(key)) throw new Error(`${key} is not valid for runner-readiness`);
}
function isCommand(value) {
  return value === "classify" || value === "wait" || value === "result" || value === "result-field";
}
function usage() {
  return "usage: runner-readiness <classify|wait|result|result-field> [options]";
}
if (require.main === module) {
  try {
    runReadinessCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runReadinessCli,
  waitForReadiness
});
