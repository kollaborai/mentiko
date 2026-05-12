"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft2Filled,
  ArrowRight2Filled,
  TickCircleFilled,
  SettingFilled,
} from "@aliimam/icons";
import { ClaudeAI, OpenAI as OpenAILogo, GoogleGemini } from "@aliimam/logos";
import { BotMessageSquare } from "@aliimam/icons";
import { motion, AnimatePresence } from "motion/react";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { CLI_TOOLS, getProviderColors } from "@/lib/provider-config";
import { ClaudeAuth } from "@/components/onboarding/cli-auth/claude-auth";
import { CodexAuth } from "@/components/onboarding/cli-auth/codex-auth";
import { GeminiAuth } from "@/components/onboarding/cli-auth/gemini-auth";
import { AiderAuth } from "@/components/onboarding/cli-auth/aider-auth";

interface ConfiguredTool {
  tool: string;
  authMethod: "login" | "api-key" | "gateway";
  model?: string;
}

interface DetectedTool {
  name: string;
  found: boolean;
  version?: string;
  path?: string;
  authenticated?: boolean;
}

interface CliSetupStepProps {
  configuredTools: ConfiguredTool[];
  onConfigureTool: (config: ConfiguredTool) => void;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  preloadedDetection?: DetectedTool[] | null;
}

// map onboarding tool id -> provider-bundles provider key
// (used to auto-install agent config profiles after auth save)
const TOOL_TO_BUNDLE: Record<string, string> = {
  claude: "claude-code",
  codex: "codex",
  gemini: "gemini",
  kollabor: "kollabor",
};

// top-level mode: provider picker, simple provider auth, or custom (full tool list)
type Mode = null | "claude" | "openai" | "gemini" | "custom";

// when in custom mode, which tool is selected for auth
type ActiveCustomTool = string | null;

function ProviderLogo({ id, className }: { id: string; className?: string }) {
  switch (id) {
    case "claude":
      return <ClaudeAI className={className} />;
    case "codex":
      return <OpenAILogo className={className} />;
    case "gemini":
      return <GoogleGemini className={className} />;
    case "kollabor":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
          <path d="M5 3h3v7.5L13.5 3H17l-6 8 6.5 10H14l-6-9.5V21H5z" />
        </svg>
      );
    default:
      return <BotMessageSquare className={className} />;
  }
}

const PROVIDERS = [
  {
    mode: "openai" as const,
    name: "OpenAI Codex",
    description: "sign in with ChatGPT/Codex",
    icon: OpenAILogo,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
  },
  {
    mode: "gemini" as const,
    name: "Gemini",
    description: "use an API key or CLI login",
    icon: GoogleGemini,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
  },
  {
    mode: "claude" as const,
    name: "Claude API Key",
    description: "use an Anthropic API key",
    icon: ClaudeAI,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
  },
  {
    mode: "custom" as const,
    name: "Custom",
    description: "configure a CLI tool manually",
    icon: SettingFilled,
    color: "text-foreground/50",
    bg: "bg-muted",
  },
];

