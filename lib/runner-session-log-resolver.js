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

// lib/runs/session-log-resolver-cli.ts
var session_log_resolver_cli_exports = {};
__export(session_log_resolver_cli_exports, {
  runSessionLogResolverCli: () => runSessionLogResolverCli
});
module.exports = __toCommonJS(session_log_resolver_cli_exports);
var import_node_fs3 = require("node:fs");

// lib/runs/session-log-resolver.ts
var import_node_child_process = require("node:child_process");
var import_node_fs = require("node:fs");
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
function getCliTool(toolId) {
  const key = toolId.toLowerCase();
  return CLI_TOOLS.find(
    (tool) => tool.id === key || tool.cli === key || tool.bundleProvider === key
  );
}
function getBundleProviderForTool(toolId) {
  return getCliTool(toolId)?.bundleProvider;
}
function getCatalogBundleByProvider(provider) {
  return PROFILE_BUNDLES.find((bundle) => bundle.provider === provider);
}

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
function getBundleByProvider(provider) {
  const bundle = getCatalogBundleByProvider(provider);
  if (!bundle) return void 0;
  return {
    ...bundle,
    logo: LOGOS[bundle.logoKey] ?? CUSTOM_LOGO
  };
}

// lib/runs/session-log-resolver.ts
function encodeCwdSlug(cli, cwd) {
  if (cli.startsWith("kollab")) {
    return cwd.replace(/^\//, "").replace(/\//g, "_");
  }
  switch (cli) {
    case "claude":
    case "claude-code":
      return cwd.replace(/[\/.]/g, "-");
    case "codex":
      return "";
    default:
      return cwd.replace(/[\/.]/g, "-");
  }
}
var TRANSCRIPT_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
var CONVERSATION_WINDOW_SECONDS = 30;
function resolveProfileLogDir(profile, cwd) {
  if (!profile.log_path?.trim()) return "";
  return resolveLogDir(profile.cli, cwd, profile.log_path);
}
function resolveSessionLog(logDir, session, ptyBinary) {
  if (!isDirectory(logDir) || !session || !ptyBinary) return "";
  const capture = (0, import_node_child_process.spawnSync)(ptyBinary, ["capture", session, "100"], {
    encoding: "utf8",
    timeout: 1e4,
    windowsHide: true
  });
  const uuid = (capture.stdout ?? "").match(TRANSCRIPT_UUID)?.[0];
  if (!uuid) return "";
  const candidate = import_path.default.join(logDir, `${uuid}.jsonl`);
  return isRegularFile(candidate) ? candidate : "";
}
function findConversationFiles(logDir, startedAtEpoch, cli = "claude") {
  if (!isDirectory(logDir) || !Number.isFinite(startedAtEpoch) || startedAtEpoch <= 0) return [];
  const dateRoot = cli === "codex" ? codexDateRoot(logDir, startedAtEpoch) : logDir;
  const searchRoot = isDirectory(dateRoot) ? dateRoot : logDir;
  const files = listJsonlFiles(searchRoot, 2);
  const matched = files.filter((file) => {
    const birth = fileBirthEpoch(file);
    return birth >= startedAtEpoch - CONVERSATION_WINDOW_SECONDS && birth <= startedAtEpoch + CONVERSATION_WINDOW_SECONDS;
  });
  if (matched.length) return matched;
  const newest = files.map((file) => ({ file, birth: fileBirthEpoch(file) })).sort((left, right) => right.birth - left.birth || left.file.localeCompare(right.file))[0];
  return newest ? [newest.file] : [];
}
function fileBirthEpoch(file) {
  try {
    const stat = (0, import_node_fs.statSync)(file);
    const birth = Math.floor(stat.birthtimeMs / 1e3);
    if (Number.isFinite(birth) && birth > 0) return birth;
    const modified = Math.floor(stat.mtimeMs / 1e3);
    return Number.isFinite(modified) && modified > 0 ? modified : 0;
  } catch {
    return 0;
  }
}
function codexDateRoot(logDir, epoch) {
  const date = new Date(epoch * 1e3);
  const part = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join(import_path.default.sep);
  return import_path.default.join(logDir, part);
}
function listJsonlFiles(root, depth) {
  if (depth < 0 || !isDirectory(root)) return [];
  try {
    return (0, import_node_fs.readdirSync)(root, { withFileTypes: true }).flatMap((entry) => {
      const candidate = import_path.default.join(root, entry.name);
      if (entry.isDirectory()) return depth > 1 ? listJsonlFiles(candidate, depth - 1) : [];
      return entry.isFile() && entry.name.endsWith(".jsonl") && isRegularFile(candidate) ? [candidate] : [];
    });
  } catch {
    return [];
  }
}
function isDirectory(candidate) {
  try {
    return (0, import_node_fs.existsSync)(candidate) && (0, import_node_fs.lstatSync)(candidate).isDirectory();
  } catch {
    return false;
  }
}
function isRegularFile(candidate) {
  try {
    return (0, import_node_fs.lstatSync)(candidate).isFile();
  } catch {
    return false;
  }
}
function resolveLogDir(provider, cwd, logPathOverride) {
  let logPath = logPathOverride || "";
  if (!logPath) {
    const providerId = getBundleProviderForTool(provider) || provider;
    const bundle = getBundleByProvider(providerId);
    logPath = bundle?.log_path || "";
  }
  if (!logPath) return "";
  if (logPath.startsWith("~")) {
    logPath = import_path.default.join((0, import_os.homedir)(), logPath.slice(1));
  }
  logPath = logPath.replace(/\/+$/, "");
  const slug = encodeCwdSlug(provider, cwd);
  return slug ? import_path.default.join(logPath, slug) : logPath;
}

// lib/runner-v2/agent-profile.ts
var import_node_fs2 = require("node:fs");
var import_node_path = require("node:path");

// lib/config.ts
var import_path2 = __toESM(require("path"));
var import_os2 = require("os");
function expandTilde(p) {
  if (p.startsWith("~/") || p === "~") {
    return import_path2.default.join((0, import_os2.homedir)(), p.slice(2));
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
  process.env.MENTIKO_GLOBAL_ROOT || process.env.MENTIKO_ROOT || import_path2.default.join((0, import_os2.homedir)(), ".mentiko")
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
var claudeProjectsBase = process.env.CLAUDE_PROJECTS_DIR || import_path2.default.join((0, import_os2.homedir)(), ".claude", "projects");
var ptyManagerDir = process.env.PTY_MANAGER_DIR || import_path2.default.join((0, import_os2.homedir)(), ".pty-manager");
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

// lib/runner-v2/agent-profile.ts
var PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var ENV_KEY = /^[A-Z_][A-Z0-9_]*$/;
function loadAgentProfile(profilePath) {
  if (!(0, import_node_path.isAbsolute)(profilePath)) throw new Error(`Agent profile path must be absolute: ${profilePath}`);
  const raw = readJson(profilePath, "agent profile");
  const profile = validateAgentProfile(raw, profilePath);
  const expectedId = (0, import_node_path.basename)(profilePath, ".json");
  if (expectedId !== profile.id) throw new Error(`Agent profile id '${profile.id}' does not match file name '${expectedId}'`);
  return { id: profile.id, name: profile.name, path: profilePath, profile };
}
function profileTranscriptConfig(profilePath) {
  const { profile } = loadAgentProfile(profilePath);
  return { cli: profile.cli, ...profile.log_path ? { logPath: profile.log_path } : {} };
}
function validateAgentProfile(value, path3) {
  if (!isRecord(value)) throw new Error(`Invalid agent profile JSON at ${path3}`);
  const id = requiredString(value.id, "id", path3);
  assertProfileId(id, "profile id");
  const name = requiredString(value.name, "name", path3);
  const cli = requiredString(value.cli, "cli", path3);
  const profile = {
    id,
    name,
    cli,
    isDefault: value.isDefault === true,
    ...value.isAdvisorDefault === true ? { isAdvisorDefault: true } : {},
    ...optionalString(value.description, "description", path3) ? { description: optionalString(value.description, "description", path3) } : {},
    ...optionalString(value.model, "model", path3) ? { model: optionalString(value.model, "model", path3) } : {},
    ...optionalString(value.relay_model, "relay_model", path3) ? { relay_model: optionalString(value.relay_model, "relay_model", path3) } : {},
    ...optionalString(value.pipe_flag, "pipe_flag", path3) ? { pipe_flag: optionalString(value.pipe_flag, "pipe_flag", path3) } : {},
    ...optionalString(value.permission_flag, "permission_flag", path3) ? { permission_flag: optionalString(value.permission_flag, "permission_flag", path3) } : {},
    ...optionalString(value.disallowed_tools, "disallowed_tools", path3) ? { disallowed_tools: optionalString(value.disallowed_tools, "disallowed_tools", path3) } : {},
    ...optionalString(value.pre_exec, "pre_exec", path3) ? { pre_exec: optionalString(value.pre_exec, "pre_exec", path3) } : {},
    ...optionalString(value.log_path, "log_path", path3) ? { log_path: optionalString(value.log_path, "log_path", path3) } : {},
    ...optionalString(value.log_format, "log_format", path3) ? { log_format: optionalString(value.log_format, "log_format", path3) } : {},
    ...value.extra_args === void 0 ? {} : { extra_args: stringArray(value.extra_args, "extra_args", path3) },
    ...value.env === void 0 ? {} : { env: profileEnv(value.env, path3) },
    ...value.readiness === void 0 ? {} : { readiness: readiness(value.readiness, path3) },
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : ""
  };
  return profile;
}
function readiness(value, path3) {
  if (!isRecord(value) || typeof value.enabled !== "boolean") throw new Error(`Invalid readiness configuration at ${path3}`);
  return value;
}
function profileEnv(value, path3) {
  if (!isRecord(value)) throw new Error(`Profile env must be an object at ${path3}`);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    if (!ENV_KEY.test(key) || typeof entry !== "string") throw new Error(`Invalid profile env entry '${key}' at ${path3}`);
    return [key, entry];
  }));
}
function stringArray(value, field, path3) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) throw new Error(`Profile ${field} must be a string array at ${path3}`);
  return value;
}
function assertProfileId(value, label) {
  if (!PROFILE_ID.test(value)) throw new Error(`Invalid ${label}: ${value}`);
}
function requiredString(value, field, path3) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Profile ${field} is required at ${path3}`);
  return value;
}
function optionalString(value, field, path3) {
  if (value === void 0) return void 0;
  if (typeof value !== "string") throw new Error(`Profile ${field} must be a string at ${path3}`);
  return value || void 0;
}
function readJson(path3, label) {
  try {
    return JSON.parse((0, import_node_fs2.readFileSync)(path3, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${label} at ${path3}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// lib/runs/session-log-resolver-cli.ts
var COMMANDS = ["encode-cwd-slug", "log-dir", "session-log", "conversation-files"];
function runSessionLogResolverCli(argv, write = (line) => console.log(line)) {
  const { command, values } = parseCli(argv);
  switch (command) {
    case "encode-cwd-slug": {
      const slug = encodeCwdSlug(required(values, "--cli"), required(values, "--cwd"));
      if (slug) write(slug);
      return 0;
    }
    case "log-dir": {
      const profileOrCli = required(values, "--profile-or-cli");
      const cwd = required(values, "--cwd");
      if (!isRegularFile2(profileOrCli)) return 0;
      const config2 = profileTranscriptConfig(profileOrCli);
      const logDir = resolveProfileLogDir({ cli: config2.cli, log_path: config2.logPath }, cwd);
      if (logDir) write(logDir);
      return 0;
    }
    case "session-log": {
      const result = resolveSessionLog(required(values, "--log-dir"), required(values, "--session"), required(values, "--pty-binary"));
      if (result) write(result);
      return 0;
    }
    case "conversation-files": {
      const startedAt = Number(required(values, "--started-at"));
      for (const result of findConversationFiles(required(values, "--log-dir"), startedAt, values.get("--cli") ?? "claude")) write(result);
      return 0;
    }
  }
}
function parseCli(argv) {
  const command = argv[0];
  if (!command || !COMMANDS.includes(command)) throw new Error(usage());
  const allowed = allowedFlags(command);
  const values = /* @__PURE__ */ new Map();
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || !value || !flag.startsWith("--") || values.has(flag)) throw new Error(usage());
    if (!allowed.has(flag)) throw new Error(`${flag} is not valid for ${command}`);
    values.set(flag, value);
  }
  return { command, values };
}
function allowedFlags(command) {
  switch (command) {
    case "encode-cwd-slug":
      return /* @__PURE__ */ new Set(["--cli", "--cwd"]);
    case "log-dir":
      return /* @__PURE__ */ new Set(["--profile-or-cli", "--cwd"]);
    case "session-log":
      return /* @__PURE__ */ new Set(["--log-dir", "--session", "--pty-binary"]);
    case "conversation-files":
      return /* @__PURE__ */ new Set(["--log-dir", "--started-at", "--cli"]);
  }
}
function required(values, flag) {
  const value = values.get(flag);
  if (!value) throw new Error(`${flag} is required`);
  return value;
}
function usage() {
  return "usage: runner-session-log-resolver <encode-cwd-slug|log-dir|session-log|conversation-files> [flags]";
}
function isRegularFile2(candidate) {
  try {
    return (0, import_node_fs3.existsSync)(candidate) && (0, import_node_fs3.lstatSync)(candidate).isFile();
  } catch {
    return false;
  }
}
if (require.main === module) {
  try {
    process.exitCode = runSessionLogResolverCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runSessionLogResolverCli
});
