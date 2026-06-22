"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import { unwrapApiData, getApiErrorMessage } from "@/lib/api/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AddFilled, TrashFilled, RefreshFilled, TickCircleFilled, DocumentDownloadFilled,
  CloseCircleFilled, InfoCircleFilled, CopyFilled, MagicStarFilled,
  EyeFilled, EyeSlashFilled, ExportFilled, MagicStarFilled as FlaskConicalFilled,
} from "@aliimam/icons";
import { BotMessageSquare, ShieldTickFilled } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import { ClaudeAI, OpenAI as OpenAILogo, GoogleIcon } from "@aliimam/logos";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { useWorkspace } from "@/lib/ui-context/workspace-context";
import type { AgentProfile, AgentProfileProvider } from "@/lib/types";
import { useAgentProfiles } from "@/lib/hooks/use-agent-profiles";
import { AgentProfileWizard } from "@/components/agent/agent-profile-wizard";
import {
  DEFAULT_MARKETPLACE_AGENT_MODEL,
  PROVIDER_CREDENTIALS,
  getProviderColors,
  getProviderDisplayName,
} from "@/lib/agents/agent-provider-catalog";

// brand icons for AI providers
function ProviderBrandIcon({ provider, className }: { provider: string; className?: string }) {
  switch (provider.toLowerCase()) {
    case "claude":
      return <ClaudeAI className={className} />;
    case "agy":
    case "antigravity":
    case "gemini":
      return <GoogleIcon className={className} />;
    case "codex":
    case "opencode":
      return <OpenAILogo className={className} />;
    case "kollab":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
          <path d="M5 3h3v7.5L13.5 3H17l-6 8 6.5 10H14l-6-9.5V21H5z" />
        </svg>
      );
    default:
      return <BotMessageSquare className={className} />;
  }
}

// ── env var editor (reused from workspaces) ────────────────────────────────────

interface EnvEditorProps {
  env: Record<string, string>;
  onChange: (env: Record<string, string>) => void;
  providerCredentialKeys?: string[]; // keys that should be masked (e.g., ANTHROPIC_AUTH_TOKEN)
}

