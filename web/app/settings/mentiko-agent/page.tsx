"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
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
  ShieldTickFilled, FlashFilled, ArrowDown2Filled as ChevronDown,
} from "@aliimam/icons";
import { ClaudeAI, OpenAI as OpenAILogo, GoogleGemini } from "@aliimam/logos";
import { cn } from "@/lib/utils";
import type { SecretMeta } from "@/lib/secrets/secrets-store";
import {
  FONT_SCALE_DEFAULT,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  KOLLABOR_BAR_APPEARANCE_DEFAULTS,
  KOLLABOR_BAR_APPEARANCE_PRESETS,
  KOLLABOR_BAR_BACKDROP_BLUR_MAX,
  KOLLABOR_BAR_BACKDROP_BLUR_MIN,
  KOLLABOR_BAR_BACKDROP_DIM_MAX,
  KOLLABOR_BAR_BACKDROP_DIM_MIN,
  KOLLABOR_BAR_BACKDROP_HEIGHT_MAX,
  KOLLABOR_BAR_BACKDROP_HEIGHT_MIN,
  KOLLABOR_BAR_BACKDROP_SOFTNESS_MAX,
  KOLLABOR_BAR_BACKDROP_SOFTNESS_MIN,
  KOLLABOR_BAR_BACKDROP_WIDTH_MAX,
  KOLLABOR_BAR_BACKDROP_WIDTH_MIN,
  KOLLABOR_BAR_SURFACE_RADIUS_MAX,
  KOLLABOR_BAR_SURFACE_RADIUS_MIN,
  KOLLABOR_BAR_SURFACE_SHADOW_MAX,
  KOLLABOR_BAR_SURFACE_SHADOW_MIN,
  KOLLABOR_BAR_TRANSCRIPT_HEIGHT_MAX,
  KOLLABOR_BAR_TRANSCRIPT_HEIGHT_MIN,
  type KollaborBarAppearance,
  useKollaborBarStore,
} from "@/lib/ui/kollabor-bar-store";
import {
  KOLLABOR_BAR_MAX_WIDTH_PX,
  KOLLABOR_BAR_MIN_WIDTH_PX,
} from "@/lib/ai-engine/kollabor-bar-flag";
import {
  ENGINE_PROVIDER_DEFAULTS,
  MENTIKO_GATEWAY_PROFILE,
  getEngineProviderDefault,
} from "@/lib/agents/agent-provider-catalog";
import { useFloatingBarStorageScope } from "@/components/app-shell/floating-bar-storage-scope";
import { useFloatingBarAvailability } from "@/lib/ui/floating-bar-availability";

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
const APPEARANCE_KEYS: Array<keyof KollaborBarAppearance> = [
  "backdropEnabled",
  "backdropBlur",
  "backdropDim",
  "backdropWidth",
  "backdropHeight",
  "backdropSoftness",
  "transcriptMaxHeight",
  "surfaceRadius",
  "surfaceShadow",
];

function appearanceMatchesPreset(
  appearance: KollaborBarAppearance,
  preset: KollaborBarAppearance,
): boolean {
  return APPEARANCE_KEYS.every((key) => appearance[key] === preset[key]);
}

function AppearanceRangeControl({
  id,
  label,
  description,
  value,
  min,
  max,
  unit,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="rounded-sm border border-border/30 bg-muted/20 px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Label htmlFor={`${id}-value`} className="text-xs font-medium">{label}</Label>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Input
            id={`${id}-value`}
            type="number"
            min={min}
            max={max}
            step={1}
            value={value}
            aria-label={`${label} value`}
            disabled={disabled}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) onChange(next);
            }}
            className="h-7 w-20 text-right text-xs font-mono"
          />
          <span className="text-[11px] text-muted-foreground">{unit}</span>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground tabular-nums">{min}</span>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          aria-label={label}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-1 flex-1 accent-primary disabled:opacity-40"
        />
        <span className="text-[10px] text-muted-foreground tabular-nums">{max}</span>
      </div>
    </div>
  );
}

