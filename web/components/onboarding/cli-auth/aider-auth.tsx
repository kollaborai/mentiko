"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft2Filled,
  TickCircleFilled,
  KeyFilled,
  CommandSquareFilled,
} from "@aliimam/icons";
import { ClaudeAI, OpenAI as OpenAILogo, GoogleGemini } from "@aliimam/logos";
import { motion } from "motion/react";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { SecretForm } from "@/components/secrets/secret-form";
import { getDefaultAgentConfigIdForTool, PROVIDER_CREDENTIALS } from "@/lib/provider-config";
import { TerminalAuthOption } from "./terminal-auth-option";

interface AiderAuthProps {
  onSave: (config: {
    authMethod: "api-key";
    model?: string;
  }) => void;
  onBack: () => void;
  backLabel?: string;
}

type AuthMethod = "api-key" | "terminal";

type Provider = "anthropic" | "openai" | "google";

interface ExistingSecret {
  id: string;
  name: string;
  envVar: string;
}

const PROVIDER_MAP: Record<Provider, {
  label: string;
  envKey: string;
  preset: string;
  icon: React.ComponentType<{ className?: string }>;
}> = {
  anthropic: {
    label: "Anthropic",
    envKey: PROVIDER_CREDENTIALS.claude.envKey,
    preset: PROVIDER_CREDENTIALS.claude.envKey,
    icon: ClaudeAI,
  },
  openai: {
    label: "OpenAI",
    envKey: PROVIDER_CREDENTIALS.codex.envKey,
    preset: PROVIDER_CREDENTIALS.codex.envKey,
    icon: OpenAILogo,
  },
  google: {
    label: "Google",
    envKey: PROVIDER_CREDENTIALS.gemini.envKey,
    preset: PROVIDER_CREDENTIALS.gemini.envKey,
    icon: GoogleGemini,
  },
};

export function AiderAuth({ onSave, onBack, backLabel }: AiderAuthProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [authMethod, setAuthMethod] = useState<AuthMethod>("api-key");
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [model, setModel] = useState(getDefaultAgentConfigIdForTool("aider"));
  const [profiles, setProfiles] = useState<{id: string, name: string}[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [existingSecrets, setExistingSecrets] = useState<ExistingSecret[]>([]);
  const [loadingSecrets, setLoadingSecrets] = useState(true);

  const loadSecrets = useCallback(async () => {
    setLoadingSecrets(true);
    try {
      const res = await fetchWithNamespace("/api/secrets");
      if (res.ok) {
        const data = (await res.json()) as { secrets?: ExistingSecret[] };
        setExistingSecrets(data.secrets ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingSecrets(false);
    }
  }, [fetchWithNamespace]);

  useEffect(() => {
    loadSecrets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetch("/api/agent-profiles")
      .then(r => r.json())
      .then(raw => {
        const data = raw.data ?? raw;
        const all = (data.profiles ?? []) as {id: string, name: string}[];
        setProfiles(all);
        if (all.length > 0 && !model) setModel(all[0].id);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const providerConfig = PROVIDER_MAP[provider];
  const hasKey = existingSecrets.some(
    (s) => s.envVar === providerConfig.envKey
  );

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
        setError("failed to save secret");
        return;
      }
      // refresh secrets list so the check shows up
      await loadSecrets();
      onSave({ authMethod: "api-key", model });
    } catch {
      setError("failed to save secret");
    } finally {
      setSaving(false);
    }
  };

  const handleUsExisting = () => {
    onSave({ authMethod: "api-key", model });
  };

  return (
    <motion.div
      key="aider-auth"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
      className="space-y-5"
    >
      <div className="text-center">
        <h2 className="text-lg font-semibold mb-1">Configure Aider</h2>
        <p className="text-xs text-foreground/40">
          aider uses your existing provider keys
        </p>
      </div>

      {/* auth method selector */}
      <div className="space-y-2">
        {([
          {
            key: "api-key" as AuthMethod,
            icon: KeyFilled,
            label: "use an API key",
            desc: "set a provider key as a secret",
          },
          {
            key: "terminal" as AuthMethod,
            icon: CommandSquareFilled,
            label: "open in terminal",
            desc: "run auth interactively in the terminal",
          },
        ]).map((opt) => {
          const Icon = opt.icon;
          const active = authMethod === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => {
                setAuthMethod(opt.key);
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

      {/* auth method content */}
      <div className="min-h-[120px]">
        {authMethod === "api-key" && (
          <>
            {/* provider selector */}
            <div className="space-y-1 mb-3">
              <label className="text-xs text-foreground/50">provider</label>
              <div className="flex gap-2">
                {(Object.entries(PROVIDER_MAP) as [Provider, typeof PROVIDER_MAP[Provider]][]).map(
                  ([key, config]) => {
                    const Icon = config.icon;
                    const active = provider === key;
                    const keyExists = existingSecrets.some(
                      (s) => s.envVar === config.envKey
                    );
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setProvider(key);
                          setError("");
                        }}
                        className={`flex-1 p-3 rounded-md text-center transition-all relative ${
                          active
                            ? "bg-accent ring-1 ring-foreground/10"
                            : "bg-muted hover:bg-accent/50"
                        }`}
                      >
                        {keyExists && (
                          <div className="absolute top-1.5 right-1.5">
                            <TickCircleFilled className="h-3 w-3 text-green-400" />
                          </div>
                        )}
                        <Icon className="h-5 w-5 mx-auto mb-1" />
                        <span className="text-xs font-medium">{config.label}</span>
                      </button>
                    );
                  }
                )}
              </div>
            </div>

            {/* key status or form */}
            {loadingSecrets ? (
              <div className="flex justify-center py-6">
                <div className="h-4 w-4 border-2 border-foreground/20 border-t-foreground/60 rounded-full animate-spin" />
              </div>
            ) : hasKey ? (
              <div className="bg-muted/50 rounded-md p-4 text-center space-y-2">
                <div className="flex items-center gap-2 justify-center text-green-400">
                  <TickCircleFilled className="h-4 w-4" />
                  <span className="text-sm">
                    using your {providerConfig.label} key
                  </span>
                </div>
                <p className="text-[10px] text-foreground/30">
                  {providerConfig.envKey} already configured in secrets
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-foreground/40">
                  add your {providerConfig.label} API key:
                </p>
                <SecretForm
                  inline
                  prefilledPreset={providerConfig.preset}
                  onSave={handleApiKeySave}
                  saving={saving}
                  error={error}
                />
              </div>
            )}
          </>
        )}

        {authMethod === "terminal" && (
          <TerminalAuthOption tool="aider" />
        )}
      </div>

      {/* agent config selector */}
      <div className="space-y-1">
        <label className="text-xs text-foreground/50">default agent config</label>
        <select
          className="w-full h-8 px-3 text-xs rounded-md bg-muted focus:ring-1 focus:ring-accent border-0"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          {profiles.length > 0
            ? profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))
            : (
                <option value="">Use CLI default</option>
              )}
        </select>
      </div>

      {/* footer */}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-foreground/40 hover:text-foreground transition-colors"
        >
          <ArrowLeft2Filled className="h-3.5 w-3.5" />
          {backLabel ?? "back to tools"}
        </button>
        <Button
          size="sm"
          disabled={saving || (!hasKey && !loadingSecrets)}
          onClick={handleUsExisting}
        >
          {saving ? "saving..." : "save"}
        </Button>
      </div>
    </motion.div>
  );
}
