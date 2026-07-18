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

// lib/system/audit-cli.ts
var audit_cli_exports = {};
__export(audit_cli_exports, {
  runAuditCli: () => runAuditCli
});
module.exports = __toCommonJS(audit_cli_exports);
var import_node_fs2 = require("node:fs");

// lib/system/audit-log.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_node_crypto = require("node:crypto");
var import_node_zlib = require("node:zlib");
var import_node_child_process = require("node:child_process");

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
function nsPath(nsId, ...segments) {
  return import_path.default.join(globalRoot, "namespaces", nsId, ...segments);
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
var config_default = config;

// lib/system/audit-log.ts
var INDEX_LIMIT = 1001;
var MAX_EVENT_LENGTH = 160;
var MAX_DESCRIPTION_LENGTH = 16e3;
var PII_KEYS = /* @__PURE__ */ new Set(["email", "name", "user_email", "user_name", "username"]);
function resolveAuditPaths(namespaceId2 = config_default.namespaceId) {
  const dir = nsPath(namespaceId2, "audit");
  return { dir, logFile: (0, import_node_path.join)(dir, "audit.log"), indexFile: (0, import_node_path.join)(dir, "index.json") };
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function parseEntry(value) {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.timestamp !== "string" || typeof value.event_type !== "string" || typeof value.description !== "string" || typeof value.user !== "string" || typeof value.source !== "string" || typeof value.ip !== "string" || typeof value.hostname !== "string" || !isRecord(value.metadata)) {
    throw new Error("Invalid audit entry");
  }
  const metadata = {};
  for (const [key, entry] of Object.entries(value.metadata)) {
    if (typeof entry !== "string") throw new Error("Invalid audit metadata value");
    metadata[key] = entry;
  }
  return { id: value.id, timestamp: value.timestamp, event_type: value.event_type, description: value.description, user: value.user, source: value.source, ip: value.ip, hostname: value.hostname, metadata };
}
function readIndex(paths) {
  if (!(0, import_node_fs.existsSync)(paths.indexFile)) return [];
  let parsed;
  try {
    parsed = JSON.parse((0, import_node_fs.readFileSync)(paths.indexFile, "utf8"));
  } catch {
    throw new Error(`Invalid audit index: ${paths.indexFile}`);
  }
  if (!Array.isArray(parsed)) throw new Error(`Invalid audit index: ${paths.indexFile}`);
  return parsed.map(parseEntry);
}
function readLog(paths) {
  if (!(0, import_node_fs.existsSync)(paths.logFile)) return [];
  const entries = [];
  for (const line of (0, import_node_fs.readFileSync)(paths.logFile, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(parseEntry(JSON.parse(line)));
    } catch {
      throw new Error(`Invalid audit log entry in ${paths.logFile}`);
    }
  }
  return entries;
}
function writeIndex(paths, entries) {
  const temp = `${paths.indexFile}.${process.pid}.${(0, import_node_crypto.randomUUID)()}.tmp`;
  (0, import_node_fs.writeFileSync)(temp, JSON.stringify(entries.slice(0, INDEX_LIMIT), null, 2) + "\n", { mode: 384 });
  (0, import_node_fs.renameSync)(temp, paths.indexFile);
}
function sanitizeMetadata(metadata) {
  const sanitized = {};
  for (const [key, raw] of Object.entries(metadata)) {
    if (raw === null || raw === void 0 || raw === "") continue;
    if (PII_KEYS.has(key.toLowerCase())) continue;
    const value = String(raw);
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) continue;
    sanitized[key] = value;
  }
  return sanitized;
}
function sanitizeText(value, field, maxLength) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || /[\u0000-\u001f]/.test(normalized)) throw new Error(`Invalid audit ${field}`);
  return normalized;
}
function currentUser() {
  return process.env.AUDIT_USER || process.env.LOGNAME || process.env.USER || "unknown";
}
function currentHost() {
  return process.env.HOSTNAME || "unknown";
}
function writeAuditLog(input) {
  const paths = resolveAuditPaths(input.namespaceId);
  (0, import_node_fs.mkdirSync)(paths.dir, { recursive: true, mode: 448 });
  const entry = {
    // Retain the public audit ID grammar used by existing index/log records:
    // epoch-like nanoseconds plus PID. The high-resolution suffix preserves the
    // same shape without changing CLI/API consumers that parse the numeric form.
    id: `audit_${Date.now()}${String(process.hrtime()[1] % 1e6).padStart(6, "0")}_${process.pid}`,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    event_type: sanitizeText(input.eventType, "event type", MAX_EVENT_LENGTH),
    description: sanitizeText(input.description, "description", MAX_DESCRIPTION_LENGTH),
    user: currentUser(),
    source: input.source || "system",
    ip: input.ip || "",
    hostname: currentHost(),
    metadata: sanitizeMetadata(input.metadata ?? {})
  };
  const serialized = JSON.stringify(entry);
  (0, import_node_fs.appendFileSync)(paths.logFile, `${serialized}
`, { encoding: "utf8", mode: 384 });
  writeIndex(paths, [entry, ...readIndex(paths)]);
  void shipAuditEntry(serialized, paths, input.namespaceId ?? config_default.namespaceId).catch(() => void 0);
  return entry;
}
function queryAuditLog(input) {
  const filterType = input.filterType ?? "all";
  if (!["all", "event_type", "user", "chain", "run_id", "auth"].includes(filterType)) throw new Error("Invalid audit filter type");
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > INDEX_LIMIT) throw new Error("Invalid audit query limit");
  const since = input.since ? Date.parse(input.since) : void 0;
  if (input.since && Number.isNaN(since)) throw new Error("Invalid audit since timestamp");
  const filterValue = input.filterValue ?? "";
  return readIndex(resolveAuditPaths(input.namespaceId)).filter((entry) => {
    if (since !== void 0 && Date.parse(entry.timestamp) < since) return false;
    if (filterType === "event_type") return entry.event_type === filterValue;
    if (filterType === "user") return entry.user === filterValue;
    if (filterType === "chain") return (entry.event_type === "chain_start" || entry.event_type === "chain_complete") && entry.metadata.chain_name === filterValue;
    if (filterType === "run_id") return entry.metadata.run_id === filterValue;
    if (filterType === "auth") return entry.event_type === "auth";
    return true;
  }).slice(0, limit);
}
function exportAuditLog(input) {
  const since = input.since ? Date.parse(input.since) : void 0;
  if (input.since && Number.isNaN(since)) throw new Error("Invalid audit since timestamp");
  return readLog(resolveAuditPaths(input.namespaceId)).filter(
    (entry) => (!input.eventType || entry.event_type === input.eventType) && (since === void 0 || Date.parse(entry.timestamp) >= since)
  );
}
function auditCsv(entries) {
  const quote = (value) => `"${value.replace(/"/g, '""')}"`;
  const header = "id,timestamp,event_type,description,user,source,ip,hostname,metadata";
  return [header, ...entries.map((entry) => [entry.id, entry.timestamp, entry.event_type, entry.description, entry.user, entry.source, entry.ip, entry.hostname, JSON.stringify(entry.metadata)].map(quote).join(","))].join("\n") + "\n";
}
function summarizeAuditLog(namespaceId2 = config_default.namespaceId) {
  const paths = resolveAuditPaths(namespaceId2);
  const entries = readIndex(paths);
  const eventCounts = /* @__PURE__ */ new Map();
  for (const entry of entries) eventCounts.set(entry.event_type, (eventCounts.get(entry.event_type) ?? 0) + 1);
  return { paths, entries, authCount: entries.filter((entry) => entry.event_type === "auth").length, eventCounts };
}
function archiveAuditLog(input) {
  if (!Number.isInteger(input.days) || input.days < 0 || input.days > 36500) throw new Error("Invalid audit archive days");
  const paths = resolveAuditPaths(input.namespaceId);
  const now = input.now ?? /* @__PURE__ */ new Date();
  const cutoff = now.getTime() - input.days * 864e5;
  const entries = readLog(paths);
  const archived = entries.filter((entry) => Date.parse(entry.timestamp) < cutoff);
  const retained = entries.filter((entry) => Date.parse(entry.timestamp) >= cutoff);
  if (!archived.length) return { archived: 0 };
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
  const archiveFile = (0, import_node_path.join)(paths.dir, `archive-${datePart}.jsonl.gz`);
  (0, import_node_fs.writeFileSync)(archiveFile, (0, import_node_zlib.gzipSync)(Buffer.from(archived.map((entry) => JSON.stringify(entry)).join("\n") + "\n")), { mode: 384 });
  (0, import_node_fs.writeFileSync)(paths.logFile, retained.map((entry) => JSON.stringify(entry)).join("\n") + (retained.length ? "\n" : ""), { mode: 384 });
  writeIndex(paths, retained.slice().reverse());
  return { archiveFile, archived: archived.length };
}
function clearAuditLog(namespaceId2 = config_default.namespaceId) {
  const paths = resolveAuditPaths(namespaceId2);
  (0, import_node_fs.mkdirSync)(paths.dir, { recursive: true, mode: 448 });
  (0, import_node_fs.writeFileSync)(paths.logFile, "", { mode: 384 });
  writeIndex(paths, []);
}
function shipAuditEntry(entry, paths, namespaceId2) {
  if (!process.env.AUDIT_REMOTE_URL) return Promise.resolve();
  const shipper = (0, import_node_path.join)(config_default.codeRoot, "lib", "audit-ship.sh");
  if (!(0, import_node_fs.existsSync)(shipper)) return Promise.reject(new Error(`Audit shipper is missing: ${shipper}`));
  const child = (0, import_node_child_process.spawn)("bash", [shipper], {
    detached: true,
    stdio: ["pipe", "ignore", "ignore"],
    env: {
      ...process.env,
      MENTIKO_CODE_ROOT: config_default.codeRoot,
      AUDIT_DIR: paths.dir,
      NAMESPACE_ID: namespaceId2
    }
  });
  child.stdin.write(`${entry}
`);
  child.stdin.end();
  child.unref();
  return Promise.resolve();
}

