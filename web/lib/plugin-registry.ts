/**
 * Plugin registry — loads, registers, enables, and disables plugins.
 *
 * Plugin discovery order:
 *   1. Built-in plugins: lib/plugins/{id}/plugin.json
 *   2. Marketplace plugins: {globalRoot}/marketplace/plugins/{id}/plugin.json
 *   3. Namespace plugins: namespaces/{ns}/plugins/{id}/plugin.json
 *
 * Plugin state (enabled/disabled + config) is stored per namespace in:
 *   namespaces/{ns}/plugins/registry.json
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { config as globalConfig, orgPath } from "@/lib/config";
import type { PluginManifest, PluginRegistration, PluginState } from "@/lib/plugin-types";
import { encrypt, decrypt } from "@/lib/secrets-store";

const ENC_PREFIX = "enc:";

function encryptConfig(
  config: Record<string, string | boolean>,
  schema: PluginManifest["configSchema"]
): Record<string, string | boolean> {
  const result = { ...config };
  for (const field of schema) {
    if (field.type === "secret" && typeof result[field.key] === "string") {
      const val = result[field.key] as string;
      if (val && !val.startsWith(ENC_PREFIX)) {
        result[field.key] = ENC_PREFIX + encrypt(val);
      }
    }
  }
  return result;
}

function decryptConfig(
  config: Record<string, string | boolean>,
  schema: PluginManifest["configSchema"]
): Record<string, string | boolean> {
  const result = { ...config };
  for (const field of schema) {
    if (field.type === "secret" && typeof result[field.key] === "string") {
      const val = result[field.key] as string;
      if (val.startsWith(ENC_PREFIX)) {
        try {
          const decrypted = decrypt(val.slice(ENC_PREFIX.length));
          if (decrypted !== null) result[field.key] = decrypted;
        } catch {
          // leave as-is if decryption fails (bad key / corrupted)
        }
      }
    }
  }
  return result;
}

/** mask secret fields for API responses — never send plaintext secrets to the client */
export function maskConfig(
  config: Record<string, string | boolean>,
  schema: PluginManifest["configSchema"]
): Record<string, string | boolean> {
  const result = { ...config };
  for (const field of schema) {
    if (field.type === "secret" && result[field.key]) {
      result[field.key] = "••••••••";
    }
  }
  return result;
}

const BUILTIN_PLUGINS_DIR = join(globalConfig.root, "lib", "plugins");
const MARKETPLACE_PLUGINS_DIR = join(globalConfig.globalRoot, "marketplace", "plugins");
const REGISTRY_FILENAME = "registry.json";

function getNamespacePluginsDir(namespaceId: string, orgId: string): string {
  return orgPath(namespaceId, orgId, "plugins");
}

function getRegistryPath(namespaceId: string, orgId: string): string {
  return join(getNamespacePluginsDir(namespaceId, orgId), REGISTRY_FILENAME);
}

function loadManifest(pluginDir: string): PluginManifest | null {
  const manifestPath = join(pluginDir, "plugin.json");
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, "utf-8")) as PluginManifest;
  } catch {
    return null;
  }
}

function loadRegistry(namespaceId: string, orgId: string): PluginState {
  const registryPath = getRegistryPath(namespaceId, orgId);
  if (!existsSync(registryPath)) {
    return {
      namespaceId,
      plugins: [],
      updatedAt: new Date().toISOString(),
    };
  }
  try {
    return JSON.parse(readFileSync(registryPath, "utf-8")) as PluginState;
  } catch {
    return { namespaceId, plugins: [], updatedAt: new Date().toISOString() };
  }
}

function saveRegistry(namespaceId: string, orgId: string, state: PluginState): void {
  const dir = getNamespacePluginsDir(namespaceId, orgId);
  mkdirSync(dir, { recursive: true });
  const registryPath = getRegistryPath(namespaceId, orgId);
  state.updatedAt = new Date().toISOString();
  // encrypt secret fields before persisting
  const stateToPersist: PluginState = {
    ...state,
    plugins: state.plugins.map((p) => ({
      ...p,
      config: encryptConfig(p.config, p.manifest?.configSchema ?? []),
    })),
  };
  writeFileSync(registryPath, JSON.stringify(stateToPersist, null, 2), "utf-8");
}

/**
 * discoverPlugins: find all available plugins (built-in + marketplace + namespace-local).
 * Returns manifests without registry state.
 */
