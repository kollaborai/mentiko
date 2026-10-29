"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TickCircleFilled, DangerFilled, InfoCircleFilled, ArrowLeft2Filled } from "@aliimam/icons";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { useAgentProfiles } from "@/lib/hooks/use-agent-profiles";
import {
  CLI_TOOLS,
  PROVIDER_CREDENTIALS,
} from "@/lib/agents/provider-config";
import { getBundleProviderForTool, getCatalogBundleByProvider } from "@/lib/agents/agent-provider-catalog";
import type { AgentProfileProvider } from "@/lib/types";
import { ProviderLogo } from "@/components/onboarding/provider-logo";
import { BusyButton } from "@/components/onboarding/setup-footer";
import { ClaudeAuth } from "@/components/onboarding/cli-auth/claude-auth";
import { CodexAuth } from "@/components/onboarding/cli-auth/codex-auth";
import { AntigravityAuth } from "@/components/onboarding/cli-auth/antigravity-auth";
import { GrokAuth } from "@/components/onboarding/cli-auth/grok-auth";
import { KollabAuth } from "@/components/onboarding/cli-auth/kollab-auth";
import { cn } from "@/lib/utils";

export interface DetectedTool {
  name: string;
  found: boolean;
  version?: string;
  path?: string;
  authenticated?: boolean;
}

export interface ProviderStepState {
  selectedCli?: string | null;
  selectedProfileId?: string | null;
  defaultVerified?: boolean;
  status?: string;
}

interface AuthSaveConfig {
  authMethod: "login" | "api-key" | "gateway";
  model?: string;
  secretName?: string;
}

// Tools whose adapter should open straight to their strongest auth path —
// mirrors the "simple mode" defaults the legacy wizard used (steps/cli-setup-step.tsx).
const INITIAL_AUTH_METHOD: Record<string, "login" | "api-key"> = {
  claude: "api-key",
  codex: "login",
  grok: "login",
  antigravity: "api-key",
};

const detectedStatusLabel = (detecting: boolean, info?: DetectedTool) =>
  detecting ? "Checking" : info?.found ? "Found on this machine" : "Not found";

const authStatusLabel = (info?: DetectedTool) =>
  info?.authenticated === true ? "Signed in" : info?.authenticated === false ? "Needs sign-in" : "Unknown";

// Spec (Recommended profile selection): "array order is not a safe onboarding
// decision." The Codex bundle's first profile ships with readiness disabled
// while its Terra/Luna siblings have it enabled — onboarding cannot let a
// silent default pick a profile that Step 3 will never be able to verify.
// Only steers away from the requested profile when it truly has no usable
// readiness signal; an explicit readiness-enabled choice is always honored.
function resolveReadinessSafeProfileId(bundleProvider: AgentProfileProvider, requestedId?: string): string | undefined {
  const bundle = getCatalogBundleByProvider(bundleProvider);
  if (!bundle) return requestedId;
  const requested = requestedId ? bundle.profiles.find((p) => p.id === requestedId) : undefined;
  if (requested?.readiness?.enabled) return requested.id;
  const readinessEnabled = bundle.profiles.find((p) => p.readiness?.enabled);
  return readinessEnabled?.id ?? requestedId;
}

