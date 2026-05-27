"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowLeft2Filled,
  CommandSquareFilled,
  KeyFilled,
} from "@aliimam/icons";

import { Button } from "@/components/ui/button";
import { SecretForm } from "@/components/secrets/secret-form";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { CLI_TOOLS, PROVIDER_CREDENTIALS } from "@/lib/provider-config";
import { TerminalAuthOption } from "./terminal-auth-option";

interface KollabAuthProps {
  onSave: (config: {
    authMethod: "login" | "api-key";
    model?: string;
    secretName?: string;
  }) => void;
  onBack: () => void;
  detectedVersion?: string;
  backLabel?: string;
}

type AuthMethod = "terminal" | "api-key";

const kollabTool = CLI_TOOLS.find((t) => t.id === "kollab")!;
const kollabCreds = PROVIDER_CREDENTIALS.kollab;

export function KollabAuth({
  onSave,
  onBack,
  detectedVersion,
  backLabel,
}: KollabAuthProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [authMethod, setAuthMethod] = useState<AuthMethod>("terminal");
  const [model, setModel] = useState(kollabTool.defaultModel);
  const [profiles, setProfiles] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/agent-profiles")
      .then((r) => r.json())
      .then((raw) => {
        const data = raw.data ?? raw;
        const all = (data.profiles ?? []) as {
          id: string;
          name: string;
          cli?: string;
        }[];
        const filtered = all.filter((p) => p.cli === "kollab");
        setProfiles(filtered);
        if (filtered.length > 0 && !model) setModel(filtered[0].id);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      const json = await res.json();
      const secret = (json.data?.secret as { name?: string } | undefined) ?? (json.secret as { name?: string } | undefined);
      onSave({
        authMethod: "api-key",
        model,
        secretName: secret?.name,
      });
    } catch {
      setError("failed to save secret");
    } finally {
      setSaving(false);
    }
  };

  const options: {
    key: AuthMethod;
    icon: typeof CommandSquareFilled;
    label: string;
    desc: string;
  }[] = [
    {
      key: "terminal",
      icon: CommandSquareFilled,
      label: "open in terminal",
      desc: "runs kollab --login openai",
    },
    {
      key: "api-key",
      icon: KeyFilled,
      label: "use an API key",
      desc: `set ${kollabCreds.envKey} as a secret`,
    },
  ];

  return (
    <motion.div
      data-source="components/onboarding/cli-auth/kollab-auth.tsx"
      key="kollab-auth"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
      className="space-y-5"
    >
      <div className="text-center">
        <h2 className="text-lg font-semibold mb-1">Configure Kollab</h2>
        {detectedVersion && (
          <p className="text-[10px] text-foreground/30">
            detected: {detectedVersion}
          </p>
        )}
      </div>

      <div className="space-y-2">
        {options.map((opt) => {
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

      <div className="min-h-[120px]">
        {authMethod === "terminal" && <TerminalAuthOption tool="kollab" />}

        {authMethod === "api-key" && (
          <SecretForm
            inline
            prefilledPreset={kollabCreds.envKey}
            onSave={handleApiKeySave}
            saving={saving}
            error={error}
          />
        )}
      </div>

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
            : kollabTool.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
        </select>
      </div>

      <div className="flex items-center justify-between pt-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-foreground/40 hover:text-foreground transition-colors"
        >
          <ArrowLeft2Filled className="h-3.5 w-3.5" />
          {backLabel ?? "back to tools"}
        </button>
        {authMethod === "terminal" && (
          <Button
            size="sm"
            disabled={saving}
            onClick={() => onSave({ authMethod: "login", model })}
          >
            save
          </Button>
        )}
      </div>
    </motion.div>
  );
}
