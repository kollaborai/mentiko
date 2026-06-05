"use client";

import { useState, useEffect } from "react";
import {
  RotateFilled as Loader2,
  ExportFilled as Save,
  InfoCircleFilled as AlertCircle,
  DocumentTextFilled as FileText,
} from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { getApiErrorMessage } from "@/lib/api/api-client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArtifactSelector, type ArtifactTemplate, type SelectedArtifact } from "./artifact-selector";
import type { ArtifactType } from "@/lib/system/artifact-template-storage";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  artifactTemplates: ArtifactTemplate[];
}

export function AgentCreateDialog({
  open,
  onClose,
  onSaved,
  artifactTemplates,
}: Props) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [step, setStep] = useState<"form" | "preview">("form");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // basic fields
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [description, setDescription] = useState("");

  // events
  const [triggers, setTriggers] = useState<string[]>([]);
  const [triggerInput, setTriggerInput] = useState("");
  const [emitsList, setEmitsList] = useState<string[]>([]);
  const [emitInput, setEmitInput] = useState("");

  // artifacts
  const [selectedArtifacts, setSelectedArtifacts] = useState<SelectedArtifact[]>([]);

  // prompt
  const [prompt, setPrompt] = useState("");

  // preview
  const [previewJson, setPreviewJson] = useState("");

  // auto-generate id from name
  useEffect(() => {
    if (name && !id) {
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      setId(slug);
    }
  }, [name, id]);

  const idValid = /^[a-z0-9-]+$/.test(id);
  const formValid =
    idValid &&
    name.trim() &&
    triggers.length > 0 &&
    emitsList.length > 0 &&
    prompt.trim();

  const handleAddTrigger = () => {
    const trimmed = triggerInput.trim();
    if (trimmed && !triggers.includes(trimmed)) {
      setTriggers([...triggers, trimmed]);
      setTriggerInput("");
    }
  };

  const handleRemoveTrigger = (t: string) => {
    setTriggers(triggers.filter((x) => x !== t));
  };

  const handleAddEmit = () => {
    const trimmed = emitInput.trim();
    if (trimmed && !emitsList.includes(trimmed)) {
      setEmitsList([...emitsList, trimmed]);
      setEmitInput("");
    }
  };

  const handleRemoveEmit = (e: string) => {
    setEmitsList(emitsList.filter((x) => x !== e));
  };

  const handlePreview = () => {
    const agent = {
      id,
      name: name.trim(),
      role: role.trim() || name.trim(),
      description: description.trim() || undefined,
      triggers,
      emits: emitsList.join(", "),
      artifacts: selectedArtifacts.length > 0
        ? { produces: selectedArtifacts.map((a) => ({ $ref: `artifact:${a.id}` })) }
        : undefined,
      prompt: prompt.trim(),
    };
    setPreviewJson(JSON.stringify(agent, null, 2));
    setStep("preview");
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");

    try {
      const agent = previewJson ? JSON.parse(previewJson) : {
        id,
        name: name.trim(),
        role: role.trim() || name.trim(),
        description: description.trim() || undefined,
        triggers,
        emits: emitsList.join(", "),
        artifacts: selectedArtifacts.length > 0
          ? { produces: selectedArtifacts.map((a) => ({ $ref: `artifact:${a.id}` })) }
          : undefined,
        prompt: prompt.trim(),
      };

      const res = await fetchWithNamespace("/api/agents/registry/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent, name: agent.id }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(getApiErrorMessage(data, "Failed to save agent"));
      }

      onSaved();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleCreateArtifact = async (artifact: {
    id: string;
    name: string;
    type: string;
    description: string;
    content: string;
  }) => {
    try {
      const res = await fetchWithNamespace("/api/artifact-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(artifact),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(getApiErrorMessage(data, "Failed to create artifact"));
      }

      // add the new artifact to selected list
      setSelectedArtifacts([
        ...selectedArtifacts,
        { id: artifact.id, type: artifact.type as ArtifactType, description: artifact.description },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleClose = () => {
    setStep("form");
    setId("");
    setName("");
    setRole("");
    setDescription("");
    setTriggers([]);
    setTriggerInput("");
    setEmitsList([]);
    setEmitInput("");
    setSelectedArtifacts([]);
    setPrompt("");
    setPreviewJson("");
    setError("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm font-medium flex items-center gap-2">
            <FileText className="h-4 w-4 text-blue-400" />
            {step === "form" ? "Create Agent" : "Preview & Save"}
          </DialogTitle>
        </DialogHeader>

        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-500/10 rounded-md text-xs text-red-400">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {step === "form" ? (
          <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-y-auto">
            {/* basic section */}
            <div className="space-y-3">
              <p className="text-[10px] font-medium text-foreground/40 uppercase tracking-wider">
                basic
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-foreground/40 uppercase tracking-wide">
                    id (slug)
                  </label>
                  <Input
                    placeholder="code-reviewer"
                    value={id}
                    onChange={(e) => setId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                    className="mt-1 text-xs font-mono h-8 bg-muted"
                  />
                  {!idValid && id && (
                    <p className="text-[9px] text-red-400 mt-0.5">lowercase letters, numbers, hyphens only</p>
                  )}
                </div>
                <div>
                  <label className="text-[10px] text-foreground/40 uppercase tracking-wide">
                    name
                  </label>
                  <Input
                    placeholder="Code Reviewer"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1 text-xs h-8 bg-muted"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-foreground/40 uppercase tracking-wide">
                  role
                </label>
                <Input
                  placeholder="e.g. security-analyst, code-reviewer"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="mt-1 text-xs h-8 bg-muted"
                />
              </div>
              <div>
                <label className="text-[10px] text-foreground/40 uppercase tracking-wide">
                  description
                </label>
                <Input
                  placeholder="what this agent does"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-1 text-xs h-8 bg-muted"
                />
              </div>
            </div>

            {/* events section */}
            <div className="space-y-3">
              <p className="text-[10px] font-medium text-foreground/40 uppercase tracking-wider">
                events
              </p>
              <div>
                <label className="text-[10px] text-foreground/40 uppercase tracking-wide">
                  triggers (what starts this agent)
                </label>
                <div className="flex gap-2 mt-1">
                  <Input
                    placeholder="e.g. code.push, task.created"
                    value={triggerInput}
                    onChange={(e) => setTriggerInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddTrigger())}
                    className="flex-1 text-xs h-8 bg-muted"
                  />
                  <Button
                    size="sm"
                    onClick={handleAddTrigger}
                    disabled={!triggerInput.trim()}
                    className="h-8"
                  >
                    add
                  </Button>
                </div>
                {triggers.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {triggers.map((t) => (
                      <span
                        key={t}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-card text-xs"
                      >
                        {t}
                        <button
                          type="button"
                          onClick={() => handleRemoveTrigger(t)}
                          className="text-foreground/30 hover:text-foreground"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="text-[10px] text-foreground/40 uppercase tracking-wide">
                  emits (what this agent produces)
                </label>
                <div className="flex gap-2 mt-1">
                  <Input
                    placeholder="e.g. code.reviewed, analysis.complete"
                    value={emitInput}
                    onChange={(e) => setEmitInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddEmit())}
                    className="flex-1 text-xs h-8 bg-muted"
                  />
                  <Button
                    size="sm"
                    onClick={handleAddEmit}
                    disabled={!emitInput.trim()}
                    className="h-8"
                  >
                    add
                  </Button>
                </div>
                {emitsList.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {emitsList.map((e) => (
                      <span
                        key={e}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-card text-xs"
                      >
                        {e}
                        <button
                          type="button"
                          onClick={() => handleRemoveEmit(e)}
                          className="text-foreground/30 hover:text-foreground"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* artifacts section */}
            <div className="space-y-3">
              <p className="text-[10px] font-medium text-foreground/40 uppercase tracking-wider">
                artifacts
              </p>
              <ArtifactSelector
                selected={selectedArtifacts}
                onChange={setSelectedArtifacts}
                artifactTemplates={artifactTemplates}
                onCreateArtifact={handleCreateArtifact}
              />
            </div>

            {/* prompt section */}
            <div className="flex-1 min-h-0 flex flex-col">
              <label className="text-[10px] text-foreground/40 uppercase tracking-wide">
                prompt
              </label>
              <Textarea
                placeholder="You are a specialized agent that..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="flex-1 min-h-[120px] text-xs bg-muted resize-none"
              />
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col">
            <textarea
              value={previewJson}
              onChange={(e) => setPreviewJson(e.target.value)}
              className="flex-1 min-h-[300px] w-full bg-muted rounded-md p-3 text-xs font-mono resize-none outline-none"
              spellCheck={false}
            />
          </div>
        )}

        <div className="flex justify-between gap-2 pt-2">
          {step === "preview" ? (
            <Button variant="ghost" size="sm" onClick={() => setStep("form")}>
              back
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={handleClose}>
              cancel
            </Button>
          )}
          <div className="flex gap-2">
            {step === "form" ? (
              <Button size="sm" onClick={handlePreview} disabled={!formValid}>
                preview
              </Button>
            ) : (
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span className="ml-1.5">saving...</span>
                  </>
                ) : (
                  <>
                    <Save className="h-3 w-3" />
                    <span className="ml-1.5">save agent</span>
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
