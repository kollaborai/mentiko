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

// lib/system/plugin-dispatch-cli.ts
var plugin_dispatch_cli_exports = {};
__export(plugin_dispatch_cli_exports, {
  runPluginDispatchCli: () => runPluginDispatchCli
});
module.exports = __toCommonJS(plugin_dispatch_cli_exports);

// lib/system/plugin-dispatch.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_node_child_process = require("node:child_process");

// lib/system/plugin-registry.ts
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

// lib/secrets/secrets-store.ts
var import_crypto2 = require("crypto");

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

// lib/system/plugin-registry.ts
var ENC_PREFIX = "enc:";
function decryptConfig(config2, schema) {
  const result = { ...config2 };
  for (const field of schema) {
    if (field.type === "secret" && typeof result[field.key] === "string") {
      const val = result[field.key];
      if (val.startsWith(ENC_PREFIX)) {
        try {
          const decrypted = decrypt(val.slice(ENC_PREFIX.length));
          if (decrypted !== null) result[field.key] = decrypted;
        } catch {
        }
      }
    }
  }
  return result;
}
var BUILTIN_PLUGINS_DIR = (0, import_path3.join)(config.root, "lib", "plugins");
var MARKETPLACE_PLUGINS_DIR = (0, import_path3.join)(config.globalRoot, "marketplace", "plugins");
var REGISTRY_FILENAME = "registry.json";
function getNamespacePluginsDir(namespaceId2, orgId2) {
  return orgPath(namespaceId2, orgId2, "plugins");
}
function getRegistryPath(namespaceId2, orgId2) {
  return (0, import_path3.join)(getNamespacePluginsDir(namespaceId2, orgId2), REGISTRY_FILENAME);
}
function loadManifest(pluginDir) {
  const manifestPath = (0, import_path3.join)(pluginDir, "plugin.json");
  if (!(0, import_fs2.existsSync)(manifestPath)) return null;
  let manifest;
  try {
    manifest = JSON.parse((0, import_fs2.readFileSync)(manifestPath, "utf-8"));
  } catch {
    throw new Error(`Invalid plugin manifest: ${manifestPath}`);
  }
  if (!isPluginManifest(manifest)) throw new Error(`Invalid plugin manifest: ${manifestPath}`);
  return manifest;
}
function loadPluginRegistry(namespaceId2, orgId2) {
  const registryPath = getRegistryPath(namespaceId2, orgId2);
  if (!(0, import_fs2.existsSync)(registryPath)) {
    return {
      namespaceId: namespaceId2,
      plugins: [],
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  let parsed;
  try {
    parsed = JSON.parse((0, import_fs2.readFileSync)(registryPath, "utf-8"));
  } catch {
    throw new Error(`Invalid plugin registry: ${registryPath}`);
  }
  if (!isPluginState(parsed, namespaceId2)) throw new Error(`Invalid plugin registry: ${registryPath}`);
  return parsed;
}
function discoverPlugins(namespaceId2, orgId2) {
  const discovered = [];
  if ((0, import_fs2.existsSync)(BUILTIN_PLUGINS_DIR)) {
    for (const entry of (0, import_fs2.readdirSync)(BUILTIN_PLUGINS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pluginDir = (0, import_path3.join)(BUILTIN_PLUGINS_DIR, entry.name);
      const manifest = loadManifest(pluginDir);
      if (manifest) {
        discovered.push({ manifest: { ...manifest, builtin: true }, pluginDir, builtin: true });
      }
    }
  }
  if ((0, import_fs2.existsSync)(MARKETPLACE_PLUGINS_DIR)) {
    for (const entry of (0, import_fs2.readdirSync)(MARKETPLACE_PLUGINS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pluginDir = (0, import_path3.join)(MARKETPLACE_PLUGINS_DIR, entry.name);
      const manifest = loadManifest(pluginDir);
      if (manifest) {
        discovered.push({ manifest: { ...manifest, builtin: false }, pluginDir, builtin: false });
      }
    }
  }
  const nsPluginsDir = getNamespacePluginsDir(namespaceId2, orgId2);
  if ((0, import_fs2.existsSync)(nsPluginsDir)) {
    for (const entry of (0, import_fs2.readdirSync)(nsPluginsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "registry.json") continue;
      const pluginDir = (0, import_path3.join)(nsPluginsDir, entry.name);
      const manifest = loadManifest(pluginDir);
      if (manifest) {
        discovered.push({ manifest, pluginDir, builtin: false });
      }
    }
  }
  return discovered;
}
function getPlugins(namespaceId2, orgId2) {
  const discovered = discoverPlugins(namespaceId2, orgId2);
  const registry = loadPluginRegistry(namespaceId2, orgId2);
  return discovered.map(({ manifest, pluginDir }) => {
    const existing = registry.plugins.find((p) => p.id === manifest.id);
    if (!existing) {
      return { id: manifest.id, manifest, config: {}, enabled: false, pluginDir };
    }
    return {
      ...existing,
      config: decryptConfig(existing.config, manifest.configSchema)
    };
  });
}
function isPluginManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const manifest = value;
  return typeof manifest.id === "string" && manifest.id.length > 0 && typeof manifest.name === "string" && typeof manifest.description === "string" && typeof manifest.version === "string" && typeof manifest.category === "string" && Array.isArray(manifest.events) && manifest.events.every((event) => typeof event === "string") && Array.isArray(manifest.configSchema) && typeof manifest.onEventScript === "string" && manifest.onEventScript.length > 0;
}
function isPluginState(value, namespaceId2) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value;
  return state.namespaceId === namespaceId2 && typeof state.updatedAt === "string" && Array.isArray(state.plugins) && state.plugins.every((plugin) => {
    if (!plugin || typeof plugin !== "object") return false;
    const registration = plugin;
    return typeof registration.id === "string" && typeof registration.enabled === "boolean" && typeof registration.pluginDir === "string" && Boolean(registration.config) && typeof registration.config === "object" && !Array.isArray(registration.config) && isPluginManifest(registration.manifest);
  });
}

// lib/system/plugin-dispatch.ts
function matchingPlugin(plugin, event) {
  return plugin.enabled && plugin.manifest.events.some((candidate) => candidate === event || candidate === "*");
}
function pluginScriptPath(plugin) {
  const script = plugin.manifest.onEventScript;
  if (!script) throw new Error(`Plugin ${plugin.id} does not declare manifest.onEventScript`);
  const pluginDir = (0, import_node_path.resolve)(plugin.pluginDir);
  const path2 = (0, import_node_path.resolve)(pluginDir, script);
  const pathWithinPlugin = (0, import_node_path.relative)(pluginDir, path2);
  if (pathWithinPlugin === "" || pathWithinPlugin.startsWith("..") || pathWithinPlugin.includes("../")) {
    throw new Error(`Plugin ${plugin.id} onEventScript escapes its plugin directory`);
  }
  if (!(0, import_node_fs.existsSync)(path2) || !(0, import_node_fs.statSync)(path2).isFile()) throw new Error(`Plugin ${plugin.id} event script is missing: ${path2}`);
  return path2;
}
function pluginEnvironment(plugin, input) {
  const configEnv = {};
  for (const [key, value] of Object.entries(plugin.config)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Plugin ${plugin.id} has invalid config key: ${key}`);
    configEnv[`PLUGIN_${key.toUpperCase()}`] = String(value);
  }
  return {
    ...process.env,
    ...configEnv,
    PLUGIN_EVENT_TYPE: input.event,
    PLUGIN_CHAIN_ID: input.chainId ?? "",
    PLUGIN_RUN_ID: input.runId ?? "",
    PLUGIN_AGENT_ID: input.agentId ?? "",
    PLUGIN_EVENT_JSON: JSON.stringify({ type: input.event, chainId: input.chainId ?? "", runId: input.runId ?? "", agentId: input.agentId ?? "", timestamp: (/* @__PURE__ */ new Date()).toISOString() }),
    PLUGIN_DATA_JSON: JSON.stringify(input.data ?? {}),
    NAMESPACE_ID: input.namespaceId,
    ORG_ID: input.orgId
  };
}
function dispatchPlugins(input) {
  if (!input.namespaceId || !input.orgId || !input.event) throw new Error("namespaceId, orgId, and event are required for plugin dispatch");
  const result = { launched: [], skipped: [] };
  for (const plugin of getPlugins(input.namespaceId, input.orgId)) {
    if (!matchingPlugin(plugin, input.event)) continue;
    const script = pluginScriptPath(plugin);
    const child = (0, import_node_child_process.spawn)("bash", [script], { detached: true, stdio: "ignore", env: pluginEnvironment(plugin, input) });
    child.unref();
    result.launched.push(plugin.id);
  }
  return result;
}

// lib/system/plugin-dispatch-cli.ts
function runPluginDispatchCli(argv, write = (line) => console.log(line)) {
  const [command, ...rest] = argv;
  if (command !== "dispatch") throw new Error(usage());
  const flags = parseFlags(rest);
  for (const key of flags.keys()) if (!(/* @__PURE__ */ new Set(["--namespace-id", "--org-id", "--event", "--chain-id", "--run-id", "--agent-id", "--data-json"])).has(key)) throw new Error(`${key} is not valid for plugin dispatch`);
  const dataJson = flags.get("--data-json") ?? "{}";
  let data;
  try {
    data = JSON.parse(dataJson);
  } catch {
    throw new Error("--data-json must be a JSON object");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("--data-json must be a JSON object");
  write(JSON.stringify(dispatchPlugins({
    namespaceId: required(flags, "--namespace-id"),
    orgId: required(flags, "--org-id"),
    event: required(flags, "--event"),
    chainId: flags.get("--chain-id"),
    runId: flags.get("--run-id"),
    agentId: flags.get("--agent-id"),
    data
  })));
}
function parseFlags(argv) {
  const flags = /* @__PURE__ */ new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === void 0 || flags.has(key)) throw new Error(usage());
    flags.set(key, value);
  }
  return flags;
}
function required(flags, key) {
  const value = flags.get(key);
  if (!value) throw new Error(`${key} is required`);
  return value;
}
function usage() {
  return "usage: runner-plugin-dispatch dispatch --namespace-id <id> --org-id <id> --event <event> [--chain-id <id> --run-id <id> --agent-id <id> --data-json <json>]";
}
if (require.main === module) {
  try {
    runPluginDispatchCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runPluginDispatchCli
});
