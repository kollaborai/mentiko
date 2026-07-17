"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// lib/runner-v2/kollabor-mcp-settings-cli.ts
var kollabor_mcp_settings_cli_exports = {};
__export(kollabor_mcp_settings_cli_exports, {
  runKollaborMcpSettingsCli: () => runKollaborMcpSettingsCli
});
module.exports = __toCommonJS(kollabor_mcp_settings_cli_exports);

// lib/kollabor-mcp-settings.ts
var import_node_fs = require("node:fs");
var import_node_os = require("node:os");
var import_node_path = require("node:path");

// lib/kollabor-mcp-server-env.ts
function getKollabMentikoMcpServerEnv() {
  const port = process.env.WEB_PORT || process.env.PORT || "3000";
  const webUrl = process.env.MENTIKO_WEB_URL && process.env.MENTIKO_WEB_URL.trim() || `http://127.0.0.1:${port}`;
  const env = {
    MENTIKO_MCP_TOOL_SCOPE: (process.env.MENTIKO_MCP_TOOL_SCOPE || "bar").trim(),
    MENTIKO_WEB_URL: webUrl,
    KOLLABOR_ENGINE_URL: process.env.KOLLABOR_ENGINE_URL && process.env.KOLLABOR_ENGINE_URL.trim() || "http://127.0.0.1:7433"
  };
  const inbox = process.env.MENTIKO_INBOX_KEY?.trim();
  if (inbox) {
    env.MENTIKO_INBOX_KEY = inbox;
  }
  const ns = process.env.MENTIKO_NAMESPACE_ID?.trim() || process.env.NAMESPACE_ID?.trim();
  if (ns) {
    env.MENTIKO_NAMESPACE_ID = ns;
  }
  const org = process.env.MENTIKO_ORG_ID?.trim() || process.env.ORG_ID?.trim();
  if (org) {
    env.MENTIKO_ORG_ID = org;
  }
  return env;
}

// lib/kollabor-mcp-settings.ts
function serverMap(value, key) {
  if (value === void 0) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${key} must be an object`);
  }
  return value;
}
function readSettings(path) {
  if (!(0, import_node_fs.existsSync)(path)) return { existed: false, settings: {}, raw: null };
  const raw = (0, import_node_fs.readFileSync)(path, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid MCP settings JSON at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`invalid MCP settings JSON at ${path}: expected a JSON object`);
  }
  return { existed: true, settings: parsed, raw };
}
function registerKollabMentikoMcpServer(input) {
  if (!input.command.trim()) throw new Error("MCP command is required");
  const path = (0, import_node_path.join)(input.homeDir ?? (0, import_node_os.homedir)(), ".kollab", "mcp", "mcp_settings.json");
  (0, import_node_fs.mkdirSync)((0, import_node_path.dirname)(path), { recursive: true });
  const { existed, settings, raw } = readSettings(path);
  const servers = {
    ...serverMap(settings.mcpServers, "mcpServers"),
    ...serverMap(settings.servers, "servers"),
    mentiko: {
      type: "stdio",
      command: input.command,
      args: [],
      env: getKollabMentikoMcpServerEnv(),
      enabled: true
    }
  };
  const next = { ...settings, servers };
  delete next.mcpServers;
  const nextRaw = `${JSON.stringify(next, null, 2)}
`;
  const updated = raw !== nextRaw;
  if (updated) {
    const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
    (0, import_node_fs.writeFileSync)(temporary, nextRaw, "utf8");
    (0, import_node_fs.renameSync)(temporary, path);
  }
  return {
    path,
    created: !existed,
    updated,
    preservedServerCount: Object.keys(servers).filter((name) => name !== "mentiko").length
  };
}

// lib/runner-v2/kollabor-mcp-settings-cli.ts
function usage() {
  return "usage: kollabor-mcp-settings-cli register --command <mentiko-mcp-path> [--home <path>]";
}
function runKollaborMcpSettingsCli(argv) {
  if (argv[0] !== "register") throw new Error(usage());
  let command = "";
  let homeDir;
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--command") command = argv[++index] ?? "";
    else if (argument === "--home") homeDir = argv[++index] ?? "";
    else throw new Error(`${usage()}: unknown argument ${argument}`);
  }
  return `${JSON.stringify(registerKollabMentikoMcpServer({ command, homeDir }))}
`;
}
if (require.main === module) {
  try {
    process.stdout.write(runKollaborMcpSettingsCli(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}
`);
    process.exitCode = 1;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runKollaborMcpSettingsCli
});
