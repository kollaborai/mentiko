"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { unwrapApiData } from "@/lib/api-client";
import {
  LinkFilled as Workflow,
  SmsFilled as Mail,
  CloseCircleFilled as X,
  Setting2Filled as Settings,
  DangerFilled as AlertTriangle,
  Webhook as WebhookIcon,
  SearchNormalFilled as Search,
  AddFilled as Plus,
  GlobalFilled as SlackIcon,
  CodeFilled as GithubIcon,
  RotateFilled as Loader2
} from "@aliimam/icons";

interface PluginConfigField {
  key: string;
  label: string;
  type: "string" | "secret" | "boolean" | "select";
  required?: boolean;
  options?: string[];
  default?: string | boolean;
  description?: string;
}

interface PluginManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  category: string;
  configSchema: PluginConfigField[];
}

interface Plugin {
  id: string;
  manifest: PluginManifest;
  config: Record<string, string | boolean>;
  enabled: boolean;
  enabledAt?: string;
  pluginDir: string;
}

const PLUGIN_ICONS: Record<string, React.ReactNode> = {
  "slack": <SlackIcon className="h-5 w-5" />,
  "notify-slack": <SlackIcon className="h-5 w-5" />,
  "github": <GithubIcon className="h-5 w-5" />,
  "github-pr": <GithubIcon className="h-5 w-5" />,
  "linear": <Workflow className="h-5 w-5" />,
  "pagerduty": <AlertTriangle className="h-5 w-5" />,
  "custom-webhook": <WebhookIcon className="h-5 w-5" />,
  "notify-email": <Mail className="h-5 w-5" />,
  "email-digest": <Mail className="h-5 w-5" />,
};

