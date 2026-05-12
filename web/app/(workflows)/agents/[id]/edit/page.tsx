"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft1Filled as ArrowLeft, ExportFilled as Save, RotateFilled as Loader2, RotateLeftFilled as RotateCcw } from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import type { RegistryAgent } from "@/app/api/agents/registry/route";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import type { ArtifactTemplate } from "@/lib/artifact-template-storage";

interface AgentForm {
  id: string;
  name: string;
  description: string;
  role: string;
  version: string;
  prompt: string;
  triggers: string;
  emits: string;
  model: string;
  timeout: string;
  max_retries: string;
  backoff: string;
  tools: string;
  context_workspace: string;
  context_read_first: string;
  authorities_can: string;
  authorities_needs_approval: string;
  artifact_template: string;
}

function serializeForm(agent: RegistryAgent): AgentForm {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description || "",
    role: agent.role || "",
    version: "1.0.0",
    prompt: agent.prompt || "",
    triggers: agent.triggers.join(", ") || "",
    emits: agent.emits || "",
    model: agent.model || "",
    timeout: agent.timeout?.toString() || "",
    max_retries: agent.retry?.max_retries?.toString() || "3",
    backoff: agent.retry?.backoff || "exponential",
    tools: agent.tools?.join(", ") || "",
    context_workspace: agent.context?.workspace || "",
    context_read_first: agent.context?.read_first?.join(", ") || "",
    authorities_can: agent.authorities?.can?.join(", ") || "",
    authorities_needs_approval: agent.authorities?.needs_approval?.join(", ") || "",
    artifact_template: (agent as RegistryAgent & { artifact_template?: string }).artifact_template || "",
  };
}

function parseCommaList(value: string): string[] {
  if (!value.trim()) return [];
  return value.split(",").map(s => s.trim()).filter(Boolean);
}