// lib/system/audit-cli.ts
function runAuditCli(argv, write = (line) => console.log(line)) {
  const [command, ...rest] = argv;
  if (!isCommand(command)) throw new Error(usage());
  const { record: metaRecord, rest: flagArgs } = parseMetaPairs(rest);
  const flags = parseFlags(flagArgs);
  const namespaceId2 = optional(flags, "--namespace-id");
  if (command !== "write" && Object.keys(metaRecord).length > 0) throw new Error("--meta is not valid for audit");
  switch (command) {
    case "write": {
      requireOnly(flags, /* @__PURE__ */ new Set(["--namespace-id", "--event-type", "--description", "--metadata-json", "--source", "--ip"]));
      const metadata = { ...jsonRecord(optional(flags, "--metadata-json") ?? "{}"), ...metaRecord };
      write(JSON.stringify(writeAuditLog({ namespaceId: namespaceId2, eventType: required(flags, "--event-type"), description: required(flags, "--description"), metadata, source: optional(flags, "--source"), ip: optional(flags, "--ip") })));
      return;
    }
    case "query": {
      requireOnly(flags, /* @__PURE__ */ new Set(["--namespace-id", "--filter-type", "--filter-value", "--since", "--limit"]));
      write(JSON.stringify(queryAuditLog({ namespaceId: namespaceId2, filterType: optional(flags, "--filter-type") ?? "all", filterValue: optional(flags, "--filter-value"), since: optional(flags, "--since"), limit: optionalNumber(flags, "--limit") })));
      return;
    }
    case "export-json":
    case "export-csv": {
      requireOnly(flags, /* @__PURE__ */ new Set(["--namespace-id", "--since", "--event-type", "--output"]));
      const entries = exportAuditLog({ namespaceId: namespaceId2, since: optional(flags, "--since"), eventType: optional(flags, "--event-type") });
      const payload = command === "export-json" ? JSON.stringify(entries, null, 2) + "\n" : auditCsv(entries);
      const output = optional(flags, "--output");
      if (output) {
        (0, import_node_fs2.writeFileSync)(output, payload, { mode: 384 });
        write(`exported to: ${output}`);
      } else write(payload);
      return;
    }
    case "summary": {
      requireOnly(flags, /* @__PURE__ */ new Set(["--namespace-id"]));
      const summary = summarizeAuditLog(namespaceId2);
      write(JSON.stringify({ logFile: summary.paths.logFile, indexFile: summary.paths.indexFile, total: summary.entries.length, authCount: summary.authCount, eventCounts: Object.fromEntries(summary.eventCounts), recent: summary.entries.slice(0, 10) }));
      return;
    }
    case "archive": {
      requireOnly(flags, /* @__PURE__ */ new Set(["--namespace-id", "--days"]));
      write(JSON.stringify(archiveAuditLog({ namespaceId: namespaceId2, days: optionalNumber(flags, "--days") ?? 30 })));
      return;
    }
    case "clear": {
      requireOnly(flags, /* @__PURE__ */ new Set(["--namespace-id", "--confirm"]));
      if (required(flags, "--confirm") !== "true") throw new Error("--confirm true is required");
      clearAuditLog(namespaceId2);
      write("cleared");
      return;
    }
  }
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
function parseMetaPairs(argv) {
  const record = {};
  const rest = [];
  for (let index = 0; index < argv.length; ) {
    const token = argv[index];
    if (token === "--meta") {
      const pair = argv[index + 1];
      if (pair === void 0) throw new Error("--meta requires a key=value argument");
      const equals = pair.indexOf("=");
      if (equals <= 0) throw new Error("--meta must be key=value");
      record[pair.slice(0, equals)] = pair.slice(equals + 1);
      index += 2;
    } else {
      rest.push(token);
      if (token.startsWith("--") && argv[index + 1] !== void 0) {
        rest.push(argv[index + 1]);
        index += 2;
      } else {
        index += 1;
      }
    }
  }
  return { record, rest };
}
function requireOnly(flags, allowed) {
  for (const key of flags.keys()) if (!allowed.has(key)) throw new Error(`${key} is not valid for audit`);
}
function required(flags, key) {
  const value = flags.get(key);
  if (!value) throw new Error(`${key} is required`);
  return value;
}
function optional(flags, key) {
  return flags.get(key);
}
function optionalNumber(flags, key) {
  const value = optional(flags, key);
  if (value === void 0) return void 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${key} must be an integer`);
  return parsed;
}
function jsonRecord(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("--metadata-json must be a JSON object");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("--metadata-json must be a JSON object");
  return parsed;
}
function isCommand(value) {
  return value === "write" || value === "query" || value === "export-json" || value === "export-csv" || value === "summary" || value === "archive" || value === "clear";
}
function usage() {
  return "usage: mentiko-audit <write|query|export-json|export-csv|summary|archive|clear> [flags]";
}
if (require.main === module) {
  try {
    runAuditCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runAuditCli
});
