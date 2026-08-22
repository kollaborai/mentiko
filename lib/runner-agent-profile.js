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

// lib/runner-v2/agent-profile-cli.ts
var agent_profile_cli_exports = {};
__export(agent_profile_cli_exports, {
  runRunnerAgentProfileCli: () => runRunnerAgentProfileCli
});
module.exports = __toCommonJS(agent_profile_cli_exports);

// lib/runner-v2/agent-profile.ts
var import_node_fs2 = require("node:fs");
var import_node_os2 = require("node:os");
var import_node_path2 = require("node:path");

// lib/runner-v2/agent-profile-args.ts
function normalizePermissionFlag(cli, permissionFlag) {
  if (cli === "codex" && permissionFlag === "--yolo") {
    return "--dangerously-bypass-approvals-and-sandbox";
  }
  if (cli === "claude" && (permissionFlag === "--dangerously-skip-permissions" || permissionFlag === "--allow-dangerously-skip-permissions --permission-mode bypassPermissions")) {
    return "--dangerously-skip-permissions";
  }
  return permissionFlag;
}
function resolveProfilePermissionArgs(cli, permissionFlag) {
  const normalized = normalizePermissionFlag(cli, permissionFlag);
  return normalized ? splitProfileArgumentString(normalized, "permission_flag") : [];
}
function splitProfileArgumentString(value2, field) {
  const tokens = [];
  let token = "";
  let quote;
  let escaped = false;
  let started = false;
  for (const character of value2) {
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

// lib/runner-v2/claude-mentiko-mcp-config.ts
var import_node_fs = require("node:fs");
var import_node_os = require("node:os");
var import_node_path = require("node:path");
var CONTEXT_DIR_PREFIX = "mentiko-claude-mcp-";
var CONFIG_FILE_NAME = "mcp.json";
function createClaudeMentikoMcpConfig(env, options = {}) {
  const webUrl = value(env.MENTIKO_WEB_URL);
  const sessionId = value(env.MENTIKO_SESSION_ID);
  const sessionToken = value(env.MENTIKO_SESSION_TOKEN);
  const contextValues = [webUrl, sessionId, sessionToken];
  if (contextValues.every((entry) => !entry)) return void 0;
  if (contextValues.some((entry) => !entry)) {
    throw new Error("Claude Mentiko MCP context requires MENTIKO_WEB_URL, MENTIKO_SESSION_ID, and MENTIKO_SESSION_TOKEN");
  }
  const serverPath = options.serverPath || resolveMentikoMcpServer(env);
  if (!(0, import_node_fs.existsSync)(serverPath)) {
    throw new Error(`Claude Mentiko MCP server is missing: ${serverPath}`);
  }
  const dir = (0, import_node_fs.mkdtempSync)((0, import_node_path.join)(options.tempRoot || (0, import_node_os.tmpdir)(), CONTEXT_DIR_PREFIX));
  (0, import_node_fs.chmodSync)(dir, 448);
  const path2 = (0, import_node_path.join)(dir, CONFIG_FILE_NAME);
  const config2 = {
    mcpServers: {
      mentiko: {
        command: "node",
        args: [serverPath],
        env: {
          MENTIKO_WEB_URL: webUrl,
          MENTIKO_SESSION_ID: sessionId,
          MENTIKO_SESSION_TOKEN: sessionToken,
          // A Claude runner may be launched by a process that also hosts the
          // interactive app/bar bridge. Explicitly neutralize that bridge's
          // approval credential so an unattended chain cannot inherit its
          // user-prompt mode.
          MENTIKO_INBOX_KEY: "",
          MENTIKO_MCP_TOOL_SCOPE: "runner"
        }
      }
    }
  };
  (0, import_node_fs.writeFileSync)(path2, `${JSON.stringify(config2)}
`, { encoding: "utf8", flag: "wx", mode: 384 });
  (0, import_node_fs.chmodSync)(path2, 384);
  return { dir, path: path2 };
}
function withClaudeMentikoMcpCleanup(command, receipt) {
  if (!receipt) return command;
  return `${command}; mentiko_mcp_status=$?; rm -f ${shellQuote(receipt.path)}; rmdir ${shellQuote(receipt.dir)} 2>/dev/null || true; (exit $mentiko_mcp_status)`;
}
function resolveMentikoMcpServer(env) {
  const codeRoot2 = value(env.MENTIKO_CODE_ROOT);
  if (!codeRoot2) throw new Error("Claude Mentiko MCP context requires MENTIKO_CODE_ROOT");
  return (0, import_node_path.join)(codeRoot2, "lib", "mentiko-mcp", "dist", "server.js");
}
function value(input) {
  return typeof input === "string" ? input.trim() : "";
}
function shellQuote(value2) {
  return `'${value2.replace(/'/g, `"'"'`)}'`;
}

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
function slugPart(value2) {
  const slug = value2.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
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
  const value2 = process.env.BETTER_AUTH_SECRET || process.env.SECRET_KEY;
  if (value2) return value2;
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
function resolveAgentProfile(input) {
  const chain = readJson(input.chainPath, "chain");
  const agents = Array.isArray(chain.agents) ? chain.agents : [];
  const agent = agents.find((candidate) => candidate.id === input.agentId);
  if (!agent) throw new Error(`Agent '${input.agentId}' is not defined in ${input.chainPath}`);
  const agentId = optionalProfileId(agent.agent_profile, "agent.agent_profile");
  if (agentId) return resolveExactProfile(input.profilesDir, agentId, "agent");
  const chainId = optionalProfileId(chain.default_agent_profile, "chain.default_agent_profile");
  if (chainId) return resolveExactProfile(input.profilesDir, chainId, "chain");
  const workspaceId = resolveWorkspaceProfileId(input.projectRoot, input.orgRoot);
  if (workspaceId) return resolveExactProfile(input.profilesDir, workspaceId, "workspace");
  return resolveDefaultProfile(input.profilesDir, "namespace");
}
function resolveDefaultProfile(profilesDir, source = "namespace") {
  const candidates = listProfileFiles(profilesDir).map((path2) => loadAgentProfile(path2));
  const matches = candidates.filter((candidate) => source === "advisor" ? candidate.profile.isAdvisorDefault === true : candidate.profile.isDefault === true);
  if (matches.length > 1) throw new Error(`Multiple ${source} default agent profiles exist in ${profilesDir}`);
  const selected = matches[0];
  return selected ? { ...selected, source } : void 0;
}
function resolveExactProfile(profilesDir, profileId, source = "explicit") {
  assertProfileId(profileId, "profile id");
  const path2 = (0, import_node_path2.join)(profilesDir, `${profileId}.json`);
  if (!(0, import_node_fs2.existsSync)(path2)) throw new Error(`Agent profile '${profileId}' does not exist at ${path2}`);
  return { ...loadAgentProfile(path2), source };
}
function loadAgentProfile(profilePath) {
  if (!(0, import_node_path2.isAbsolute)(profilePath)) throw new Error(`Agent profile path must be absolute: ${profilePath}`);
  const raw = readJson(profilePath, "agent profile");
  const profile = validateAgentProfile(raw, profilePath);
  const expectedId = (0, import_node_path2.basename)(profilePath, ".json");
  if (expectedId !== profile.id) throw new Error(`Agent profile id '${profile.id}' does not match file name '${expectedId}'`);
  return { id: profile.id, name: profile.name, path: profilePath, profile };
}
function buildAgentProfileCommand(input) {
  const { profile } = loadAgentProfile(input.profilePath);
  const model = input.modelOverride ?? (input.purpose === "relay" ? profile.relay_model ?? profile.model : profile.model);
  const codex = profile.cli === "codex";
  const configuredPipeArgs = input.interactive || !profile.pipe_flag ? [] : splitProfileArgumentString(profile.pipe_flag, "pipe_flag");
  const pipeArgs = codex ? configuredPipeArgs.filter((argument) => argument !== "exec") : configuredPipeArgs;
  const permissionArgs = resolveProfilePermissionArgs(profile.cli, profile.permission_flag);
  const envFile = writeProfileEnvFile(profile, input.namespaceId, input.orgId);
  const mentikoMcp = profile.cli === "claude" ? createClaudeMentikoMcpConfig(process.env) : void 0;
  const codexArgs = codex ? [
    // PTY launches need Codex's interactive TUI so the typed bootstrap can
    // submit the instruction after readiness. The exec subcommand requires
    // a prompt up front and exits with "No prompt provided" otherwise.
    ...input.interactive ? [] : ["exec"],
    "-c",
    "check_for_update_on_startup=false",
    "--dangerously-bypass-hook-trust"
  ] : [];
  const args = [
    profile.cli,
    ...codexArgs,
    ...pipeArgs,
    ...permissionArgs,
    ...model ? ["--model", model] : [],
    ...profile.extra_args ?? [],
    // `--strict-mcp-config` prevents an old user-level `mentiko` entry from
    // overriding this run's URL/session capability.
    ...mentikoMcp ? ["--mcp-config", mentikoMcp.path, "--strict-mcp-config"] : []
  ];
  const command = withClaudeMentikoMcpCleanup(args.map(shellQuote2).join(" "), mentikoMcp);
  const setup = [
    envFile ? `source ${shellQuote2(envFile)}; rm -f ${shellQuote2(envFile)}; rmdir ${shellQuote2((0, import_node_path2.dirname)(envFile))} 2>/dev/null || true` : "",
    envFile && !Object.hasOwn(profile.env ?? {}, "ANTHROPIC_API_KEY") ? "unset ANTHROPIC_API_KEY" : "",
    profile.pre_exec ?? "",
    ...codex ? [buildCodexSetup()] : [],
    ...profile.cli === "claude" && input.interactive ? [buildClaudeTrustSetup()] : [],
    command
  ].filter(Boolean);
  return setup.join("; ");
}
function buildClaudeTrustSetup() {
  const script = "const fs=require('fs'),os=require('os'),path=require('path');const cfg=path.join(os.homedir(),'.claude.json');let d={};try{d=JSON.parse(fs.readFileSync(cfg,'utf8'))}catch{}d.projects=d.projects||{};const c=process.cwd();d.projects[c]={...(d.projects[c]||{}),hasTrustDialogAccepted:true,hasCompletedProjectOnboarding:true,projectOnboardingSeenCount:Math.max(1,(d.projects[c]||{}).projectOnboardingSeenCount||0)};const t=cfg+'.mentiko.'+process.pid;fs.writeFileSync(t,JSON.stringify(d));fs.renameSync(t,cfg);";
  return `node -e ${shellQuote2(script)} 2>/dev/null || true`;
}
function buildCodexSetup() {
  return [
    // Capture the caller's auth location before replacing CODEX_HOME.
    `MENTIKO_CODEX_AUTH_HOME="\${CODEX_HOME:-$HOME/.codex}"`,
    `CODEX_HOME="$(mktemp -d "\${TMPDIR:-/tmp}/mentiko-codex-home.XXXXXX")"`,
    "export CODEX_HOME",
    `if [ -f "$MENTIKO_CODEX_AUTH_HOME/auth.json" ]; then cp "$MENTIKO_CODEX_AUTH_HOME/auth.json" "$CODEX_HOME/auth.json"; chmod 600 "$CODEX_HOME/auth.json"; fi`,
    // Codex uses the absolute project path as the TOML table key. Escape
    // backslashes and double quotes before writing a basic-string key.
    String.raw`MENTIKO_CODEX_PROJECT="$(pwd -P)"`,
    String.raw`MENTIKO_CODEX_PROJECT_KEY="$(printf '%s' "$MENTIKO_CODEX_PROJECT" | sed 's/\\/\\\\/g; s/"/\\"/g')"`,
    `printf 'check_for_update_on_startup = false\\n[projects."%s"]\\ntrust_level = "trusted"\\n' "$MENTIKO_CODEX_PROJECT_KEY" > "$CODEX_HOME/config.toml"`,
    `trap 'rm -rf "$CODEX_HOME"' EXIT`
  ].join("; ");
}
function profileTranscriptConfig(profilePath) {
  const { profile } = loadAgentProfile(profilePath);
  return { cli: profile.cli, ...profile.log_path ? { logPath: profile.log_path } : {} };
}
function validateAgentProfile(value2, path2) {
  if (!isRecord(value2)) throw new Error(`Invalid agent profile JSON at ${path2}`);
  const id = requiredString(value2.id, "id", path2);
  assertProfileId(id, "profile id");
  const name = requiredString(value2.name, "name", path2);
  const cli = requiredString(value2.cli, "cli", path2);
  const profile = {
    id,
    name,
    cli,
    isDefault: value2.isDefault === true,
    ...value2.isAdvisorDefault === true ? { isAdvisorDefault: true } : {},
    ...optionalString(value2.description, "description", path2) ? { description: optionalString(value2.description, "description", path2) } : {},
    ...optionalString(value2.model, "model", path2) ? { model: optionalString(value2.model, "model", path2) } : {},
    ...optionalString(value2.relay_model, "relay_model", path2) ? { relay_model: optionalString(value2.relay_model, "relay_model", path2) } : {},
    ...optionalString(value2.pipe_flag, "pipe_flag", path2) ? { pipe_flag: optionalString(value2.pipe_flag, "pipe_flag", path2) } : {},
    ...optionalString(value2.permission_flag, "permission_flag", path2) ? { permission_flag: optionalString(value2.permission_flag, "permission_flag", path2) } : {},
    ...optionalString(value2.disallowed_tools, "disallowed_tools", path2) ? { disallowed_tools: optionalString(value2.disallowed_tools, "disallowed_tools", path2) } : {},
    ...optionalString(value2.pre_exec, "pre_exec", path2) ? { pre_exec: optionalString(value2.pre_exec, "pre_exec", path2) } : {},
    ...optionalString(value2.log_path, "log_path", path2) ? { log_path: optionalString(value2.log_path, "log_path", path2) } : {},
    ...optionalString(value2.log_format, "log_format", path2) ? { log_format: optionalString(value2.log_format, "log_format", path2) } : {},
    ...value2.extra_args === void 0 ? {} : { extra_args: stringArray(value2.extra_args, "extra_args", path2) },
    ...value2.env === void 0 ? {} : { env: profileEnv(value2.env, path2) },
    ...value2.readiness === void 0 ? {} : { readiness: readiness(value2.readiness, path2) },
    createdAt: typeof value2.createdAt === "string" ? value2.createdAt : "",
    updatedAt: typeof value2.updatedAt === "string" ? value2.updatedAt : ""
  };
  return profile;
}
function resolveWorkspaceProfileId(projectRoot2, orgRoot2) {
  if (!projectRoot2 || !orgRoot2) return void 0;
  const workspacePath = (0, import_node_path2.join)(orgRoot2, "workspaces.json");
  if (!(0, import_node_fs2.existsSync)(workspacePath)) return void 0;
  const workspaces = readJson(workspacePath, "workspace profile configuration");
  if (!Array.isArray(workspaces)) throw new Error(`Workspace profile configuration must be an array: ${workspacePath}`);
  const match = workspaces.find((workspace) => workspace.path === projectRoot2);
  return optionalProfileId(match?.default_agent_profile, "workspace.default_agent_profile");
}
function listProfileFiles(profilesDir) {
  if (!(0, import_node_path2.isAbsolute)(profilesDir)) throw new Error(`Agent profiles directory must be absolute: ${profilesDir}`);
  if (!(0, import_node_fs2.existsSync)(profilesDir)) return [];
  return (0, import_node_fs2.readdirSync)(profilesDir).filter((name) => name.endsWith(".json")).sort().map((name) => (0, import_node_path2.join)(profilesDir, name));
}
function writeProfileEnvFile(profile, namespaceId2, orgId2) {
  const values = Object.entries(profile.env ?? {}).flatMap(([key, value2]) => {
    const secret = value2.match(SECRET_REFERENCE);
    if (!secret) return [[key, value2]];
    const resolved = getSecretByName(namespaceId2, orgId2, secret[1]);
    return resolved === null ? [] : [[key, resolved]];
  });
  if (values.length === 0) return void 0;
  const dir = (0, import_node_fs2.mkdtempSync)((0, import_node_path2.join)((0, import_node_os2.tmpdir)(), "mentiko-agent-profile-"));
  (0, import_node_fs2.chmodSync)(dir, 448);
  const envPath = (0, import_node_path2.join)(dir, "env.sh");
  (0, import_node_fs2.writeFileSync)(envPath, `${values.map(([key, value2]) => `export ${key}=${shellQuote2(value2)}`).join("\n")}
`, { mode: 384 });
  return envPath;
}
function readiness(value2, path2) {
  if (!isRecord(value2) || typeof value2.enabled !== "boolean") throw new Error(`Invalid readiness configuration at ${path2}`);
  return value2;
}
function profileEnv(value2, path2) {
  if (!isRecord(value2)) throw new Error(`Profile env must be an object at ${path2}`);
  return Object.fromEntries(Object.entries(value2).map(([key, entry]) => {
    if (!ENV_KEY.test(key) || typeof entry !== "string") throw new Error(`Invalid profile env entry '${key}' at ${path2}`);
    return [key, entry];
  }));
}
function stringArray(value2, field, path2) {
  if (!Array.isArray(value2) || value2.some((entry) => typeof entry !== "string")) throw new Error(`Profile ${field} must be a string array at ${path2}`);
  return value2;
}
function optionalProfileId(value2, field) {
  if (value2 === void 0 || value2 === null || value2 === "") return void 0;
  if (typeof value2 !== "string") throw new Error(`${field} must be a profile id`);
  assertProfileId(value2, field);
  return value2;
}
function assertProfileId(value2, label) {
  if (!PROFILE_ID.test(value2)) throw new Error(`Invalid ${label}: ${value2}`);
}
function requiredString(value2, field, path2) {
  if (typeof value2 !== "string" || !value2.trim()) throw new Error(`Profile ${field} is required at ${path2}`);
  return value2;
}
function optionalString(value2, field, path2) {
  if (value2 === void 0) return void 0;
  if (typeof value2 !== "string") throw new Error(`Profile ${field} must be a string at ${path2}`);
  return value2 || void 0;
}
function readJson(path2, label) {
  try {
    return JSON.parse((0, import_node_fs2.readFileSync)(path2, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${label} at ${path2}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function isRecord(value2) {
  return typeof value2 === "object" && value2 !== null && !Array.isArray(value2);
}
function shellQuote2(value2) {
  return `'${value2.replace(/'/g, "'\\''")}'`;
}

