"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft2Filled,
  TickCircleFilled,
  CloseCircleFilled,
  KeyFilled,
  GlobalFilled,
  CommandSquareFilled,
} from "@aliimam/icons";
import { motion } from "motion/react";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { SecretForm } from "@/components/secrets/secret-form";
import {
  PROVIDER_CREDENTIALS,
  getAgentConfigOptionsForTool,
  getDefaultAgentConfigIdForTool,
} from "@/lib/agents/provider-config";
import { TerminalAuthOption } from "./terminal-auth-option";
import { WebViewport } from "@/components/ui/web-viewport";

interface ClaudeAuthProps {
  onSave: (config: {
    authMethod: "login" | "api-key" | "gateway";
    model?: string;
  }) => void;
  onBack: () => void;
  detectedVersion?: string;
  initialAuthMethod?: AuthOption;
  backLabel?: string;
}

type AuthOption = "login" | "api-key" | "gateway" | "terminal";

type LoginStatus = "idle" | "pending" | "complete" | "failed";

const claudeCreds = PROVIDER_CREDENTIALS.claude;
const claudeProfileOptions = getAgentConfigOptionsForTool("claude");

export function ClaudeAuth({ onSave, onBack, detectedVersion, initialAuthMethod, backLabel }: ClaudeAuthProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [authOption, setAuthOption] = useState<AuthOption>(initialAuthMethod ?? "api-key");
  const [model, setModel] = useState(getDefaultAgentConfigIdForTool("claude"));
  const [profiles, setProfiles] = useState<{id: string, name: string}[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // interactive login state
  const [loginStatus, setLoginStatus] = useState<LoginStatus>("idle");
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [showViewport, setShowViewport] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // gateway state
  const [gatewayUrl, setGatewayUrl] = useState("");
  const [gatewayToken, setGatewayToken] = useState("");

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
        const filtered = all.filter(p => p.cli === "claude");
        setProfiles(filtered);
        const options = filtered.length > 0 ? filtered : claudeProfileOptions;
        setModel((current) => (
          options.some((option) => option.id === current)
            ? current
            : options[0]?.id ?? ""
        ));
      })
      .catch(() => {});
  }, []);

  const startLogin = async () => {
    setLoginStatus("pending");
    setAuthUrl(null);
    setError("");
    try {
      const res = await fetchWithNamespace("/api/system/cli-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "claude" }),
      });
      if (!res.ok) {
        setLoginStatus("failed");
        setError("failed to start auth session");
        return;
      }
      const data = (await res.json()) as { sessionId?: string };
      if (!data.sessionId) {
        setLoginStatus("failed");
        setError("no session ID returned");
        return;
      }
      // start polling
      pollRef.current = setInterval(async () => {
        try {
          const pollRes = await fetchWithNamespace(
            `/api/system/cli-auth?sessionId=${data.sessionId}`
          );
          if (!pollRes.ok) return;
          const pollData = (await pollRes.json()) as {
            status?: "pending" | "complete" | "failed";
            authUrl?: string;
            error?: string;
          };
          if (pollData.authUrl && !authUrl) {
            setAuthUrl(pollData.authUrl);
            setShowViewport(true);
          }
          if (pollData.status === "complete") {
            stopPolling();
            setLoginStatus("complete");
            setShowViewport(false);
          } else if (pollData.status === "failed") {
            stopPolling();
            setLoginStatus("failed");
            setShowViewport(false);
            setError(pollData.error || "authentication failed");
          }
        } catch {
          // poll error, keep trying
        }
      }, 2000);
    } catch {
      setLoginStatus("failed");
      setError("network error");
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
        setError("failed to save secret");
        return;
      }
      onSave({ authMethod: "api-key", model });
    } catch {
      setError("failed to save secret");
    } finally {
      setSaving(false);
    }
  };

  const handleGatewaySave = async () => {
    if (!gatewayUrl.trim()) {
      setError("base URL is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      // save base URL
      await fetchWithNamespace("/api/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Anthropic Gateway URL",
          envVar: "ANTHROPIC_BASE_URL",
          value: gatewayUrl.trim(),
        }),
      });
      // save token if provided
      if (gatewayToken.trim()) {
        await fetchWithNamespace("/api/secrets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Anthropic Gateway Token",
            envVar: "ANTHROPIC_AUTH_TOKEN",
            value: gatewayToken.trim(),
          }),
        });
      }
      onSave({ authMethod: "gateway", model });
    } catch {
      setError("failed to save gateway config");
    } finally {
      setSaving(false);
    }
  };

  const handleLoginDone = () => {
    onSave({ authMethod: "login", model });
  };

  const showFooterSave = authOption === "login" || authOption === "gateway";
  const profileOptions = profiles.length > 0 ? profiles : claudeProfileOptions;

  const options: { key: AuthOption; icon: typeof KeyFilled; label: string; desc: string }[] = [
    {
      key: "api-key",
      icon: KeyFilled,
      label: "use an API key",
      desc: `set ${claudeCreds.envKey} as a secret`,
    },
    {
      key: "gateway",
      icon: GlobalFilled,
      label: "custom gateway",
      desc: "proxy through a custom API endpoint",
    },
    {
      key: "terminal",
      icon: CommandSquareFilled,
      label: "open in terminal",
      desc: "run auth interactively in the terminal",
    },
  ];

  return (
    <motion.div
      key="claude-auth"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
      className="space-y-5"
    >
      <div className="text-center">
        <h2 className="text-lg font-semibold mb-1">Configure Claude Code</h2>
        {detectedVersion && (
          <p className="text-[10px] text-foreground/30">
            detected: {detectedVersion}
          </p>
        )}
      </div>

      {/* auth option selector */}
      <div className="space-y-2">
        {options.map((opt) => {
          const Icon = opt.icon;
          const active = authOption === opt.key;
          const disabled = false;
          return (
            <button
              key={opt.key}
              type="button"
              disabled={disabled}
              onClick={() => {
                if (disabled) return;
                setAuthOption(opt.key);
                setError("");
              }}
              className={`w-full text-left p-3 rounded-md flex items-start gap-3 transition-all ${
                disabled
                  ? "bg-muted/30 opacity-40 cursor-not-allowed"
                  : active
                    ? "bg-accent ring-1 ring-foreground/10"
                    : "bg-muted hover:bg-accent/50"
              }`}
            >
              <div
                className={`mt-0.5 h-3.5 w-3.5 rounded-full border flex items-center justify-center ${
                  active && !disabled
                    ? "border-foreground/60 bg-foreground/10"
                    : "border-foreground/20"
                }`}
              >
                {active && !disabled && (
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
                sign in
              </Button>
            )}
            {loginStatus === "pending" && (
              <div className="space-y-2 text-center">
                {authUrl ? (
                  <>
                    {!showViewport && (
                      <button
                        type="button"
                        onClick={() => setShowViewport(true)}
                        className="w-full px-3 py-2 text-xs bg-muted hover:bg-accent rounded-md transition-colors"
                      >
                        open sign-in page
                      </button>
                    )}
                    <p className="text-[10px] text-foreground/30">
                      complete sign-in in the browser below
                    </p>
                    {showViewport && (
                      <WebViewport
                        url={authUrl}
                        mode="modal"
                        open={showViewport}
                        onClose={() => setShowViewport(false)}
                      />
                    )}
                  </>
                ) : (
                  <p className="text-xs text-foreground/50">
                    starting auth session...
                  </p>
                )}
                <div className="flex justify-center">
                  <div className="h-4 w-4 border-2 border-foreground/20 border-t-foreground/60 rounded-full animate-spin" />
                </div>
              </div>
            )}
            {loginStatus === "complete" && (
              <div className="flex items-center gap-2 justify-center text-green-400">
                <TickCircleFilled className="h-4 w-4" />
                <span className="text-sm">signed in</span>
              </div>
            )}
            {loginStatus === "failed" && (
              <div className="space-y-2 text-center">
                <div className="flex items-center gap-2 justify-center text-red-400">
                  <CloseCircleFilled className="h-4 w-4" />
                  <span className="text-xs">{error || "sign in failed"}</span>
                </div>
                <Button
                  onClick={() => {
                    setLoginStatus("idle");
                    setError("");
                  }}
                  variant="outline"
                  size="sm"
                >
                  try again
                </Button>
              </div>
            )}
          </div>
        )}

        {authOption === "api-key" && (
          <SecretForm
            inline
            prefilledPreset={claudeCreds.envKey}
            onSave={handleApiKeySave}
            saving={saving}
            error={error}
          />
        )}

        {authOption === "gateway" && (
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-foreground/50">base URL</label>
              <input
                type="text"
                placeholder="https://gateway.example.com/v1"
                value={gatewayUrl}
                onChange={(e) => setGatewayUrl(e.target.value)}
                className="w-full bg-muted rounded px-3 py-1.5 text-sm font-mono focus:outline-none focus:bg-accent"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-foreground/50">
                auth token{" "}
                <span className="text-foreground/30">(optional)</span>
              </label>
              <input
                type="password"
                placeholder="token..."
                value={gatewayToken}
                onChange={(e) => setGatewayToken(e.target.value)}
                className="w-full bg-muted rounded px-3 py-1.5 text-sm font-mono focus:outline-none focus:bg-accent"
              />
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>
        )}

        {authOption === "terminal" && (
          <TerminalAuthOption tool="claude" />
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
          {profileOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
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
          {backLabel ?? "back to tools"}
        </button>
        {showFooterSave && (
          <Button
            size="sm"
            disabled={
              saving ||
              (authOption === "login" && loginStatus !== "complete") ||
              (authOption === "gateway" && !gatewayUrl.trim())
            }
            onClick={() => {
              if (authOption === "login") handleLoginDone();
              else if (authOption === "gateway") handleGatewaySave();
            }}
          >
            {saving ? "saving..." : "save"}
          </Button>
        )}
      </div>
    </motion.div>
  );
}
