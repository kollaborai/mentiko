"use client";

import { useState, useEffect, useCallback } from "react";
import { PageBanner } from "@/components/ui/page-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AddFilled, TrashFilled, TickCircleFilled, CloseCircleFilled,
  RefreshFilled, MagicStarFilled, CloudConnectionFilled, Setting2Filled,
  ShieldTickFilled, FlashFilled,
} from "@aliimam/icons";
import { ClaudeAI, OpenAI as OpenAILogo, GoogleGemini } from "@aliimam/logos";
import { cn } from "@/lib/utils";
import type { SecretMeta } from "@/lib/secrets/secrets-store";
import {
  FONT_SCALE_DEFAULT,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  useKollaborBarStore,
} from "@/lib/ui/kollabor-bar-store";
import {
  ENGINE_PROVIDER_DEFAULTS,
  MENTIKO_GATEWAY_PROFILE,
  getEngineProviderDefault,
} from "@/lib/agents/agent-provider-catalog";

interface EngineProfile {
  name: string;
  provider: string;
  model: string;
  temperature: number;
  max_tokens: number | null;
  timeout: number;
  description: string;
  base_url?: string;
  streaming: boolean;
  supports_tools: boolean;
  is_active?: boolean;
}

interface ProfilesResponse {
  profiles: EngineProfile[];
  active: string;
  count: number;
}

const PROVIDERS = ENGINE_PROVIDER_DEFAULTS;
const DEFAULT_PROVIDER = getEngineProviderDefault("anthropic") ?? PROVIDERS[0];

function ProviderIcon({ provider, className }: { provider: string; className?: string }) {
  switch (provider.toLowerCase()) {
    case "anthropic": return <ClaudeAI className={className} />;
    case "openai":    return <OpenAILogo className={className} />;
    case "gemini":    return <GoogleGemini className={className} />;
    default:          return <CloudConnectionFilled className={className} />;
  }
}

const EMPTY_FORM = {
  name: "",
  provider: DEFAULT_PROVIDER.value,
  model: DEFAULT_PROVIDER.model,
  api_key_secret: "",   // secret name from vault
  base_url: DEFAULT_PROVIDER.baseUrl,
  description: "",
};

const FONT_SCALE_PRESETS = [
  { label: "Small", value: 0.9 },
  { label: "Default", value: FONT_SCALE_DEFAULT },
  { label: "Large", value: 1.2 },
];

const PROFILE_ACTION_BUTTON_CLASS = "h-7 w-20 px-0 text-xs justify-center";
const PROFILE_ICON_BUTTON_CLASS = "h-7 w-7 p-0 justify-center";