export default function PluginsPage() {
  const [tab, setTab] = useState<"installed" | "available">("available");
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installDialog, setInstallDialog] = useState<{
    plugin: Plugin | null;
    open: boolean;
    config: Record<string, string>;
  }>({ plugin: null, open: false, config: {} });
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const categories = useMemo(() => {
    const cats = new Set(plugins.map((p) => p.manifest.category).filter(Boolean));
    return ["all", ...Array.from(cats).sort()];
  }, [plugins]);

  const filterPlugins = (list: Plugin[]) => {
    return list.filter((p) => {
      const matchesSearch =
        !search ||
        p.manifest.name.toLowerCase().includes(search.toLowerCase()) ||
        p.manifest.description.toLowerCase().includes(search.toLowerCase());
      const matchesCategory =
        categoryFilter === "all" || p.manifest.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  };

  const installedPlugins = plugins.filter((p) => p.enabled);
  const availablePlugins = plugins.filter((p) => !p.enabled);
  const filteredInstalled = filterPlugins(installedPlugins);
  const filteredAvailable = filterPlugins(availablePlugins);

  // fetch plugins from API
  const fetchPlugins = async () => {
    try {
      const res = await fetch("/api/plugins");
      if (!res.ok) throw new Error("Failed to fetch plugins");
      const data = unwrapApiData<{ plugins?: Plugin[] }>(await res.json());
      setPlugins(data.plugins || []);
    } catch {
      console.error("Failed to load plugins");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlugins();
  }, []);

  const openInstallDialog = (plugin: Plugin) => {
    // initialize config with defaults
    const defaultConfig: Record<string, string> = {};
    plugin.manifest.configSchema.forEach((field) => {
      if (field.default !== undefined) {
        defaultConfig[field.key] = String(field.default);
      }
    });
    setInstallDialog({ plugin, open: true, config: defaultConfig });
  };

  const closeInstallDialog = () => {
    setInstallDialog({ plugin: null, open: false, config: {} });
  };

  const installPlugin = async () => {
    const { plugin, config } = installDialog;
    if (!plugin) return;

    setInstalling(plugin.id);
    try {
      const res = await fetch(`/api/plugins/${plugin.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      if (!res.ok) throw new Error("Failed to install plugin");
      closeInstallDialog();
      await fetchPlugins();
    } catch {
      console.error("Failed to install plugin");
    } finally {
      setInstalling(null);
    }
  };

  const removePlugin = async (id: string) => {
    try {
      const res = await fetch(`/api/plugins/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to remove plugin");
      await fetchPlugins();
    } catch {
      console.error("Failed to remove plugin");
    }
  };

  const openConfig = (id: string) => {
    const plugin = plugins.find((p) => p.id === id);
    const existing: Record<string, string> = {};
    if (plugin) {
      Object.entries(plugin.config).forEach(([k, v]) => {
        existing[k] = String(v);
      });
    }
    setConfigValues(existing);
    setConfiguring(id);
  };

  const saveConfig = async () => {
    if (!configuring) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/plugins/${configuring}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: configValues }),
      });
      if (!res.ok) throw new Error("Failed to save config");
      setConfiguring(null);
      await fetchPlugins();
    } catch {
      console.error("Failed to save plugin config");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 shrink-0">
        <div>
          <h1>Plugins</h1>
          <p className="text-xs text-muted-foreground">
            Extend mentiko with integrations and custom actions
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 shrink-0">
        <div className="flex items-center gap-1 bg-muted rounded-md p-0.5 w-fit">
          <button
            onClick={() => setTab("available")}
            className={`text-xs px-3 py-1 rounded-md transition-colors ${
              tab === "available"
                ? "bg-card text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Available
            {!loading && (
              <Badge variant="ghost" className="ml-1.5 text-[9px] h-4 px-1">
                {availablePlugins.length}
              </Badge>
            )}
          </button>
          <button
            onClick={() => setTab("installed")}
            className={`text-xs px-3 py-1 rounded-md transition-colors ${
              tab === "installed"
                ? "bg-card text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Installed
            {!loading && (
              <Badge variant="ghost" className="ml-1.5 text-[9px] h-4 px-1">
                {installedPlugins.length}
              </Badge>
            )}
          </button>
        </div>
      </div>

      {/* Search + category filter */}
      <div className="px-4 pt-3 pb-1 shrink-0 space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search plugins..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-muted rounded-md focus:outline-none focus:bg-accent"
          />
        </div>
        {categories.length > 1 && (
          <div className="flex items-center gap-1 flex-wrap">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`text-[10px] px-2 py-0.5 rounded-full transition-colors capitalize ${
                  categoryFilter === cat
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Plugin grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : tab === "available" ? (
          filteredAvailable.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-xs text-muted-foreground/60">
                {search || categoryFilter !== "all" ? "No plugins match your filters" : "All plugins installed"}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredAvailable.map((plugin) => (
                <div key={plugin.id} className="bg-card rounded-md p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="p-2 bg-muted rounded-md text-foreground/70">
                        {PLUGIN_ICONS[plugin.id] || <WebhookIcon className="h-5 w-5" />}
                      </div>
                      <div>
                        <h3 className="text-sm font-medium">{plugin.manifest.name}</h3>
                        <Badge variant="ghost" className="text-[9px] h-4 px-1 mt-0.5">
                          {plugin.manifest.category}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground/80 mb-3">
                    {plugin.manifest.description}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => openInstallDialog(plugin)}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Install
                  </Button>
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {installedPlugins.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-xs text-muted-foreground/60">No plugins installed</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => setTab("available")}
                >
                  Browse Available
                </Button>
              </div>
            ) : filteredInstalled.length === 0 ? (
              <div className="text-center py-12 col-span-3">
                <p className="text-xs text-muted-foreground/60">No installed plugins match your filters</p>
              </div>
            ) : (
              filteredInstalled.map((plugin) => (
                <div key={plugin.id} className="bg-card rounded-md p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="p-2 bg-muted rounded-md text-green-400">
                        {PLUGIN_ICONS[plugin.id] || <WebhookIcon className="h-5 w-5" />}
                      </div>
                      <div>
                        <h3 className="text-sm font-medium">{plugin.manifest.name}</h3>
                        <div className="flex items-center gap-1 mt-0.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                          <span className="text-[10px] text-green-400">Enabled</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground/80 mb-3">
                    {plugin.manifest.description}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => openConfig(plugin.id)}
                    >
                      <Settings className="h-3 w-3 mr-1" />
                      Configure
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-400 hover:text-red-400 hover:bg-red-400/10"
                      onClick={() => removePlugin(plugin.id)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Install dialog */}
      {installDialog.open && installDialog.plugin && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={closeInstallDialog}
        >
          <div
            className="bg-card rounded-md p-5 w-full max-w-md mx-4 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <div className="p-2 bg-muted rounded-md text-foreground/70">
                {PLUGIN_ICONS[installDialog.plugin.id] || <WebhookIcon className="h-5 w-5" />}
              </div>
              <h2 className="text-sm font-medium">
                Install {installDialog.plugin.manifest.name}
              </h2>
            </div>

            <p className="text-xs text-foreground/60">
              {installDialog.plugin.manifest.description}
            </p>

            <div className="space-y-3">
              {installDialog.plugin.manifest.configSchema.map((field) => (
                <div key={field.key} className="space-y-1">
                  <label className="text-xs text-foreground/70 flex items-center gap-1">
                    {field.label}
                    {field.required && <span className="text-red-400">*</span>}
                  </label>
                  {field.type === "select" ? (
                    <select
                      className="w-full bg-muted rounded px-3 py-1.5 text-sm focus:outline-none focus:bg-accent"
                      value={installDialog.config[field.key] || String(field.default || "")}
                      onChange={(e) =>
                        setInstallDialog({
                          ...installDialog,
                          config: { ...installDialog.config, [field.key]: e.target.value },
                        })
                      }
                    >
                      {field.options?.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.type === "secret" ? "password" : "text"}
                      placeholder={field.description || field.label}
                      className="w-full bg-muted rounded px-3 py-1.5 text-sm focus:outline-none focus:bg-accent"
                      value={installDialog.config[field.key] || ""}
                      onChange={(e) =>
                        setInstallDialog({
                          ...installDialog,
                          config: { ...installDialog.config, [field.key]: e.target.value },
                        })
                      }
                    />
                  )}
                  {field.description && (
                    <p className="text-[10px] text-foreground/50">{field.description}</p>
                  )}
                </div>
              ))}
            </div>

            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={closeInstallDialog}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={installPlugin}
                disabled={installing !== null}
              >
                {installing === installDialog.plugin?.id ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Plus className="h-3 w-3 mr-1" />
                )}
                Install
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Config modal */}
      {configuring && (() => {
        const configPlugin = plugins.find((p) => p.id === configuring);
        if (!configPlugin) return null;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={() => setConfiguring(null)}
          >
            <div
              className="bg-card rounded-md p-5 w-full max-w-md mx-4 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2">
                <div className="p-2 bg-muted rounded-md text-foreground/70">
                  {PLUGIN_ICONS[configuring] || <WebhookIcon className="h-5 w-5" />}
                </div>
                <h2 className="text-sm font-medium">
                  Configure {configPlugin.manifest.name}
                </h2>
              </div>

              <div className="space-y-3">
                {configPlugin.manifest.configSchema.map((field) => (
                  <div key={field.key} className="space-y-1">
                    <label className="text-xs text-foreground/70 flex items-center gap-1">
                      {field.label}
                      {field.required && <span className="text-red-400">*</span>}
                    </label>
                    {field.type === "select" ? (
                      <select
                        className="w-full bg-muted rounded px-3 py-1.5 text-sm focus:outline-none focus:bg-accent"
                        value={configValues[field.key] || String(field.default || "")}
                        onChange={(e) =>
                          setConfigValues({ ...configValues, [field.key]: e.target.value })
                        }
                      >
                        {field.options?.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={field.type === "secret" ? "password" : "text"}
                        placeholder={field.description || field.label}
                        className="w-full bg-muted rounded px-3 py-1.5 text-sm focus:outline-none focus:bg-accent"
                        value={configValues[field.key] || ""}
                        onChange={(e) =>
                          setConfigValues({ ...configValues, [field.key]: e.target.value })
                        }
                      />
                    )}
                    {field.description && (
                      <p className="text-[10px] text-foreground/50">{field.description}</p>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="outline" onClick={() => setConfiguring(null)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={saveConfig} disabled={saving}>
                  {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                  Save
                </Button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