function EnvEditor({ env, onChange, providerCredentialKeys = [] }: EnvEditorProps) {
  const entries = Object.entries(env);
  const [secrets, setSecrets] = useState<Array<{ id: string; name: string }>>([]);
  const [secretDropdowns, setSecretDropdowns] = useState<Record<string, boolean>>({});
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  // fetch secrets on mount
  useEffect(() => {
    fetch("/api/secrets")
      .then((res) => res.json())
      .then((raw) => {
        const data = unwrapApiData<{ secrets?: Array<{ name: string }> }>(raw);
        if (data.secrets) {
          setSecrets(data.secrets.map((s) => ({ id: s.name, name: s.name })));
        }
      })
      .catch(() => {
        // ignore error
      });
  }, []);

  const add = () => onChange({ ...env, "": "" });
  const remove = (k: string) => {
    const next = { ...env };
    delete next[k];
    onChange(next);
  };
  const setKey = (oldKey: string, newKey: string) => {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) {
      next[k === oldKey ? newKey : k] = v;
    }
    onChange(next);
  };
  const setVal = (k: string, v: string) => onChange({ ...env, [k]: v });

  // insert secret reference
  const insertSecret = (key: string, secretName: string) => {
    setVal(key, `{secret:${secretName}}`);
    setSecretDropdowns((prev) => ({ ...prev, [key]: false }));
  };

  // auto-uppercase keys on blur
  const handleKeyBlur = (oldKey: string, newKey: string) => {
    if (newKey !== oldKey) {
      const upperKey = newKey.toUpperCase();
      setKey(oldKey, upperKey);
    }
  };

  // check if value is a secret reference
  const isSecretRef = (v: string) => /^\{secret:/.test(v);

  // check if key is a provider credential that should be masked
  const isProviderCred = (k: string) => providerCredentialKeys.includes(k);

  // toggle reveal for masked values
  const toggleReveal = (k: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  // format display value (mask provider creds unless revealed)
  const formatDisplayValue = (k: string, v: string) => {
    if (isSecretRef(v)) return v;
    if (isProviderCred(k) && !revealedKeys.has(k)) {
      return v.length > 0 ? "••••••••" : "";
    }
    return v;
  };

  return (
    <div className="space-y-1.5">
      {entries.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            className="h-7 text-xs font-mono w-36 shrink-0"
            placeholder="KEY"
            value={k}
            onChange={(e) => setKey(k, e.target.value)}
            onBlur={(e) => handleKeyBlur(k, e.target.value)}
          />
          <span className="text-foreground/30 text-xs">=</span>
          <div className="flex-1 relative">
            <Input
              className="h-7 text-xs font-mono w-full pr-16"
              placeholder="value or {secret:NAME}"
              value={isProviderCred(k) ? formatDisplayValue(k, v) : v}
              onChange={(e) => setVal(k, e.target.value)}
              type={isProviderCred(k) && !revealedKeys.has(k) && !isSecretRef(v) ? "password" : "text"}
            />
            {isSecretRef(v) && (
              <span className="absolute right-8 top-1/2 -translate-y-1/2 text-[9px] text-amber-400 font-mono">
                secret
              </span>
            )}
            <div className="absolute right-6 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {/* reveal button for provider credentials */}
              {isProviderCred(k) && v && !isSecretRef(v) && (
                <button
                  type="button"
                  onClick={() => toggleReveal(k)}
                  className="text-foreground/30 hover:text-foreground transition-colors"
                  title={revealedKeys.has(k) ? "Hide" : "Show"}
                >
                  {revealedKeys.has(k) ? <EyeSlashFilled className="h-3 w-3" /> : <EyeFilled className="h-3 w-3" />}
                </button>
              )}
              {secretDropdowns[k] ? (
                <div className="relative z-10">
                  <div
                    className="absolute right-0 top-0 w-32 bg-card border border-foreground/10 rounded-md shadow-lg py-1 max-h-32 overflow-y-auto"
                  >
                    {secrets.length === 0 ? (
                      <div className="text-[10px] text-muted-foreground px-2 py-1">
                        No secrets
                      </div>
                    ) : (
                      secrets.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => insertSecret(k, s.name)}
                          className="block w-full text-left text-[10px] px-2 py-1 hover:bg-accent whitespace-nowrap overflow-hidden text-ellipsis"
                          title={s.name}
                        >
                          {s.name}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => setSecretDropdowns((prev) => ({ ...prev, [k]: !prev[k] }))}
                className="text-foreground/30 hover:text-foreground transition-colors"
                title="Insert secret reference"
              >
                <FlaskConicalFilled className="h-3 w-3" />
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => remove(k)}
            className="text-foreground/30 hover:text-red-400 transition-colors shrink-0"
          >
            <CloseCircleFilled className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="text-[10px] text-foreground/40 hover:text-foreground transition-colors flex items-center gap-1 mt-1"
      >
        <AddFilled className="h-3 w-3" /> add variable
      </button>
    </div>
  );
}

// ── section label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-medium text-foreground/40 uppercase tracking-wider mb-3">
      {children}
    </p>
  );
}

// ── cli icon component ─────────────────────────────────────────────────────────

function CliIcon({ cli, className }: { cli: string; className?: string }) {
  const { color, bg } = getProviderColors(cli);
  return (
    <span className={`flex items-center justify-center h-7 w-7 rounded-lg shrink-0 ${bg} ${color} ${className || ""}`}>
      <ProviderBrandIcon provider={cli} className="h-3.5 w-3.5" />
    </span>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function AgentProfilesPage() {
  const { profiles, loading, refetch } = useAgentProfiles();
  const { fetchWithNamespace } = useNamespaceFetch();
  const { workspaceId, workspacePath } = useWorkspace();
  const router = useRouter();

  const [selected, setSelected] = useState<AgentProfile | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [advisorSaving, setAdvisorSaving] = useState(false);
  const [defaultSaving, setDefaultSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState("");

  // bundle install modal
  const [bundleModalOpen, setBundleModalOpen] = useState(false);
  const [bundles, setBundles] = useState<Array<{
    provider: AgentProfileProvider;
    name: string;
    logo: string;
    profiles: Array<{ id: string; name: string; installed: boolean }>;
  }>>([]);
  const [installingProvider, setInstallingProvider] = useState<AgentProfileProvider | null>(null);
  const [installResult, setInstallResult] = useState<Record<string, { installed: number; skipped: number; error?: string }>>({});

  // delete default modal
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [defaultPromoteId, setDefaultPromoteId] = useState<string | null>(null);

  // wizard modal
  const [wizardOpen, setWizardOpen] = useState(false);

  // edit form state
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editIsDefault, setEditIsDefault] = useState(false);
  const [editIsAdvisorDefault, setEditIsAdvisorDefault] = useState(false);
  const [editCli, setEditCli] = useState("");
  const [editModel, setEditModel] = useState("");
  const [editPipeFlag, setEditPipeFlag] = useState("");
  const [editPermissionFlag, setEditPermissionFlag] = useState("");
  const [editExtraArgs, setEditExtraArgs] = useState("");
  const [editDisallowedTools, setEditDisallowedTools] = useState("");
  const [editEnv, setEditEnv] = useState<Record<string, string>>({});
  const [editPreExec, setEditPreExec] = useState("");
  const [editReadiness, setEditReadiness] = useState("");
  const [editLogPath, setEditLogPath] = useState("");
  const [editLogFormat, setEditLogFormat] = useState("");

  // credential ui state
  const [showCredential, setShowCredential] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [launchingTest, setLaunchingTest] = useState(false);
  const [launchResult, setLaunchResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [secrets, setSecrets] = useState<Array<{ id: string; name: string }>>([]);
  const [credSecretDropdown, setCredSecretDropdown] = useState(false);

  // fetch secrets for credential picker
  useEffect(() => {
    fetch("/api/secrets")
      .then((res) => res.json())
      .then((raw) => {
        const data = unwrapApiData<{ secrets?: Array<{ name: string }> }>(raw);
        if (data.secrets) {
          setSecrets(data.secrets.map((s) => ({ id: s.name, name: s.name })));
        }
      })
      .catch(() => {
        // ignore
      });
  }, []);

  // derived: credential info for current cli
  const providerCred = PROVIDER_CREDENTIALS[editCli.toLowerCase()];
  const credValue = providerCred ? (editEnv[providerCred.envKey] || "") : "";
  const setCredValue = (v: string) => {
    if (!providerCred) return;
    setEditEnv({ ...editEnv, [providerCred.envKey]: v });
  };

  // helper: check if value is a secret reference
  const isSecretRef = (v: string) => /^\{secret:/.test(v);

  const formatReadiness = (readiness: AgentProfile["readiness"]) =>
    readiness ? JSON.stringify(readiness, null, 2) : "";

  const parseReadiness = (): AgentProfile["readiness"] | undefined => {
    const raw = editReadiness.trim();
    if (!raw) return undefined;

    const parsed = JSON.parse(raw) as AgentProfile["readiness"];
    if (!parsed || typeof parsed.enabled !== "boolean") {
      throw new Error("readiness JSON must include enabled as true or false");
    }
    return parsed;
  };

  const handleTestConnection = async () => {
    if (!selected) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetchWithNamespace(`/api/agent-profiles/${selected.id}/test`, {
        method: "POST",
      });
      const raw = await res.json();
      const data = unwrapApiData<{ message?: string }>(raw);
      if (res.ok) {
        setTestResult({ ok: true, message: data.message || "Connection successful" });
      } else {
        setTestResult({ ok: false, message: getApiErrorMessage(raw, "Connection failed") });
      }
    } catch {
      setTestResult({ ok: false, message: "Request failed" });
    } finally {
      setTesting(false);
    }
  };

  const handleLaunchTestSession = async () => {
    if (!selected) return;
    setLaunchingTest(true);
    setLaunchResult(null);
    try {
      const res = await fetchWithNamespace(`/api/agent-profiles/${selected.id}/test-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd: workspacePath || undefined,
          workspaceId: workspaceId || undefined,
        }),
      });
      const raw = await res.json();
      const data = unwrapApiData<{ runId?: string; chainId?: string; message?: string }>(raw);
      if (!res.ok || !data.runId) {
        setLaunchResult({ ok: false, message: getApiErrorMessage(raw, "Readiness test failed") });
        return;
      }

      setLaunchResult({ ok: true, message: data.message || `Started readiness test ${data.runId}` });
      router.push(`/runs/${encodeURIComponent(data.runId)}`);
    } catch {
      setLaunchResult({ ok: false, message: "Readiness test failed" });
    } finally {
      setLaunchingTest(false);
    }
  };

  // fetch bundles when modal opens
  const fetchBundles = useCallback(async () => {
    try {
      const res = await fetchWithNamespace("/api/agent-profiles/bundles");
      const data = await res.json();
      setBundles(data.bundles || []);
    } catch {
      setBundles([]);
    }
  }, [fetchWithNamespace]);

  useEffect(() => {
    if (bundleModalOpen) {
      setInstallResult({});
      fetchBundles();
    }
  }, [bundleModalOpen, fetchBundles]);

  const populateEdit = (p: AgentProfile) => {
    setEditName(p.name);
    setEditDescription(p.description || "");
    setEditIsDefault(p.isDefault);
    setEditIsAdvisorDefault(!!p.isAdvisorDefault);
    setEditCli(p.cli);
    setEditModel(p.model || "");
    setEditPipeFlag(p.pipe_flag || "");
    setEditPermissionFlag(p.permission_flag || "");
    setEditExtraArgs((p.extra_args || []).join(" "));
    setEditDisallowedTools(p.disallowed_tools || "");
    setEditEnv(p.env || {});
    setEditPreExec(p.pre_exec || "");
    setEditReadiness(formatReadiness(p.readiness));
    setEditLogPath(p.log_path || "");
    setEditLogFormat(p.log_format || "");
    setError("");
    setTestResult(null);
    setLaunchResult(null);
    setShowCredential(false);
  };

  const selectProfile = (p: AgentProfile) => {
    setIsNew(false);
    setSelected(p);
    populateEdit(p);
  };

  const startNew = () => {
    setSelected(null);
    setIsNew(true);
    setEditName("");
    setEditDescription("");
    setEditIsDefault(false);
    setEditIsAdvisorDefault(false);
    setEditCli("");
    setEditModel("");
    setEditPipeFlag("");
    setEditPermissionFlag("");
    setEditExtraArgs("");
    setEditDisallowedTools("");
    setEditEnv({});
    setEditPreExec("");
    setEditReadiness("");
    setEditLogPath("");
    setEditLogFormat("");
    setError("");
  };

  const cancel = () => {
    setSelected(null);
    setIsNew(false);
    setError("");
  };

  const handleSave = async () => {
    if (!editName.trim() || !editCli.trim()) {
      setError("name and CLI binary are required");
      return;
    }

    let readiness: AgentProfile["readiness"] | undefined;
    try {
      readiness = parseReadiness();
    } catch (error) {
      setError(error instanceof Error ? error.message : "readiness JSON is invalid");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const payload = {
        name: editName.trim(),
        description: editDescription.trim() || undefined,
        isDefault: editIsDefault,
        isAdvisorDefault: editIsAdvisorDefault,
        cli: editCli.trim(),
        model: editModel.trim() || undefined,
        pipe_flag: editPipeFlag.trim() || undefined,
        permission_flag: editPermissionFlag.trim() || undefined,
        extra_args: editExtraArgs.trim() ? editExtraArgs.trim().split(/\s+/).filter(Boolean) : [],
        disallowed_tools: editDisallowedTools.trim() || undefined,
        env: editEnv,
        pre_exec: editPreExec.trim() || undefined,
        readiness,
        log_path: editLogPath.trim() || undefined,
        log_format: editLogFormat.trim() || undefined,
      };

      let res;
      if (isNew) {
        res = await fetchWithNamespace("/api/agent-profiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else if (selected) {
        res = await fetchWithNamespace(`/api/agent-profiles/${selected.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      if (!res!) {
        setError("save failed");
        return;
      }

      const data = await res!.json();
      if (!res!.ok) {
        setError(getApiErrorMessage(data, "save failed"));
        return;
      }

      await refetch();
      if (isNew) {
        setSelected(data.profile);
        setIsNew(false);
      } else {
        setSelected(data.profile);
      }
      populateEdit(data.profile);
    } catch {
      setError("save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleSetProfileDefault = async () => {
    setError("");

    // new/unsaved profile: flag locally, persists when the profile is saved
    if (isNew || !selected) {
      setEditIsDefault(true);
      return;
    }

    setDefaultSaving(true);
    try {
      const res = await fetchWithNamespace(`/api/agent-profiles/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(getApiErrorMessage(data, "failed to set default profile"));
        return;
      }
      setEditIsDefault(true);
      setSelected((prev) => (prev ? { ...prev, isDefault: true } : prev));
      await refetch();
    } catch {
      setError("failed to set default profile");
    } finally {
      setDefaultSaving(false);
    }
  };

  const handleSetAdvisorDefault = async () => {
    setError("");

    if (isNew || !selected) {
      setEditIsAdvisorDefault(true);
      return;
    }

    setAdvisorSaving(true);
    try {
      const res = await fetchWithNamespace(`/api/agent-profiles/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAdvisorDefault: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(getApiErrorMessage(data, "failed to set advisor default"));
        return;
      }
      setEditIsAdvisorDefault(true);
      setSelected((prev) => prev ? { ...prev, isAdvisorDefault: true } : prev);
      await refetch();
    } catch {
      setError("failed to set advisor default");
    } finally {
      setAdvisorSaving(false);
    }
  };

  const handleCopy = async () => {
    if (!selected) return;
    const copyName = `${selected.name} (copy)`;
    const res = await fetchWithNamespace("/api/agent-profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: copyName,
        description: selected.description,
        isDefault: false,
        isAdvisorDefault: false,
        cli: selected.cli,
        model: selected.model,
        pipe_flag: selected.pipe_flag,
        permission_flag: selected.permission_flag,
        extra_args: selected.extra_args,
        disallowed_tools: selected.disallowed_tools,
        env: selected.env,
        pre_exec: selected.pre_exec,
        readiness: selected.readiness,
        log_path: selected.log_path,
        log_format: selected.log_format,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      await refetch();
      setSelected(data.profile);
      setIsNew(false);
      populateEdit(data.profile);
    }
  };

  const handleDeleteClick = (id: string) => {
    const profile = profiles.find((p) => p.id === id);
    if (!profile) return;
    if (profiles.length === 1) return; // can't delete last profile

    if (profile.isDefault && profiles.length > 1) {
      // show modal to pick new default
      setSelected(profile);
      setDeleteModalOpen(true);
    } else {
      // straight delete
      handleDelete(id);
    }
  };

  const handleDelete = async (id: string, promoteId?: string) => {
    setDeleting(id);
    try {
      let url = `/api/agent-profiles/${id}`;
      if (promoteId) {
        url += `?promote=${encodeURIComponent(promoteId)}`;
      }
      await fetchWithNamespace(url, { method: "DELETE" });
      if (selected?.id === id) {
        setSelected(null);
      }
      setDeleteModalOpen(false);
      setDefaultPromoteId(null);
      await refetch();
    } finally {
      setDeleting(null);
    }
  };

  const handleInstallBundle = async (provider: AgentProfileProvider) => {
    setInstallingProvider(provider);
    try {
      const res = await fetchWithNamespace("/api/agent-profiles/install-bundle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInstallResult((prev) => ({
          ...prev,
          [provider]: { installed: 0, skipped: 0, error: getApiErrorMessage(data, "Installation failed") },
        }));
        return;
      }
      setInstallResult((prev) => ({
        ...prev,
        [provider]: { installed: data.installed?.length || 0, skipped: data.skipped?.length || 0 },
      }));
      await refetch();
      await fetchBundles();
    } finally {
      setInstallingProvider(null);
    }
  };

  const canDelete = selected && profiles.length > 1;
  const isLastProfile = profiles.length === 1;

  const showDetail = isNew || selected !== null;

  return (
    <div className="h-[calc(100vh-2.5rem)] flex flex-col">
      <PageBanner
        title="Agent Configs"
        subtitle="CLI execution profiles for AI agents. Define provider, model, API keys, and environment variables per profile."
        icon={BotMessageSquare}
        sectionColor="#a0927b"
        actions={[
          { label: "Secrets", href: "/settings/secrets", icon: ShieldTickFilled, iconColor: "#a0927b" },
          { label: "Refresh", onClick: refetch, icon: RefreshFilled },
          { label: "Install Bundle", onClick: () => setBundleModalOpen(true), icon: DocumentDownloadFilled },
          { label: "Wizard", onClick: () => setWizardOpen(true), icon: MagicStarFilled, generate: true },
          { label: "New Profile", onClick: startNew, icon: AddFilled },
        ]}
        docs={[
          { label: "Agent Configs Docs", href: "/docs/config-profiles" },
        ]}
      />

      <div className="flex-1 flex min-h-0">
        {/* left: profile list */}
        <div className="w-64 shrink-0 flex flex-col overflow-y-auto">
          <div className="px-3 pt-3 pb-3">
            {loading ? (
              <div className="space-y-1">
                {[1, 2, 3].map((i) => <div key={i} className="h-12 bg-accent/50 rounded-md animate-pulse" />)}
              </div>
            ) : profiles.length === 0 ? (
              <div className="text-center py-8">
                <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center mx-auto mb-3">
                  <BotMessageSquare className="h-5 w-5 text-foreground/30" />
                </div>
                <p className="text-xs font-medium text-foreground/40 mb-1">No profiles yet</p>
                <p className="text-[10px] text-foreground/25 px-3">Install a bundle to get started</p>
              </div>
            ) : (() => {
              // group by provider
              const order: string[] = [];
              const groups: Record<string, typeof profiles> = {};
              for (const p of profiles) {
                const key = p.cli.toLowerCase();
                if (!groups[key]) { groups[key] = []; order.push(key); }
                groups[key].push(p);
              }
              return (
                <div className="space-y-4">
                  {order.map((cli) => (
                    <div key={cli}>
                      <p className="text-[10px] font-medium text-foreground/35 uppercase tracking-wider px-2 mb-1">
                        {getProviderDisplayName(cli)}
                      </p>
                      <div className="space-y-0.5">
                        {groups[cli].map((p) => {
                          const isActive = !isNew && selected?.id === p.id;
                          return (
                            <div
                              key={p.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => selectProfile(p)}
                              onKeyDown={(e) => { if (e.key === "Enter") selectProfile(p); }}
                              className={`w-full text-left px-2 py-2 rounded-md text-xs flex items-center gap-2.5 group transition-colors cursor-pointer ${
                                isActive ? "bg-accent" : "hover:bg-muted/60"
                              }`}
                            >
                              <CliIcon cli={p.cli} />
                              <div className="flex-1 min-w-0 space-y-1">
                                <div className="font-medium min-w-0">
                                  <span className="block truncate">{p.name}</span>
                                </div>
                                {(p.isDefault || p.isAdvisorDefault || p.model) && (
                                  <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                                    {p.isDefault && (
                                      <span className="text-[9px] text-primary bg-primary/15 px-1.5 py-0.5 rounded-full font-medium uppercase tracking-wide shrink-0">
                                        default
                                      </span>
                                    )}
                                    {p.isAdvisorDefault && (
                                      <span className="text-[9px] text-purple-300 bg-purple-500/15 px-1.5 py-0.5 rounded-full font-medium uppercase tracking-wide shrink-0">
                                        advisor
                                      </span>
                                    )}
                                    {p.model && (
                                      <span className="text-[10px] text-foreground/35 font-mono truncate min-w-0 max-w-full">
                                        {p.model}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteClick(p.id);
                                }}
                                className="shrink-0 opacity-0 group-hover:opacity-100 text-foreground/40 hover:text-red-400 transition-all disabled:opacity-30 disabled:hover:text-foreground/40"
                                disabled={isLastProfile}
                                title={isLastProfile ? "Can't delete the only profile" : "Delete profile"}
                              >
                                <TrashFilled className="h-3 w-3" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>

        {/* right: detail / form */}
        <div className="flex-1 overflow-y-auto border-l border-muted/30">
          {!showDetail ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <div className="w-14 h-14 rounded-2xl bg-muted/60 flex items-center justify-center mb-4">
                <BotMessageSquare className="h-7 w-7 text-foreground/20" />
              </div>
              <p className="text-sm font-medium text-foreground/50 mb-1.5">No profile selected</p>
              <p className="text-xs text-foreground/30 max-w-[220px] leading-relaxed">
                Pick a profile from the list to view and edit its CLI configuration
              </p>
              <button
                onClick={startNew}
                className="mt-5 text-xs text-foreground/40 hover:text-foreground transition-colors flex items-center gap-1.5"
              >
                <AddFilled className="h-3 w-3" />
                create new profile
              </button>
            </div>

          ) : (
            /* edit form */
            <div className="p-6 max-w-2xl space-y-8">

              {/* general */}
              <div>
                <SectionLabel>General</SectionLabel>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs text-foreground/50">Name</Label>
                    <Input
                      className="mt-1.5 h-9 text-xs"
                      placeholder="My Agent Profile"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-foreground/50">Description</Label>
                    <Input
                      className="mt-1.5 h-9 text-xs"
                      placeholder="optional"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={editIsDefault ? "secondary" : "outline"}
                      className="h-7 text-xs"
                      onClick={handleSetProfileDefault}
                      disabled={defaultSaving || editIsDefault}
                    >
                      <TickCircleFilled className="h-3.5 w-3.5 mr-1" />
                      {defaultSaving
                        ? "Setting..."
                        : editIsDefault
                          ? "Default profile"
                          : "Set as default profile"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={editIsAdvisorDefault ? "secondary" : "outline"}
                      className="h-7 text-xs"
                      onClick={handleSetAdvisorDefault}
                      disabled={advisorSaving || editIsAdvisorDefault}
                    >
                      <MagicStarFilled className="h-3.5 w-3.5 mr-1" />
                      {advisorSaving
                        ? "Setting..."
                        : editIsAdvisorDefault
                          ? "Default advisor"
                          : "Set as default advisor"}
                    </Button>
                    {isNew && (editIsDefault || editIsAdvisorDefault) && (
                      <span className="text-[10px] text-foreground/40">applies on save</span>
                    )}
                  </div>
                </div>
              </div>

              {/* cli config */}
              <div>
                <SectionLabel>CLI Config</SectionLabel>
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs text-foreground/50">CLI Binary</Label>
                      <Input
                        className="mt-1.5 h-9 text-xs font-mono"
                        placeholder="cc"
                        value={editCli}
                        onChange={(e) => setEditCli(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-foreground/50">Model</Label>
                      <Input
                        className="mt-1.5 h-9 text-xs font-mono"
                        placeholder={DEFAULT_MARKETPLACE_AGENT_MODEL}
                        value={editModel}
                        onChange={(e) => setEditModel(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs text-foreground/50">Pipe Flag</Label>
                      <Input
                        className="mt-1.5 h-9 text-xs font-mono"
                        placeholder="-p"
                        value={editPipeFlag}
                        onChange={(e) => setEditPipeFlag(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-foreground/50">Permission Flag</Label>
                      <Input
                        className="mt-1.5 h-9 text-xs font-mono"
                        placeholder="--permission-mode bypassPermissions"
                        value={editPermissionFlag}
                        onChange={(e) => setEditPermissionFlag(e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-foreground/50">Extra Args</Label>
                    <Input
                      className="mt-1.5 h-9 text-xs font-mono"
                      placeholder="--flag1 --flag2"
                      value={editExtraArgs}
                      onChange={(e) => setEditExtraArgs(e.target.value)}
                    />
                    <p className="mt-1 text-[10px] text-foreground/30">space-separated</p>
                  </div>
                  <div>
                    <Label className="text-xs text-foreground/50">Disallowed Tools</Label>
                    <Input
                      className="mt-1.5 h-9 text-xs font-mono"
                      placeholder="Write Edit MultiEdit NotebookEdit"
                      value={editDisallowedTools}
                      onChange={(e) => setEditDisallowedTools(e.target.value)}
                    />
                    <p className="mt-1 text-[10px] text-foreground/30">
                      space-separated CLI tool names to block. claude: passes as --disallowed-tools.
                      use for JSON-generation jobs so the model can&apos;t write files and narrate.
                    </p>
                  </div>
                </div>
              </div>

              {/* credentials */}
              {providerCred && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <SectionLabel>Credentials</SectionLabel>
                    {!isNew && selected && (
                      <div className="flex items-center gap-2">
                        {testResult && (
                          <span className={`text-[10px] ${testResult.ok ? "text-green-400" : "text-red-400"}`}>
                            {testResult.message}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={handleTestConnection}
                          disabled={testing || !credValue}
                          className="flex items-center gap-1 text-[10px] text-foreground/50 hover:text-foreground disabled:opacity-40 transition-colors"
                          title={!credValue ? "Enter API key first" : "Test connection"}
                        >
                          <FlaskConicalFilled className="h-3 w-3" />
                          {testing ? "testing..." : "Test connection"}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <Label className="text-xs text-foreground/50">{providerCred.label}</Label>
                        <a
                          href={providerCred.docsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-0.5 text-[10px] text-foreground/30 hover:text-foreground/60 transition-colors"
                        >
                          {providerCred.docsLabel}
                          <ExportFilled className="h-2.5 w-2.5" />
                        </a>
                      </div>
                      <div className="relative">
                        <Input
                          className="mt-0 h-9 text-xs font-mono pr-16"
                          type={showCredential ? "text" : "password"}
                          placeholder={providerCred.placeholder}
                          value={credValue}
                          onChange={(e) => setCredValue(e.target.value)}
                        />
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                          {/* secret picker dropdown */}
                          {credSecretDropdown && (
                            <div className="absolute right-0 top-6 w-40 bg-card border border-foreground/10 rounded-md shadow-lg py-1 z-10">
                              {secrets.length === 0 ? (
                                <div className="text-[10px] text-muted-foreground px-2 py-1">
                                  No secrets — <Link href="/settings/secrets" className="underline hover:text-foreground">create one</Link>
                                </div>
                              ) : (
                                secrets.map((s) => (
                                  <button
                                    key={s.id}
                                    type="button"
                                    onClick={() => {
                                      setCredValue(`{secret:${s.name}}`);
                                      setCredSecretDropdown(false);
                                    }}
                                    className="block w-full text-left text-[10px] px-2 py-1 hover:bg-accent whitespace-nowrap overflow-hidden text-ellipsis"
                                    title={s.name}
                                  >
                                    {s.name}
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => setCredSecretDropdown(!credSecretDropdown)}
                            className="text-foreground/30 hover:text-foreground transition-colors"
                            title="Pick a secret"
                          >
                            <FlaskConicalFilled className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowCredential(!showCredential)}
                            className="text-foreground/30 hover:text-foreground transition-colors"
                          >
                            {showCredential ? <EyeSlashFilled className="h-3.5 w-3.5" /> : <EyeFilled className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </div>
                      <p className="mt-1 text-[10px] text-foreground/30 flex items-center gap-2">
                        <span>Stored as <span className="font-mono">{providerCred.envKey}</span> env var</span>
                        {isSecretRef(credValue) && (
                          <span className="text-amber-400/80">(using secret reference)</span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* env vars */}
              <div>
                <SectionLabel>Environment Variables</SectionLabel>
                <EnvEditor
                  env={editEnv}
                  onChange={setEditEnv}
                  providerCredentialKeys={providerCred ? [providerCred.envKey] : []}
                />
              </div>

              {/* pre-exec script */}
              <div>
                <SectionLabel>Pre-Exec Script</SectionLabel>
                <p className="text-[10px] text-amber-400/80 flex items-center gap-1 mb-2">
                  <InfoCircleFilled className="h-3 w-3" />
                  Runs in the same shell as the CLI
                </p>
                <Textarea
                  className="text-xs font-mono h-24 resize-y"
                  placeholder="source ~/.bashrc&#10;nvm use 18&#10;export PATH=$PATH:/custom/bin"
                  value={editPreExec}
                  onChange={(e) => setEditPreExec(e.target.value)}
                />
                <p className="mt-1 text-[10px] text-foreground/30">Use for: nvm use, source ~/.bashrc, export PATH=...</p>
              </div>

              {/* readiness */}
              <div>
                <SectionLabel>Readiness</SectionLabel>
                <Textarea
                  className="text-xs font-mono h-48 resize-y"
                  placeholder={'{\n  "enabled": true,\n  "ready_patterns": [],\n  "blocked_patterns": [],\n  "recoverable_patterns": [],\n  "retry_patterns": []\n}'}
                  value={editReadiness}
                  onChange={(e) => setEditReadiness(e.target.value)}
                />
                <p className="mt-1 text-[10px] text-foreground/30">
                  JSON policy used before Mentiko sends the task into the CLI session.
                </p>
              </div>

              {/* logs */}
              <div>
                <SectionLabel>Logs</SectionLabel>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-foreground/50">JSON Logs Directory</Label>
                    <Input
                      className="mt-1.5 h-9 text-xs font-mono"
                      placeholder="~/.claude/projects/"
                      value={editLogPath}
                      onChange={(e) => setEditLogPath(e.target.value)}
                    />
                    <p className="mt-1 text-[10px] text-foreground/30">path where CLI stores session logs (~/ expanded at runtime)</p>
                  </div>
                  <div>
                    <Label className="text-xs text-foreground/50">Format</Label>
                    <Input
                      className="mt-1.5 h-9 text-xs font-mono"
                      placeholder="jsonl"
                      value={editLogFormat}
                      onChange={(e) => setEditLogFormat(e.target.value)}
                    />
                    <p className="mt-1 text-[10px] text-foreground/30">jsonl · json · sqlite</p>
                  </div>
                </div>
              </div>

              {/* actions */}
              <div className="flex items-center gap-2 pt-2 border-t border-muted/30">
                <Button size="sm" variant="ghost" className="text-xs" onClick={cancel}>Cancel</Button>
                <Button size="sm" className="text-xs" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </Button>
                {error && <p className="text-xs text-red-400 ml-2">{error}</p>}
                {!isNew && selected && (
                  <div className="ml-auto flex items-center gap-2">
                    {launchResult && (
                      <span className={`text-[10px] ${launchResult.ok ? "text-green-400" : "text-red-400"}`}>
                        {launchResult.message}
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs text-foreground/50 hover:text-foreground"
                      onClick={handleLaunchTestSession}
                      disabled={launchingTest}
                      title="Run a real chain through this profile's readiness gate"
                    >
                      <MagicStarFilled className="h-3.5 w-3.5 mr-1" />
                      {launchingTest ? "Running..." : "Run readiness"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs text-foreground/50 hover:text-foreground"
                      onClick={handleCopy}
                      title="Duplicate profile"
                    >
                      <CopyFilled className="h-3.5 w-3.5 mr-1" />
                      Copy
                    </Button>
                  </div>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className={`text-xs text-red-400 hover:text-red-400 hover:bg-red-500/10 ${isNew || !selected ? "ml-auto" : ""}`}
                  onClick={() => selected && handleDeleteClick(selected.id)}
                  disabled={!canDelete || deleting === selected?.id}
                  title={isLastProfile ? "Can't delete the only profile" : undefined}
                >
                  <TrashFilled className="h-3.5 w-3.5 mr-1" />
                  Delete
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* install bundle modal */}
      <Dialog open={bundleModalOpen} onOpenChange={setBundleModalOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Install Provider Bundle</DialogTitle>
            <DialogDescription>
              Click a provider to install its default agent profiles
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
            {bundles.map((bundle) => {
              const installedCount = bundle.profiles.filter((p) => p.installed).length;
              const totalCount = bundle.profiles.length;
              const isFullyInstalled = installedCount === totalCount && totalCount > 0;
              const isPartial = installedCount > 0 && installedCount < totalCount;
              const result = installResult[bundle.provider];

              return (
                <button
                  key={bundle.provider}
                  type="button"
                  disabled={installingProvider === bundle.provider}
                  onClick={() => handleInstallBundle(bundle.provider)}
                  className={`text-left p-3 rounded-md border transition-all ${
                    isFullyInstalled
                      ? "bg-green-500/10 border-green-500/30"
                      : isPartial
                        ? "bg-amber-500/10 border-amber-500/30"
                        : "bg-card border-muted/30 hover:border-muted hover:bg-muted/30"
                  } ${installingProvider === bundle.provider ? "opacity-50 cursor-wait" : ""}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className="h-8 w-8 rounded-md flex items-center justify-center"
                      dangerouslySetInnerHTML={{ __html: bundle.logo }}
                    />
                    <span className="text-sm font-medium">{bundle.name}</span>
                  </div>
                  <ul className="text-[10px] text-foreground/50 space-y-0.5">
                    {bundle.profiles.map((p) => (
                      <li key={p.id} className="flex items-center gap-1">
                        {p.installed ? <TickCircleFilled className="h-2.5 w-2.5 text-green-400" /> : <span className="w-2.5" />}
                        {p.name}
                      </li>
                    ))}
                  </ul>
                  {result && !result.error && (
                    <p className="text-[10px] text-foreground/60 mt-2">
                      Installed {result.installed}, skipped {result.skipped}
                    </p>
                  )}
                  {result && result.error && (
                    <p className="text-[10px] text-red-400 mt-2">{result.error}</p>
                  )}
                  {installingProvider === bundle.provider && (
                    <p className="text-[10px] text-foreground/40 mt-2">Installing...</p>
                  )}
                </button>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setBundleModalOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* delete default modal */}
      <Dialog open={deleteModalOpen} onOpenChange={setDeleteModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Default Profile</DialogTitle>
            <DialogDescription>
              Choose a new default profile before deleting
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 mt-4">
            {profiles
              .filter((p) => p.id !== selected?.id)
              .map((p) => (
                <label
                  key={p.id}
                  className={`flex items-center gap-2 p-2 rounded-md cursor-pointer transition-colors ${
                    defaultPromoteId === p.id ? "bg-accent" : "hover:bg-muted"
                  }`}
                >
                  <input
                    type="radio"
                    name="promote"
                    checked={defaultPromoteId === p.id}
                    onChange={() => setDefaultPromoteId(p.id)}
                    className="accent-foreground"
                  />
                  <CliIcon cli={p.cli} />
                  <span className="text-xs">{p.name}</span>
                </label>
              ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDeleteModalOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={!defaultPromoteId || deleting === selected?.id}
              onClick={() => selected && handleDelete(selected.id, defaultPromoteId!)}
            >
              Set as Default and Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* wizard modal */}
      <AgentProfileWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onSuccess={async () => {
          await refetch();
        }}
      />
    </div>
  );
}
