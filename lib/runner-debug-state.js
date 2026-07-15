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

// lib/runner-v2/debug-state-cli.ts
var debug_state_cli_exports = {};
__export(debug_state_cli_exports, {
  runDebugStateCli: () => runDebugStateCli
});
module.exports = __toCommonJS(debug_state_cli_exports);

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

// lib/runs/debug-state-store.ts
var import_node_fs = require("node:fs");
var import_node_crypto = require("node:crypto");
var import_node_path = require("node:path");

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

// lib/runner-v2/file-claim.ts
var import_fs2 = require("fs");
var import_path3 = require("path");
var import_crypto = require("crypto");
var import_child_process = require("child_process");
var DEFAULT_FRESH_MS = 3e4;
var DEFAULT_WAIT_TIMEOUT_MS = 250;
var DEFAULT_RETRY_DELAY_MS = 10;
var ExclusiveFileClaimBusyError = class extends Error {
  constructor(claimDir) {
    super(`file claim already held: ${claimDir}`);
    this.claimDir = claimDir;
    this.name = "ExclusiveFileClaimBusyError";
  }
};
function withExclusiveFileClaim(claimDir, fn, options = {}) {
  const release = acquireExclusiveFileClaim(claimDir, options);
  try {
    const value = fn();
    if (isPromiseLike(value)) {
      return Promise.resolve(value).finally(release);
    }
    release();
    return value;
  } catch (error) {
    release();
    throw error;
  }
}
function acquireExclusiveFileClaim(claimDir, options) {
  const deadline = Date.now() + (options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS);
  while (true) {
    try {
      return tryAcquireExclusiveFileClaim(claimDir, options);
    } catch (error) {
      if (!(error instanceof ExclusiveFileClaimBusyError) || Date.now() >= deadline) throw error;
      waitSynchronously(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
    }
  }
}
function tryAcquireExclusiveFileClaim(claimDir, options) {
  const pid = options.pid ?? process.pid;
  const isAlive = options.isProcessAlive ?? processIsAlive;
  const identity = options.processIdentity ?? claimProcessIdentity;
  const freshMs = options.freshMs ?? DEFAULT_FRESH_MS;
  const reaperDir = `${claimDir}.reaper`;
  (0, import_fs2.mkdirSync)((0, import_path3.dirname)(claimDir), { recursive: true });
  cleanupOrphanedReleaseQuarantines(claimDir, isAlive, identity, freshMs);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if ((0, import_fs2.existsSync)(reaperDir)) {
      const reaper2 = acquireReaperClaim(reaperDir, {
        pid,
        isAlive,
        identity,
        freshMs,
        removeDirectoryAttempt: options.removeDirectoryAttempt
      });
      reaper2.release();
      continue;
    }
    const owner = newOwner(pid, identity);
    try {
      const held = createOwnedDirectoryClaim(claimDir, owner, options.removeDirectoryAttempt);
      if ((0, import_fs2.existsSync)(reaperDir)) {
        held.release();
        continue;
      }
      return held.release;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
    const observed = readOwner(claimDir);
    if (observed && ownerIsAlive(observed, isAlive, identity) || !observed && claimAgeMs(claimDir) < freshMs) {
      throw new ExclusiveFileClaimBusyError(claimDir);
    }
    const reaper = acquireReaperClaim(reaperDir, {
      pid,
      isAlive,
      identity,
      freshMs,
      removeDirectoryAttempt: options.removeDirectoryAttempt
    });
    try {
      const current = readOwner(claimDir);
      const ownerChanged = !sameOwner(observed, current);
      if (ownerChanged || current && ownerIsAlive(current, isAlive, identity) || !current && claimAgeMs(claimDir) < freshMs) {
        throw new ExclusiveFileClaimBusyError(claimDir);
      }
      if (!reaper.owns()) throw new ExclusiveFileClaimBusyError(claimDir);
      options.beforeStaleRetirement?.();
      if (!reaper.owns()) throw new ExclusiveFileClaimBusyError(claimDir);
      const quarantine = `${claimDir}.stale-${process.pid}-${(0, import_crypto.randomUUID)()}`;
      try {
        (0, import_fs2.renameSync)(claimDir, quarantine);
      } catch (error) {
        if (isNotFound(error)) continue;
        throw error;
      }
      const moved = readOwner(quarantine);
      if (!sameOwner(observed, moved) || !reaper.owns()) {
        restoreQuarantine(quarantine, claimDir);
        throw new ExclusiveFileClaimBusyError(claimDir);
      }
      (0, import_fs2.rmSync)(quarantine, { recursive: true, force: true });
    } finally {
      reaper.release();
    }
  }
  throw new ExclusiveFileClaimBusyError(claimDir);
}
function acquireReaperClaim(reaperDir, input) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const owner = newOwner(input.pid, input.identity);
    try {
      return createOwnedDirectoryClaim(reaperDir, owner, input.removeDirectoryAttempt);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
    const observed = readOwner(reaperDir);
    if (observed && ownerIsAlive(observed, input.isAlive, input.identity) || !observed && claimAgeMs(reaperDir) < input.freshMs) {
      throw new ExclusiveFileClaimBusyError(reaperDir);
    }
    const quarantine = `${reaperDir}.stale-${process.pid}-${(0, import_crypto.randomUUID)()}`;
    try {
      (0, import_fs2.renameSync)(reaperDir, quarantine);
    } catch (error) {
      if (isNotFound(error)) continue;
      throw error;
    }
    const moved = readOwner(quarantine);
    if (!sameOwner(observed, moved)) {
      restoreQuarantine(quarantine, reaperDir);
      throw new ExclusiveFileClaimBusyError(reaperDir);
    }
    removeDirectoryWithRetries(quarantine, input.removeDirectoryAttempt);
  }
  throw new ExclusiveFileClaimBusyError(reaperDir);
}
function createOwnedDirectoryClaim(claimDir, owner, removeDirectoryAttempt) {
  const candidate = `${claimDir}.candidate-${owner.pid}-${owner.token}`;
  (0, import_fs2.mkdirSync)(candidate);
  try {
    (0, import_fs2.writeFileSync)(ownerPath(candidate), `${JSON.stringify(owner)}
`, {
      flag: "wx",
      mode: 384
    });
    (0, import_fs2.renameSync)(candidate, claimDir);
  } catch (error) {
    (0, import_fs2.rmSync)(candidate, { recursive: true, force: true });
    throw error;
  }
  return {
    owner,
    owns: () => sameOwner(readOwner(claimDir), owner),
    release: claimRelease(claimDir, owner, removeDirectoryAttempt)
  };
}
function claimRelease(claimDir, owner, removeDirectoryAttempt) {
  let released = false;
  return () => {
    if (released) return;
    const current = readOwner(claimDir);
    if (!sameOwner(current, owner)) return;
    const quarantine = `${claimDir}.release-${owner.pid}-${owner.token}`;
    try {
      (0, import_fs2.renameSync)(claimDir, quarantine);
    } catch (error) {
      if (isNotFound(error)) released = true;
      else throw error;
      return;
    }
    const moved = readOwner(quarantine);
    if (!sameOwner(moved, owner)) {
      restoreQuarantine(quarantine, claimDir);
      return;
    }
    try {
      removeDirectoryWithRetries(quarantine, removeDirectoryAttempt);
      released = true;
    } catch {
      released = true;
    }
  };
}
function restoreQuarantine(quarantine, canonical) {
  if ((0, import_fs2.existsSync)(canonical)) return;
  try {
    (0, import_fs2.renameSync)(quarantine, canonical);
  } catch {
  }
}
function sameOwner(left, right) {
  if (!left || !right) return !left && !right;
  return left.pid === right.pid && left.token === right.token && left.processIdentity === right.processIdentity;
}
function ownerPath(claimDir) {
  return `${claimDir}/owner.json`;
}
function readOwner(claimDir) {
  try {
    const value = JSON.parse((0, import_fs2.readFileSync)(ownerPath(claimDir), "utf8"));
    return Number.isInteger(value.pid) && Number(value.pid) > 0 && typeof value.token === "string" ? {
      pid: Number(value.pid),
      token: value.token,
      ...typeof value.processIdentity === "string" ? { processIdentity: value.processIdentity } : {}
    } : void 0;
  } catch {
    return void 0;
  }
}
function claimAgeMs(claimDir) {
  try {
    return Math.max(0, Date.now() - (0, import_fs2.statSync)(claimDir).mtimeMs);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return hasCode(error, "EPERM");
  }
}
function claimProcessIsAlive(pid) {
  return processIsAlive(pid);
}
function claimProcessIdentity(pid) {
  try {
    const stat = (0, import_fs2.readFileSync)(`/proc/${pid}/stat`, "utf8");
    const closingParen = stat.lastIndexOf(")");
    const fields = stat.slice(closingParen + 2).split(" ");
    if (fields[19]) return `proc:${fields[19]}`;
  } catch {
  }
  try {
    const value = (0, import_child_process.execFileSync)("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 1e3,
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return value ? `ps:${value}` : void 0;
  } catch {
    return void 0;
  }
}
function claimProcessMatchesIdentity(pid, recordedIdentity, isAlive = claimProcessIsAlive, identity = claimProcessIdentity) {
  if (!isAlive(pid)) return false;
  if (!recordedIdentity) return true;
  const currentIdentity = identity(pid);
  return currentIdentity === void 0 || currentIdentity === recordedIdentity;
}
function newOwner(pid, identity) {
  const value = identity(pid);
  return {
    pid,
    token: (0, import_crypto.randomUUID)(),
    ...value ? { processIdentity: value } : {}
  };
}
function ownerIsAlive(owner, isAlive, identity) {
  return claimProcessMatchesIdentity(owner.pid, owner.processIdentity, isAlive, identity);
}
function waitSynchronously(timeoutMs) {
  if (timeoutMs <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, timeoutMs);
}
function removeDirectoryWithRetries(path2, attemptRemoval = (target) => {
  (0, import_fs2.rmSync)(target, { recursive: true, force: true });
}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      attemptRemoval(path2);
      return;
    } catch (error) {
      if (attempt >= 3 || !isTransientRemoveError(error)) throw error;
      waitSynchronously(10);
    }
  }
}
function cleanupOrphanedReleaseQuarantines(claimDir, isAlive, identity, freshMs) {
  const parent = (0, import_path3.dirname)(claimDir);
  const prefix = `${(0, import_path3.basename)(claimDir)}.release-`;
  let entries;
  try {
    entries = (0, import_fs2.readdirSync)(parent);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.startsWith(prefix)) continue;
    const path2 = (0, import_path3.join)(parent, entry);
    const owner = readOwner(path2);
    if (owner && ownerIsAlive(owner, isAlive, identity) || !owner && claimAgeMs(path2) < freshMs) continue;
    try {
      removeDirectoryWithRetries(path2);
    } catch {
    }
  }
}
function isTransientRemoveError(error) {
  return ["EBUSY", "EMFILE", "ENFILE", "ENOTEMPTY", "EPERM"].some((code) => hasCode(error, code));
}
function isPromiseLike(value) {
  return !!value && (typeof value === "object" || typeof value === "function") && "then" in value && typeof value.then === "function";
}
function isAlreadyExists(error) {
  return hasCode(error, "EEXIST") || hasCode(error, "ENOTEMPTY");
}
function isNotFound(error) {
  return hasCode(error, "ENOENT");
}
function hasCode(error, code) {
  return !!error && typeof error === "object" && "code" in error && error.code === code;
}

