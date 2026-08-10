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

// lib/runner-v2/manual-monitor-cli.ts
var manual_monitor_cli_exports = {};
__export(manual_monitor_cli_exports, {
  readProfile: () => readProfile,
  resolveExecutable: () => resolveExecutable,
  runManualMonitorCli: () => runManualMonitorCli
});
module.exports = __toCommonJS(manual_monitor_cli_exports);

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

// lib/runner-v2/manual-monitor-cli.ts
var import_node_fs2 = require("node:fs");
var import_node_child_process = require("node:child_process");
var import_node_path2 = require("node:path");

// lib/pty/pty-client.ts
var import_net = require("net");

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
  // send text + enter to a session. Include the return in the payload rather
  // than relying only on the daemon's newer `enter` flag: existing local
  // daemons can be older than this client and silently ignore that flag. The
  // explicit frame keeps agent instructions, completion commands, and monitor
  // nudges submit-capable during a rolling daemon upgrade.
  async sendKeys(name, text) {
    const submittedText = /[\r\n]$/.test(text) ? text : `${text}\r`;
    const res = await sendCommand({
      cmd: "send",
      name,
      args: { text: submittedText, raw: true }
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

// lib/runner-v2/manual-monitor.ts
var import_node_crypto = require("node:crypto");
var import_node_fs = require("node:fs");
var import_node_os = require("node:os");
var import_node_path = require("node:path");
var MAX_SESSION_NAME_LENGTH = 240;
var PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
async function runManualMonitor(input, dependencies) {
  validateManualMonitorInput(input);
  const paths = manualMonitorPaths(input.sessionName, input.stateDir);
  const now = dependencies.now ?? (() => /* @__PURE__ */ new Date());
  const log = (message) => {
    appendLog(paths.log, `${now().toISOString()} ${message}`);
    dependencies.log?.(message);
  };
  initializeMonitorFiles(paths, input, now());
  for (let retries = 1; !await dependencies.hasSession(input.sessionName); retries += 1) {
    if (retries >= 10) {
      log(`session '${input.sessionName}' not found after 30s`);
      throw new Error(`manual monitor session '${input.sessionName}' not found after 30s`);
    }
    dependencies.log?.(`waiting for session '${input.sessionName}'... (${retries}/10)`);
    await dependencies.sleep(3);
  }
  (0, import_node_fs.writeFileSync)(paths.state, captureHash(await dependencies.capture(input.sessionName, 20)), { mode: 384 });
  let staleCount = 0;
  while (true) {
    await dependencies.sleep(input.intervalSeconds);
    if (!await dependencies.hasSession(input.sessionName)) {
      log("session terminated");
      clearManualMonitorState(paths);
      return { reason: "session-gone", staleCount, paths };
    }
    const capture = await dependencies.capture(input.sessionName, 500);
    const last50 = tailLines(capture, 50);
    const newHash = captureHash(firstLines(tailLines(capture, 40), 20));
    const oldHash = readOptional(paths.state);
    if (newHash !== oldHash) {
      staleCount = 0;
      (0, import_node_fs.writeFileSync)(paths.state, newHash, { mode: 384 });
      (0, import_node_fs.writeFileSync)(paths.stale, "0\n", { mode: 384 });
      log("active");
      continue;
    }
    if (last50.includes("AGENT_COMPLETE")) {
      log("AGENT_COMPLETE");
      await dependencies.sleep(2);
      if (await dependencies.hasSession(input.sessionName)) {
        await dependencies.kill(input.sessionName);
        log("killed session");
      }
      clearManualMonitorState(paths);
      return { reason: "complete", staleCount, paths };
    }
    staleCount = readNonNegativeInt(paths.stale) + 1;
    (0, import_node_fs.writeFileSync)(paths.stale, `${staleCount}
`, { mode: 384 });
    if (input.maxStaleCount > 0 && staleCount >= input.maxStaleCount) {
      if (staleCount === input.maxStaleCount) log(`nudge budget exhausted at x${staleCount}`);
      continue;
    }
    log(`stale x${staleCount}`);
    const prompt = buildManualAdvisorPrompt({
      sessionName: input.sessionName,
      endState: input.endState,
      profileContent: input.profileContent,
      staleCount,
      intervalSeconds: input.intervalSeconds,
      capture
    });
    let nudge = sanitizeNudge(await dependencies.advise(prompt));
    if (!nudge) nudge = fallbackNudge(staleCount);
    log(`nudge: ${nudge}`);
    await dependencies.sendRaw(input.sessionName, nudge);
    await dependencies.sleep(1);
    await dependencies.sendRaw(input.sessionName, "\r");
    await dependencies.sleep(0.5);
    (0, import_node_fs.writeFileSync)(paths.state, newHash, { mode: 384 });
  }
}
function manualMonitorPaths(sessionName, stateDir = (0, import_node_path.join)((0, import_node_os.homedir)(), ".mentiko_monitor")) {
  if (!isSafeSessionName(sessionName)) throw new Error("manual monitor requires a safe session name");
  return {
    state: (0, import_node_path.join)(stateDir, `${sessionName}_state`),
    stale: (0, import_node_path.join)(stateDir, `${sessionName}_stale`),
    log: (0, import_node_path.join)(stateDir, `${sessionName}_log`)
  };
}
function parseManualMonitorArgs(argv) {
  if (argv.length < 2 || argv.length > 4) {
    throw new Error('usage: mentiko monitor <session-name> "end state" [profile] [interval]');
  }
  const [sessionName, endState, profileName = "mentiko", interval = "60"] = argv;
  if (!endState?.trim()) throw new Error("manual monitor requires an end state");
  if (!PROFILE_NAME.test(profileName)) throw new Error("manual monitor requires a safe profile name");
  const intervalSeconds = Number.parseInt(interval, 10);
  if (!Number.isInteger(intervalSeconds) || intervalSeconds <= 0) {
    throw new Error("manual monitor interval must be a positive integer");
  }
  return { sessionName, endState, profileName, intervalSeconds };
}
function buildManualAdvisorPrompt(input) {
  return [
    `AGENT SESSION CAPTURE (${lineCount(input.capture)} total lines)`,
    "",
    "== TOP OF SESSION (task assignment, first 150 lines) ==",
    firstLines(input.capture, 150),
    "",
    "== BOTTOM OF SESSION (current state, last 400 lines) ==",
    tailLines(input.capture, 400),
    "",
    "== END OF CAPTURE ==",
    "",
    "---",
    "",
    "MONITORING CONTEXT:",
    `- Session: ${input.sessionName}`,
    `- Stale count: ${input.staleCount} (no output change in ${input.staleCount * input.intervalSeconds}+ seconds)`,
    `- Expected end state: ${input.endState}`,
    "",
    "---",
    "",
    input.profileContent,
    "",
    "---",
    "",
    "Now output exactly ONE message as Mentiko would send it. Nothing else."
  ].join("\n");
}
function sanitizeNudge(value) {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
  const normalized = trimmed.toLowerCase().replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized || /^(proceed|continue|go|k|ok|yes|y)(\s+(proceed|continue|go|k|ok|yes|y))*[.!]*$/.test(normalized)) return "";
  return trimmed;
}
function fallbackNudge(staleCount) {
  if (staleCount <= 2) {
    return "Resume only the current assigned task. If it is complete, write any required artifacts, run your completion command (mentiko emit), and make the final non-empty line exactly AGENT_COMPLETE.";
  }
  if (staleCount <= 4) {
    return "You look stalled. State the blocker in one sentence, then continue the assigned task or, if done, write your required artifacts, run your completion command (mentiko emit), and finish with AGENT_COMPLETE.";
  }
  return "Stop waiting. Finish only the assigned task: write required artifacts, run your completion command (mentiko emit), and make the final non-empty line exactly AGENT_COMPLETE. Do not hand-write event files.";
}
function validateManualMonitorInput(input) {
  manualMonitorPaths(input.sessionName, input.stateDir);
  if (!input.endState.trim()) throw new Error("manual monitor requires an end state");
  if (!PROFILE_NAME.test(input.profileName)) throw new Error("manual monitor requires a safe profile name");
  if (!Number.isInteger(input.intervalSeconds) || input.intervalSeconds <= 0) throw new Error("manual monitor interval must be a positive integer");
  if (!Number.isInteger(input.maxStaleCount) || input.maxStaleCount < 0) throw new Error("manual monitor max stale count must be zero or a positive integer");
}
function initializeMonitorFiles(paths, input, now) {
  (0, import_node_fs.mkdirSync)((0, import_node_path.dirname)(paths.state), { recursive: true, mode: 448 });
  (0, import_node_fs.writeFileSync)(paths.stale, "0\n", { mode: 384 });
  (0, import_node_fs.writeFileSync)(paths.log, [
    `${now.toISOString()} monitor started for ${input.sessionName}`,
    `  end state: ${input.endState}`,
    `  profile: ${input.profileName}`,
    "---",
    ""
  ].join("\n"), { mode: 384 });
}
function clearManualMonitorState(paths) {
  (0, import_node_fs.rmSync)(paths.state, { force: true });
  (0, import_node_fs.rmSync)(paths.stale, { force: true });
}
function appendLog(path2, line) {
  (0, import_node_fs.writeFileSync)(path2, `${readOptional(path2)}${line}
`, { mode: 384 });
}
function readOptional(path2) {
  try {
    return (0, import_node_fs.readFileSync)(path2, "utf8");
  } catch {
    return "";
  }
}
function readNonNegativeInt(path2) {
  const value = Number.parseInt(readOptional(path2).trim(), 10);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}
function isSafeSessionName(sessionName) {
  return sessionName.length > 0 && sessionName.length <= MAX_SESSION_NAME_LENGTH && !sessionName.includes("/") && !sessionName.includes("\\") && !sessionName.includes("\0") && sessionName !== "." && sessionName !== "..";
}
function captureHash(value) {
  return (0, import_node_crypto.createHash)("md5").update(value).digest("hex");
}
function firstLines(value, count) {
  return value.split(/\r?\n/).slice(0, count).join("\n");
}
function tailLines(value, count) {
  return value.split(/\r?\n/).slice(-count).join("\n");
}
function lineCount(value) {
  return value ? value.split(/\r?\n/).length : 0;
}

// lib/runner-v2/manual-monitor-cli.ts
async function runManualMonitorCli(argv, env = process.env) {
  const args = parseManualMonitorArgs(argv);
  const profilePath = (0, import_node_path2.join)(config_default.codeRoot, "lib", "monitor-profiles", `${args.profileName}.md`);
  const profileContent = readProfile(profilePath, args.profileName);
  const executable = resolveExecutable(env.MENTIKO_CLI || "claude", env.PATH || "");
  await runManualMonitor({
    ...args,
    profileContent,
    maxStaleCount: nonNegativeInt(env.MENTIKO_MONITOR_MAX_STALE, 10)
  }, {
    hasSession: (session) => pty.alive(session),
    capture: (session, lines) => pty.capture(session, lines),
    kill: (session) => pty.kill(session),
    sendRaw: (session, text) => pty.sendRaw(session, text),
    sleep: (seconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, seconds * 1e3)),
    advise: async (prompt) => runAdvisor(executable, prompt),
    log: (line) => console.log(`manual-monitor: ${line}`)
  });
}
function readProfile(profilePath, profileName) {
  try {
    const stat = (0, import_node_fs2.lstatSync)(profilePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("not a regular file");
    return (0, import_node_fs2.readFileSync)(profilePath, "utf8");
  } catch {
    throw new Error(`manual monitor profile '${profileName}' not found or unsafe`);
  }
}
function resolveExecutable(command, pathValue) {
  if (!command) throw new Error("manual monitor requires MENTIKO_CLI");
  const candidates = command.includes("/") ? [(0, import_node_path2.resolve)(command)] : pathValue.split(":").filter(Boolean).map((part) => (0, import_node_path2.join)(part, command));
  for (const candidate of candidates) {
    try {
      (0, import_node_fs2.accessSync)(candidate, import_node_fs2.constants.X_OK);
      return candidate;
    } catch {
    }
  }
  throw new Error(`manual monitor advisor CLI not found: ${command}`);
}
function runAdvisor(executable, prompt) {
  return new Promise((resolveAdvisor) => {
    const child = (0, import_node_child_process.spawn)(executable, ["-p", prompt], { stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", () => resolveAdvisor(""));
    child.on("close", () => resolveAdvisor(output.split(/\r?\n/).slice(0, 10).join("\n")));
  });
}
function nonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
if (require.main === module) {
  runManualMonitorCli(process.argv.slice(2)).catch((error) => {
    console.error(`manual monitor failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  readProfile,
  resolveExecutable,
  runManualMonitorCli
});