// lib/runner-v2/agent-profile-cli.ts
var import_node_fs3 = require("node:fs");
function runRunnerAgentProfileCli(argv, write = (line) => console.log(line)) {
  const [command, ...rest] = argv;
  if (!isCommand(command)) throw new Error(usage());
  const values = parseValues(rest);
  switch (command) {
    case "resolve": {
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--chain-path", "--agent-id", "--project-root", "--profiles-dir", "--org-root"]));
      const result = resolveAgentProfile({
        chainPath: required(values, "--chain-path"),
        agentId: required(values, "--agent-id"),
        projectRoot: optional(values, "--project-root"),
        profilesDir: required(values, "--profiles-dir"),
        orgRoot: optional(values, "--org-root")
      });
      write(JSON.stringify(result ? publicProfile(result) : null));
      return;
    }
    case "resolve-field": {
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--chain-path", "--agent-id", "--project-root", "--profiles-dir", "--org-root", "--field"]));
      const result = resolveAgentProfile({
        chainPath: required(values, "--chain-path"),
        agentId: required(values, "--agent-id"),
        projectRoot: optional(values, "--project-root"),
        profilesDir: required(values, "--profiles-dir"),
        orgRoot: optional(values, "--org-root")
      });
      const field = required(values, "--field");
      if (field !== "id" && field !== "path" && field !== "source") throw new Error("--field must be id, path, or source");
      write(result ? String(publicProfile(result)[field] || "") : "");
      return;
    }
    case "default":
    case "advisor": {
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--profiles-dir"]));
      const result = resolveDefaultProfile(required(values, "--profiles-dir"), command === "advisor" ? "advisor" : "namespace");
      write(JSON.stringify(result ? publicProfile(result) : null));
      return;
    }
    case "advisor-field": {
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--profiles-dir", "--field"]));
      const field = required(values, "--field");
      if (field !== "id" && field !== "path") throw new Error("--field must be id or path");
      const result = resolveDefaultProfile(required(values, "--profiles-dir"), "advisor");
      write(result ? String(publicProfile(result)[field]) : "");
      return;
    }
    case "select": {
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--profiles-dir", "--profile-id"]));
      write(JSON.stringify(publicProfile(resolveExactProfile(required(values, "--profiles-dir"), required(values, "--profile-id")))));
      return;
    }
    case "select-field": {
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--profiles-dir", "--profile-id", "--field"]));
      const field = required(values, "--field");
      if (field !== "id" && field !== "path" && field !== "source") throw new Error("--field must be id, path, or source");
      const result = resolveExactProfile(required(values, "--profiles-dir"), required(values, "--profile-id"));
      write(String(publicProfile(result)[field] || ""));
      return;
    }
    case "command": {
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--profile-path", "--interactive", "--namespace-id", "--org-id", "--model", "--purpose"]));
      const purpose = optional(values, "--purpose");
      if (purpose !== void 0 && purpose !== "agent" && purpose !== "relay") throw new Error("--purpose must be agent or relay");
      write(buildAgentProfileCommand({
        profilePath: required(values, "--profile-path"),
        interactive: optional(values, "--interactive") === "true",
        namespaceId: required(values, "--namespace-id"),
        orgId: required(values, "--org-id"),
        modelOverride: optional(values, "--model"),
        purpose: purpose === "relay" ? "relay" : "agent"
      }));
      return;
    }
    case "transcript": {
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--profile-path"]));
      write(JSON.stringify(profileTranscriptConfig(required(values, "--profile-path"))));
      return;
    }
    case "transcript-field": {
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--profile-path", "--field"]));
      const field = required(values, "--field");
      if (field !== "cli" && field !== "logPath") throw new Error("--field must be cli or logPath");
      const transcript = profileTranscriptConfig(required(values, "--profile-path"));
      write(typeof transcript[field] === "string" ? transcript[field] : "");
      return;
    }
    case "field": {
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--profile-path", "--field"]));
      const field = required(values, "--field");
      if (field !== "cli") throw new Error("--field must be cli");
      const profile = loadAgentProfile(required(values, "--profile-path"));
      const cli = profile.cli;
      write(typeof cli === "string" ? cli : "");
      return;
    }
    case "snapshot": {
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--output-path", "--agent-id", "--profile-id", "--profile-source", "--profile-file", "--cli", "--session", "--timestamp"]));
      (0, import_node_fs3.writeFileSync)(required(values, "--output-path"), `${JSON.stringify({
        agent_id: required(values, "--agent-id"),
        profile_id: optional(values, "--profile-id") || "",
        profile_source: optional(values, "--profile-source") || "",
        profile_file: optional(values, "--profile-file") || "",
        cli: optional(values, "--cli") || "",
        session: required(values, "--session"),
        timestamp: required(values, "--timestamp")
      }, null, 2)}
`, { mode: 384 });
      return;
    }
  }
}
function publicProfile(result) {
  return { id: result.id, name: result.name, path: result.path, ...result.source ? { source: result.source } : {} };
}
function parseValues(argv) {
  const values = /* @__PURE__ */ new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value2 = argv[index + 1];
    if (!key?.startsWith("--") || value2 === void 0 || values.has(key)) throw new Error(usage());
    values.set(key, value2);
  }
  return values;
}
function required(values, key) {
  const value2 = values.get(key);
  if (!value2) throw new Error(`${key} is required`);
  return value2;
}
function optional(values, key) {
  return values.get(key);
}
function rejectUnexpected(values, allowed) {
  for (const key of values.keys()) if (!allowed.has(key)) throw new Error(`${key} is not valid for runner-agent-profile`);
}
function isCommand(value2) {
  return value2 === "resolve" || value2 === "resolve-field" || value2 === "default" || value2 === "advisor" || value2 === "advisor-field" || value2 === "select" || value2 === "select-field" || value2 === "command" || value2 === "transcript" || value2 === "transcript-field" || value2 === "field" || value2 === "snapshot";
}
function usage() {
  return "usage: runner-agent-profile <resolve|resolve-field|default|advisor|advisor-field|select|select-field|command|transcript|transcript-field|field|snapshot> [options]";
}
if (require.main === module) {
  try {
    runRunnerAgentProfileCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runRunnerAgentProfileCli
});
