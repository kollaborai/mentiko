"use client";

import { useState } from "react";
import {
  RotateFilled as Loader2,
  MagicStarFilled as Wand2,
  ExportFilled as Save,
  InfoCircleFilled as AlertCircle,
} from "@aliimam/icons";
import { Button } from "@/components/ui/button";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { getApiErrorMessage } from "@/lib/api/api-client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { RegistryAgent } from "@/app/api/agents/registry/route";

interface AgentEditDialogProps {
  open: boolean;
  agent: RegistryAgent;
  onClose: () => void;
  onSaved: () => void;
  workspacePath?: string;
}

export function AgentEditDialog({
  open,
  agent,
  onClose,
  onSaved,
  workspacePath,
}: AgentEditDialogProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [step, setStep] = useState<"describe" | "preview">("describe");
  const [instructions, setInstructions] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editedJson, setEditedJson] = useState("");
  const [jsonError, setJsonError] = useState("");

  // strip registry-only fields before sending to AI
  const agentJson = (() => {
    const { chains: _chains, source: _source, ...rest } = agent;
    return rest;
  })();

  const handleEdit = async () => {
    if (!instructions.trim()) return;

    setEditing(true);
    setError("");

    try {
      const res = await fetchWithNamespace("/api/agents/registry/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentJson,
          instructions,
          ...(workspacePath ? { workspacePath } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(getApiErrorMessage(data, "Failed to start edit job"));

      const { jobId } = data as { jobId: string };

      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const poll = await fetchWithNamespace(`/api/jobs/${jobId}`);
        const job = await poll.json();
        if (job.status === "complete" && job.result) {
          setEditedJson(JSON.stringify(job.result, null, 2));
          setJsonError("");
          setStep("preview");
          return;
        }
        if (job.status === "failed") {
          throw new Error(job.error || "Edit failed");
        }
      }
      throw new Error("Edit timed out");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEditing(false);
    }
  };

  const handleSave = async () => {
    let parsed;
    try {
      parsed = JSON.parse(editedJson);
      setJsonError("");
    } catch (e) {
      setJsonError("Invalid JSON: " + (e instanceof Error ? e.message : String(e)));
      return;
    }

    if (!parsed.id || !parsed.name || !parsed.triggers || !parsed.emits) {
      setJsonError("Agent must have id, name, triggers, and emits");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const res = await fetchWithNamespace("/api/agents/registry/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: parsed, name: parsed.id }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(getApiErrorMessage(data, "Failed to save agent"));

      onSaved();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setStep("describe");
    setInstructions("");
    setError("");
    setEditedJson("");
    setJsonError("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm font-medium">
            {step === "describe" ? `Edit: ${agent.name}` : "Preview & Save"}
          </DialogTitle>
        </DialogHeader>

        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-500/10 rounded-md text-xs text-red-400">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {step === "describe" && (
          <div className="space-y-3 flex-1 min-h-0 flex flex-col">
            <div className="overflow-auto max-h-[200px] bg-muted rounded-md p-3 shrink-0">
              <pre className="text-[10px] font-mono text-foreground/40 whitespace-pre-wrap">
                {JSON.stringify(agentJson, null, 2)}
              </pre>
            </div>
            <Textarea
              placeholder={`Describe the changes you want to make...\n\ne.g. "Add bash and file read tools. Make the prompt more concise. Use the default profile model."`}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className="flex-1 min-h-[120px] text-sm bg-muted resize-none"
              autoFocus
            />
            <div className="flex justify-end gap-2 shrink-0">
              <Button variant="ghost" size="sm" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleEdit}
                disabled={!instructions.trim() || editing}
              >
                {editing ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span className="ml-1.5">Applying...</span>
                  </>
                ) : (
                  <>
                    <Wand2 className="h-3 w-3" />
                    <span className="ml-1.5">Apply Changes</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-3 flex-1 min-h-0 flex flex-col">
            {jsonError && (
              <div className="text-xs text-red-400 p-2 bg-red-500/10 rounded-md shrink-0">
                {jsonError}
              </div>
            )}
            <textarea
              value={editedJson}
              onChange={(e) => setEditedJson(e.target.value)}
              className="flex-1 min-h-[300px] w-full bg-muted rounded-md p-3 text-xs font-mono resize-none outline-none focus:ring-1 focus:ring-foreground/10"
              spellCheck={false}
            />
            <div className="flex justify-between gap-2 shrink-0">
              <Button variant="ghost" size="sm" onClick={() => setStep("describe")}>
                Back
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={handleClose}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span className="ml-1.5">Saving...</span>
                    </>
                  ) : (
                    <>
                      <Save className="h-3 w-3" />
                      <span className="ml-1.5">Save Agent</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
