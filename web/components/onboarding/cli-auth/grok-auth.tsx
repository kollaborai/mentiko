"use client";

import { useState, useEffect, useRef, useCallback, type ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { BusyButton } from "@/components/onboarding/setup-footer";
import {
  ArrowLeft2Filled,
  TickCircleFilled,
  CloseCircleFilled,
  KeyFilled,
  Link2Filled,
} from "@aliimam/icons";
import { motion } from "motion/react";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { SecretForm } from "@/components/secrets/secret-form";
import {
  PROVIDER_CREDENTIALS,
  getAgentConfigOptionsForTool,
  getDefaultAgentConfigIdForTool,
} from "@/lib/agents/provider-config";
import { getReadinessEnabledProfileIds, getPreferredReadinessProfileId } from "@/lib/agents/readiness-profiles";
import { getTerminalAuthCommand } from "@/lib/agents/agent-provider-catalog";
import { TerminalAuthOption } from "./terminal-auth-option";
import { TerminalIcon } from "@/components/ui/terminal-icon";

interface GrokAuthProps {
  onSave: (config: {
    authMethod: "login" | "api-key";
    model?: string;
  }) => void;
  onBack: () => void;
  detectedVersion?: string;
  initialAuthMethod?: AuthOption;
  backLabel?: string;
  /** From detect-cli: skip the fresh device-auth flow when already signed in. */
  authenticated?: boolean;
  /** Hide this adapter's own header — the host (Setup Center) already shows one. */
  embedded?: boolean;
  /** An ancestor is still processing after onSave fired — keep the primary action visibly busy through both phases. */
  busy?: boolean;
}

type AuthOption = "login" | "api-key" | "terminal";

type LoginStatus = "idle" | "pending" | "complete" | "failed";

const grokCreds = PROVIDER_CREDENTIALS.grok;
const grokProfileOptions = getAgentConfigOptionsForTool("grok");
const grokReadinessIds = getReadinessEnabledProfileIds("grok");

export function GrokAuth({ onSave, onBack, detectedVersion, initialAuthMethod, backLabel, authenticated, embedded, busy }: GrokAuthProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [authOption, setAuthOption] = useState<AuthOption>(initialAuthMethod ?? "api-key");
  const [model, setModel] = useState(getDefaultAgentConfigIdForTool("grok"));
  const [profiles, setProfiles] = useState<{id: string, name: string}[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // interactive login state — already-authenticated (per detect-cli) skips
  // straight to "complete" instead of forcing a fresh `grok login --device-auth`.
  const [loginStatus, setLoginStatus] = useState<LoginStatus>(authenticated ? "complete" : "idle");
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [authCode, setAuthCode] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  useEffect(() => {
    fetch("/api/agent-profiles")
      .then(r => r.json())
      .then(raw => {
        const data = raw.data ?? raw;
        const all = (data.profiles ?? []) as {id: string, name: string, cli?: string}[];
        const filtered = all.filter(p => p.cli === "grok");
        setProfiles(filtered);
        const options = filtered.length > 0 ? filtered : grokProfileOptions;
        const preferred = getPreferredReadinessProfileId("grok");
        // This effect runs exactly once (mount), so `current` here is always
        // the naive useState initializer (catalog[0] — Grok's
        // readiness-DISABLED entry), never a real prior choice. Always
        // steer to the readiness-capable profile when the list has one.
        setModel(preferred && options.some((option) => option.id === preferred) ? preferred : (options[0]?.id ?? ""));
      })
      .catch(() => {});
  }, []);

  const startLogin = async () => {
    setLoginStatus("pending");
    setAuthUrl(null);
    setAuthCode(null);
    setError("");
    try {
      const res = await fetchWithNamespace("/api/system/cli-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "grok" }),
      });
      if (!res.ok) {
        setLoginStatus("failed");
        setError("Failed to start auth session.");
        return;
      }
      const data = (await res.json()) as { sessionId?: string };
      if (!data.sessionId) {
        setLoginStatus("failed");
        setError("No session ID returned.");
        return;
      }

      pollRef.current = setInterval(async () => {
        try {
          const pollRes = await fetchWithNamespace(
            `/api/system/cli-auth?sessionId=${data.sessionId}`
          );
          if (!pollRes.ok) return;
          const pollData = (await pollRes.json()) as {
            status?: "pending" | "complete" | "failed";
            authUrl?: string;
            deviceCode?: string;
            error?: string;
          };
          if (pollData.authUrl) setAuthUrl(pollData.authUrl);
          if (pollData.deviceCode) setAuthCode(pollData.deviceCode);
          if (pollData.status === "complete") {
            stopPolling();
            setLoginStatus("complete");
          } else if (pollData.status === "failed") {
            stopPolling();
            setLoginStatus("failed");
            setError(pollData.error || "Authentication failed.");
          }
        } catch {
          // poll error, keep trying
        }
      }, 2000);
    } catch {
      setLoginStatus("failed");
      setError("Network error.");
    }
  };

  const handleApiKeySave = async (data: {
    name: string;
    envVar: string;
    value: string;
    description?: string;
  }) => {
    setSaving(true);
    setError("");
    try {
      const res = await fetchWithNamespace("/api/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        setError("Failed to save secret.");
        return;
      }
      onSave({ authMethod: "api-key", model });
    } catch {
      setError("Failed to save secret.");
    } finally {
      setSaving(false);
    }
  };

  const handleLoginDone = () => {
    if (loginStatus !== "complete") {
      setError("Sign in to Grok first.");
      return;
    }
    onSave({ authMethod: "login", model });
  };

  const showFooterSave = authOption === "login";
  const profileOptions = profiles.length > 0 ? profiles : grokProfileOptions;
  const isBusy = saving || Boolean(busy);

  const options: { key: AuthOption; icon: ComponentType<{ className?: string }>; label: string; desc: string }[] = [
    {
      key: "api-key",
      icon: KeyFilled,
      label: "Use an API Key",
      desc: `Set ${grokCreds.envKey} as a secret.`,
    },
    {
      key: "login",
      icon: Link2Filled,
      label: "Sign in with xAI",
      desc: `Runs ${getTerminalAuthCommand("grok")}, opens browser.`,
    },
    {
      key: "terminal",
      icon: TerminalIcon,
      label: "Open in Terminal",
      desc: "Run auth interactively in the terminal.",
    },
  ];

  return (
    <motion.div
      key="grok-auth"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
      className="space-y-5"
    >
      {!embedded && (
        <div className="text-center">
          <h2 className="text-lg font-semibold mb-1">Configure Grok</h2>
          {detectedVersion && (
            <p className="text-[10px] text-foreground/30">
              Detected: {detectedVersion}
            </p>
          )}
        </div>
      )}

      {/* auth option selector */}
      <div className="space-y-2">
        {options.map((opt) => {
          const Icon = opt.icon;
          const active = authOption === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => {
                setAuthOption(opt.key);
                setError("");
              }}
              className={`w-full text-left p-3 rounded-md flex items-start gap-3 transition-all ${
                active
                  ? "bg-accent ring-1 ring-foreground/10"
                  : "bg-muted hover:bg-accent/50"
              }`}
            >
              <div
                className={`mt-0.5 h-3.5 w-3.5 rounded-full border flex items-center justify-center ${
                  active
                    ? "border-foreground/60 bg-foreground/10"
                    : "border-foreground/20"
                }`}
              >
                {active && (
                  <div className="h-1.5 w-1.5 rounded-full bg-foreground/80" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 text-foreground/50" />
                  <span className="text-sm font-medium">{opt.label}</span>
                </div>
                <p className="text-[10px] text-foreground/40 mt-0.5">
                  {opt.desc}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* auth option content */}
      <div className="min-h-[120px]">
        {authOption === "login" && (
          <div className="space-y-3">
            {loginStatus === "idle" && (
              <Button onClick={startLogin} className="w-full" size="sm">
                Sign In
              </Button>
            )}
            {loginStatus === "pending" && (
              <div className="space-y-2 text-center">
                <p className="text-xs text-foreground/50">
                  Waiting for browser…
                </p>
                {authUrl && (
                  <div className="bg-muted rounded-md p-2">
                    <p className="text-[10px] text-foreground/40 mb-1">
                      Open this link and enter the code:
                    </p>
                    <a
                      href={authUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-400 hover:underline break-all font-mono"
                    >
                      {authUrl}
                    </a>
                    {authCode && (
                      <div className="mt-2 rounded bg-background px-3 py-2 font-mono text-sm tracking-wider text-foreground">
                        {authCode}
                      </div>
                    )}
                  </div>
                )}
                <div className="flex justify-center">
                  <div className="h-4 w-4 border-2 border-foreground/20 border-t-foreground/60 rounded-full animate-spin" />
                </div>
              </div>
            )}
            {loginStatus === "complete" && (
              <div className="flex items-center gap-2 justify-center text-green-400">
                <TickCircleFilled className="h-4 w-4" />
                <span className="text-sm">Signed In</span>
              </div>
            )}
            {loginStatus === "failed" && (
              <div className="space-y-2 text-center">
                <div className="flex items-center gap-2 justify-center text-red-400">
                  <CloseCircleFilled className="h-4 w-4" />
                  <span className="text-xs">{error || "Sign in failed."}</span>
                </div>
                <Button
                  onClick={() => {
                    setLoginStatus("idle");
                    setError("");
                  }}
                  variant="outline"
                  size="sm"
                >
                  Try Again
                </Button>
              </div>
            )}
          </div>
        )}

        {authOption === "api-key" && (
          <SecretForm
            inline
            prefilledPreset={grokCreds.envKey}
            onSave={handleApiKeySave}
            saving={saving}
            error={error}
          />
        )}

        {authOption === "terminal" && (
          <TerminalAuthOption tool="grok" />
        )}
      </div>

      {/* profile selector */}
      <div className="space-y-1">
        <label className="text-xs text-foreground/50">Profile for Your First Run</label>
        <select
          className="w-full h-8 px-3 text-xs rounded-md bg-muted focus:ring-1 focus:ring-accent border-0"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          {profileOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}{!grokReadinessIds.has(p.id) ? " (cannot be verified here)" : ""}
            </option>
          ))}
        </select>
      </div>

      {/* footer */}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-foreground/40 hover:text-foreground transition-colors"
        >
          <ArrowLeft2Filled className="h-3.5 w-3.5" />
          {backLabel ?? "Back to Tools"}
        </button>
        {showFooterSave && (
          <BusyButton busy={isBusy} busyLabel="Saving…" onClick={handleLoginDone}>
            Save and Check Grok
          </BusyButton>
        )}
      </div>
      {/* the "failed" loginStatus branch above already shows its own error;
          this is only for the "clicked Save before finishing sign-in" guard */}
      {authOption === "login" && loginStatus !== "failed" && error && (
        <p className="text-right text-xs text-red-400">{error}</p>
      )}
    </motion.div>
  );
}
