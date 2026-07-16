#!/usr/bin/env node
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

// lib/runner-v2/runtime-paths-cli.ts
var runtime_paths_cli_exports = {};
__export(runtime_paths_cli_exports, {
  runRuntimePathsCli: () => main
});
module.exports = __toCommonJS(runtime_paths_cli_exports);

// lib/runner-v2/runtime-paths.ts
var import_node_fs = require("node:fs");
var import_node_os = require("node:os");
var import_node_path = require("node:path");
function value(env, key, fallback) {
  return env[key] || fallback;
}
function child(root, ...segments) {
  return `${root}/${segments.join("/")}`;
}
function slugPart(input) {
  const slug = input.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return slug || "root";
}
function deriveRuntimePtyDaemon(root, namespaceId, orgId) {
  return ["mentiko", slugPart(root), slugPart(namespaceId || "default"), slugPart(orgId || "default")].join("-");
}
function resolveRuntimePaths(env = process.env, options = { codeRoot: process.cwd() }) {
  const codeRoot = value(env, "MENTIKO_CODE_ROOT", options.codeRoot);
  const root = value(env, "MENTIKO_ROOT", codeRoot);
  const globalRoot = value(env, "MENTIKO_GLOBAL_ROOT", (0, import_node_path.join)(options.home || env.HOME || (0, import_node_os.homedir)(), ".mentiko"));
  const namespaceId = value(env, "NAMESPACE_ID", "default");
  const orgId = value(env, "ORG_ID", "default");
  const projectDir = value(env, "MENTIKO_PROJECT_DIR", codeRoot);
  const projectId = value(env, "MENTIKO_PROJECT_ID", projectDir.replace(/\//g, "-"));
  const namespaceRoot = value(env, "MENTIKO_NAMESPACE_ROOT", child(globalRoot, "namespaces", namespaceId));
  const orgRoot = value(env, "MENTIKO_ORG_ROOT", orgId === "default" ? namespaceRoot : child(namespaceRoot, "orgs", orgId));
  const projectRoot = value(env, "MENTIKO_PROJECT_ROOT", projectDir === codeRoot ? orgRoot : child(orgRoot, "projects", projectId));
  const values = {
    MENTIKO_CODE_ROOT: codeRoot,
    MENTIKO_ROOT: root,
    MENTIKO_GLOBAL_ROOT: globalRoot,
    NAMESPACE_ID: namespaceId,
    ORG_ID: orgId,
    MENTIKO_PROJECT_DIR: projectDir,
    MENTIKO_PROJECT_ID: projectId,
    MENTIKO_NAMESPACE_ROOT: namespaceRoot,
    MENTIKO_ORG_ROOT: orgRoot,
    MENTIKO_PROJECT_ROOT: projectRoot,
    NAMESPACE_ROOT: namespaceRoot,
    NAMESPACES_BASE: value(env, "NAMESPACES_BASE", child(globalRoot, "namespaces")),
    PTY_DAEMON: value(env, "PTY_DAEMON", deriveRuntimePtyDaemon(globalRoot, namespaceId, orgId)),
    BILLING_DIR: value(env, "BILLING_DIR", child(namespaceRoot, "billing")),
    MARKETPLACE_DIR: value(env, "MARKETPLACE_DIR", child(namespaceRoot, "marketplace")),
    CHAIN_DIR: value(env, "CHAIN_DIR", child(orgRoot, "chains")),
    LINKS_DIR: value(env, "LINKS_DIR", child(orgRoot, "links")),
    AGENTS_DIR: value(env, "AGENTS_DIR", child(orgRoot, "agents")),
    AGENT_PROFILES_DIR: value(env, "AGENT_PROFILES_DIR", child(orgRoot, "agent-profiles")),
    CONFIG_PROFILES_DIR: value(env, "CONFIG_PROFILES_DIR", child(orgRoot, "config-profiles")),
    TEMPLATES_DIR: value(env, "TEMPLATES_DIR", child(orgRoot, "templates")),
    WEBHOOKS_DIR: value(env, "WEBHOOKS_DIR", child(orgRoot, "webhooks")),
    EMAILS_DIR: value(env, "EMAILS_DIR", child(orgRoot, "emails")),
    RUNS_DIR: value(env, "RUNS_DIR", child(projectRoot, "runs")),
    JOBS_DIR: value(env, "JOBS_DIR", child(projectRoot, "jobs")),
    EVENTS_DIR: value(env, "EVENTS_DIR", child(projectRoot, "events")),
    STATE_DIR: value(env, "STATE_DIR", child(projectRoot, "state")),
    DECISIONS_DIR: value(env, "DECISIONS_DIR", child(projectRoot, "decisions")),
    SCHEDULES_DIR: value(env, "SCHEDULES_DIR", child(projectRoot, "schedules")),
    METRICS_DIR: value(env, "METRICS_DIR", child(projectRoot, "metrics")),
    REPORTS_DIR: value(env, "REPORTS_DIR", child(projectRoot, "reports")),
    DEBUG_DIR: value(env, "DEBUG_DIR", child(projectRoot, "debug")),
    WORKSPACE_DIR: value(env, "WORKSPACE_DIR", child(projectRoot, "workspace")),
    RUNSPACE_DIR: value(env, "RUNSPACE_DIR", child(projectRoot, "runspace")),
    WATCHDOG_HOOKS_DIR: value(env, "WATCHDOG_HOOKS_DIR", child(projectRoot, "watchdog-hooks")),
    AGENTS_RUNTIME_DIR: value(env, "AGENTS_RUNTIME_DIR", child(projectRoot, "agents-runtime")),
    RUNTIME_DIR: value(env, "RUNTIME_DIR", child(projectRoot, "runtime")),
    BIN_DIR: value(env, "BIN_DIR", child(codeRoot, "bin")),
    LIB_DIR: value(env, "LIB_DIR", child(codeRoot, "lib")),
    DEFAULT_CLI: value(env, "DEFAULT_CLI", "claude"),
    DEFAULT_SESSION_PREFIX: value(env, "DEFAULT_SESSION_PREFIX", "mentiko"),
    DEFAULT_PROJECT_ROOT: value(env, "DEFAULT_PROJECT_ROOT", "auto"),
    WEB_PORT: value(env, "WEB_PORT", value(env, "PORT", "3000")),
    MAX_CONCURRENT_AGENTS: value(env, "MAX_CONCURRENT_AGENTS", "10"),
    DEFAULT_MAX_ROUNDS: value(env, "DEFAULT_MAX_ROUNDS", "50"),
    MENTIKO_MAX_CONCURRENT_CHAINS: value(env, "MENTIKO_MAX_CONCURRENT_CHAINS", "4"),
    MENTIKO_MAX_ACTIVE_AGENTS: value(env, "MENTIKO_MAX_ACTIVE_AGENTS", "3"),
    MENTIKO_CAP_MAX_WAIT_SECS: value(env, "MENTIKO_CAP_MAX_WAIT_SECS", "300")
  };
  return {
    values: { ...values, CHAINS_DIR: values.CHAIN_DIR },
    directoriesToCreate: [
      values.BILLING_DIR,
      values.MARKETPLACE_DIR,
      values.CHAIN_DIR,
      values.LINKS_DIR,
      values.AGENTS_DIR,
      values.AGENT_PROFILES_DIR,
      values.CONFIG_PROFILES_DIR,
      values.TEMPLATES_DIR,
      values.WEBHOOKS_DIR,
      values.EMAILS_DIR,
      values.RUNS_DIR,
      values.JOBS_DIR,
      values.EVENTS_DIR,
      values.STATE_DIR,
      values.DECISIONS_DIR,
      values.SCHEDULES_DIR,
      values.METRICS_DIR,
      values.REPORTS_DIR,
      values.DEBUG_DIR
    ]
  };
}
function ensureRuntimePathDirectories(paths) {
  for (const directory of paths.directoriesToCreate) {
    try {
      (0, import_node_fs.mkdirSync)(directory, { recursive: true });
    } catch {
    }
  }
}
function shellQuote(value2) {
  return `'${value2.replace(/'/g, "'\\''")}'`;
}
function formatRuntimePathExports(paths) {
  return Object.entries(paths.values).map(([key, value2]) => `export ${key}=${shellQuote(value2)}`).join("\n");
}

// lib/runner-v2/runtime-paths-cli.ts
function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.length !== 1 || argv[0] !== "shell-exports") {
    throw new Error("usage: runner-runtime-paths shell-exports");
  }
  const codeRoot = env.MENTIKO_CODE_ROOT;
  if (!codeRoot) throw new Error("MENTIKO_CODE_ROOT must be configured");
  const paths = resolveRuntimePaths(env, { codeRoot });
  ensureRuntimePathDirectories(paths);
  process.stdout.write(`${formatRuntimePathExports(paths)}
`);
}
try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runRuntimePathsCli
});
