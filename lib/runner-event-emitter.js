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

// lib/runner-v2/event-emitter.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_node_crypto = require("node:crypto");

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

// lib/runner-v2/events.ts
var RUNNER_EVENT_RAW_FIELDS = [
  "event",
  "source",
  "run_id",
  "timestamp",
  "processed",
  "data"
];
function parseRunnerEvent(content) {
  const raw = validateRawRunnerEvent(content);
  if (!raw.valid) {
    const summary = raw.issues.map((issue) => issue.code).join(", ");
    throw new Error(`Invalid runner event file: ${summary}`);
  }
  const record = {
    event: raw.fields.event,
    source: raw.fields.source,
    runId: raw.fields.run_id,
    timestamp: raw.fields.timestamp,
    processed: parseProcessed(raw.fields.processed),
    data: raw.fields.data,
    fields: raw.fields
  };
  const normalized = validateRunnerEventRecord(record);
  if (!normalized.valid) {
    const summary = normalized.issues.map((issue) => issue.code).join(", ");
    throw new Error(`Invalid normalized runner event: ${summary}`);
  }
  return record;
}
function validateRawRunnerEvent(content) {
  const fields = {};
  const issues = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const separator = line.indexOf(":");
    if (separator < 0) {
      issues.push({
        code: "malformed-line",
        line: index + 1,
        message: "Non-empty lines must use key: value syntax."
      });
      continue;
    }
    const rawKey = line.slice(0, separator).trim();
    const key = rawKey.toLowerCase();
    if (!key) {
      issues.push({ code: "empty-key", line: index + 1, message: "Field name is empty." });
      continue;
    }
    if (rawKey !== key) {
      issues.push({
        code: "noncanonical-key",
        field: key,
        line: index + 1,
        message: `Field ${key} must use lowercase canonical casing.`
      });
    }
    if (fields[key] !== void 0) {
      issues.push({
        code: "duplicate-field",
        field: key,
        line: index + 1,
        message: `Field ${key} appears more than once.`
      });
      continue;
    }
    fields[key] = line.slice(separator + 1).trim();
  }
  for (const field of RUNNER_EVENT_RAW_FIELDS) {
    if (fields[field] === void 0) {
      issues.push({ code: "missing-field", field, message: `Missing required field ${field}.` });
    }
  }
  for (const field of ["event", "source", "timestamp"]) {
    if (fields[field] !== void 0 && fields[field] === "") {
      issues.push({ code: "empty-field", field, message: `Field ${field} must not be empty.` });
    }
  }
  if (fields.timestamp && !Number.isFinite(new Date(fields.timestamp).getTime())) {
    issues.push({
      code: "invalid-timestamp",
      field: "timestamp",
      message: "Field timestamp must be a parseable date-time."
    });
  }
  if (fields.processed !== void 0 && !/^(?:true|false)$/.test(fields.processed)) {
    issues.push({
      code: "invalid-processed",
      field: "processed",
      message: "Field processed must be true or false."
    });
  }
  return { valid: issues.length === 0, fields, issues };
}
function validateRunnerEventRecord(value) {
  const issues = [];
  if (!isPlainRecord(value)) {
    return {
      valid: false,
      issues: [{ code: "invalid-record", message: "Runner event must be an object." }]
    };
  }
  for (const field of ["event", "source", "runId", "timestamp", "data"]) {
    if (typeof value[field] !== "string") {
      issues.push({
        code: "invalid-field-type",
        field,
        message: `Normalized field ${field} must be a string.`
      });
    }
  }
  for (const field of ["event", "source", "timestamp"]) {
    if (typeof value[field] === "string" && value[field] === "") {
      issues.push({ code: "empty-field", field, message: `Normalized field ${field} must not be empty.` });
    }
  }
  if (typeof value.timestamp === "string" && !Number.isFinite(new Date(value.timestamp).getTime())) {
    issues.push({
      code: "invalid-timestamp",
      field: "timestamp",
      message: "Normalized field timestamp must be a parseable date-time."
    });
  }
  if (typeof value.processed !== "boolean") {
    issues.push({
      code: "invalid-processed",
      field: "processed",
      message: "Normalized field processed must be a boolean."
    });
  }
  if (value.path !== void 0 && typeof value.path !== "string") {
    issues.push({
      code: "invalid-field-type",
      field: "path",
      message: "Normalized field path must be a string when present."
    });
  }
  if (!isStringRecord(value.fields)) {
    issues.push({
      code: "invalid-field-type",
      field: "fields",
      message: "Normalized field fields must map strings to strings."
    });
  } else {
    const expectedFields = [
      ["event", value.event],
      ["source", value.source],
      ["run_id", value.runId],
      ["timestamp", value.timestamp],
      ["processed", typeof value.processed === "boolean" ? String(value.processed) : void 0],
      ["data", value.data]
    ];
    for (const [field, expected] of expectedFields) {
      if (typeof expected === "string" && value.fields[field] !== expected) {
        issues.push({
          code: "field-mismatch",
          field: `fields.${field}`,
          message: `Normalized field fields.${field} must match ${field === "run_id" ? "runId" : field}.`
        });
      }
    }
  }
  return { valid: issues.length === 0, issues };
}
function serializeRunnerEvent(event) {
  const runId = event.runId ?? "";
  const data = event.data ?? "";
  assertSerializableField("event", event.event, false);
  assertSerializableField("source", event.source, false);
  assertSerializableField("run_id", runId, true);
  assertSerializableField("timestamp", event.timestamp, false);
  assertSerializableField("data", data, true);
  if (!Number.isFinite(new Date(event.timestamp).getTime())) {
    throw new Error("Cannot serialize runner event: timestamp must be a parseable date-time.");
  }
  if (event.processed !== void 0 && typeof event.processed !== "boolean") {
    throw new Error("Cannot serialize runner event: processed must be a boolean.");
  }
  const extensionLines = serializeExtensionFields(event.extensionFields);
  const content = [
    `event: ${event.event}`,
    `source: ${event.source}`,
    `run_id: ${runId}`,
    `timestamp: ${event.timestamp}`,
    `processed: ${event.processed === true ? "true" : "false"}`,
    `data: ${data}`,
    ...extensionLines
  ].join("\n") + "\n";
  const validation = validateRawRunnerEvent(content);
  if (!validation.valid) {
    throw new Error(`Cannot serialize runner event: ${validation.issues.map((issue) => issue.code).join(", ")}`);
  }
  const roundTrip = parseRunnerEvent(content);
  const expected = {
    event: event.event,
    source: event.source,
    runId,
    timestamp: event.timestamp,
    processed: event.processed === true,
    data
  };
  for (const [field, value] of Object.entries(expected)) {
    if (roundTrip[field] !== value) {
      throw new Error(`Cannot serialize runner event: ${field} does not round-trip exactly.`);
    }
  }
  return content;
}
function serializeExtensionFields(fields) {
  if (!fields) return [];
  return Object.entries(fields).map(([field, value]) => {
    if (!/^[a-z][a-z0-9_]*$/.test(field)) {
      throw new Error(`Cannot serialize runner event: extension field ${field} must use lowercase snake_case.`);
    }
    if (RUNNER_EVENT_RAW_FIELDS.includes(field)) {
      throw new Error(`Cannot serialize runner event: extension field ${field} duplicates a canonical field.`);
    }
    assertSerializableField(field, value, true);
    return `${field}: ${value}`;
  });
}
function parseProcessed(value) {
  return value === "true";
}
function assertSerializableField(field, value, allowEmpty) {
  if (typeof value !== "string") {
    throw new Error(`Cannot serialize runner event: ${field} must be a string.`);
  }
  if (!allowEmpty && value.length === 0) {
    throw new Error(`Cannot serialize runner event: ${field} must not be empty.`);
  }
  if (value.includes("\n") || value.includes("\r")) {
    throw new Error(`Cannot serialize runner event: ${field} must be a single line.`);
  }
}
function isPlainRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isStringRecord(value) {
  return isPlainRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

// lib/runner-v2/event-emitter.ts
var RUN_LIFECYCLE_EVENTS = /* @__PURE__ */ new Set([
  "chain-started",
  "chain-complete",
  "chain-error",
  "agent-started",
  "agent-complete",
  "agent-error",
  "agent-timeout",
  "agent-context-exhausted",
  "fan-in-complete",
  "fan-out-complete",
  "run-stalled",
  "run-error",
  "run-complete",
  "task-status-updated"
]);
function emitRunnerEvent(input) {
  assertModeRequirements(input);
  const timestamp = input.timestamp ?? (/* @__PURE__ */ new Date()).toISOString();
  const content = serializeRunnerEvent({
    event: input.event,
    source: input.source,
    runId: input.runId,
    timestamp,
    processed: false,
    data: input.data,
    extensionFields: diagnosticExtensionFields(input)
  });
  const requestedFilename = buildRunnerEventFilename(input, timestamp);
  const temporaryPath = (0, import_node_path.join)(
    config_default.eventsDir,
    `.${(0, import_node_path.basename)(requestedFilename)}.${process.pid}.${(0, import_node_crypto.randomUUID)()}.tmp`
  );
  (0, import_node_fs.mkdirSync)(config_default.eventsDir, { recursive: true });
  (0, import_node_fs.writeFileSync)(temporaryPath, content, { encoding: "utf8", flag: "wx" });
  try {
    return persistWithoutClobber({ requestedFilename, temporaryPath, content });
  } finally {
    try {
      (0, import_node_fs.unlinkSync)(temporaryPath);
    } catch {
    }
  }
}
function diagnosticEventData(input) {
  if (!input.agent) throw new Error("Diagnostic event agent must not be empty.");
  if (!input.reason) throw new Error("Diagnostic event reason must not be empty.");
  return JSON.stringify({
    agent: input.agent,
    reason: input.reason,
    ...input.staleCount !== void 0 ? { stale_count: input.staleCount } : {}
  });
}
function assertModeRequirements(input) {
  if (input.scope === "run" && !input.runId) {
    throw new Error("run-scoped events require a run id.");
  }
  if (input.scope === "ingress" && input.runId) {
    throw new Error("ingress events must not carry a run id.");
  }
  if (input.scope === "ingress" && RUN_LIFECYCLE_EVENTS.has(input.event)) {
    throw new Error(`run lifecycle event ${input.event} cannot use ingress scope.`);
  }
  if (input.filenameMode === "diagnostic" && input.scope !== "run") {
    throw new Error("diagnostic events require run scope.");
  }
  if (input.filenameMode === "diagnostic" && !input.diagnosticAgent) {
    throw new Error("Diagnostic events require an agent id for filename ownership.");
  }
  if (input.filenameMode === "diagnostic" && !input.diagnosticReason) {
    throw new Error("Diagnostic events require a reason.");
  }
  if (input.diagnosticStaleCount !== void 0 && (!Number.isSafeInteger(input.diagnosticStaleCount) || input.diagnosticStaleCount < 0)) {
    throw new Error("Diagnostic stale count must be a non-negative integer.");
  }
}
function diagnosticExtensionFields(input) {
  if (input.filenameMode !== "diagnostic") return void 0;
  return {
    agent: input.diagnosticAgent,
    reason: input.diagnosticReason,
    ...input.diagnosticStaleCount !== void 0 ? { stale_count: String(input.diagnosticStaleCount) } : {}
  };
}
function persistWithoutClobber(input) {
  const requestedPath = (0, import_node_path.join)(config_default.eventsDir, input.requestedFilename);
  try {
    (0, import_node_fs.linkSync)(input.temporaryPath, requestedPath);
    return resultFor(requestedPath, input.requestedFilename, input.content);
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
  }
  const existingContent = (0, import_node_fs.readFileSync)(requestedPath, "utf8");
  if (eventsAreSemanticallyIdentical(existingContent, input.content)) {
    return resultFor(requestedPath, input.requestedFilename, existingContent);
  }
  for (; ; ) {
    const collisionFilename = collisionSafeFilename(input.requestedFilename);
    const collisionPath = (0, import_node_path.join)(config_default.eventsDir, collisionFilename);
    try {
      (0, import_node_fs.linkSync)(input.temporaryPath, collisionPath);
      return resultFor(collisionPath, collisionFilename, input.content);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
  }
}
function resultFor(path2, filename, content) {
  return {
    path: path2,
    filename,
    record: { ...parseRunnerEvent(content), path: path2 }
  };
}
function eventsAreSemanticallyIdentical(left, right) {
  try {
    const leftEvent = parseRunnerEvent(left);
    const rightEvent = parseRunnerEvent(right);
    return semanticEventFields(leftEvent) === semanticEventFields(rightEvent);
  } catch {
    return false;
  }
}
function semanticEventFields(event) {
  return JSON.stringify(Object.entries(event.fields).filter(([field]) => field !== "timestamp").sort(([left], [right]) => left.localeCompare(right)));
}
function collisionSafeFilename(filename) {
  const stem = filename.endsWith(".event") ? filename.slice(0, -".event".length) : filename;
  return `${stem}-collision-${process.pid}-${(0, import_node_crypto.randomUUID)()}.event`;
}
function isAlreadyExists(error) {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
function buildRunnerEventFilename(input, timestamp) {
  const event = filenameComponent(input.event);
  const source = filenameComponent(input.source);
  const runId = input.runId ? `${filenameComponent(input.runId)}-` : "";
  if (input.filenameMode === "diagnostic") {
    const agent = filenameComponent(input.diagnosticAgent);
    return `${filenameTimestamp(timestamp)}-${runId}${agent}-${event}.event`;
  }
  return `${runId}${source}-${event}.event`;
}
function filenameTimestamp(timestamp) {
  return new Date(timestamp).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "");
}
function filenameComponent(value) {
  const sanitized = value.replace(/[\\/\u0000-\u001f\u007f]/g, "_").replace(/[^A-Za-z0-9._-]/g, "_");
  return sanitized === "" || sanitized === "." || sanitized === ".." ? "_" : sanitized;
}

// lib/runner-v2/event-emitter-cli.ts
function main() {
  const args = parseArguments(process.argv.slice(2));
  const result = emitRunnerEvent({
    event: args.event,
    source: args.source,
    runId: args.runId,
    scope: args.scope,
    filenameMode: args.mode,
    diagnosticAgent: args.agent,
    diagnosticReason: args.mode === "diagnostic" ? args.data : void 0,
    diagnosticStaleCount: args.staleCount,
    data: args.mode === "diagnostic" ? diagnosticEventData({ agent: args.agent, reason: args.data, staleCount: args.staleCount }) : args.data
  });
  if (args.output === "json") {
    console.log(JSON.stringify({ path: result.path, filename: result.filename }));
    return;
  }
  if (args.mode === "diagnostic") {
    console.log(`  diagnostic event written: ${result.filename}`);
    return;
  }
  console.log(`  event emitted: ${args.event}`);
  console.log(`  file: ${result.path}`);
}
function parseArguments(argv) {
  const command = argv[0];
  const mode = parseMode(command);
  const values = /* @__PURE__ */ new Map();
  const allowed = /* @__PURE__ */ new Set([
    "--event",
    "--source",
    "--run-id",
    "--scope",
    "--data",
    "--agent",
    "--reason",
    "--stale-count",
    "--output"
  ]);
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag)) throw new Error(`Unknown runner event emitter argument: ${flag}`);
    if (value === void 0) throw new Error(`Missing value for runner event emitter argument: ${flag}`);
    if (values.has(flag)) throw new Error(`Duplicate runner event emitter argument: ${flag}`);
    values.set(flag, value);
  }
  const event = requireNonEmpty(values, "--event");
  const source = requireNonEmpty(values, "--source");
  const runId = requirePresent(values, "--run-id");
  const scope = parseScope(requireNonEmpty(values, "--scope"));
  if (mode === "diagnostic") {
    rejectPresent(values, "--data", command);
    return {
      mode,
      event,
      source,
      runId,
      scope,
      agent: requireNonEmpty(values, "--agent"),
      data: requireNonEmpty(values, "--reason"),
      staleCount: parseStaleCount(values.get("--stale-count")),
      output: parseOutput(values.get("--output"))
    };
  }
  rejectPresent(values, "--agent", command);
  rejectPresent(values, "--reason", command);
  rejectPresent(values, "--stale-count", command);
  return {
    mode,
    event,
    source,
    runId,
    scope,
    data: requirePresent(values, "--data"),
    output: parseOutput(values.get("--output"))
  };
}
function parseScope(value) {
  if (value === "run" || value === "ingress") return value;
  throw new Error("Runner event emitter --scope must be run or ingress.");
}
function parseStaleCount(value) {
  if (value === void 0) return void 0;
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error("Runner event emitter --stale-count must be a non-negative integer.");
  }
  const count = Number(value);
  if (!Number.isSafeInteger(count)) {
    throw new Error("Runner event emitter --stale-count exceeds the safe integer range.");
  }
  return count;
}
function parseMode(command) {
  if (command === "emit") return "canonical";
  if (command === "diagnostic") return "diagnostic";
  throw new Error(
    "usage: runner-event-emitter <emit|diagnostic> --scope <run|ingress> --event <name> --source <source> --run-id <id>"
  );
}
function requirePresent(values, flag) {
  if (!values.has(flag)) throw new Error(`Missing required runner event emitter argument: ${flag}`);
  return values.get(flag);
}
function parseOutput(value) {
  if (value === void 0 || value === "text") return "text";
  if (value === "json") return "json";
  throw new Error("Runner event emitter --output must be text or json.");
}
function requireNonEmpty(values, flag) {
  const value = requirePresent(values, flag);
  if (!value) throw new Error(`Runner event emitter argument must not be empty: ${flag}`);
  return value;
}
function rejectPresent(values, flag, command) {
  if (values.has(flag)) throw new Error(`${flag} is not valid for runner event emitter command ${command}.`);
}
try {
  main();
} catch (error) {
  console.error(`runner event emitter failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