export function discoverPlugins(namespaceId: string, orgId: string): Array<{ manifest: PluginManifest; pluginDir: string; builtin: boolean }> {
  const discovered: Array<{ manifest: PluginManifest; pluginDir: string; builtin: boolean }> = [];

  // built-in plugins
  if (existsSync(BUILTIN_PLUGINS_DIR)) {
    for (const entry of readdirSync(BUILTIN_PLUGINS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pluginDir = join(BUILTIN_PLUGINS_DIR, entry.name);
      const manifest = loadManifest(pluginDir);
      if (manifest) {
        discovered.push({ manifest: { ...manifest, builtin: true }, pluginDir, builtin: true });
      }
    }
  }

  // marketplace plugins
  if (existsSync(MARKETPLACE_PLUGINS_DIR)) {
    for (const entry of readdirSync(MARKETPLACE_PLUGINS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pluginDir = join(MARKETPLACE_PLUGINS_DIR, entry.name);
      const manifest = loadManifest(pluginDir);
      if (manifest) {
        discovered.push({ manifest: { ...manifest, builtin: false }, pluginDir, builtin: false });
      }
    }
  }

  // namespace-local plugins
  const nsPluginsDir = getNamespacePluginsDir(namespaceId, orgId);
  if (existsSync(nsPluginsDir)) {
    for (const entry of readdirSync(nsPluginsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "registry.json") continue;
      const pluginDir = join(nsPluginsDir, entry.name);
      const manifest = loadManifest(pluginDir);
      if (manifest) {
        discovered.push({ manifest, pluginDir, builtin: false });
      }
    }
  }

  return discovered;
}

/**
 * getPlugins: return all plugins with their registration state.
 */
export function getPlugins(namespaceId: string, orgId: string): PluginRegistration[] {
  const discovered = discoverPlugins(namespaceId, orgId);
  const registry = loadRegistry(namespaceId, orgId);

  return discovered.map(({ manifest, pluginDir }) => {
    const existing = registry.plugins.find((p) => p.id === manifest.id);
    if (!existing) {
      return { id: manifest.id, manifest, config: {}, enabled: false, pluginDir };
    }
    return {
      ...existing,
      config: decryptConfig(existing.config, manifest.configSchema),
    };
  });
}

/**
 * getPlugin: get a single plugin registration.
 */
export function getPlugin(namespaceId: string, orgId: string, pluginId: string): PluginRegistration | null {
  return getPlugins(namespaceId, orgId).find((p) => p.id === pluginId) ?? null;
}

/**
 * enablePlugin: enable a plugin for the namespace.
 */
export function enablePlugin(
  namespaceId: string,
  orgId: string,
  pluginId: string,
  pluginConfig?: Record<string, string | boolean>
): PluginRegistration | null {
  const plugin = getPlugin(namespaceId, orgId, pluginId);
  if (!plugin) return null;

  const registry = loadRegistry(namespaceId, orgId);
  const idx = registry.plugins.findIndex((p) => p.id === pluginId);
  const updated: PluginRegistration = {
    ...plugin,
    config: pluginConfig ?? plugin.config,
    enabled: true,
    enabledAt: new Date().toISOString(),
    disabledAt: undefined,
  };

  if (idx >= 0) {
    registry.plugins[idx] = updated;
  } else {
    registry.plugins.push(updated);
  }

  saveRegistry(namespaceId, orgId, registry);
  return updated;
}

/**
 * disablePlugin: disable a plugin for the namespace.
 */
export function disablePlugin(namespaceId: string, orgId: string, pluginId: string): PluginRegistration | null {
  const plugin = getPlugin(namespaceId, orgId, pluginId);
  if (!plugin) return null;

  const registry = loadRegistry(namespaceId, orgId);
  const idx = registry.plugins.findIndex((p) => p.id === pluginId);
  const updated: PluginRegistration = {
    ...plugin,
    enabled: false,
    disabledAt: new Date().toISOString(),
  };

  if (idx >= 0) {
    registry.plugins[idx] = updated;
  } else {
    registry.plugins.push(updated);
  }

  saveRegistry(namespaceId, orgId, registry);
  return updated;
}

/**
 * configurePlugin: update plugin config without changing enabled state.
 */
export function configurePlugin(
  namespaceId: string,
  orgId: string,
  pluginId: string,
  pluginConfig: Record<string, string | boolean>
): PluginRegistration | null {
  const plugin = getPlugin(namespaceId, orgId, pluginId);
  if (!plugin) return null;

  const registry = loadRegistry(namespaceId, orgId);
  const idx = registry.plugins.findIndex((p) => p.id === pluginId);
  const updated: PluginRegistration = { ...plugin, config: pluginConfig };

  if (idx >= 0) {
    registry.plugins[idx] = updated;
  } else {
    registry.plugins.push(updated);
  }

  saveRegistry(namespaceId, orgId, registry);
  return updated;
}