function AppearanceAccordionSection({
  id,
  title,
  description,
  status,
  children,
}: {
  id: string;
  title: string;
  description: string;
  status: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const headingId = `${id}-heading`;
  const panelId = `${id}-panel`;

  return (
    <section className="mt-5 border-t border-border/40 pt-4">
      <h3 id={headingId} className="m-0">
        <button
          type="button"
          aria-labelledby={`${id}-label`}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((current) => !current)}
          className="flex w-full items-start justify-between gap-3 rounded-sm text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span id={`${id}-label`} className="text-xs font-medium">{title}</span>
              <span className="text-[10px] text-muted-foreground">{status}</span>
            </span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">{description}</span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
      </h3>
      <div
        id={panelId}
        role="region"
        aria-labelledby={headingId}
        hidden={!open}
        className="mt-3"
      >
        {children}
      </div>
    </section>
  );
}

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
  const {
    fontScale,
    setFontScale,
    barWidth,
    appearance,
    enabled,
    storageScopeReady,
    preferenceReadResolved,
    preferenceStorageError,
    cleanupBlocked,
    shutdownError,
  } = useKollaborBarStore();
  const { deploymentEnabled, effectiveEnabled } = useFloatingBarAvailability();
  const {
    scopeError,
    bridgeError,
    bridgePending,
    shutdownRetryable,
    shutdownSessionUnknown,
    shutdownCancellationUnverifiable,
    retryScope,
    retryBridge,
    retryShutdown,
    setEnabled,
    setBarWidth,
    setAppearance,
  } = useFloatingBarStorageScope();
  const { yoloMode, setYoloMode } = useKollaborBarStore();

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

  function handleBarWidthChange(value: number) {
    if (!Number.isFinite(value)) return;
    setBarWidth(Math.round(value));
  }

  function handleAppearanceChange(key: keyof KollaborBarAppearance, value: number) {
    if (!Number.isFinite(value)) return;
    setAppearance({ [key]: Math.round(value) } as Partial<KollaborBarAppearance>);
  }

  function handleAppearancePreset(values: KollaborBarAppearance) {
    setAppearance({ ...values });
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
  const visual = appearance ?? KOLLABOR_BAR_APPEARANCE_DEFAULTS;
  const appearanceDisabled = !storageScopeReady || !preferenceReadResolved;
  const activeAppearancePreset = KOLLABOR_BAR_APPEARANCE_PRESETS.find((preset) =>
    appearanceMatchesPreset(visual, preset.values),
  )?.id;
  const activeAppearancePresetLabel = KOLLABOR_BAR_APPEARANCE_PRESETS.find(
    (preset) => preset.id === activeAppearancePreset,
  )?.label ?? "Custom";

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

        <div className="mb-4 rounded-md border border-border/40 bg-card p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-2.5">
              <MagicStarFilled className="mt-0.5 h-4 w-4 shrink-0 text-[#b07ee8]" />
              <div className="min-w-0">
                <p className="text-sm font-medium">Chat backdrop and shape</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Control the backdrop and the chat surface independently. Changes apply live.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                role="status"
                aria-label="Current appearance"
                className="rounded-sm bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground"
              >
                {activeAppearancePresetLabel}
              </span>
              <button
                type="button"
                role="switch"
                aria-label="Enable chat backdrop"
                aria-checked={visual.backdropEnabled}
                disabled={appearanceDisabled}
                onClick={() => setAppearance({ backdropEnabled: !visual.backdropEnabled })}
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  visual.backdropEnabled ? "bg-[#b07ee8]" : "bg-muted-foreground/30",
                )}
              >
                <span
                  className={cn(
                    "inline-block h-4 w-4 transform rounded-full bg-background transition-transform",
                    visual.backdropEnabled ? "translate-x-4" : "translate-x-0.5",
                  )}
                />
              </button>
            </div>
          </div>
          <div className="mt-4 rounded-sm border border-border/30 bg-muted/20 p-3">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="text-xs font-medium">Appearance presets</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Start with a look, then fine-tune the controls. Width stays independent.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {KOLLABOR_BAR_APPEARANCE_PRESETS.map((preset) => {
                const isActive = activeAppearancePreset === preset.id;
                return (
                  <Button
                    key={preset.id}
                    type="button"
                    variant={isActive ? "default" : "outline"}
                    size="sm"
                    aria-label={`Use ${preset.label} appearance preset`}
                    aria-pressed={isActive}
                    disabled={appearanceDisabled}
                    onClick={() => handleAppearancePreset(preset.values)}
                    className={cn(
                      "relative h-auto min-h-12 items-start justify-start px-3 py-2 text-left",
                      isActive && "border-primary/60 bg-primary/10",
                    )}
                  >
                    <span className="flex min-w-0 flex-col items-start gap-0.5">
                      <span className="text-xs font-medium">{preset.label}</span>
                      <span className="text-[10px] font-normal opacity-70">{preset.description}</span>
                    </span>
                    {isActive && <TickCircleFilled className="absolute right-2 top-2 h-3.5 w-3.5 text-primary" />}
                  </Button>
                );
              })}
            </div>
          </div>
          <AppearanceAccordionSection
            id="backdrop-controls"
            title="Backdrop"
            description="Shape and soften the page layer behind the expanded chat."
            status={visual.backdropEnabled ? "On" : "Off"}
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <AppearanceRangeControl
                id="backdrop-blur"
                label="Backdrop blur"
                description="Softens page content behind the chat."
                value={visual.backdropBlur}
                min={KOLLABOR_BAR_BACKDROP_BLUR_MIN}
                max={KOLLABOR_BAR_BACKDROP_BLUR_MAX}
                unit="px"
                disabled={appearanceDisabled}
                onChange={(value) => handleAppearanceChange("backdropBlur", value)}
              />
              <AppearanceRangeControl
                id="backdrop-dim"
                label="Backdrop dimness"
                description="Darkens page content behind the chat."
                value={visual.backdropDim}
                min={KOLLABOR_BAR_BACKDROP_DIM_MIN}
                max={KOLLABOR_BAR_BACKDROP_DIM_MAX}
                unit="%"
                disabled={appearanceDisabled}
                onChange={(value) => handleAppearanceChange("backdropDim", value)}
              />
              <AppearanceRangeControl
                id="backdrop-width"
                label="Horizontal reach"
                description="Controls the left-to-right ellipse size."
                value={visual.backdropWidth}
                min={KOLLABOR_BAR_BACKDROP_WIDTH_MIN}
                max={KOLLABOR_BAR_BACKDROP_WIDTH_MAX}
                unit="px"
                disabled={appearanceDisabled}
                onChange={(value) => handleAppearanceChange("backdropWidth", value)}
              />
              <AppearanceRangeControl
                id="backdrop-height"
                label="Vertical reach"
                description="Controls how far the ellipse extends up the page."
                value={visual.backdropHeight}
                min={KOLLABOR_BAR_BACKDROP_HEIGHT_MIN}
                max={KOLLABOR_BAR_BACKDROP_HEIGHT_MAX}
                unit="px"
                disabled={appearanceDisabled}
                onChange={(value) => handleAppearanceChange("backdropHeight", value)}
              />
              <AppearanceRangeControl
                id="backdrop-softness"
                label="Edge softness"
                description="Moves the fade boundary between clear and covered content."
                value={visual.backdropSoftness}
                min={KOLLABOR_BAR_BACKDROP_SOFTNESS_MIN}
                max={KOLLABOR_BAR_BACKDROP_SOFTNESS_MAX}
                unit="%"
                disabled={appearanceDisabled}
                onChange={(value) => handleAppearanceChange("backdropSoftness", value)}
              />
            </div>
          </AppearanceAccordionSection>
          <AppearanceAccordionSection
            id="chat-surface-controls"
            title="Chat surface"
            description="Control how much room the chat uses and how its surface feels."
            status="3 controls"
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <AppearanceRangeControl
                id="transcript-height"
                label="Transcript height"
                description="Limits how much vertical page space the expanded chat can occupy."
                value={visual.transcriptMaxHeight}
                min={KOLLABOR_BAR_TRANSCRIPT_HEIGHT_MIN}
                max={KOLLABOR_BAR_TRANSCRIPT_HEIGHT_MAX}
                unit="vh"
                disabled={appearanceDisabled}
                onChange={(value) => handleAppearanceChange("transcriptMaxHeight", value)}
              />
              <AppearanceRangeControl
                id="surface-radius"
                label="Corner radius"
                description="Rounds the input and transcript surface."
                value={visual.surfaceRadius}
                min={KOLLABOR_BAR_SURFACE_RADIUS_MIN}
                max={KOLLABOR_BAR_SURFACE_RADIUS_MAX}
                unit="px"
                disabled={appearanceDisabled}
                onChange={(value) => handleAppearanceChange("surfaceRadius", value)}
              />
              <AppearanceRangeControl
                id="surface-shadow"
                label="Shadow strength"
                description="Controls the shadow under the input and transcript."
                value={visual.surfaceShadow}
                min={KOLLABOR_BAR_SURFACE_SHADOW_MIN}
                max={KOLLABOR_BAR_SURFACE_SHADOW_MAX}
                unit="px"
                disabled={appearanceDisabled}
                onChange={(value) => handleAppearanceChange("surfaceShadow", value)}
              />
            </div>
          </AppearanceAccordionSection>
          <p className="mt-3 text-[11px] text-muted-foreground/60">
            Saved for this preference scope and applied live when the chat is expanded. Adjusting a control changes the preset label to Custom.
          </p>
        </div>

        <div className="mb-4 rounded-md border border-border/40 bg-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Floating bar width</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Set the wide-screen width of the bar. Narrow screens stay responsive.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Input
                id="floating-bar-width"
                type="number"
                min={KOLLABOR_BAR_MIN_WIDTH_PX}
                max={KOLLABOR_BAR_MAX_WIDTH_PX}
                step={1}
                value={barWidth}
                aria-label="Floating bar width in pixels"
                disabled={!storageScopeReady || !preferenceReadResolved}
                onChange={(event) => handleBarWidthChange(Number(event.target.value))}
                className="h-8 w-20 text-right text-xs font-mono"
              />
              <span className="text-xs text-muted-foreground">px</span>
            </div>
          </div>
          <input
            type="range"
            min={KOLLABOR_BAR_MIN_WIDTH_PX}
            max={KOLLABOR_BAR_MAX_WIDTH_PX}
            step={1}
            value={barWidth}
            aria-label="Floating bar width slider"
            disabled={!storageScopeReady || !preferenceReadResolved}
            onChange={(event) => handleBarWidthChange(Number(event.target.value))}
            className="mt-3 h-1 w-full accent-primary disabled:opacity-40"
          />
          <p className="mt-2 text-[11px] text-muted-foreground/60">
            Saved for this preference scope. Deployment config provides the default when no saved value exists.
          </p>
        </div>

        <div className="mb-4 rounded-md border border-border/40 bg-card p-4">
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

        <div className="mb-4 rounded-md border border-border/40 bg-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-2.5">
              <MagicStarFilled className="mt-0.5 h-4 w-4 shrink-0 text-[#b07ee8]" />
              <div className="min-w-0">
                <p className="text-sm font-medium">Floating bar</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Show the Mentiko assistant bar across the app.
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground/70">
                  Hiding the bar suspends external control in this tab. Existing grants may resume when you turn it back on.
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="Enable floating bar"
              aria-checked={enabled}
              disabled={!storageScopeReady || !preferenceReadResolved || !deploymentEnabled || bridgePending}
              onClick={() => setEnabled(!enabled)}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                enabled && deploymentEnabled ? "bg-[#b07ee8]" : "bg-muted-foreground/30",
              )}
            >
              <span
                className={cn(
                  "inline-block h-4 w-4 transform rounded-full bg-background transition-transform",
                  enabled && deploymentEnabled ? "translate-x-4" : "translate-x-0.5",
                )}
              />
            </button>
          </div>

          {!deploymentEnabled && (
            <p className="mt-3 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground" role="status">
              Your deployment has disabled the Mentiko bar. Your saved preference will apply if the deployment enables it again.
            </p>
          )}
          {!storageScopeReady && (
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite">
              <span>{scopeError || "Loading your bar settings…"}</span>
              {scopeError && (
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={retryScope}>Retry</Button>
              )}
            </div>
          )}
          {storageScopeReady && !preferenceReadResolved && (
            <div className="mt-3 flex items-center gap-2 text-xs text-destructive" role="alert" aria-live="assertive">
              <span>Could not read your bar setting</span>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={retryScope}>Retry</Button>
            </div>
          )}
          {(preferenceStorageError || bridgeError || shutdownError) && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-destructive" role="alert" aria-live="assertive">
              <span>
                {shutdownError && shutdownSessionUnknown
                  ? "Bar remains blocked: its session ID is unknown, so shutdown cannot be retried safely until the engine can reconcile that create."
                  : shutdownError && shutdownCancellationUnverifiable
                  ? "Bar remains blocked: safe shutdown retry requires turn-scoped, idempotent cancellation and confirmation that the turn and its tools have stopped."
                  : preferenceStorageError || bridgeError || shutdownError}
              </span>
              {bridgeError === "Could not update the bar in this window" && (
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={retryBridge}>Retry</Button>
              )}
              {shutdownError && shutdownRetryable && (
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={retryShutdown}>Retry stopping</Button>
              )}
            </div>
          )}
          {storageScopeReady && preferenceReadResolved && !preferenceStorageError && !bridgeError && !shutdownError && (
            <p className="mt-3 text-[11px] text-muted-foreground/60" role="status" aria-live="polite">
              {effectiveEnabled ? "Saved and active in this window." : cleanupBlocked ? "Saved off; waiting for shutdown recovery." : "Saved off in this window."}
            </p>
          )}
        </div>

        <div className="mb-4 rounded-md border border-border/40 bg-card p-4">
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
                  New preference scopes start with YOLO on. When off, the agent asks for approval before each tool runs.
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="YOLO mode"
              aria-checked={yoloMode}
              disabled={!storageScopeReady || !preferenceReadResolved}
              onClick={() => setYoloMode(!yoloMode)}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40",
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
