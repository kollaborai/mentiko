"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  MonitorFilled as HardDrive,
  GlobalFilled as Globe,
  BoxFilled as Container,
  AddFilled as Plus,
  TrashFilled as Trash2,
  CloseCircleFilled as X,
  TickCircleFilled as CheckCircle2,
  InfoCircleFilled as AlertCircle,
  RotateFilled as Loader2,
  MagicStarFilled as FlaskConical,
} from "@aliimam/icons";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { useWorkspace } from "@/lib/ui-context/workspace-context";
import { getApiErrorMessage } from "@/lib/api/api-client";
import { getMissingAgentProfileId } from "@/lib/chains/chain-profile-settings";
import type { Workspace, WorkspaceExecution } from "@/lib/workspaces/workspace-storage";
import { isTaskProviderType, TASK_PROVIDER_META } from "@/lib/task-provider/types";
import type { TaskProviderType } from "@/lib/task-provider/types";

// ── env editor ────────────────────────────────────────────────────────────────

function EnvEditor({
  env,
  onChange,
}: {
  env: Record<string, string>;
  onChange: (env: Record<string, string>) => void;
}) {
  const entries = Object.entries(env);
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

  return (
    <div className="space-y-1.5">
      {entries.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input className="h-7 text-xs font-mono w-36 shrink-0" placeholder="KEY"
            value={k} onChange={(e) => setKey(k, e.target.value)} />
          <span className="text-foreground/30 text-xs">=</span>
          <Input className="h-7 text-xs font-mono flex-1" placeholder="value"
            value={v} onChange={(e) => setVal(k, e.target.value)} />
          <button type="button" onClick={() => remove(k)}
            className="text-foreground/30 hover:text-red-400 transition-colors shrink-0">
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button type="button" onClick={add}
        className="text-[10px] text-foreground/40 hover:text-foreground transition-colors flex items-center gap-1 mt-1">
        <Plus className="h-3 w-3" /> add variable
      </button>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-medium text-foreground/40 uppercase tracking-wider mb-3">
      {children}
    </p>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export function WorkspaceSettings({
  workspace,
  onSaved,
  onDelete,
}: {
  workspace: Workspace;
  onSaved: (updated: Workspace) => void;
  onDelete: () => void;
}) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const { refetch: refetchNav } = useWorkspace();

  const [agentProfiles, setAgentProfiles] = useState<Array<{ id: string; name: string; model?: string; isDefault?: boolean }>>([]);
  const [chains, setChains] = useState<Array<{ id: string; name: string }>>([]);

  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description || "");
  const [icon, setIcon] = useState(workspace.icon || "");
  const [execType, setExecType] = useState<"local" | "ssh" | "docker">(workspace.execution?.type || "local");
  const [ssh, setSsh] = useState({
    host: workspace.execution?.ssh?.host || "",
    user: workspace.execution?.ssh?.user || "",
    path: workspace.execution?.ssh?.path || "",
    key: workspace.execution?.ssh?.key || "~/.ssh/id_rsa",
    port: String(workspace.execution?.ssh?.port || 22),
  });
  const [docker, setDocker] = useState({
    container: workspace.execution?.docker?.container || "",
    path: workspace.execution?.docker?.path || "/workspace",
    user: workspace.execution?.docker?.user || "",
  });
  const [env, setEnv] = useState<Record<string, string>>(workspace.env || {});
  const [maxAgents, setMaxAgents] = useState(workspace.max_agents != null ? String(workspace.max_agents) : "");
  const [maxRounds, setMaxRounds] = useState(workspace.max_rounds != null ? String(workspace.max_rounds) : "");
  const [branch, setBranch] = useState(workspace.default_branch || "");
  const [agentProfile, setAgentProfile] = useState(workspace.default_agent_profile || "");
  const [projectGitUrl, setProjectGitUrl] = useState(workspace.project?.gitUrl || "");
  const [projectDefaultChain, setProjectDefaultChain] = useState(workspace.project?.defaultChain || "");

  const [autoRun, setAutoRun] = useState(workspace.auto_run || "inherit");
  const [autoApproveDecisions, setAutoApproveDecisions] = useState(
    workspace.auto_approve_decisions === true,
  );

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState("");

  // Task provider state
  const [taskProviderType, setTaskProviderType] = useState<TaskProviderType>(
    isTaskProviderType(workspace.taskProvider?.type) ? workspace.taskProvider.type : "native"
  );
  const [taskProviderCreds, setTaskProviderCreds] = useState<Record<string, string>>(
    workspace.taskProvider?.credentials ?? {}
  );
  const [taskProviderOptions, setTaskProviderOptions] = useState<Record<string, string>>(
    workspace.taskProvider?.options ?? {}
  );
  const [pingState, setPingState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [pingError, setPingError] = useState<string | null>(null);

  // Secrets for task provider credentials
  const [secrets, setSecrets] = useState<Array<{ id: string; name: string }>>([]);
  const [secretDropdowns, setSecretDropdowns] = useState<Record<string, boolean>>({});

  // Migration state for plain-text credentials
  const [needsMigration, setNeedsMigration] = useState(false);
  const [migrating, setMigrating] = useState(false);

  const [runtimeEnv, setRuntimeEnv] = useState<Record<string, string>>({});
  const [showRuntimeEnv, setShowRuntimeEnv] = useState(false);

  const taskProviderMeta = TASK_PROVIDER_META[taskProviderType as keyof typeof TASK_PROVIDER_META];
  const missingAgentProfileId = getMissingAgentProfileId(agentProfile, agentProfiles);

  // Check if credentials need migration (plain-text, not {secret:} references)
  useEffect(() => {
    const creds = workspace.taskProvider?.credentials;
    if (!creds) return;
    const hasPlainText = Object.values(creds).some(
      (v) => v && !v.match(/^\{secret:/)
    );
    setNeedsMigration(hasPlainText);
  }, [workspace.taskProvider]);

  // Insert secret reference into credential field
  const insertSecret = (fieldKey: string, secretName: string) => {
    setTaskProviderCreds((prev) => ({ ...prev, [fieldKey]: `{secret:${secretName}}` }));
    setSecretDropdowns((prev) => ({ ...prev, [fieldKey]: false }));
  };

  // Migrate plain-text credentials to secrets
  async function handleMigrateCredentials() {
    setMigrating(true);
    try {
      const creds = workspace.taskProvider?.credentials;
      if (!creds) return;

      const newCreds: Record<string, string> = {};
      const providerType = workspace.taskProvider?.type || "unknown";

      for (const [key, value] of Object.entries(creds)) {
        if (!value || value.match(/^\{secret:/)) {
          // Already a secret reference or empty, keep as-is
          newCreds[key] = value;
          continue;
        }

        // Create secret with predictable name
        const secretName = `workspace-${workspace.id}-${providerType}-${key}`;
        const envVar = key.toUpperCase();

        // Create secret
        const createRes = await fetchWithNamespace("/api/secrets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: secretName,
            envVar,
            value,
          }),
        });

        if (!createRes.ok) {
          const data = await createRes.json();
          throw new Error(getApiErrorMessage(data, "Failed to create secret"));
        }

        // Reference the new secret
        newCreds[key] = `{secret:${secretName}}`;
      }

      // Update workspace config with secret references
      await fetchWithNamespace(`/api/workspaces/${encodeURIComponent(workspace.id)}/task-provider`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: providerType,
          credentials: newCreds,
          options: workspace.taskProvider?.options,
        }),
      });

      // Update local state
      setTaskProviderCreds(newCreds);
      setNeedsMigration(false);
    } catch (err) {
      console.error("Migration failed:", err);
      alert(err instanceof Error ? err.message : "Migration failed");
    } finally {
      setMigrating(false);
    }
  }

  async function handlePingTaskProvider() {
    setPingState("loading");
    setPingError(null);
    try {
      // Save config first, then ping
      await fetchWithNamespace(`/api/workspaces/${encodeURIComponent(workspace.id)}/task-provider`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: taskProviderType,
          credentials: taskProviderCreds,
          options: taskProviderOptions,
        }),
      });
      const res = await fetchWithNamespace(
        `/api/workspaces/${encodeURIComponent(workspace.id)}/task-provider`,
        { method: "POST" }
      );
      const raw = await res.json();
      const data = raw as { ok?: boolean; error?: string };
      if (data.ok) {
        setPingState("ok");
      } else {
        setPingState("error");
        setPingError(getApiErrorMessage(data, "Connection failed"));
      }
    } catch (err) {
      setPingState("error");
      setPingError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  async function handleSaveTaskProvider() {
    await fetchWithNamespace(`/api/workspaces/${encodeURIComponent(workspace.id)}/task-provider`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: taskProviderType,
        credentials: taskProviderCreds,
        options: taskProviderOptions,
      }),
    });
  }

  useEffect(() => {
    fetchWithNamespace("/api/agent-profiles")
      .then((r) => r.json())
      .then((raw) => {
        const d = raw as { profiles?: Array<{ id: string; name: string; model?: string; isDefault?: boolean }> };
        setAgentProfiles(d.profiles || []);
      })
      .catch(() => {});
    fetchWithNamespace("/api/chains")
      .then((r) => r.json())
      .then((raw) => {
        const d = raw as { chains?: Array<{ id: string; name: string }> };
        setChains((d.chains || []).map((c) => ({ id: c.id, name: c.name })));
      })
      .catch(() => {});
    // Fetch secrets for task provider credential selection
    fetchWithNamespace("/api/secrets")
      .then((r) => r.json())
      .then((raw) => {
        const d = raw as { secrets?: Array<{ name: string }> };
        if (d.secrets) {
          setSecrets(d.secrets.map((s) => ({ id: s.name, name: s.name })));
        }
      })
      .catch(() => {});
    // Fetch platform runtime env vars (read-only display)
    fetchWithNamespace("/api/runtime-env")
      .then((r) => r.json())
      .then((raw) => {
        const d = raw as { vars?: Record<string, string> };
        if (d.vars) setRuntimeEnv(d.vars);
      })
      .catch(() => {});
  }, [fetchWithNamespace]);

  const buildExecution = (): WorkspaceExecution => {
    if (execType === "ssh") {
      return {
        type: "ssh",
        ssh: {
          host: ssh.host,
          user: ssh.user,
          path: ssh.path,
          key: ssh.key || undefined,
          port: parseInt(ssh.port) || 22,
        },
      };
    }
    if (execType === "docker") {
      return {
        type: "docker",
        docker: {
          container: docker.container,
          path: docker.path || undefined,
          user: docker.user || undefined,
        },
      };
    }
    return { type: "local" };
  };

  const handleSave = async () => {
    if (execType === "ssh" && (!ssh.host || !ssh.user || !ssh.path)) {
      setError("SSH requires host, user, and path");
      return;
    }
    if (execType === "docker" && !docker.container) {
      setError("Docker requires a container name");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetchWithNamespace(`/api/workspaces/${encodeURIComponent(workspace.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || undefined,
          description: description || undefined,
          icon: icon || undefined,
          execution: buildExecution(),
          env: Object.keys(env).length ? env : undefined,
          max_agents: maxAgents ? parseInt(maxAgents) : undefined,
          max_rounds: maxRounds ? parseInt(maxRounds) : undefined,
          default_branch: branch || undefined,
          default_agent_profile: agentProfile || undefined,
          auto_run: autoRun as "enabled" | "disabled" | "inherit",
          auto_approve_decisions: autoApproveDecisions,
          project: (projectGitUrl || projectDefaultChain)
            ? { gitUrl: projectGitUrl || undefined, defaultChain: projectDefaultChain || undefined }
            : undefined,
        }),
      });
      const raw = await res.json();
      if (!res.ok) { setError(getApiErrorMessage(raw, "failed to save")); return; }
      const data = raw as { workspace?: Workspace };
      await refetchNav();
      if (data.workspace) onSaved(data.workspace);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await fetchWithNamespace(`/api/workspaces/${encodeURIComponent(workspace.id)}`, { method: "DELETE" });
      onDelete();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl space-y-8 overflow-y-auto h-full">

      {/* general */}
      <div>
        <SectionLabel>General</SectionLabel>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-foreground/50">Name</Label>
              <Input className="mt-1.5 h-9 text-xs" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-foreground/50">Default Branch</Label>
              <Input className="mt-1.5 h-9 text-xs font-mono" placeholder="main"
                value={branch} onChange={(e) => setBranch(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-xs text-foreground/50">Description</Label>
            <Input className="mt-1.5 h-9 text-xs" placeholder="optional"
              value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="bg-card rounded-md p-3 text-[10px] font-mono text-foreground/40">
            {workspace.path}
          </div>
        </div>
      </div>

      {/* icon */}
      <div>
        <SectionLabel>Icon</SectionLabel>
        <div className="flex items-start gap-3">
          <Textarea className="flex-1 text-xs font-mono h-20 resize-none"
            placeholder={'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">...</svg>'}
            value={icon} onChange={(e) => setIcon(e.target.value)} />
          {icon && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&>svg]:h-6 [&>svg]:w-6"
              dangerouslySetInnerHTML={{ __html: icon }} />
          )}
        </div>
      </div>

      {/* execution */}
      <div>
        <SectionLabel>Execution</SectionLabel>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-foreground/50">Environment</Label>
            <Select value={execType} onValueChange={(v) => setExecType(v as typeof execType)}>
              <SelectTrigger className="mt-1.5 h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local" className="text-xs">
                  <span className="flex items-center gap-2"><HardDrive className="h-3.5 w-3.5" /> Local</span>
                </SelectItem>
                <SelectItem value="ssh" className="text-xs">
                  <span className="flex items-center gap-2"><Globe className="h-3.5 w-3.5" /> SSH</span>
                </SelectItem>
                <SelectItem value="docker" className="text-xs">
                  <span className="flex items-center gap-2"><Container className="h-3.5 w-3.5" /> Docker</span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {execType === "ssh" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-xs text-foreground/50">Host</Label>
                <Input className="mt-1.5 h-9 text-xs font-mono" placeholder="build-server.internal"
                  value={ssh.host} onChange={(e) => setSsh((s) => ({ ...s, host: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs text-foreground/50">User</Label>
                <Input className="mt-1.5 h-9 text-xs font-mono" placeholder="ubuntu"
                  value={ssh.user} onChange={(e) => setSsh((s) => ({ ...s, user: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs text-foreground/50">Port</Label>
                <Input className="mt-1.5 h-9 text-xs font-mono" placeholder="22"
                  value={ssh.port} onChange={(e) => setSsh((s) => ({ ...s, port: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs text-foreground/50">Remote Path</Label>
                <Input className="mt-1.5 h-9 text-xs font-mono" placeholder="/home/ubuntu/project"
                  value={ssh.path} onChange={(e) => setSsh((s) => ({ ...s, path: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs text-foreground/50">SSH Key</Label>
                <Input className="mt-1.5 h-9 text-xs font-mono" placeholder="~/.ssh/id_rsa"
                  value={ssh.key} onChange={(e) => setSsh((s) => ({ ...s, key: e.target.value }))} />
              </div>
            </div>
          )}

          {execType === "docker" && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-foreground/50">Container</Label>
                <Input className="mt-1.5 h-9 text-xs font-mono" placeholder="dev-container"
                  value={docker.container} onChange={(e) => setDocker((d) => ({ ...d, container: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-foreground/50">Working Dir</Label>
                  <Input className="mt-1.5 h-9 text-xs font-mono" placeholder="/workspace"
                    value={docker.path} onChange={(e) => setDocker((d) => ({ ...d, path: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs text-foreground/50">User (optional)</Label>
                  <Input className="mt-1.5 h-9 text-xs font-mono" placeholder="vscode"
                    value={docker.user} onChange={(e) => setDocker((d) => ({ ...d, user: e.target.value }))} />
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-foreground/50">Max Agents</Label>
              <Input className="mt-1.5 h-9 text-xs" type="number" placeholder="4"
                value={maxAgents} onChange={(e) => setMaxAgents(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-foreground/50">Max Rounds</Label>
              <Input className="mt-1.5 h-9 text-xs" type="number" placeholder="10"
                value={maxRounds} onChange={(e) => setMaxRounds(e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      {/* auto-run */}
      <div>
        <SectionLabel>Auto-Run</SectionLabel>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-foreground/50">Chain Auto-Run</Label>
            <div className="mt-1.5 flex h-9 w-full rounded-md bg-muted p-0.5 text-xs">
              {(["inherit", "enabled", "disabled"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setAutoRun(value)}
                  className={`flex-1 rounded-[5px] transition-colors ${
                    autoRun === value
                      ? "bg-accent text-foreground"
                      : "text-foreground/50 hover:text-foreground/80"
                  }`}
                >
                  {value === "inherit" ? "Inherit" : value === "enabled" ? "Enabled" : "Disabled"}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-foreground/30">
              {autoRun === "inherit"
                ? "Uses the system-level auto-run setting"
                : autoRun === "enabled"
                ? "Chains will auto-start when tasks are ready"
                : "Chains will never auto-start in this workspace"}
            </p>
          </div>
          <label className="flex items-start gap-2.5 rounded-md border border-amber-500/20 bg-amber-500/5 p-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 h-3.5 w-3.5 accent-amber-500"
              checked={autoApproveDecisions}
              onChange={(event) => setAutoApproveDecisions(event.target.checked)}
            />
            <span>
              <span className="block text-xs text-foreground/80">Auto-approve decision recommendations</span>
              <span className="mt-1 block text-[10px] text-foreground/40">
                Automatically selects the recommended option, generates its plan, and creates the resulting tasks. Decisions without a valid recommendation remain paused.
              </span>
            </span>
          </label>
        </div>
      </div>

      {/* project */}
      <div>
        <SectionLabel>Project</SectionLabel>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-foreground/50">Git URL</Label>
            <Input className="mt-1.5 h-9 text-xs font-mono" placeholder="https://github.com/org/repo.git"
              value={projectGitUrl} onChange={(e) => setProjectGitUrl(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs text-foreground/50">Default Chain</Label>
            {chains.length > 0 ? (
              <Select
                value={projectDefaultChain || "__none__"}
                onValueChange={(v) => setProjectDefaultChain(v === "__none__" ? "" : v)}
              >
                <SelectTrigger className="mt-1.5 h-9 text-xs">
                  <SelectValue placeholder="none" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-xs">None</SelectItem>
                  {chains.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input className="mt-1.5 h-9 text-xs font-mono" placeholder="chain-id"
                value={projectDefaultChain} onChange={(e) => setProjectDefaultChain(e.target.value)} />
            )}
            <p className="mt-1 text-[10px] text-foreground/30">Chain run by default for this project.</p>
          </div>
        </div>
      </div>

      {/* agent profile */}
      <div>
        <SectionLabel>Agent Profile</SectionLabel>
        <Select
          value={agentProfile || "__default__"}
          onValueChange={(v) => setAgentProfile(v === "__default__" ? "" : v)}
        >
          <SelectTrigger className="h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__default__" className="text-xs">Use namespace default</SelectItem>
            {missingAgentProfileId && (
              <SelectItem value={missingAgentProfileId} className="text-xs">
                Profile not found - {missingAgentProfileId}
              </SelectItem>
            )}
            {agentProfiles.map((p) => (
              <SelectItem key={p.id} value={p.id} className="text-xs">
                {p.name}{p.model ? ` — ${p.model}` : ""}{p.isDefault ? " (default)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(() => {
          const resolved = agentProfile
            ? agentProfiles.find((p) => p.id === agentProfile)
            : agentProfiles.find((p) => p.isDefault);
          if (resolved) {
            return (
              <p className="mt-1 text-[10px] text-foreground/40">
                Resolves to <span className="text-foreground/70 font-mono">{resolved.name}</span>
                {resolved.model ? <span className="text-foreground/40"> — {resolved.model}</span> : null}
              </p>
            );
          }
          if (agentProfile) {
            return (
              <p className="mt-1 text-[10px] text-amber-400">
                ⚠ Profile not found — will fall back to namespace default
              </p>
            );
          }
          return (
            <p className="mt-1 text-[10px] text-amber-400">
              ⚠ No namespace default set. Agents and floating terminal won&apos;t inherit credentials.{" "}
              <a href="/settings/agent-configs" className="underline">Set one</a>
            </p>
          );
        })()}
        <p className="mt-1 text-[10px] text-foreground/30">
          Default agent profile for all chains in this workspace.{" "}
          <a href="/settings/agent-configs" className="text-foreground/50 hover:text-foreground underline">
            Manage profiles
          </a>
        </p>
      </div>

      {/* task provider */}
      <div>
        <SectionLabel>Task Provider</SectionLabel>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-foreground/50">Provider</Label>
            <select
              value={taskProviderType}
              onChange={(e) => {
                setTaskProviderType(e.target.value as TaskProviderType);
                setTaskProviderCreds({});
                setTaskProviderOptions({});
                setPingState("idle");
              }}
              className="mt-1.5 w-full h-9 px-3 rounded-md bg-muted border border-foreground/10 text-xs"
            >
              {Object.values(TASK_PROVIDER_META).map((p) => (
                <option key={p.type} value={p.type}>{p.name}</option>
              ))}
            </select>
            <p className="mt-1 text-[10px] text-foreground/30">{taskProviderMeta?.description}</p>
          </div>

          {taskProviderMeta?.fields.map((field) => {
            const value = taskProviderCreds[field.key] ?? "";
            const isSecretRef = value.match(/^\{secret:/);
            return (
              <div key={field.key}>
                <Label className="text-xs text-foreground/50">{field.label}</Label>
                <div className="relative mt-1.5">
                  <Input
                    className="h-9 text-xs font-mono pr-16"
                    type={field.type === "secret" && !isSecretRef ? "password" : "text"}
                    placeholder={field.placeholder || field.description}
                    value={value}
                    onChange={(e) => setTaskProviderCreds((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  />
                  {isSecretRef && (
                    <span className="absolute right-8 top-1/2 -translate-y-1/2 text-[9px] text-amber-400 font-mono">
                      secret
                    </span>
                  )}
                  {field.type === "secret" && (
                    <div className="absolute right-6 top-1/2 -translate-y-1/2 flex items-center gap-1">
                      {secretDropdowns[field.key] && (
                        <div className="relative z-10">
                          <div className="absolute right-0 top-6 w-40 bg-card border border-foreground/10 rounded-md shadow-lg py-1 max-h-32 overflow-y-auto">
                            {secrets.length === 0 ? (
                              <div className="text-[10px] text-muted-foreground px-2 py-1">
                                No secrets
                              </div>
                            ) : (
                              secrets.map((s) => (
                                <button
                                  key={s.id}
                                  type="button"
                                  onClick={() => insertSecret(field.key, s.name)}
                                  className="block w-full text-left text-[10px] px-2 py-1 hover:bg-accent whitespace-nowrap overflow-hidden text-ellipsis"
                                  title={s.name}
                                >
                                  {s.name}
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => setSecretDropdowns((prev) => ({ ...prev, [field.key]: !prev[field.key] }))}
                        className="text-foreground/30 hover:text-foreground transition-colors"
                        title="Insert secret reference"
                      >
                        <FlaskConical className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
                {field.description && (
                  <p className="mt-0.5 text-[10px] text-foreground/30">{field.description}</p>
                )}
              </div>
            );
          })}

          {/* Migration prompt for plain-text credentials */}
          {needsMigration && taskProviderMeta?.fields.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-md p-3 space-y-2">
              <p className="text-[10px] text-amber-200">
                <strong>Security:</strong> This workspace stores API keys in plain text. Migrate to encrypted secrets?
              </p>
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={handleMigrateCredentials}
                disabled={migrating}
              >
                {migrating ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Plus className="h-3 w-3 mr-1" />}
                {migrating ? "Migrating..." : "Migrate to Secrets"}
              </Button>
            </div>
          )}

          {taskProviderMeta?.fields.length > 0 && (
            <div className="flex items-center gap-3 pt-1">
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={handlePingTaskProvider}
                disabled={pingState === "loading"}
              >
                {pingState === "loading" ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : pingState === "ok" ? (
                  <CheckCircle2 className="h-3 w-3 mr-1 text-green-400" />
                ) : pingState === "error" ? (
                  <AlertCircle className="h-3 w-3 mr-1 text-red-400" />
                ) : null}
                Test Connection
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-xs"
                onClick={handleSaveTaskProvider}
              >
                Save Provider
              </Button>
              {pingState === "ok" && (
                <span className="text-[10px] text-green-400">Connected</span>
              )}
              {pingError && (
                <span className="text-[10px] text-red-400">{pingError}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* env */}
      <div>
        <SectionLabel>Environment Variables</SectionLabel>
        <EnvEditor env={env} onChange={setEnv} />

        {/* runtime env (read-only) */}
        {Object.keys(runtimeEnv).length > 0 && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowRuntimeEnv(!showRuntimeEnv)}
              className="text-[10px] text-foreground/40 hover:text-foreground transition-colors flex items-center gap-1"
            >
              <span className={`inline-block transition-transform ${showRuntimeEnv ? "rotate-90" : ""}`}>&#9654;</span>
              platform runtime ({Object.keys(runtimeEnv).length} vars)
            </button>
            {showRuntimeEnv && (
              <div className="mt-2 space-y-1 opacity-60">
                {Object.entries(runtimeEnv).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-1.5">
                    <span className="h-7 text-xs font-mono w-36 shrink-0 flex items-center text-foreground/50">{k}</span>
                    <span className="text-foreground/30 text-xs">=</span>
                    <span className="h-7 text-xs font-mono flex-1 flex items-center text-foreground/40 truncate" title={v}>{v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-muted/30">
        <Button size="sm" className="text-xs" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
        {error && <p className="text-xs text-red-400">{error}</p>}

        {!showDeleteConfirm ? (
          <Button
            size="sm" variant="ghost"
            className="text-xs text-red-400 hover:text-red-400 hover:bg-red-500/10 ml-auto"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Remove Workspace
          </Button>
        ) : (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-foreground/50">Remove this workspace?</span>
            <Button size="sm" variant="ghost" className="text-xs" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button
              size="sm" variant="ghost"
              className="text-xs text-red-400 hover:text-red-400 hover:bg-red-500/10"
              onClick={handleDelete}
              disabled={deleting}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              {deleting ? "Removing..." : "Remove"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