export function ProviderStep({
  providerState,
  revision,
  setupVersion,
  onChanged,
  onBusyChange,
  onError,
  onNotify,
  onContinue,
}: {
  providerState: ProviderStepState;
  /** Onboarding record revision, for a stable idempotency key (see nextIdempotencyKey below). */
  revision?: number;
  setupVersion: number;
  onChanged: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
  onError: (message: string | null) => void;
  onNotify: (message: string | null) => void;
  /** Advance to the next milestone — used by the "set up but not yet verified" card's primary action. */
  onContinue: () => void;
}) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const { profiles, loading: profilesLoading, refetch: refetchProfiles } = useAgentProfiles();
  // Same stable-key + attempt-counter pattern as setup-center.tsx's runAction:
  // same (revision, tool, profile, default choice) reuses/resumes the same
  // server-side operation; a failure bumps the counter so the *next* click
  // gets a fresh key instead of replaying a stale failed operation record.
  const attemptCountersRef = useRef<Map<string, number>>(new Map());
  const nextIdempotencyKey = useCallback((base: string) => {
    const key = `${base}:rev${revision ?? 0}`;
    const attempt = attemptCountersRef.current.get(key) ?? 0;
    return attempt > 0 ? `${key}:attempt${attempt}` : key;
  }, [revision]);
  const recordAttemptFailure = useCallback((base: string) => {
    const key = `${base}:rev${revision ?? 0}`;
    attemptCountersRef.current.set(key, (attemptCountersRef.current.get(key) ?? 0) + 1);
  }, [revision]);

  const [detected, setDetected] = useState<DetectedTool[]>([]);
  const [detecting, setDetecting] = useState(true);
  const [activeToolId, setActiveToolId] = useState<string | null>(null);
  const [defaultChoice, setDefaultChoice] = useState<"use" | "keep">("use");
  const [changingTool, setChangingTool] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [unverifiedNotice, setUnverifiedNotice] = useState<string | null>(null);
  const [lastAuthMethod, setLastAuthMethod] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setDetecting(true);
      try {
        const res = await fetchWithNamespace("/api/system/detect-cli");
        if (res.ok && !cancelled) {
          const json = (await res.json()) as { data?: { tools?: DetectedTool[] }; tools?: DetectedTool[] };
          setDetected(json.data?.tools ?? json.tools ?? []);
        }
      } catch {
        // detection failed — cards fall back to "Not found" rather than lying
      } finally {
        if (!cancelled) setDetecting(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // useAgentProfiles() serves a module-cached list that may predate this
  // session's own bundle installs; force one fresh read whenever Step 1 opens
  // so the Switch/Keep default decision is never made against stale data.
  useEffect(() => {
    void refetchProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sortedTools = useMemo(() => {
    // Found tools first (defect #2). Array.prototype.sort is stable, so ties
    // keep catalog order.
    return [...CLI_TOOLS].sort((a, b) => {
      const aFound = detected.find((d) => d.name === a.id)?.found ? 0 : 1;
      const bFound = detected.find((d) => d.name === b.id)?.found ? 0 : 1;
      return aFound - bFound;
    });
  }, [detected]);

  const currentDefaultProfile = useMemo(() => profiles.find((p) => p.isDefault) ?? null, [profiles]);
  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === providerState.selectedProfileId) ?? null,
    [profiles, providerState.selectedProfileId],
  );
  const activeTool = useMemo(
    () => CLI_TOOLS.find((t) => t.id === providerState.selectedCli || getBundleProviderForTool(t.id) === providerState.selectedCli),
    [providerState.selectedCli],
  );

  // Trust, but verify: the server wrote "ready" at activation time. If the
  // live profile list no longer agrees (something changed the default out
  // from under onboarding), don't keep showing a green check.
  const readBackConfirmed = !profilesLoading && (!providerState.selectedProfileId || Boolean(activeProfile?.isDefault));
  const showProof = providerState.status === "ready" && !changingTool;

  const openTool = (toolId: string) => {
    setActiveToolId(toolId);
    setUnverifiedNotice(null);
    onError(null);
    // Spec: default checked only when there is no current default at all —
    // set as soon as the auth view opens so it's visible before the adapter's
    // own save action fires (there's no separate confirm screen anymore).
    setDefaultChoice(currentDefaultProfile ? "keep" : "use");
  };

  const backToList = useCallback(() => {
    setActiveToolId(null);
    setUnverifiedNotice(null);
  }, []);

  // The adapter's own primary action ("Save and Check X") IS the save
  // action now — no separate confirm screen. The Switch/Keep or "Use for my
  // first run" choice is already set (via openTool/the sibling control) by
  // the time this fires.
  const handleAdapterSave = (toolId: string, config: AuthSaveConfig) => {
    setLastAuthMethod(config.authMethod);
    void handleConfirmSave(toolId, config);
  };

  const syncKollabProfileSecret = async (secretName: string, profileHint?: string) => {
    // useAgentProfiles()'s refetch() returns void, so read the server directly
    // (mirrors steps/cli-setup-step.tsx's syncKollabProfileSecret).
    const profilesRes = await fetchWithNamespace("/api/agent-profiles");
    if (!profilesRes.ok) return;
    const raw = await profilesRes.json();
    const data = raw.data ?? raw;
    const all = (data.profiles ?? []) as { id: string; cli?: string; env?: Record<string, string> }[];
    const kollabProfiles = all.filter((p) => p.cli === "kollab");
    if (kollabProfiles.length === 0) return;
    const target = (profileHint ? kollabProfiles.find((p) => p.id === profileHint) : undefined) ?? kollabProfiles[0];
    const nextEnv = { ...(target.env || {}), [PROVIDER_CREDENTIALS.kollab.envKey]: `{secret:${secretName}}` };
    await fetchWithNamespace(`/api/agent-profiles/${encodeURIComponent(target.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ env: nextEnv }),
    });
    await refetchProfiles();
  };

  const handleConfirmSave = async (toolId: string, config: AuthSaveConfig) => {
    const bundleProvider = getBundleProviderForTool(toolId);
    const tool = CLI_TOOLS.find((t) => t.id === toolId);
    if (!bundleProvider) {
      // Spec's "no verifiable readiness path" case (currently true for tools without a readiness-enabled bundle profile,
      // which has no profile bundle in the catalog).
      setUnverifiedNotice(
        `${tool?.name ?? toolId} can be configured, but Mentiko cannot prove it is ready here. Credentials were saved; choose another tool to unlock Check and Run, or continue exploring.`,
      );
      return;
    }
    setSaving(true);
    onBusyChange(true);
    onError(null);
    const idempotencyBase = `provider_complete:${toolId}:${config.model || "auto"}:${defaultChoice}`;
    try {
      const profileId = resolveReadinessSafeProfileId(bundleProvider, config.model || undefined);
      const res = await fetchWithNamespace("/api/onboarding/provider/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: bundleProvider,
          profileId,
          makeDefault: defaultChoice === "use",
          idempotencyKey: nextIdempotencyKey(idempotencyBase),
          setupVersion,
        }),
      });
      // fetchWithNamespace's response proxy throws on {success:false} bodies
      // (see unwrapApiData), so a non-2xx with no parseable envelope is the
      // only case left to handle explicitly here.
      await res.json();
      if (!res.ok) throw new Error(`Could not verify ${tool?.name ?? toolId}. Try again.`);
      if (toolId === "kollab" && config.secretName) {
        await syncKollabProfileSecret(config.secretName, config.model).catch(() => {
          // Onboarding can still proceed without the kollab secret sync; the
          // provider itself is already verified at this point.
        });
      } else {
        await refetchProfiles();
      }
      await onChanged();
      setActiveToolId(null);
      setChangingTool(false);
      onNotify(`${tool?.name ?? toolId} is ready.`);
    } catch (cause) {
      recordAttemptFailure(idempotencyBase);
      onError(cause instanceof Error ? cause.message : `Could not verify ${tool?.name ?? toolId}. Try again.`);
    } finally {
      setSaving(false);
      onBusyChange(false);
    }
  };

  const handleRecheck = async () => {
    setRechecking(true);
    onError(null);
    try {
      await refetchProfiles();
      await onChanged();
      onNotify("Rechecked. Setup is current.");
    } finally {
      setRechecking(false);
    }
  };

  // ── proof / needs-attention (Step 1 success state) ─────────────────────
  if (showProof) {
    if (!readBackConfirmed) {
      return (
        <div>
          <h2 className="text-lg font-semibold">Pick a Tool</h2>
          <div className="mt-5 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <div className="flex items-start gap-3">
              <DangerFilled className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                <p className="text-sm font-medium">Needs Attention</p>
                <p className="mt-1 text-xs text-foreground/60">
                  The persisted default no longer matches what onboarding verified. Recheck, or choose a tool again.
                </p>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <BusyButton busy={rechecking} busyLabel="Checking…" onClick={() => void handleRecheck()} variant="outline" size="sm">
                Recheck
              </BusyButton>
              <button
                type="button"
                onClick={() => setChangingTool(true)}
                className="text-xs text-foreground/50 hover:text-foreground"
              >
                Change tool
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div>
        <h2 className="text-lg font-semibold">Pick a Tool</h2>
        <div className="mt-5 rounded-lg border border-border/60 bg-card/20 p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-foreground/5">
              <ProviderLogo id={activeTool?.id ?? ""} className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <TickCircleFilled className="h-4 w-4 text-green-400" />
                {activeTool?.name ?? providerState.selectedCli} is ready.
              </p>
              <p className="mt-1 text-xs text-foreground/50">
                Default for new chains: <span className="text-foreground/80">{activeProfile?.name ?? "Unknown profile"}</span>
              </p>
              {activeProfile?.model && <p className="text-xs text-foreground/50">Model: {activeProfile.model}</p>}
              {lastAuthMethod && <p className="text-xs text-foreground/50">Auth: {lastAuthMethod === "api-key" ? "API key" : lastAuthMethod === "gateway" ? "Gateway" : "Signed in"}</p>}
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <BusyButton busy={rechecking} busyLabel="Checking…" onClick={() => void handleRecheck()} variant="outline" size="sm">
              Recheck
            </BusyButton>
            <button
              type="button"
              onClick={() => setChangingTool(true)}
              className="text-xs text-foreground/50 hover:text-foreground"
            >
              Change tool
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── set up but not yet verified (spec G4: Provider Ready needs the Step 3
  // readiness run too — defaultVerified alone never earns the green "is
  // ready" claim) ──────────────────────────────────────────────────────────
  if (providerState.status === "in_progress" && !changingTool && !activeToolId) {
    return (
      <div>
        <h2 className="text-lg font-semibold">Pick a Tool</h2>
        <div className="mt-5 rounded-lg border border-border/60 bg-card/20 p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-foreground/5">
              <ProviderLogo id={activeTool?.id ?? ""} className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{activeTool?.name ?? providerState.selectedCli} is set up.</p>
              <p className="mt-1 text-xs text-foreground/50">
                Default for new chains: <span className="text-foreground/80">{activeProfile?.name ?? "Unknown profile"}</span>
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-amber-300">
                <InfoCircleFilled className="h-3.5 w-3.5 shrink-0" />
                Not yet verified: Step 3 runs the check.
              </p>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <BusyButton onClick={onContinue} size="sm" className="gap-1.5">
              Continue to Step 2
            </BusyButton>
            <button
              type="button"
              onClick={() => setChangingTool(true)}
              className="text-xs text-foreground/50 hover:text-foreground"
            >
              Change tool
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── capture (Step 1 authentication view — one screen, one save action) ──
  if (activeToolId) {
    const tool = CLI_TOOLS.find((t) => t.id === activeToolId);
    if (!tool) { backToList(); return null; }
    const detectedInfo = detected.find((d) => d.name === activeToolId);
    const handleSave = (config: AuthSaveConfig) => handleAdapterSave(activeToolId, config);
    const sharedAdapterProps = {
      onBack: backToList,
      detectedVersion: detectedInfo?.version,
      backLabel: "Back to Tools",
      authenticated: detectedInfo?.authenticated,
      embedded: true,
      busy: saving,
    };

    return (
      <div>
        <button
          type="button"
          onClick={backToList}
          className="mb-4 flex items-center gap-1 text-xs text-foreground/40 hover:text-foreground transition-colors"
        >
          <ArrowLeft2Filled className="h-3.5 w-3.5" />
          Back to Tools
        </button>

        <div className="mb-4 flex items-center gap-3">
          <ProviderLogo id={tool.id} className={cn("h-8 w-8", tool.color)} />
          <div>
            <h2 className="text-lg font-semibold">Set Up {tool.name}</h2>
            <p className="text-xs text-foreground/50">{tool.name} will run agents in your first chain.</p>
            {detectedInfo?.version && <p className="text-[10px] text-foreground/35">Detected version: {detectedInfo.version}</p>}
          </div>
        </div>

        {unverifiedNotice ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
            <div className="flex items-start gap-3">
              <InfoCircleFilled className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <p className="text-xs text-foreground/70">{unverifiedNotice}</p>
            </div>
            <button type="button" onClick={backToList} className="mt-3 text-xs text-foreground/50 hover:text-foreground">
              Back to Tools
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Switch/Keep or "use for my first run" — visible on this same
                screen, set before the adapter's own save action fires. */}
            {currentDefaultProfile && currentDefaultProfile.cli !== tool.cli ? (
              <div className="rounded-lg border border-border/60 p-4">
                <p className="text-sm">
                  Current default: <span className="text-foreground/90">{currentDefaultProfile.name}</span>. Use {tool.name} for this setup?
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setDefaultChoice("keep")}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-xs transition",
                      defaultChoice === "keep" ? "border-amber-400/60 bg-amber-400/10 text-amber-300" : "border-border/60 text-foreground/60 hover:border-foreground/40",
                    )}
                  >
                    Keep Current Default
                  </button>
                  <button
                    type="button"
                    onClick={() => setDefaultChoice("use")}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-xs transition",
                      defaultChoice === "use" ? "border-amber-400/60 bg-amber-400/10 text-amber-300" : "border-border/60 text-foreground/60 hover:border-foreground/40",
                    )}
                  >
                    Switch to {tool.name}
                  </button>
                </div>
              </div>
            ) : (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={defaultChoice === "use"}
                  onChange={(e) => setDefaultChoice(e.target.checked ? "use" : "keep")}
                  className="h-4 w-4 rounded border-border/60"
                />
                Use for first run
              </label>
            )}

            {activeToolId === "claude" ? (
              <ClaudeAuth {...sharedAdapterProps} onSave={handleSave} initialAuthMethod={INITIAL_AUTH_METHOD.claude} />
            ) : activeToolId === "codex" ? (
              <CodexAuth {...sharedAdapterProps} onSave={handleSave} initialAuthMethod={INITIAL_AUTH_METHOD.codex} />
            ) : activeToolId === "antigravity" ? (
              <AntigravityAuth {...sharedAdapterProps} onSave={handleSave} initialAuthMethod={INITIAL_AUTH_METHOD.antigravity} />
            ) : activeToolId === "grok" ? (
              <GrokAuth {...sharedAdapterProps} onSave={handleSave} initialAuthMethod={INITIAL_AUTH_METHOD.grok} />
            ) : activeToolId === "kollab" ? (
              <KollabAuth {...sharedAdapterProps} onSave={handleSave} />
            ) : null}
          </div>
        )}
      </div>
    );
  }

  // ── provider picker (Step 1 default view) ────────────────────────────
  return (
    <div>
      <h2 className="text-base font-semibold">Pick a Tool</h2>
      <p className="mt-1 text-xs text-foreground/50">Select a tool for your first run. Found tools appear first.</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 md:grid-cols-3">
        {sortedTools.map((tool) => {
          const info = detected.find((d) => d.name === tool.id);
          const isCurrent = providerState.selectedCli === tool.id || providerState.selectedCli === getBundleProviderForTool(tool.id);
          return (
            <button
              key={tool.id}
              type="button"
              onClick={() => openTool(tool.id)}
              className={cn(
                "rounded-md border border-border/60 bg-card/20 p-3 text-left transition hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isCurrent && "border-amber-400/60 bg-amber-400/5",
              )}
            >
              <span className="flex items-start gap-3">
                <ProviderLogo id={tool.id} className={cn("h-7 w-7 shrink-0", tool.color)} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{tool.name}</span>
                    {tool.id === "codex" && <span className="shrink-0 text-[10px] text-amber-300">Recommended</span>}
                  </span>
                  <span className="mt-1 block text-[11px] leading-snug text-foreground/50">{tool.description}</span>
                  <span className="mt-1.5 block text-[10px] text-foreground/40">
                    {detectedStatusLabel(detecting, info)} · {authStatusLabel(info)}
                  </span>
                </span>
              </span>
              <span className="mt-2.5 block text-right text-[11px] text-amber-300">
                {info?.found ? `Use ${tool.name}` : `Set up ${tool.name}`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