export function CliSetupStep({
  configuredTools,
  onConfigureTool,
  onNext,
  onBack,
  onSkip,
  preloadedDetection,
}: CliSetupStepProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [detected, setDetected] = useState<DetectedTool[]>(preloadedDetection ?? []);
  const [detecting, setDetecting] = useState(!preloadedDetection);
  const [mode, setMode] = useState<Mode>(null);
  const [activeCustomTool, setActiveCustomTool] = useState<ActiveCustomTool>(null);

  const detectTools = useCallback(async () => {
    setDetecting(true);
    try {
      const res = await fetchWithNamespace("/api/system/detect-cli");
      if (res.ok) {
        const json = (await res.json()) as { data?: { tools?: DetectedTool[] }; tools?: DetectedTool[] };
        setDetected(json.data?.tools ?? json.tools ?? []);
      }
    } catch {
      // detection failed, continue with empty
    } finally {
      setDetecting(false);
    }
  }, [fetchWithNamespace]);

  // if preloaded data arrives after mount, use it
  useEffect(() => {
    if (preloadedDetection && detecting) {
      setDetected(preloadedDetection);
      setDetecting(false);
    }
  }, [preloadedDetection, detecting]);

  // fallback: fetch on mount if no preloaded data available
  useEffect(() => {
    if (!preloadedDetection) {
      detectTools();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isConfigured = (toolId: string) =>
    configuredTools.some((t) => t.tool === toolId);

  const getDetectedInfo = (toolId: string) =>
    detected.find((d) => d.name === toolId);

  const getDetectedVersion = (toolId: string) => {
    const info = getDetectedInfo(toolId);
    return info?.version;
  };

  const handleAuthSave = (
    toolId: string,
    config: { authMethod: "login" | "api-key" | "gateway"; model?: string }
  ) => {
    onConfigureTool({ tool: toolId, ...config });

    // fire-and-forget: install the provider's agent config bundle
    // so the user gets default profiles (e.g. Claude/Sonnet, Claude/Opus)
    const bundleProvider = TOOL_TO_BUNDLE[toolId];
    if (bundleProvider) {
      fetchWithNamespace("/api/agent-profiles/install-bundle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: bundleProvider }),
      }).catch(() => {
        // silent -- they can install from /settings/agent-configs later
      });
    }

    // go back to provider picker after save
    setMode(null);
    setActiveCustomTool(null);
  };

  // ── simple provider auth views (claude, openai, gemini) ──────────────

  if (mode === "claude") {
    return (
      <motion.div
        key="auth-claude-simple"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.3 }}
        className="space-y-4"
      >
        <ClaudeAuth
          onBack={() => setMode(null)}
          onSave={(config) => handleAuthSave("claude", config)}
          detectedVersion={getDetectedVersion("claude")}
          initialAuthMethod="api-key"
          backLabel="back"
        />
      </motion.div>
    );
  }

  if (mode === "openai") {
    return (
      <motion.div
        key="auth-openai-simple"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.3 }}
        className="space-y-4"
      >
        <CodexAuth
          onBack={() => setMode(null)}
          onSave={(config) => handleAuthSave("codex", config)}
          detectedVersion={getDetectedVersion("codex")}
          initialAuthMethod="login"
          backLabel="back"
        />
      </motion.div>
    );
  }

  if (mode === "gemini") {
    return (
      <motion.div
        key="auth-gemini-simple"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.3 }}
        className="space-y-4"
      >
        <GeminiAuth
          onBack={() => setMode(null)}
          onSave={(config) => handleAuthSave("gemini", config)}
          detectedVersion={getDetectedVersion("gemini")}
          initialAuthMethod="api-key"
          backLabel="back"
        />
      </motion.div>
    );
  }

  // ── custom mode: full tool picker (existing behavior) ────────────────

  if (mode === "custom") {
    // if a tool is selected in custom mode, show its auth view
    if (activeCustomTool) {
      const authProps = {
        onBack: () => setActiveCustomTool(null),
        detectedVersion: getDetectedVersion(activeCustomTool),
        backLabel: "back to tools",
      };

      return (
        <motion.div
          key={`auth-custom-${activeCustomTool}`}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.3 }}
          className="space-y-4"
        >
          <AnimatePresence mode="wait">
            {activeCustomTool === "claude" && (
              <ClaudeAuth
                key="claude"
                {...authProps}
                onSave={(config) => handleAuthSave("claude", config)}
              />
            )}
            {activeCustomTool === "codex" && (
              <CodexAuth
                key="codex"
                {...authProps}
                onSave={(config) => handleAuthSave("codex", config)}
              />
            )}
            {activeCustomTool === "gemini" && (
              <GeminiAuth
                key="gemini"
                {...authProps}
                onSave={(config) => handleAuthSave("gemini", config)}
              />
            )}
            {activeCustomTool === "aider" && (
              <AiderAuth
                key="aider"
                onBack={authProps.onBack}
                onSave={(config) => handleAuthSave("aider", config)}
                backLabel="back to tools"
              />
            )}
            {activeCustomTool === "kollabor" && (
              <ClaudeAuth
                key="kollabor"
                {...authProps}
                onSave={(config) => handleAuthSave("kollabor", config)}
              />
            )}
          </AnimatePresence>
        </motion.div>
      );
    }

    // custom tool list (all 5 CLI tools)
    return (
      <motion.div
        key="custom-tool-list"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.3 }}
        className="space-y-6"
      >
        <div className="text-center">
          <h2 className="text-lg font-semibold mb-1">Choose a CLI tool</h2>
          <p className="text-sm text-foreground/50">
            pick the tool you want to configure
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {CLI_TOOLS.map((tool) => {
            const detectedInfo = getDetectedInfo(tool.id);
            const configured = isConfigured(tool.id);
            const { bg } = getProviderColors(tool.id);

            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => !detecting && setActiveCustomTool(tool.id)}
                disabled={detecting}
                className={`relative text-left p-4 rounded-md transition-all ${
                  configured
                    ? `${bg} ring-1 ring-foreground/10`
                    : detecting
                      ? "bg-muted cursor-default"
                      : "bg-muted hover:bg-accent/50"
                }`}
              >
                {configured && (
                  <div className="absolute top-2 right-2">
                    <TickCircleFilled className="h-4 w-4 text-green-400" />
                  </div>
                )}
                <div className="flex items-center gap-2 mb-2">
                  <ProviderLogo
                    id={tool.id}
                    className={`h-5 w-5 ${detecting ? "text-foreground/30" : tool.color}`}
                  />
                  <span className={`text-sm font-medium ${detecting ? "text-foreground/50" : ""}`}>
                    {tool.name}
                  </span>
                </div>
                <p className="text-[10px] text-foreground/40 mb-1.5">
                  {tool.description}
                </p>
                {detecting ? (
                  <span className="inline-block h-4 w-16 rounded-full bg-foreground/10 animate-pulse" />
                ) : detectedInfo?.found ? (
                  <span className="inline-block text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400">
                    installed{detectedInfo.version ? ` ${detectedInfo.version}` : ""}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <p className="text-[10px] text-center text-foreground/30">
          you can add more tools later in settings
        </p>

        <div className="flex items-center justify-between">
          <button
            onClick={() => setMode(null)}
            className="flex items-center gap-1 text-xs text-foreground/40 hover:text-foreground transition-colors"
          >
            <ArrowLeft2Filled className="h-3.5 w-3.5" />
            back
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onSkip}
              className="text-xs text-foreground/30 hover:text-foreground/50 transition-colors"
            >
              skip
            </button>
            <Button
              onClick={onNext}
              disabled={configuredTools.length < 1}
              className="gap-2"
            >
              next
              <ArrowRight2Filled className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </motion.div>
    );
  }

  // ── provider picker (default view) ───────────────────────────────────

  return (
    <motion.div
      key="provider-picker"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      <div className="text-center">
        <h2 className="text-lg font-semibold mb-1">Connect your AI tools</h2>
        <p className="text-sm text-foreground/50">
          sign in with a provider to get started
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {PROVIDERS.map((provider) => {
          const Icon = provider.icon;
          // map provider mode to CLI tool id for detection lookup
          const toolId = provider.mode === "openai" ? "codex" : provider.mode === "custom" ? null : provider.mode;
          const configured = toolId ? isConfigured(toolId) : false;
          const detectedInfo = toolId ? getDetectedInfo(toolId) : null;
          const alreadyAuthed =
            provider.mode !== "claude" &&
            detectedInfo?.found &&
            detectedInfo?.authenticated;

          const handleClick = () => {
            if (configured) {
              // already configured, clicking again goes to auth to reconfigure
              setMode(provider.mode);
            } else if (alreadyAuthed && toolId) {
              // detected + authenticated: auto-save, skip auth flow
              handleAuthSave(toolId, { authMethod: "login" });
            } else {
              setMode(provider.mode);
            }
          };

          return (
            <button
              key={provider.mode}
              type="button"
              onClick={handleClick}
              className={`relative text-left p-4 rounded-md transition-all ${
                configured || alreadyAuthed
                  ? `${provider.bg} ring-1 ring-foreground/10`
                  : "bg-muted hover:bg-accent/50"
              }`}
            >
              {(configured || alreadyAuthed) && (
                <div className="absolute top-2 right-2">
                  <TickCircleFilled className="h-4 w-4 text-green-400" />
                </div>
              )}
              <div className="flex items-center gap-2 mb-2">
                <Icon className={`h-5 w-5 ${provider.color}`} />
                <span className="text-sm font-medium">
                  {provider.name}
                </span>
              </div>
              <p className="text-[10px] text-foreground/40">
                {alreadyAuthed && !configured ? "already signed in" : provider.description}
              </p>
            </button>
          );
        })}
      </div>

      <p className="text-[10px] text-center text-foreground/30">
        you can add more tools later in settings
      </p>

      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-foreground/40 hover:text-foreground transition-colors"
        >
          <ArrowLeft2Filled className="h-3.5 w-3.5" />
          back
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={onSkip}
            className="text-xs text-foreground/30 hover:text-foreground/50 transition-colors"
          >
            skip
          </button>
          <Button
            onClick={onNext}
            disabled={configuredTools.length < 1}
            className="gap-2"
          >
            next
            <ArrowRight2Filled className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