// lib/runs/debug-state-store.ts
var SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
var CLAIM_WAIT_MS = 1e3;
var DebugStateValidationError = class extends Error {
  constructor(stage, issues) {
    super(`Invalid ${stage} debug state: ${issues.map((issue) => `${issue.code} (${issue.message})`).join(", ")}`);
    this.stage = stage;
    this.issues = issues;
    this.name = "DebugStateValidationError";
  }
};
function resolveDebugStatePaths(runId, debugDir = config_default.debugDir) {
  assertSegment(runId, "run id");
  if (!debugDir || !(0, import_node_path.isAbsolute)(debugDir)) throw new DebugStateValidationError("normalized", [{ code: "invalid-record", message: "Debug directory must be absolute." }]);
  (0, import_node_fs.mkdirSync)(debugDir, { recursive: true, mode: 448 });
  const canonicalRoot = (0, import_node_fs.realpathSync)(debugDir);
  const debugPath = contained(canonicalRoot, `${runId}.json`);
  if (pathPresent(debugPath)) assertRegularFile(debugPath);
  return { debugDir: canonicalRoot, debugPath };
}
function validateRawDebugState(content) {
  if (content.trim() === "") return { valid: false, issues: [{ code: "empty-file", message: "Debug state file must not be empty." }] };
  let value;
  try {
    value = JSON.parse(content);
  } catch (error) {
    return { valid: false, issues: [{ code: "invalid-json", message: error instanceof Error ? error.message : "Debug state is not valid JSON." }] };
  }
  if (!isRecord(value)) return { valid: false, issues: [{ code: "invalid-root", message: "Debug state JSON root must be an object." }] };
  return { valid: true, value, issues: [] };
}
function validateDebugState(value) {
  if (!isRecord(value)) return { valid: false, issues: [{ code: "invalid-record", message: "Debug state must be an object." }] };
  const issues = [];
  if (value.run_id !== void 0 && (typeof value.run_id !== "string" || !SEGMENT.test(value.run_id))) {
    issues.push({ code: "invalid-id", field: "run_id", message: "run_id must be a safe path segment." });
  }
  if (value.status !== void 0 && (typeof value.status !== "string" || !isDebugStatus(value.status))) {
    issues.push({ code: "invalid-status", field: "status", message: "status must be a known debug status." });
  }
  if (value.current_step !== void 0 && value.current_step !== null && (!Number.isSafeInteger(value.current_step) || value.current_step < 0)) {
    issues.push({ code: "invalid-field-type", field: "current_step", message: "current_step must be a non-negative integer or null." });
  }
  if (!Array.isArray(value.steps)) {
    issues.push({ code: "invalid-field-type", field: "steps", message: "steps must be an array." });
  } else {
    value.steps.forEach((step, index) => {
      if (!isRecord(step)) {
        issues.push({ code: "invalid-step", field: `steps[${index}]`, message: "step must be an object." });
        return;
      }
      for (const field of ["agent_id", "agent_name", "session", "status", "output"]) {
        if (step[field] !== void 0 && typeof step[field] !== "string") {
          issues.push({ code: "invalid-step", field: `steps[${index}].${field}`, message: `${field} must be a string.` });
        }
      }
      if (step.round !== void 0 && (!Number.isSafeInteger(step.round) || step.round < 0)) {
        issues.push({ code: "invalid-step", field: `steps[${index}].round`, message: "round must be a non-negative integer." });
      }
      if (step.timestamp !== void 0 && (typeof step.timestamp !== "string" || Number.isNaN(Date.parse(step.timestamp)))) {
        issues.push({ code: "invalid-timestamp", field: `steps[${index}].timestamp`, message: "timestamp must be an ISO timestamp." });
      }
    });
  }
  if (value.breakpoints !== void 0 && !Array.isArray(value.breakpoints)) {
    issues.push({ code: "invalid-field-type", field: "breakpoints", message: "breakpoints must be an array." });
  }
  if (value.last_action_at !== void 0 && (typeof value.last_action_at !== "string" || Number.isNaN(Date.parse(value.last_action_at)))) {
    issues.push({ code: "invalid-timestamp", field: "last_action_at", message: "last_action_at must be an ISO timestamp." });
  }
  return { valid: issues.length === 0, issues };
}
function parseDebugState(content, expectedRunId) {
  const raw = validateRawDebugState(content);
  if (!raw.valid || !raw.value) throw new DebugStateValidationError("raw", raw.issues);
  const normalized = validateDebugState(raw.value);
  if (!normalized.valid) throw new DebugStateValidationError("normalized", normalized.issues);
  const state = raw.value;
  if (expectedRunId && state.run_id && state.run_id !== expectedRunId) {
    throw new DebugStateValidationError("normalized", [{ code: "invalid-id", field: "run_id", message: "run_id does not match its path." }]);
  }
  return state;
}
function loadDebugState(runId, debugDir = config_default.debugDir) {
  const { debugPath } = resolveDebugStatePaths(runId, debugDir);
  if (!pathPresent(debugPath)) return null;
  return parseDebugState((0, import_node_fs.readFileSync)(debugPath, "utf8"), runId);
}
function appendDebugStep(input, debugDir = config_default.debugDir) {
  const { debugPath } = resolveDebugStatePaths(input.runId, debugDir);
  return withExclusiveFileClaim(`${debugPath}.lock`, () => {
    const current = pathPresent(debugPath) ? parseDebugState((0, import_node_fs.readFileSync)(debugPath, "utf8"), input.runId) : { run_id: input.runId, steps: [] };
    const sanitized = sanitizeOutput(input.output);
    return publishDebugState(debugPath, validateForWrite({
      ...current,
      run_id: input.runId,
      steps: [...current.steps, {
        agent_id: input.agentId,
        agent_name: input.agentName,
        session: input.session,
        round: input.round,
        status: input.status,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        output: sanitized
      }],
      current_step: current.steps.length
    }));
  }, { waitTimeoutMs: CLAIM_WAIT_MS });
}
function mutateDebugState(input, debugDir = config_default.debugDir) {
  const { debugPath } = resolveDebugStatePaths(input.runId, debugDir);
  return withExclusiveFileClaim(`${debugPath}.lock`, () => {
    const current = pathPresent(debugPath) ? parseDebugState((0, import_node_fs.readFileSync)(debugPath, "utf8"), input.runId) : { run_id: input.runId, status: "initialized", current_step: null, steps: [], breakpoints: input.breakpoints || [] };
    const next = { ...current, run_id: input.runId, last_action: input.action, last_action_at: (/* @__PURE__ */ new Date()).toISOString() };
    switch (input.action) {
      case "pause":
        next.status = "paused";
        break;
      case "continue":
      case "resume":
        next.status = "running";
        break;
      case "step":
        next.status = "stepping";
        next.current_step = input.stepIndex ?? (current.current_step ?? -1) + 1;
        break;
      case "skip":
        updateStepStatus(next, input.stepIndex, "skipped");
        break;
      case "retry":
        updateStepStatus(next, input.stepIndex, "pending");
        break;
      case "abort":
        next.status = "aborted";
        break;
      case "set_breakpoints":
        next.breakpoints = input.breakpoints || [];
        break;
    }
    return publishDebugState(debugPath, validateForWrite(next));
  }, { waitTimeoutMs: CLAIM_WAIT_MS });
}
function clearDebugState(runId, debugDir = config_default.debugDir) {
  const { debugPath } = resolveDebugStatePaths(runId, debugDir);
  withExclusiveFileClaim(`${debugPath}.lock`, () => {
    if (pathPresent(debugPath)) (0, import_node_fs.unlinkSync)(debugPath);
  }, { waitTimeoutMs: CLAIM_WAIT_MS });
}
function emptyDebugState() {
  return { status: "idle", current_step: null, steps: [] };
}
function validateForWrite(state) {
  const normalized = validateDebugState(state);
  if (!normalized.valid) throw new DebugStateValidationError("normalized", normalized.issues);
  return state;
}
function publishDebugState(debugPath, state) {
  (0, import_node_fs.mkdirSync)((0, import_node_path.resolve)(debugPath, ".."), { recursive: true, mode: 448 });
  const temporary = (0, import_node_path.join)((0, import_node_path.resolve)(debugPath, ".."), `.${(0, import_node_path.basename)(debugPath)}.${process.pid}.${(0, import_node_crypto.randomUUID)()}.tmp`);
  (0, import_node_fs.writeFileSync)(temporary, `${JSON.stringify(state, null, 2)}
`, { encoding: "utf8", mode: 384, flag: "wx" });
  (0, import_node_fs.renameSync)(temporary, debugPath);
  return state;
}
function updateStepStatus(state, stepIndex, status) {
  if (stepIndex === void 0 || !Number.isSafeInteger(stepIndex) || stepIndex < 0) return;
  const step = state.steps[stepIndex];
  if (step) step.status = status;
}
function sanitizeOutput(output) {
  const collapsed = String(output).replace(/[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  const truncated = collapsed.slice(0, 200);
  return output.length > 200 ? `${truncated}...` : truncated || "(no output)";
}
function isDebugStatus(value) {
  return ["idle", "initialized", "running", "paused", "stepping", "aborted", "completed", "failed", "stopped"].includes(value);
}
function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function assertSegment(value, label) {
  if (!SEGMENT.test(value)) throw new DebugStateValidationError("normalized", [{ code: "invalid-id", field: label, message: `${label} must be a safe path segment.` }]);
}
function contained(root, child) {
  const path2 = (0, import_node_path.resolve)(root, child);
  const rel = (0, import_node_path.relative)(root, path2);
  if (!rel || rel.startsWith("..") || (0, import_node_path.isAbsolute)(rel)) throw new DebugStateValidationError("normalized", [{ code: "invalid-record", message: "Debug state path escapes its root." }]);
  return path2;
}
function assertRegularFile(path2) {
  const stat = (0, import_node_fs.lstatSync)(path2);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new DebugStateValidationError("normalized", [{ code: "invalid-record", message: "Debug state path must be a regular file." }]);
}
function pathPresent(path2) {
  try {
    (0, import_node_fs.lstatSync)(path2);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

// lib/runner-v2/debug-state-cli.ts
var COMMANDS = ["write-step", "get", "clear", "action"];
function runDebugStateCli(argv, write = (line) => console.log(line)) {
  const { command, values } = parseCli(argv);
  const runId = required(values, "--run-id");
  const debugDir = optional(values, "--debug-dir");
  if (command === "write-step") {
    rejectUnexpected(values, /* @__PURE__ */ new Set(["--run-id", "--debug-dir", "--agent-id", "--agent-name", "--session", "--round", "--status", "--output"]));
    write(JSON.stringify(appendDebugStep({
      runId,
      agentId: required(values, "--agent-id"),
      agentName: required(values, "--agent-name"),
      session: required(values, "--session"),
      round: nonNegativeInteger(values, "--round"),
      status: required(values, "--status"),
      output: optional(values, "--output") || ""
    }, debugDir)));
    return;
  }
  if (command === "get") {
    rejectUnexpected(values, /* @__PURE__ */ new Set(["--run-id", "--debug-dir"]));
    write(JSON.stringify(loadDebugState(runId, debugDir) || emptyDebugState()));
    return;
  }
  if (command === "clear") {
    rejectUnexpected(values, /* @__PURE__ */ new Set(["--run-id", "--debug-dir"]));
    clearDebugState(runId, debugDir);
    write(JSON.stringify({ success: true }));
    return;
  }
  rejectUnexpected(values, /* @__PURE__ */ new Set(["--run-id", "--debug-dir", "--action", "--step-index", "--breakpoints-json"]));
  const action = required(values, "--action");
  if (!["pause", "continue", "resume", "step", "skip", "retry", "abort", "set_breakpoints"].includes(action)) throw new Error(`Invalid debug action: ${action}`);
  const breakpointsJson = optional(values, "--breakpoints-json");
  let breakpoints;
  if (breakpointsJson !== void 0) {
    const parsed = JSON.parse(breakpointsJson);
    if (!Array.isArray(parsed)) throw new Error("--breakpoints-json must contain an array");
    breakpoints = parsed;
  }
  write(JSON.stringify(mutateDebugState({
    runId,
    action,
    stepIndex: optional(values, "--step-index") === void 0 ? void 0 : nonNegativeInteger(values, "--step-index"),
    breakpoints
  }, debugDir)));
}
function parseCli(argv) {
  const command = argv[0];
  if (!COMMANDS.includes(command)) throw new Error(`usage: runner-debug-state <${COMMANDS.join("|")}> [options]`);
  const values = /* @__PURE__ */ new Map();
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === void 0 || values.has(flag)) throw new Error(`usage: runner-debug-state <${COMMANDS.join("|")}> [options]`);
    values.set(flag, value);
  }
  return { command, values };
}
function rejectUnexpected(values, allowed) {
  for (const flag of values.keys()) if (!allowed.has(flag)) throw new Error(`${flag} is not valid for runner-debug-state.`);
}
function required(values, flag) {
  const value = values.get(flag);
  if (value === void 0 || value.trim() === "") throw new Error(`Missing required debug-state argument: ${flag}`);
  return value;
}
function optional(values, flag) {
  const value = values.get(flag);
  return value === void 0 || value.trim() === "" ? void 0 : value;
}
function nonNegativeInteger(values, flag) {
  const value = required(values, flag);
  if (!/^\d+$/.test(value)) throw new Error(`${flag} must be a non-negative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${flag} must be a safe integer`);
  return parsed;
}
if (typeof require !== "undefined" && require.main === module) {
  try {
    runDebugStateCli(process.argv.slice(2));
  } catch (error) {
    console.error(`runner debug state failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runDebugStateCli
});
