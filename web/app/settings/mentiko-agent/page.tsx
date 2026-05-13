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
  ShieldTickFilled,
} from "@aliimam/icons";
import { ClaudeAI, OpenAI as OpenAILogo, GoogleGemini } from "@aliimam/logos";
import { cn } from "@/lib/utils";
import type { SecretMeta } from "@/lib/secrets-store";

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

const PROVIDERS = [
  { value: "anthropic",   label: "Anthropic",         defaultModel: "claude-sonnet-4-6",             defaultBaseUrl: "" },
  { value: "openai",      label: "OpenAI",             defaultModel: "gpt-4o",                        defaultBaseUrl: "" },
  { value: "openrouter",  label: "OpenRouter",         defaultModel: "deepseek/deepseek-v4-flash",    defaultBaseUrl: "https://openrouter.ai/api/v1" },
  { value: "gemini",      label: "Google Gemini",      defaultModel: "gemini-2.0-flash",              defaultBaseUrl: "" },
  { value: "custom",      label: "Custom / Local",     defaultModel: "",                              defaultBaseUrl: "" },
  { value: "auto",        label: "Auto (env vars)",    defaultModel: "",                              defaultBaseUrl: "" },
];

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
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  api_key_secret: "",   // secret name from vault
  base_url: "",
  description: "",
};

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

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/kollabor/engine/profiles", { credentials: "same-origin" });
      if (!res.ok) throw new Error(`failed to load profiles: ${res.status}`);
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
      model:    def?.defaultModel   ?? "",
      base_url: def?.defaultBaseUrl ?? f.base_url,
    }));
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
        throw new Error(err.error ?? err.detail ?? `save failed: ${res.status}`);
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
        throw new Error(err.detail ?? `delete failed: ${res.status}`);
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
      if (!res.ok) throw new Error(`failed to set active profile: ${res.status}`);
      setActiveProfile(name);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActivating(null);
    }
  }

  async function handleTest(name: string) {
    setTestingProfile(name);
    setTestResults((r) => ({ ...r, [name]: { success: false, message: "testing..." } }));
    try {
      const res = await fetch(`/api/kollabor/engine/profiles/${encodeURIComponent(name)}/test`, {
        method: "POST", credentials: "same-origin",
      });
      const data = (await res.json()) as { success: boolean; message?: string; error?: string };
      setTestResults((r) => ({
        ...r,
        [name]: {
          success: data.success,
          message: data.message ?? data.error ?? (data.success ? "connection ok" : "failed"),
        },
      }));
    } catch (e: unknown) {
      setTestResults((r) => ({
        ...r,
        [name]: { success: false, message: e instanceof Error ? e.message : "test failed" },
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
            active:{" "}
            <span className="text-foreground font-medium">{activeProfile || "none"}</span>
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={loadProfiles} disabled={loading}>
              <RefreshFilled className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" onClick={openCreate}>
              <AddFilled className="h-3.5 w-3.5 mr-1.5" />
              add profile
            </Button>
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
          <div className="text-xs text-muted-foreground">loading...</div>
        ) : profiles.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <CloudConnectionFilled className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm mb-1">no profiles configured</p>
            <p className="text-xs mb-4">add a provider profile to use the Mentiko floating bar</p>
            <Button size="sm" onClick={openCreate}>
              <AddFilled className="h-3.5 w-3.5 mr-1.5" />
              add profile
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
                              active
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {profile.provider} · {profile.model || "no model set"}
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
                          variant="ghost" size="sm" className="text-xs h-7 px-2"
                          onClick={() => handleSetActive(profile.name)}
                          disabled={activating === profile.name}
                        >
                          {activating === profile.name ? "setting..." : "set active"}
                        </Button>
                      )}
                      <Button
                        variant="ghost" size="sm" className="text-xs h-7 px-2"
                        onClick={() => handleTest(profile.name)}
                        disabled={testingProfile === profile.name}
                      >
                        {testingProfile === profile.name ? "testing..." : "test"}
                      </Button>
                      <Button
                        variant="ghost" size="sm" className="h-7 px-2"
                        onClick={() => openEdit(profile)}
                      >
                        edit
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        className="h-7 px-2 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(profile.name)}
                        disabled={deleting === profile.name}
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
            <DialogTitle>{editing ? `edit "${editing.name}"` : "add profile"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {!editing && (
              <div className="space-y-1.5">
                <Label htmlFor="profile-name" className="text-xs">profile name</Label>
                <Input
                  id="profile-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. my-claude"
                  className="text-sm"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="provider" className="text-xs">provider</Label>
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
              <Label htmlFor="model" className="text-xs">model</Label>
              <Input
                id="model"
                value={form.model}
                onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                placeholder="e.g. claude-sonnet-4-6"
                className="text-sm"
              />
            </div>

            {needsApiKey(form.provider) && (
              <div className="space-y-1.5">
                <Label htmlFor="api-key-secret" className="text-xs">
                  api key
                  <span className="ml-1 text-muted-foreground font-normal">— pick from secrets vault</span>
                </Label>
                {secrets.length === 0 ? (
                  <div className="text-xs text-muted-foreground px-1">
                    no secrets found.{" "}
                    <a href="/settings/secrets" className="underline text-primary" target="_blank">
                      add one in secrets settings
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
                    <option value="">{editing ? "keep existing key" : "select a secret..."}</option>
                    {secrets.map((s) => (
                      <option key={s.id} value={s.name}>
                        {s.name} ({s.envVar})
                      </option>
                    ))}
                  </select>
                )}
                <p className="text-[11px] text-muted-foreground/60">
                  the key is resolved server-side and written to the engine config — never sent to the browser.
                </p>
              </div>
            )}

            {needsBaseUrl(form.provider) && (
              <div className="space-y-1.5">
                <Label htmlFor="base-url" className="text-xs">base url</Label>
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
              <Label htmlFor="description" className="text-xs">description (optional)</Label>
              <Input
                id="description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="e.g. Claude for complex tasks"
                className="text-sm"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
              {saving ? "saving..." : editing ? "save changes" : "add profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