export default function MentikoAgentSettingsPage() {
  const [profiles, setProfiles]           = useState<EngineProfile[]>([]);
  const [activeProfile, setActiveProfile] = useState<string>("");
  const [secrets, setSecrets]             = useState<SecretMeta[]>([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState<string | null>(null);
  const [dialogOpen, setDialogOpen]       = useState(false);
  const [editing, setEditing]             = useState<EngineProfile | null>(null);
  const [form, setForm]                   = useState(EMPTY_FORM);
  const [saving, setSaving]               = useState(false);
  const [testingProfile, setTestingProfile]   = useState<string | null>(null);
  const [testResults, setTestResults]         = useState<Record<string, { success: boolean; message: string }>>({});
  const [activating, setActivating]       = useState<string | null>(null);
  const [deleting, setDeleting]           = useState<string | null>(null);
  const { fontScale, setFontScale }       = useKollaborBarStore();
  const { yoloMode, setYoloMode }         = useKollaborBarStore();

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/kollabor/engine/profiles", { credentials: "same-origin" });
      if (!res.ok) throw new Error(`Failed to load profiles: ${res.status}`);
      const data = (await res.json()) as ProfilesResponse;
      setProfiles(data.profiles ?? []);
      setActiveProfile(data.active ?? "");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSecrets = useCallback(async () => {
    try {
      const res = await fetch("/api/secrets", { credentials: "same-origin" });
      if (!res.ok) return;
      const data = (await res.json()) as { data?: { secrets?: SecretMeta[] } };
      setSecrets(data.data?.secrets ?? []);
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    void loadProfiles();
    void loadSecrets();
  }, [loadProfiles, loadSecrets]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(profile: EngineProfile) {
    setEditing(profile);
    setForm({
      name:           profile.name,
      provider:       profile.provider,
      model:          profile.model,
      api_key_secret: "",
      base_url:       profile.base_url ?? "",
      description:    profile.description ?? "",
    });
    setDialogOpen(true);
  }

  function onProviderChange(provider: string) {
    const def = PROVIDERS.find((p) => p.value === provider);
    setForm((f) => ({
      ...f,
      provider,
      model:    def?.model   ?? "",
      base_url: def?.baseUrl ?? f.base_url,
    }));
  }

  function handleFontScaleChange(value: number) {
    setFontScale(Math.round(value * 20) / 20);
  }

  async function handleSave() {
    if (!form.name.trim() || !form.provider) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name:        form.name.trim(),
        provider:    form.provider,
        model:       form.model.trim(),
        description: form.description.trim(),
        editing:     !!editing,
      };
      if (form.api_key_secret.trim()) body.api_key_secret = form.api_key_secret.trim();
      if (form.base_url.trim())       body.base_url       = form.base_url.trim();

      const res = await fetch("/api/kollabor/profiles/save", {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "same-origin",
        body:        JSON.stringify(body),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        throw new Error(err.error ?? err.detail ?? `Save failed: ${res.status}`);
      }

      setDialogOpen(false);
      await loadProfiles();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(name: string) {
    setDeleting(name);
    try {
      const res = await fetch(`/api/kollabor/engine/profiles/${encodeURIComponent(name)}`, {
        method: "DELETE", credentials: "same-origin",
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(err.detail ?? `Delete failed: ${res.status}`);
      }
      await loadProfiles();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(null);
    }
  }

  async function handleSetActive(name: string) {
    setActivating(name);
    try {
      const res = await fetch("/api/kollabor/profiles/active", {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "same-origin",
        body:        JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`Failed to set active profile: ${res.status}`);
      setActiveProfile(name);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActivating(null);
    }
  }

  async function handleTest(name: string) {
    setTestingProfile(name);
    setTestResults((r) => ({ ...r, [name]: { success: false, message: "Testing..." } }));
    try {
      const res = await fetch(`/api/kollabor/engine/profiles/${encodeURIComponent(name)}/test`, {
        method: "POST", credentials: "same-origin",
      });
      const data = (await res.json()) as { success: boolean; message?: string; error?: string };
      setTestResults((r) => ({
        ...r,
        [name]: {
          success: data.success,
          message: data.message ?? data.error ?? (data.success ? "Connection OK" : "Failed"),
        },
      }));
    } catch (e: unknown) {
      setTestResults((r) => ({
        ...r,
        [name]: { success: false, message: e instanceof Error ? e.message : "Test failed" },
      }));
    } finally {
      setTestingProfile(null);
    }
  }

  const needsBaseUrl = (provider: string) => ["custom", "openrouter"].includes(provider);
  const needsApiKey  = (provider: string) => !["auto"].includes(provider);

  return (
    <div className="flex-1 overflow-auto">
      <PageBanner
        title="Mentiko Agent"
        subtitle="Configure AI provider profiles for the Mentiko floating bar. API keys are pulled from your secrets vault — never stored in plaintext."
        icon={MagicStarFilled}
        sectionColor="#b07ee8"
        actions={[
          { label: "Secrets",      href: "/settings/secrets",      icon: ShieldTickFilled,     iconColor: "#a0927b" },
          { label: "Agent Configs", href: "/settings/agent-configs", icon: Setting2Filled,       iconColor: "#b07ee8" },
        ]}
      />

      <div className="px-6 pb-6 max-w-3xl">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-muted-foreground">
            Active profile:{" "}
            <span className="text-foreground font-medium">{activeProfile || "None"}</span>
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={loadProfiles} disabled={loading}>
              <RefreshFilled className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" onClick={openCreate}>
              <AddFilled className="h-3.5 w-3.5 mr-1.5" />
              Add Profile
            </Button>
          </div>
        </div>

        <div className="mb-4 rounded-md border border-border/40 bg-background p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Agent Text Size</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Floating bar input, markdown paragraphs, and tool chips
              </p>
            </div>
            <span className="text-xs font-mono text-muted-foreground">
              {Math.round(fontScale * 100)}%
            </span>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <input
              type="range"
              min={FONT_SCALE_MIN}
              max={FONT_SCALE_MAX}
              step={0.05}
              value={fontScale}
              onChange={(e) => handleFontScaleChange(parseFloat(e.target.value))}
              className="flex-1 h-1 accent-primary"
            />
            <div className="flex gap-1">
              {FONT_SCALE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => handleFontScaleChange(preset.value)}
                  className={cn(
                    "px-2 py-1 rounded text-[10px]",
                    fontScale === preset.value
                      ? "bg-accent text-foreground"
                      : "bg-muted text-muted-foreground hover:bg-accent/50",
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mb-4 rounded-md border border-border/40 bg-background p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-2.5">
              <FlashFilled
                className={cn(
                  "h-4 w-4 mt-0.5 shrink-0",
                  yoloMode ? "text-amber-400" : "text-muted-foreground",
                )}
              />
              <div>
                <p className="text-sm font-medium">YOLO mode</p>
                <p className="text-xs text-muted-foreground mt-0.5 max-w-md">
                  Run tools automatically without asking for approval each time.
                  When off, the agent prompts before running each tool. You can
                  also toggle this from the floating bar by typing{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-[10px]">/yolo</code>.
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={yoloMode}
              onClick={() => setYoloMode(!yoloMode)}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
                yoloMode ? "bg-amber-400" : "bg-muted-foreground/30",
              )}
            >
              <span
                className={cn(
                  "inline-block h-4 w-4 transform rounded-full bg-background transition-transform",
                  yoloMode ? "translate-x-4" : "translate-x-0.5",
                )}
              />
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 rounded-md bg-destructive/10 text-destructive text-xs flex items-center gap-2">
            <CloseCircleFilled className="h-3.5 w-3.5 shrink-0" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto">
              <CloseCircleFilled className="h-3 w-3" />
            </button>
          </div>
        )}

        {loading ? (
          <div className="text-xs text-muted-foreground">Loading...</div>
        ) : profiles.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <CloudConnectionFilled className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm mb-1">No profiles configured</p>
            <p className="text-xs mb-4">Add a provider profile to use the Mentiko floating bar.</p>
            <Button size="sm" onClick={openCreate}>
              <AddFilled className="h-3.5 w-3.5 mr-1.5" />
              Add Profile
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {profiles.map((profile) => {
              const isActive   = profile.name === activeProfile;
              const testResult = testResults[profile.name];
              return (
                <div
                  key={profile.name}
                  className={cn(
                    "border rounded-md p-4 transition-colors",
                    isActive ? "border-primary/40 bg-primary/5" : "border-border/40 bg-background"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <ProviderIcon provider={profile.provider} className="h-5 w-5 shrink-0 text-foreground/60" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{profile.name}</span>
                          {isActive && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">
                              Active
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {profile.provider} · {profile.model || "No model set"}
                          {profile.base_url ? ` · ${profile.base_url}` : ""}
                        </p>
                        {profile.description && (
                          <p className="text-xs text-muted-foreground/60 truncate mt-0.5">{profile.description}</p>
                        )}
                        {testResult && (
                          <div className={cn(
                            "flex items-center gap-1 mt-1 text-xs",
                            testResult.success ? "text-green-500" : "text-destructive"
                          )}>
                            {testResult.success
                              ? <TickCircleFilled className="h-3 w-3" />
                              : <CloseCircleFilled className="h-3 w-3" />}
                            {testResult.message}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {!isActive && (
                        <Button
                          variant="ghost" size="sm" className={PROFILE_ACTION_BUTTON_CLASS}
                          onClick={() => handleSetActive(profile.name)}
                          disabled={activating === profile.name}
                        >
                          {activating === profile.name ? "Setting..." : "Set Active"}
                        </Button>
                      )}
                      <Button
                        variant="ghost" size="sm" className={PROFILE_ACTION_BUTTON_CLASS}
                        onClick={() => handleTest(profile.name)}
                        disabled={testingProfile === profile.name}
                      >
                        {testingProfile === profile.name ? "Testing..." : "Test"}
                      </Button>
                      <Button
                        variant="ghost" size="sm" className={PROFILE_ACTION_BUTTON_CLASS}
                        onClick={() => openEdit(profile)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost" size="icon-sm"
                        className={cn(PROFILE_ICON_BUTTON_CLASS, "text-destructive hover:text-destructive")}
                        onClick={() => handleDelete(profile.name)}
                        disabled={deleting === profile.name}
                        aria-label={`Delete ${profile.name}`}
                      >
                        <TrashFilled className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit "${editing.name}"` : "Add Profile"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {!editing && (
              <div className="space-y-1.5">
                <Label htmlFor="profile-name" className="text-xs">Profile Name</Label>
                <Input
                  id="profile-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Example: my-claude"
                  className="text-sm"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="provider" className="text-xs">Provider</Label>
              <select
                id="provider"
                value={form.provider}
                onChange={(e) => onProviderChange(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="model" className="text-xs">Model</Label>
              <Input
                id="model"
                value={form.model}
                onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                placeholder={`Example: ${getEngineProviderDefault(form.provider)?.model || MENTIKO_GATEWAY_PROFILE.model}`}
                className="text-sm"
              />
            </div>

            {needsApiKey(form.provider) && (
              <div className="space-y-1.5">
                <Label htmlFor="api-key-secret" className="text-xs">
                  API Key
                  <span className="ml-1 text-muted-foreground font-normal">- Select from Secrets</span>
                </Label>
                {secrets.length === 0 ? (
                  <div className="text-xs text-muted-foreground px-1">
                    No secrets found.{" "}
                    <a href="/settings/secrets" className="underline text-primary" target="_blank">
                      Add one in Secrets settings
                    </a>
                    {" "}first.
                  </div>
                ) : (
                  <select
                    id="api-key-secret"
                    value={form.api_key_secret}
                    onChange={(e) => setForm((f) => ({ ...f, api_key_secret: e.target.value }))}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">{editing ? "Keep existing key" : "Select a secret..."}</option>
                    {secrets.map((s) => (
                      <option key={s.id} value={s.name}>
                        {s.name} ({s.envVar})
                      </option>
                    ))}
                  </select>
                )}
                <p className="text-[11px] text-muted-foreground/60">
                  The key is resolved server-side and written to the engine config. It is never sent to the browser.
                </p>
              </div>
            )}

            {needsBaseUrl(form.provider) && (
              <div className="space-y-1.5">
                <Label htmlFor="base-url" className="text-xs">Base URL</Label>
                <Input
                  id="base-url"
                  value={form.base_url}
                  onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
                  placeholder="https://openrouter.ai/api/v1"
                  className="text-sm"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="description" className="text-xs">Description (Optional)</Label>
              <Input
                id="description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Example: Claude for complex tasks"
                className="text-sm"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
              {saving ? "Saving..." : editing ? "Save Changes" : "Add Profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
