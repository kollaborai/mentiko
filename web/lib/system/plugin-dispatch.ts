import { existsSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import config from "@/lib/config";
import { spawn } from "node:child_process";
import { getPlugins } from "@/lib/system/plugin-registry";
import type { PluginRegistration } from "@/lib/system/plugin-types";

export interface PluginDispatchInput {
  namespaceId: string;
  orgId: string;
  event: string;
  chainId?: string;
  runId?: string;
  agentId?: string;
  data?: Record<string, unknown>;
}

export interface PluginDispatchResult {
  launched: string[];
  skipped: Array<{ pluginId: string; reason: string }>;
}

function matchingPlugin(plugin: PluginRegistration, event: string): boolean {
  return plugin.enabled && plugin.manifest.events.some((candidate) => candidate === event || candidate === "*");
}

function pluginScriptPath(plugin: PluginRegistration): string {
  const script = plugin.manifest.onEventScript;
  if (!script) throw new Error(`Plugin ${plugin.id} does not declare manifest.onEventScript`);
  const pluginDir = resolve(plugin.pluginDir);
  const path = resolve(pluginDir, script);
  const pathWithinPlugin = relative(pluginDir, path);
  if (pathWithinPlugin === "" || pathWithinPlugin.startsWith("..") || pathWithinPlugin.includes("../")) {
    throw new Error(`Plugin ${plugin.id} onEventScript escapes its plugin directory`);
  }
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Plugin ${plugin.id} event script is missing: ${path}`);
  return path;
}

function pluginEnvironment(plugin: PluginRegistration, input: PluginDispatchInput): NodeJS.ProcessEnv {
  const configEnv: Record<string, string> = {};
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
    PLUGIN_EVENT_JSON: JSON.stringify({ type: input.event, chainId: input.chainId ?? "", runId: input.runId ?? "", agentId: input.agentId ?? "", timestamp: new Date().toISOString() }),
    PLUGIN_DATA_JSON: JSON.stringify(input.data ?? {}),
    NAMESPACE_ID: input.namespaceId,
    ORG_ID: input.orgId,
  };
}

/**
 * Parse the registry through the typed owner, then launch each declared plugin
 * hook as its own external CLI process. The hook script is product behavior;
 * this function never lets shell parse registry state or choose paths.
 */
export function dispatchPlugins(input: PluginDispatchInput): PluginDispatchResult {
  if (!input.namespaceId || !input.orgId || !input.event) throw new Error("namespaceId, orgId, and event are required for plugin dispatch");
  const result: PluginDispatchResult = { launched: [], skipped: [] };
  for (const plugin of getPlugins(input.namespaceId, input.orgId)) {
    if (!matchingPlugin(plugin, input.event)) continue;
    const child = plugin.manifest.builtin && plugin.manifest.nativeHandler
      ? spawn(process.execPath, [join(config.codeRoot, "lib", "runner-native-plugin.js"), "dispatch", "--handler", plugin.manifest.nativeHandler], { detached: true, stdio: "ignore", env: pluginEnvironment(plugin, input) })
      : spawn("bash", [pluginScriptPath(plugin)], { detached: true, stdio: "ignore", env: pluginEnvironment(plugin, input) });
    child.unref();
    result.launched.push(plugin.id);
  }
  return result;
}