export default function AgentEditPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { fetchWithNamespace } = useNamespaceFetch();

  const [agent, setAgent] = useState<RegistryAgent | null>(null);
  const [form, setForm] = useState<AgentForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [artifactTemplates, setArtifactTemplates] = useState<ArtifactTemplate[]>([]);

  const fetchAgent = useCallback(async () => {
    try {
      const res = await fetchWithNamespace("/api/agents/registry");
      const data = await res.json();
      const found = data.agents?.find((a: RegistryAgent) => a.id === params.id);
      if (!found) {
        setError("Agent not found");
        return;
      }
      if (found.source !== "standalone") {
        setError("Only standalone agents can be edited");
        return;
      }
      setAgent(found);
      setForm(serializeForm(found));
    } catch {
      setError("Failed to load agent");
    } finally {
      setLoading(false);
    }
  }, [fetchWithNamespace, params.id]);

  useEffect(() => {
    fetchAgent();
    fetchWithNamespace("/api/artifact-templates")
      .then((r) => r.json())
      .then((d) => setArtifactTemplates(d.templates || []))
      .catch(() => {});
  }, [fetchAgent, fetchWithNamespace]);

  const handleSave = async () => {
    if (!form) return;

    setSaving(true);
    setError("");

    try {
      const payload = {
        id: form.id,
        name: form.name,
        description: form.description || undefined,
        role: form.role || undefined,
        version: form.version,
        prompt: form.prompt,
        triggers: parseCommaList(form.triggers),
        emits: form.emits,
        model: form.model || undefined,
        timeout: form.timeout ? parseInt(form.timeout, 10) : undefined,
        retry: {
          max_retries: form.max_retries ? parseInt(form.max_retries, 10) : undefined,
          backoff: form.backoff || undefined,
        },
        tools: parseCommaList(form.tools),
        context: {
          workspace: form.context_workspace || undefined,
          read_first: parseCommaList(form.context_read_first),
        },
        authorities: {
          can: parseCommaList(form.authorities_can),
          needs_approval: parseCommaList(form.authorities_needs_approval),
        },
        artifact_template: form.artifact_template || undefined,
      };

      const res = await fetchWithNamespace(`/api/agents/registry/${encodeURIComponent(form.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save agent");

      setSuccess(true);
      setTimeout(() => router.push(`/agents?id=${form.id}`), 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (agent) setForm(serializeForm(agent));
    setError("");
    setSuccess(false);
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <WaveSpinner size="sm" color="primary" animation="ripple" />
      </div>
    );
  }

  if (error && !form) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4">
        <p className="text-sm text-foreground/50">{error}</p>
        <Link href="/agents">
          <Button size="sm" variant="ghost">Back to Agents</Button>
        </Link>
      </div>
    );
  }

  if (!form) return null;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* header */}
      <div className="flex items-center justify-between px-4 py-2 shrink-0 border-b border-border/10">
        <div className="flex items-center gap-3">
          <Link href="/agents">
            <Button size="sm" variant="ghost" className="h-7 px-2">
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-sm font-medium">Edit Agent</h1>
            <p className="text-xs text-foreground/50">{form.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={handleReset}>
            <RotateCcw className="h-3 w-3" />
            <span className="hidden sm:inline ml-1.5">Reset</span>
          </Button>
          <Button size="sm" variant="default" onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="hidden sm:inline ml-1.5">Saving...</span>
              </>
            ) : (
              <>
                <Save className="h-3 w-3" />
                <span className="hidden sm:inline ml-1.5">Save</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* form */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-2xl mx-auto space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert className="bg-green-500/10 text-green-400 border-green-500/20">
              <AlertDescription className="text-xs">Agent saved successfully</AlertDescription>
            </Alert>
          )}

          {/* basic info */}
          <section className="space-y-3">
            <div>
              <Label htmlFor="id" className="text-[10px] text-foreground/50 uppercase">Agent ID</Label>
              <Input
                id="id"
                value={form.id}
                onChange={(e) => setForm({ ...form, id: e.target.value })}
                disabled
                className="bg-muted/50 text-foreground/40"
              />
            </div>

            <div>
              <Label htmlFor="name" className="text-[10px] text-foreground/50 uppercase">Name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Agent name"
              />
            </div>

            <div>
              <Label htmlFor="description" className="text-[10px] text-foreground/50 uppercase">Description</Label>
              <Input
                id="description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Brief description of what this agent does"
              />
            </div>

            <div>
              <Label htmlFor="role" className="text-[10px] text-foreground/50 uppercase">Role</Label>
              <Input
                id="role"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                placeholder="e.g. developer, reviewer, analyst"
              />
            </div>
          </section>

          {/* artifact template */}
          <section className="space-y-3">
            <div>
              <Label htmlFor="artifact_template" className="text-[10px] text-foreground/50 uppercase">
                Output Template
              </Label>
              <select
                id="artifact_template"
                value={form.artifact_template}
                onChange={(e) => setForm({ ...form, artifact_template: e.target.value })}
                className="mt-1.5 w-full h-9 bg-background border border-input rounded-md px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">None — free-form output</option>
                {artifactTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {t.description}
                  </option>
                ))}
              </select>
              {form.artifact_template && (
                <p className="text-[10px] text-foreground/40 mt-1">
                  {"The template structure will be injected into this agent's system prompt at runtime."}
                </p>
              )}
            </div>
          </section>

          {/* prompt */}
          <section className="space-y-3">
            <div>
              <Label htmlFor="prompt" className="text-[10px] text-foreground/50 uppercase">Prompt</Label>
              <Textarea
                id="prompt"
                value={form.prompt}
                onChange={(e) => setForm({ ...form, prompt: e.target.value })}
                placeholder="Agent system prompt and instructions"
                className="min-h-[200px] font-mono text-xs"
              />
            </div>
          </section>

          {/* events */}
          <section className="space-y-3">
            <div>
              <Label htmlFor="triggers" className="text-[10px] text-foreground/50 uppercase">Triggers</Label>
              <Input
                id="triggers"
                value={form.triggers}
                onChange={(e) => setForm({ ...form, triggers: e.target.value })}
                placeholder="event-one, event-two"
              />
              <p className="text-[10px] text-foreground/30 mt-1">Comma-separated events that start this agent</p>
            </div>

            <div>
              <Label htmlFor="emits" className="text-[10px] text-foreground/50 uppercase">Emits</Label>
              <Input
                id="emits"
                value={form.emits}
                onChange={(e) => setForm({ ...form, emits: e.target.value })}
                placeholder="event-name"
              />
              <p className="text-[10px] text-foreground/30 mt-1">Single event this agent emits when complete</p>
            </div>
          </section>

          {/* execution config */}
          <section className="space-y-3">
            <div>
              <Label htmlFor="model" className="text-[10px] text-foreground/50 uppercase">Model</Label>
              <Input
                id="model"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                placeholder="claude-opus-4-6, gpt-4, etc."
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="timeout" className="text-[10px] text-foreground/50 uppercase">Timeout (seconds)</Label>
                <Input
                  id="timeout"
                  type="number"
                  value={form.timeout}
                  onChange={(e) => setForm({ ...form, timeout: e.target.value })}
                  placeholder="300"
                />
              </div>
              <div>
                <Label htmlFor="max_retries" className="text-[10px] text-foreground/50 uppercase">Max Retries</Label>
                <Input
                  id="max_retries"
                  type="number"
                  value={form.max_retries}
                  onChange={(e) => setForm({ ...form, max_retries: e.target.value })}
                  placeholder="3"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="backoff" className="text-[10px] text-foreground/50 uppercase">Backoff Strategy</Label>
              <Input
                id="backoff"
                value={form.backoff}
                onChange={(e) => setForm({ ...form, backoff: e.target.value })}
                placeholder="exponential, linear, fixed"
              />
            </div>
          </section>

          {/* tools */}
          <section className="space-y-3">
            <div>
              <Label htmlFor="tools" className="text-[10px] text-foreground/50 uppercase">Tools</Label>
              <Input
                id="tools"
                value={form.tools}
                onChange={(e) => setForm({ ...form, tools: e.target.value })}
                placeholder="Read, Write, Edit, Bash, Grep, Glob"
              />
              <p className="text-[10px] text-foreground/30 mt-1">Comma-separated tool names</p>
            </div>
          </section>

          {/* context */}
          <section className="space-y-3">
            <div>
              <Label htmlFor="context_workspace" className="text-[10px] text-foreground/50 uppercase">Context Workspace</Label>
              <Input
                id="context_workspace"
                value={form.context_workspace}
                onChange={(e) => setForm({ ...form, context_workspace: e.target.value })}
                placeholder="local"
              />
            </div>

            <div>
              <Label htmlFor="context_read_first" className="text-[10px] text-foreground/50 uppercase">Read First Files</Label>
              <Input
                id="context_read_first"
                value={form.context_read_first}
                onChange={(e) => setForm({ ...form, context_read_first: e.target.value })}
                placeholder="CLAUDE.md, README.md"
              />
            </div>
          </section>

          {/* authorities */}
          <section className="space-y-3">
            <div>
              <Label htmlFor="authorities_can" className="text-[10px] text-foreground/50 uppercase">Can (permissions)</Label>
              <Input
                id="authorities_can"
                value={form.authorities_can}
                onChange={(e) => setForm({ ...form, authorities_can: e.target.value })}
                placeholder="read-files, edit-files, run-bash"
              />
            </div>

            <div>
              <Label htmlFor="authorities_needs_approval" className="text-[10px] text-foreground/50 uppercase">Needs Approval</Label>
              <Input
                id="authorities_needs_approval"
                value={form.authorities_needs_approval}
                onChange={(e) => setForm({ ...form, authorities_needs_approval: e.target.value })}
                placeholder="delete-files, git-push"
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
